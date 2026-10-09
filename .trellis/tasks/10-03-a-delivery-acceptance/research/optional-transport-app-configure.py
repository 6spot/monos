#!/usr/bin/env python3
"""Once-only installed HTTP save_github; the RSA PEM arrives solely on stdin.
The original PEM-bearing envelope remains root-private for receipt recovery.
No command replay, provider write, Task admission, model or credential output.
"""
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import urllib.error
import urllib.request
import uuid

WORK = Path('/root/monos-optional-transport-app-v1')
INSTALLED = Path('/root/monos-optional-transport-install-v1/result.json')
PRIVATE = Path('/root/monos-delivery-acceptance-fresh-v1/infra/compose/private')
SERVER = 'ed4742360c0362d95e16d5cb172f35b46f739fbc366e77e03bee1a0cb8a9e27d'
IMAGE = 'sha256:f8577deb0497677c32c4ff4ed9121dcd5400a5722a5bdf5fa78c8c0dbbff5d32'
COMMIT = '4a48cdc7f7eb78f201828733307b030c3de4448a'
ORIGIN, APP, INSTALLATION = 'http://127.0.0.1:18445', '5237783', '169256543'
REPO, FULL_NAME = '1393178791', '6spot/monolab-feasibility-20260928-160020-public'
FINGERPRINT = '4c6ee0f9aed7a1ab1071fd40276ffd6be6f44fa12de771feb33ba2c213d4851e'
CLAIMED, BINDING, REQUESTS, SERVER_START = False, None, 0, None
JAR = http.cookiejar.CookieJar()
STATE = {'outcome': 'failed', 'submitted': False, 'receipt_confirmed': False, 'session_unknown': False, 'automatic_retry': False}


class Stop(Exception):
    pass


def need(ok, code):
    if not ok:
        raise Stop(code)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()


def read(path):
    for parent in path.parents:
        s = parent.lstat()
        need(stat.S_ISDIR(s.st_mode) and s.st_uid == 0 and not s.st_mode & 0o022, 'unsafe_private_parent')
    s = path.lstat()
    need(stat.S_ISREG(s.st_mode) and s.st_uid == 0 and stat.S_IMODE(s.st_mode) == 0o600 and s.st_size <= 2 << 20, 'unsafe_private_file')
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as f:
        raw = f.read((2 << 20) + 1)
        signature = lambda v: (v.st_dev, v.st_ino, v.st_mode, v.st_uid, v.st_gid, v.st_size, v.st_mtime_ns, v.st_ctime_ns)
        need(signature(s) == signature(os.fstat(f.fileno())) == signature(path.lstat()) and len(raw) <= 2 << 20, 'private_file_changed')
    return raw


def save(name, value):
    with os.fdopen(os.open(WORK / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), 'wb') as f:
        f.write(value if isinstance(value, bytes) else canonical(value))
        f.flush(); os.fsync(f.fileno())
    fd = os.open(WORK, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def docker(args, data=None):
    p = subprocess.run(['/usr/bin/docker', *args], input=data, capture_output=True, timeout=15,
                       env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})
    need(p.returncode == 0 and not p.stderr and len(p.stdout) <= 2 << 20, 'docker_read_failed')
    return json.loads(p.stdout)


def server_guard():
    row = docker(['inspect', SERVER])[0]
    need(row['Id'] == SERVER and row['Image'] == IMAGE and row['State']['Running'] is True
         and not row['State']['Paused'] and not row['State']['Restarting'] and row['RestartCount'] == SERVER_START[1]
         and row['State']['StartedAt'] == SERVER_START[0] and row['Name'] == '/monos-delivery-acceptance-fresh-v1-server-1'
         and row['Config']['Labels'].get('com.docker.compose.project') == 'monos-delivery-acceptance-fresh-v1'
         and row['HostConfig']['PortBindings'] == {'18443/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '18445'}]}, 'installed_server_changed')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request(path, body=None, method='GET'):
    global REQUESTS
    REQUESTS += 1
    need(REQUESTS <= 16, 'request_count_bound')
    server_guard()
    save('%02d.intent.json' % REQUESTS, {'method': method, 'path': path})
    headers = {'Origin': ORIGIN, 'Accept': 'application/json'}
    if BINDING:
        headers['X-Monos-Session'] = BINDING
    if body is not None:
        headers['Content-Type'] = 'application/json'
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(), urllib.request.HTTPCookieProcessor(JAR))
    try:
        with opener.open(urllib.request.Request(ORIGIN + path, data=body, headers=headers, method=method), timeout=30) as response:
            raw = response.read((2 << 20) + 1)
            need(response.status == 200 and len(raw) <= 2 << 20 and response.headers.get('Cache-Control') == 'no-store'
                 and response.headers.get_content_type() == 'application/json', 'invalid_http_response')
            result = json.loads(raw)
    except urllib.error.HTTPError as error:
        code = error.code; error.close()
        raise Stop('http_status_%d' % code) from None
    except (OSError, ValueError):
        raise Stop('http_completion_unknown') from None
    server_guard()
    save('%02d.result.json' % REQUESTS, {'status': 200, 'body_not_recorded': True})
    return result


def committed(value, request_id, version):
    need(type(value.get('schema_version')) is int and type(value.get('control_version')) is int
         and value == {'schema_version': 1, 'request_id': request_id, 'status': 'committed',
                   'control_version': version + 1, 'entity_id': 'save_github'}, 'original_commit_unconfirmed')


def configure():
    global CLAIMED, BINDING, SERVER_START
    need(os.geteuid() == 0 and sys.platform == 'linux', 'linux_root_required')
    os.mkdir(WORK, 0o700); CLAIMED = True
    fd = os.open(WORK.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    installed = json.loads(read(INSTALLED))
    need(installed['outcome'] == 'pass' and installed['candidate_commit'] == COMMIT and installed['server_image'] == IMAGE
         and installed['server'][0] == SERVER and installed['endpoint'] == ORIGIN, 'installation_pass_required')
    SERVER_START = tuple(installed['server'][1:]); server_guard()
    STATE.update(request_id=str(uuid.uuid4()), app_id=APP, installation_id=INSTALLATION, server_id=SERVER)
    save('intent.json', STATE)
    pem = sys.stdin.buffer.read(16385)
    need(0 < len(pem) <= 16384 and re.fullmatch(rb'-----BEGIN (RSA PRIVATE KEY|PRIVATE KEY)-----\r?\n[A-Za-z0-9+/=\r\n]+-----END \1-----\r?\n?', pem), 'unencrypted_pem_required')
    code = """const c=require('node:crypto'),k=c.createPrivateKey(require('node:fs').readFileSync(0));
if(k.asymmetricKeyType!=='rsa'||k.asymmetricKeyDetails.modulusLength<2048)process.exit(2);
process.stdout.write(JSON.stringify(c.createHash('sha256').update(c.createPublicKey(k).export({type:'spki',format:'der'})).digest('hex')));"""
    need(docker(['exec', '-i', SERVER, 'node', '-e', code], pem) == FINGERPRINT, 'app_key_fingerprint_changed')
    owner = json.loads(read(PRIVATE / 'owner-bootstrap.json'))
    need(set(owner) == {'password'} and isinstance(owner['password'], str) and 12 <= len(owner['password'])
         and len(owner['password'].encode()) <= 1024, 'owner_input_invalid')
    STATE['session_unknown'] = True
    login = request('/v1/owner/login', canonical({'schema_version': 1, **owner}), 'POST')
    need(login.get('schema_version') == 1 and login.get('authenticated') is True
         and re.fullmatch(r'[0-9a-f-]{36}', login.get('session_id', '')), 'login_session_invalid')
    BINDING = login['session_id']
    need(len(list(JAR)) == 1 and next(iter(JAR)).name == 'monos' and not next(iter(JAR)).secure, 'http_session_cookie_invalid')
    need(request('/v1/owner/session') == login, 'session_binding_changed')
    before = request('/v1/owner/configuration'); version = before['control_version']
    need(before.get('schema_version') == 1 and 'github' not in before and type(version) is int and 0 <= version < 9007199254740991, 'initial_configuration_changed')
    envelope = canonical({'schema_version': 1, 'request_id': STATE['request_id'], 'expected_control_version': version,
                          'name': 'save_github', 'payload': {'app_id': APP, 'installation_id': INSTALLATION, 'private_key': pem.decode('ascii')}})
    save('original-command.json', envelope)
    need(read(WORK / 'original-command.json') == envelope, 'original_command_changed')
    STATE['command_digest'] = hashlib.sha256(envelope).hexdigest()
    save('command.intent.json', {'request_id': STATE['request_id'], 'command_digest': STATE['command_digest'], 'expected_control_version': version})
    STATE['submitted'] = True
    try:
        response = request('/v1/owner/configuration/commands', envelope, 'POST')
        committed(response, STATE['request_id'], version)
        STATE['response_committed'] = True
    except Stop as error:
        STATE['submit_observation'] = str(error)  # Read the same receipt once; never resend.
    receipt = request('/v1/owner/configuration/commands/' + STATE['request_id'])
    committed(receipt, STATE['request_id'], version); STATE['receipt_confirmed'] = True
    after = request('/v1/owner/configuration')
    need(after == {**before, 'control_version': version + 1, 'github': {'app_id': APP, 'installation_id': INSTALLATION,
         'key_fingerprint': FINGERPRINT}}, 'configured_snapshot_changed')
    for page in range(1, 9):
        catalog = request('/v1/owner/github/repositories?page=' + str(page))
        need(catalog.get('schema_version') == 1 and isinstance(catalog.get('repositories'), list) and len(catalog['repositories']) <= 100, 'catalog_shape_invalid')
        selected = [r for r in catalog['repositories'] if r.get('provider_repo_id') == REPO]
        need(len(selected) <= 1, 'duplicate_selected_repository')
        if selected:
            r = selected[0]
            need(r.get('full_name') == FULL_NAME and r.get('remote_url') == 'https://github.com/' + FULL_NAME + '.git'
                 and isinstance(r.get('default_branch'), str) and bool(r['default_branch']) and r.get('private') is False, 'selected_repository_changed')
            STATE.update(outcome='pass', key_fingerprint=FINGERPRINT, repository_id=REPO, catalog_pages=page)
            return
        need(type(catalog.get('next_page')) is int and catalog['next_page'] == page + 1 and page < 8, 'selected_repository_missing')


def main():
    try:
        configure()
    except Exception as error:
        STATE['reason'] = str(error) if isinstance(error, Stop) else 'local_or_request_failure'
    finally:
        if STATE['session_unknown'] and list(JAR):
            try:
                need(request('/v1/owner/logout', method='POST') == {'schema_version': 1, 'authenticated': False}
                     and not list(JAR), 'logout_unconfirmed')
                STATE['session_unknown'] = False
            except Exception:
                STATE.update(outcome='failed', logout='unconfirmed')
        if STATE['session_unknown']:
            STATE['outcome'] = 'failed'
        if CLAIMED:
            try:
                save('result.json', STATE)
            except Exception:
                STATE.update(outcome='failed', evidence='result_write_unconfirmed')
    return STATE


if __name__ == '__main__':
    os.umask(0o077)
    result = main()
    print(json.dumps(result, sort_keys=True))
    raise SystemExit(0 if result['outcome'] == 'pass' else 1)
