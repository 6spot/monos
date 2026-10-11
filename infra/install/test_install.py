import contextlib
import io
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import ANY, patch

import install


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='monos-install-test-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.state = self.root / 'state'
        self.state.mkdir(mode=0o700)
        self.password = {'password': 'synthetic-install-owner-password'}

    def instance(self):
        instance = install.Installer(self.root, self.root / 'binaries', self.state, self.password, 1000)
        instance.manifest = lambda: {'synthetic': 'same-inputs'}
        instance.fresh_preflight = lambda: None
        return instance

    def test_private_publication_is_reusable_without_overwriting_or_following_links(self):
        target = self.state / 'credential'
        install.publish_private(target, b'synthetic-private-value')
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)
        install.publish_private(target, b'synthetic-private-value')
        with self.assertRaises(install.InstallError):
            install.publish_private(target, b'different-value')
        self.assertEqual(target.read_bytes(), b'synthetic-private-value')
        link = self.state / 'link'
        link.symlink_to(target)
        with self.assertRaises(OSError):
            install.publish_private(link, b'synthetic-private-value')
        staging = target.parent / ('.' + target.name + '.install-staging')
        os.link(target, staging)
        install.publish_private(target, b'synthetic-private-value')
        self.assertFalse(staging.exists())
        self.assertEqual(target.stat().st_nlink, 1)
        foreign = self.state / 'foreign-alias'
        os.link(target, foreign)
        with self.assertRaises(install.InstallError):
            install.publish_private(target, b'synthetic-private-value')
        foreign.unlink()
        staged_target = self.state / 'staged-only'
        staged_file = self.state / '.staged-only.install-staging'
        install.publish_private(staged_file, b'complete-staging')
        with patch.object(install.os, 'fsync', side_effect=OSError('synthetic sync failure')):
            with self.assertRaises(OSError):
                install.publish_private(staged_target, b'complete-staging')
        self.assertFalse(staged_target.exists())
        self.assertEqual(staged_file.read_bytes(), b'complete-staging')
        with patch.object(install.os, 'fsync', wraps=os.fsync):
            install.publish_private(staged_target, b'complete-staging')
        self.assertEqual(staged_target.read_bytes(), b'complete-staging')
        target.chmod(0o644)
        with self.assertRaises(install.InstallError):
            install.private_read(target)

    def test_bounded_owner_input_and_argument_errors_never_echo_credentials(self):
        self.assertEqual(install.owner_input(io.BytesIO(install.encode(self.password))), self.password)
        for payload in (b'x' * 4097, b'{', b'{"password":"short"}', b'{"password":{},"unexpected":true}'):
            with self.assertRaises(install.InstallError):
                install.owner_input(io.BytesIO(payload))
        result = subprocess.run([sys.executable, str(Path(install.__file__)), '--unknown-synthetic-secret'], capture_output=True, check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(b'unknown-synthetic-secret', result.stderr)
        plan = subprocess.run([sys.executable, str(Path(install.__file__)), '--artifacts', '/not-required-for-plan', '--plan'], capture_output=True, check=False)
        self.assertEqual(plan.returncode, 0)
        self.assertIn(b'prepare -> backend -> owner', plan.stdout)

    def test_resume_keeps_identity_skips_finished_stages_and_requires_same_inputs(self):
        original = self.instance()
        original.load(False)
        calls = []
        for stage in install.STAGES:
            setattr(original, stage, lambda stage=stage: calls.append(stage))
        def prepared():
            calls.append('prepare')
            original.state['private_digests'] = {'synthetic': 'durable digest'}
        original.prepare = prepared
        def interrupted():
            calls.append('owner')
            raise install.InstallError('Synthetic interruption')
        original.owner = interrupted
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(install.InstallError):
            original.execute()
        prior = json.loads(install.private_read(original.path))
        self.assertEqual(prior['done'], ['prepare', 'backend'])
        self.assertEqual(prior['pending'], 'owner')
        resumed = self.instance()
        resumed.load(True)
        for stage in install.STAGES:
            setattr(resumed, stage, lambda stage=stage: calls.append(stage))
        with contextlib.redirect_stdout(io.StringIO()):
            resumed.execute()
        self.assertEqual(calls.count('prepare'), 1)
        self.assertEqual(calls.count('backend'), 1)
        self.assertEqual(resumed.state['installation_id'], prior['installation_id'])
        self.assertEqual(resumed.state['done'], list(install.STAGES))
        changed = self.instance()
        changed.manifest = lambda: {'synthetic': 'different-inputs'}
        with self.assertRaises(install.InstallError):
            changed.load(True)
        with self.assertRaises(install.InstallError):
            self.instance().load(False)

    def test_failed_intent_persistence_prevents_the_next_command(self):
        instance = self.instance()
        instance.load(False)
        calls = []
        instance.prepare = lambda: calls.append('prepare')
        with patch.object(instance, 'save', side_effect=OSError('synthetic disk failure')):
            with self.assertRaises(OSError):
                instance.execute()
        self.assertEqual(calls, [])

    def test_uncertain_owner_bootstrap_authenticates_original_input_without_rotation(self):
        instance = self.instance()
        calls = []
        def run(args, data=None, **options):
            calls.append((args, data, options))
            return SimpleNamespace(returncode=1 if args[-1].endswith('owner-admin.ts') else 2, stdout=b'')
        instance.run = run
        instance.owner()
        self.assertEqual(len(calls), 2)
        self.assertNotIn('--rotate', calls[0][0])
        self.assertEqual(json.loads(calls[0][1]), self.password)
        self.assertEqual(json.loads(calls[1][1])['password'], self.password['password'])
        self.assertTrue(all(self.password['password'] not in str(args) for args, _, _ in calls))

    def test_interrupted_enrollment_reuses_pending_request_without_issuing_another_grant(self):
        instance = self.instance()
        instance.state = {}
        identity = self.state / 'runner-identity.json'
        pending = self.state / 'runner-identity.json.enroll.pending'
        calls = []
        interrupted = True
        credential = 'synthetic-original-runner-credential'
        expected_hash = hashlib.sha256(credential.encode()).hexdigest()
        def run(args, data=None, **_options):
            calls.append((args, data))
            if args[-1] == '--verify':
                proof = json.loads(data)
                if proof['credential_hash'] != expected_hash:
                    raise install.InstallError('Synthetic proof mismatch')
                return SimpleNamespace(returncode=0, stdout=install.encode({'schema_version': 1, 'runner_id': 'runner-1', 'request_id': 'request-1'}))
            if args[-1].endswith('runner-enrollment-admin.ts'):
                return SimpleNamespace(returncode=0, stdout=b'{"enrollment_id":"enrollment-1"}\n')
            if interrupted:
                install.publish_private(pending, b'{"synthetic":"retained request"}')
                raise install.InstallError('Synthetic response loss')
            install.publish_private(identity, install.encode({'schema_version': 1, 'runner_id': 'runner-1', 'credential': credential}))
            pending.unlink()
            return SimpleNamespace(returncode=0, stdout=b'Runner enrolled')
        instance.run = run
        with patch.object(install, 'IDENTITY', identity), patch.object(install.pwd, 'getpwnam', return_value=SimpleNamespace(pw_uid=os.geteuid())):
            with self.assertRaises(install.InstallError):
                instance.enroll()
            interrupted = False
            instance.enroll()
            instance.state = {}  # Successful CLI exit, but installer stage save was lost.
            instance.enroll()
            self.assertEqual(sum('--verify' in args for args, _ in calls), 2)
            self.assertEqual(sum(args[0] == 'sudo' for args, _ in calls), 2)
            self.assertIn('identity_digest', instance.state)
            identity.write_bytes(install.encode({'schema_version': 1, 'runner_id': 'runner-1', 'credential': 'different-credential'}))
            instance.state = {}
            with self.assertRaises(install.InstallError):
                instance.enroll()
            self.assertNotIn('identity_digest', instance.state)
        self.assertEqual(sum(args[-1].endswith('runner-enrollment-admin.ts') for args, _ in calls), 1)
        self.assertEqual([data for args, data in calls if args[0] == 'sudo'][-1], b'')
        self.assertEqual((self.state / 'enrollment-grant.json').stat().st_mode & 0o777, 0o600)

    def test_current_configuration_contains_private_identity_and_bounded_resource_defaults(self):
        instance = self.instance()
        instance.state = {}
        config = self.state / 'runner.json'
        with patch.object(install, 'CONFIG', config), patch.object(install.pwd, 'getpwnam', return_value=SimpleNamespace(pw_uid=os.geteuid(), pw_gid=os.getegid())), patch.object(install.os, 'fchown') as ownership:
            instance.runner_config()
            ownership.assert_called_once_with(ANY, 0, os.getegid())
        value = json.loads(install.private_read(config, mode=0o640, group=os.getegid()))
        self.assertEqual(value['runner_id'], '')
        self.assertEqual(value['execution_uid'], 1000)
        self.assertEqual(value['execution_limits']['tasks_max'], 512)
        self.assertNotIn('credential', value)
        self.assertEqual(config.stat().st_mode & 0o777, 0o640)

    def test_local_docker_context_rejects_remote_and_environment_overrides(self):
        instance = self.instance()
        instance.run = lambda *_args, **_options: SimpleNamespace(stdout=b'"ssh://synthetic-remote"')
        with patch.dict(os.environ, {}, clear=True), self.assertRaises(install.InstallError):
            instance.local_docker_context()
        instance.run = lambda *_args, **_options: SimpleNamespace(stdout=b'"unix:///var/run/docker.sock"')
        with patch.dict(os.environ, {}, clear=True):
            instance.local_docker_context()
        with patch.dict(os.environ, {'DOCKER_HOST': 'tcp://synthetic-remote'}), self.assertRaises(install.InstallError):
            instance.local_docker_context()


if __name__ == '__main__':
    unittest.main()
