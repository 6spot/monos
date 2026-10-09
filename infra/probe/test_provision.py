"""Configuration outputs with host identity/Git effects replaced by fixtures."""
import contextlib
import io
import json
import pathlib
import tempfile
import types
import unittest
from unittest.mock import patch

import provision


class ProvisionTests(unittest.TestCase):
    def test_http_and_system_trusted_https_do_not_read_or_copy_ca(self):
        for arguments, endpoint in (([], 'http://127.0.0.1:18443'),
                                    (['--endpoint', 'https://localhost:18443'], 'https://localhost:18443')):
            with self.subTest(endpoint=endpoint), tempfile.TemporaryDirectory() as directory:
                root = pathlib.Path(directory)
                private = root / 'infra/compose/private'
                private.mkdir(parents=True)
                (private / 'runner_credential').write_text('a' * 96 + '\n')
                marker = root / 'marker'
                marker.write_text('monos-boundary-probe-v1\n')
                service = types.SimpleNamespace(pw_uid=1001, pw_gid=1002, pw_dir=str(root / 'service'), pw_shell='/usr/sbin/nologin')
                execution = types.SimpleNamespace(pw_uid=1000, pw_gid=1000)
                with contextlib.ExitStack() as stack:
                    for name, value in (('SOURCE', root), ('ROOT', root), ('CONFIG', root / 'config'), ('MARKER', marker)):
                        stack.enter_context(patch.object(provision, name, value))
                    stack.enter_context(patch.object(provision.sys, 'argv', ['provision.py', *arguments]))
                    stack.enter_context(patch.object(provision.sys, 'platform', 'linux'))
                    stack.enter_context(patch.object(provision.os, 'geteuid', return_value=0))
                    stack.enter_context(patch.object(provision.os, 'getgrouplist', return_value=[1002]))
                    stack.enter_context(patch.object(provision.pwd, 'getpwnam', side_effect=[service, execution]))
                    stack.enter_context(patch.object(provision.grp, 'getgrnam', return_value=types.SimpleNamespace(gr_gid=1002)))
                    stack.enter_context(patch.object(provision, 'directory'))
                    regular = stack.enter_context(patch.object(provision, 'regular'))
                    stack.enter_context(patch.object(provision, 'check_existing', return_value=False))
                    create = stack.enter_context(patch.object(provision, 'create_file'))
                    stack.enter_context(patch.object(provision.subprocess, 'run', return_value=types.SimpleNamespace(returncode=0, stdout=b'{}')))
                    stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
                    provision.main()
                self.assertEqual(create.call_count, 2)
                entries = {call.args[0].name: call.args for call in create.call_args_list}
                settings = json.loads(entries['runner.json'][1])
                self.assertEqual(settings['endpoint'], endpoint)
                self.assertNotIn('ca_file', settings)
                self.assertEqual(entries['runner-token'][2:], (1001, 1002, 0o600))
                self.assertFalse(any(call.args[0].suffix in ('.crt', '.pem') for call in regular.call_args_list))

    def test_http_ca_is_rejected_before_host_access(self):
        with patch.object(provision.sys, 'argv', ['provision.py', '--ca-file', 'ca.crt']), patch.object(provision.pwd, 'getpwnam') as identity:
            with self.assertRaisesRegex(ValueError, 'requires an HTTPS endpoint'):
                provision.main()
            identity.assert_not_called()


if __name__ == '__main__':
    unittest.main()
