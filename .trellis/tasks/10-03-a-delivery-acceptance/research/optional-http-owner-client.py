#!/usr/bin/env python3
"""One ordinary Owner request from stdin: {path, method: GET|POST, body?}.
Stage the hash-bound optional-transport-app-configure.py beside this file, mode
0600. Only its validated HTTP/file/identity primitives are reused; never its App
configuration flow. POST IDs and versions come from the parent, never this helper.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import types
import urllib.parse
import uuid

DEPENDENCY_SHA = '8158e8391ffb3d02e6d023d0bafc6e0f504de2a5e45ebdbc24a74f64e36767f3'
BASE = Path('/root/monos-optional-http-owner-requests-v1')
APP_RESULT = Path('/root/monos-optional-transport-app-v1/result.json')
ID = r'[A-Za-z0-9_-]{1,128}'
SECRET_FIELDS = {'privatekey', 'password', 'bearer', 'token', 'credential', 'secret', 'authorization',
                 'cookie', 'sessionid', 'accesstoken', 'refreshtoken', 'signingkey'}
COMMANDS = {
    '/v1/owner/configuration/commands': ({'save_policies', 'save_planner_guidance', 'save_role', 'save_project'}, 'expected_control_version'),
    '/v1/owner/todos/commands': ({'capture_todo'}, None),
    '/v1/owner/todos/discussion/commands': ({'submit_discussion_message'}, 'todo_id'),
    '/v1/owner/task-previews/commands': ({'confirm_task_preview', 'create_execution_task'}, 'todo_id'),
    '/v1/owner/commands': ({'start_task', 'cancel_task'}, 'scope_id'),
    '/v1/owner/tasks/conversation/commands': ({'submit_task_message'}, 'task_id'),
    '/v1/owner/tasks/review/commands': ({'request_changes'}, 'task_id'),
    '/v1/owner/tasks/delivery/commands': ({'prepare_delivery_acceptance', 'confirm_delivery_acceptance', 'accept_delivery', 'cancel_delivery'}, 'task_id'),
}
READS = [
    (r'/v1/owner/(configuration|infrastructure)', ()),
    (r'/v1/owner/(configuration|task-previews|todos|todos/discussion)/commands/' + ID, ()),
    (r'/v1/owner/scopes/' + ID + '/commands/' + ID, ()),
    (r'/v1/owner/(todos|tasks)', ('cursor',)),
    (r'/v1/owner/todos/' + ID, ()),
    (r'/v1/owner/todos/' + ID + '/(discussion|attempts|discussion/messages)', ('cursor',)),
    (r'/v1/owner/todos/' + ID + '/(attempts|operations)/' + ID, ()),
    (r'/v1/owner/todos/' + ID + '/task-previews/' + ID, ('project_id',)),
    (r'/v1/owner/tasks/' + ID, ()),
    (r'/v1/owner/tasks/' + ID + '/(planning|conversation|specification)', ()),
    (r'/v1/owner/tasks/' + ID + '/(results|events|attempts|artifacts|publication-candidates|remote-preparation|conversation/messages|conversation/operations|specification/proposals|specification/revisions)', ('cursor',)),
    (r'/v1/owner/tasks/' + ID + '/(plans|attempts|operations|artifacts|publication-candidates|remote-preparation|specification/proposals|specification/revisions)/' + ID, ()),
    (r'/v1/owner/tasks/' + ID + '/attempts/' + ID + '/workspace', ()),
    (r'/v1/owner/tasks/' + ID + '/nodes/' + ID + '/execution', ()),
    (r'/v1/owner/tasks/' + ID + '/publication-candidates/' + ID + '/findings', ('cursor',)),
    (r'/v1/owner/tasks/' + ID + '/remote-preparation/' + ID + '/checks/' + ID, ('cursor',)),
    (r'/v1/owner/tasks/' + ID + '/(conversation|review|delivery|publication|remote-preparation|specification)/commands/' + ID, ()),
    (r'/v1/owner/tasks/' + ID + '/review', ('feedback_cursor', 'input_cursor')),
    (r'/v1/owner/tasks/' + ID + '/review/feedback/' + ID, ('decision_cursor',)),
    (r'/v1/owner/tasks/' + ID + '/review/operations/' + ID, ()),
    (r'/v1/owner/tasks/' + ID + '/delivery', ('proposal_cursor', 'batch_cursor')),
    (r'/v1/owner/tasks/' + ID + '/delivery/(proposals|batches)/' + ID, ()),
    (r'/v1/owner/tasks/' + ID + '/results/' + ID + '/changes', ('identity_digest', 'cursor')),
    (r'/v1/owner/tasks/' + ID + '/results/' + ID + '/file', ('identity_digest', 'path', 'side')),
    (r'/v1/owner/tasks/' + ID + '/results/' + ID + '/diff', ('identity_digest', 'path')),
]
O, CLAIMED, SESSION_POSSIBLE, SENSITIVE = None, False, False, []
RESULT = {'outcome': 'failed', 'submitted': False, 'receipt_confirmed': False, 'responses': [], 'automatic_retry': False}


class Stop(Exception):
    pass


def need(ok, code):
    if not ok:
        raise Stop(code)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def public(value, depth=0):
    need(depth <= 32, 'json_depth_bound')
    if isinstance(value, dict):
        for key, child in value.items():
            need(re.sub(r'[_-]', '', key).lower() not in SECRET_FIELDS, 'secret_field_forbidden')
            public(child, depth + 1)
    elif isinstance(value, list):
        for child in value:
            public(child, depth + 1)
    elif isinstance(value, str):
        need('PRIVATE KEY-----' not in value and not re.search(r'(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{12,}', value)
             and not any(secret and secret in value for secret in SENSITIVE), 'secret_content_forbidden')


def read_path(path):
    need(isinstance(path, str) and 0 < len(path) <= 8192 and not any(ord(c) < 32 for c in path), 'path_invalid')
    split = urllib.parse.urlsplit(path)
    need(not split.scheme and not split.netloc and not split.fragment, 'external_path_forbidden')
    matched = [keys for pattern, keys in READS if re.fullmatch(pattern, split.path)]
    need(len(matched) == 1, 'read_route_forbidden')
    pairs = urllib.parse.parse_qsl(split.query, keep_blank_values=True, strict_parsing=True, max_num_fields=8) if split.query else []
    query = dict(pairs)
    need(len(query) == len(pairs) and set(query) <= set(matched[0]) and all(0 < len(v) <= 4096 for v in query.values()), 'query_forbidden')
    if '/results/' in split.path:
        mode = split.path.rsplit('/', 1)[1]
        required = {'identity_digest'} | ({'path'} if mode != 'changes' else set()) | ({'side'} if mode == 'file' else set())
        need(required <= set(query) and re.fullmatch('[0-9a-f]{64}', query['identity_digest']), 'result_identity_required')
        need('path' not in query or (all(x not in ('', '.', '..') for x in query['path'].split('/'))
             and '\\' not in query['path'] and not any(ord(c) < 32 for c in query['path'])), 'result_path_forbidden')
        need('side' not in query or query['side'] in ('base', 'result'), 'result_side_invalid')


def input_request(value):
    public(value); canonical(value)
    need(type(value) is dict and value.get('method') in ('GET', 'POST'), 'request_invalid')
    if value['method'] == 'GET':
        need(set(value) == {'path', 'method'}, 'get_body_forbidden'); read_path(value['path'])
        return None
    need(set(value) == {'path', 'method', 'body'} and value['path'] in COMMANDS, 'post_route_forbidden')
    body = value['body']; names, scope = COMMANDS[value['path']]
    fields = {'schema_version', 'request_id', 'name', 'payload'} | ({scope} if scope else set())
    if scope == 'scope_id':
        fields.add('expected_control_version')
    optional = {'expected_control_version'} if value['path'].endswith('/delivery/commands') else set()
    need(type(body) is dict and fields <= set(body) <= fields | optional and type(body['schema_version']) is int
         and body['schema_version'] == 1 and body['name'] in names and type(body['payload']) is dict, 'command_envelope_invalid')
    for key in ('request_id', 'task_id', 'todo_id', 'scope_id'):
        need(key not in body or (isinstance(body[key], str) and re.fullmatch(ID, body[key])), 'command_identity_invalid')
    need('expected_control_version' not in body or (type(body['expected_control_version']) is int
         and 0 <= body['expected_control_version'] <= 9007199254740991), 'frozen_version_required')
    receipt = (('/v1/owner/scopes/' + body['scope_id'] + '/commands') if scope == 'scope_id' else
               ('/v1/owner/tasks/' + body['task_id'] + '/' + value['path'].split('/')[-2] + '/commands')
               if value['path'].startswith('/v1/owner/tasks/') else value['path']) + '/' + body['request_id']
    read_path(receipt)
    return receipt


def load_transport():
    path = Path(__file__).absolute().with_name('optional-transport-app-configure.py')
    for parent in path.parents:
        s = parent.lstat()
        need(stat.S_ISDIR(s.st_mode) and s.st_uid == 0 and not s.st_mode & 0o022, 'unsafe_dependency_parent')
    s = path.lstat()
    need(stat.S_ISREG(s.st_mode) and s.st_uid == 0 and stat.S_IMODE(s.st_mode) == 0o600, 'unsafe_dependency')
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as f:
        raw = f.read((128 << 10) + 1)
    need(hashlib.sha256(raw).hexdigest() == DEPENDENCY_SHA, 'dependency_changed')
    module = types.ModuleType('http_transport'); module.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), module.__dict__)
    return module


def business(path, body=None):
    response = O.request(path, body, 'POST' if body is not None else 'GET')
    public(response); canonical(response)
    result = {'path': path, 'status': 200, 'body': response}
    O.save('business-%d.json' % len(RESULT['responses']), result)
    RESULT['responses'].append(result)
    return response


def run():
    global O, CLAIMED, SESSION_POSSIBLE
    need(os.geteuid() == 0 and sys.platform == 'linux', 'linux_root_required')
    raw = sys.stdin.buffer.read((128 << 10) + 1)
    need(0 < len(raw) <= 128 << 10, 'request_size_bound')
    value = json.loads(raw); receipt = input_request(value); O = load_transport()
    O.INSTALLED = Path('/root/monos-review-context-install-v1/result.json')
    O.SERVER = 'cbb5b4213ff702cc6af5eb944bb8eeff2b0a686d3abd6d0a7e70b9b3fbf1dec7'
    O.IMAGE = 'sha256:17b4a92c74067892685fe2b126578a0132335d1610bf7c1f87ad66409e84b92c'
    O.COMMIT = 'acff7663209949929c11d7543eb6453e19cee6ea'
    installed = json.loads(O.read(O.INSTALLED)); app = json.loads(O.read(APP_RESULT))
    need(installed['outcome'] == 'pass' and installed['candidate_commit'] == O.COMMIT and installed['server_image'] == O.IMAGE
         and installed['server'][0] == O.SERVER and installed['endpoint'] == O.ORIGIN and app['outcome'] == 'pass'
         and app['server_id'] == 'ed4742360c0362d95e16d5cb172f35b46f739fbc366e77e03bee1a0cb8a9e27d' and app['receipt_confirmed'] is True and app['session_unknown'] is False
         and app['app_id'] == O.APP and app['installation_id'] == O.INSTALLATION and app['key_fingerprint'] == O.FINGERPRINT, 'current_installation_required')
    O.SERVER_START = tuple(installed['server'][1:]); O.server_guard()
    if not os.path.lexists(BASE):
        BASE.mkdir(mode=0o700)
        fd = os.open(BASE.parent, os.O_RDONLY | os.O_DIRECTORY); os.fsync(fd); os.close(fd)
    s = BASE.lstat()
    need(stat.S_ISDIR(s.st_mode) and s.st_uid == 0 and stat.S_IMODE(s.st_mode) == 0o700, 'unsafe_request_directory')
    O.WORK = BASE / ('post-' + value['body']['request_id'] if receipt else 'get-' + str(uuid.uuid4()))
    O.WORK.mkdir(mode=0o700); CLAIMED = True
    fd = os.open(BASE, os.O_RDONLY | os.O_DIRECTORY); os.fsync(fd); os.close(fd)
    RESULT.update(directory=str(O.WORK), method=value['method'], path=value['path'], request_id=value.get('body', {}).get('request_id'),
                  input_sha256=hashlib.sha256(canonical(value)).hexdigest(), receipt_path=receipt)
    O.save('intent.json', RESULT)
    owner = json.loads(O.read(O.PRIVATE / 'owner-bootstrap.json'))
    need(set(owner) == {'password'} and isinstance(owner['password'], str) and 12 <= len(owner['password'])
         and len(owner['password'].encode()) <= 1024, 'owner_input_invalid')
    SENSITIVE.append(owner['password'])
    SESSION_POSSIBLE = True
    login = O.request('/v1/owner/login', canonical({'schema_version': 1, **owner}), 'POST')
    need(login.get('authenticated') is True and isinstance(login.get('session_id'), str)
         and re.fullmatch(r'[0-9a-f-]{36}', login['session_id']), 'login_session_invalid')
    O.BINDING = login['session_id']; SENSITIVE.extend([O.BINDING, *[c.value for c in O.JAR]])
    need(len(list(O.JAR)) == 1 and next(iter(O.JAR)).name == 'monos' and not next(iter(O.JAR)).secure, 'http_cookie_invalid')
    public(value)
    if receipt:
        frozen = canonical(value['body']); O.save('original-command.json', frozen)
        need(O.read(O.WORK / 'original-command.json') == frozen, 'frozen_command_changed')
        RESULT['submitted'] = True; response = None
        try:
            response = business(value['path'], frozen)
        except (Stop, O.Stop) as error:
            RESULT['submit_observation'] = str(error)
        observed = business(receipt)
        need(observed.get('request_id') == value['body']['request_id'] and observed.get('status') in ('committed', 'admitted')
             and (response is None or response == observed), 'original_receipt_unconfirmed')
        RESULT['receipt_confirmed'] = True
    else:
        business(value['path'])
    RESULT['outcome'] = 'pass'


def main():
    try:
        run()
    except Exception as error:
        RESULT['reason'] = str(error) if isinstance(error, (Stop, O.Stop if O else Stop)) else 'local_or_request_failure'
    finally:
        if SESSION_POSSIBLE and list(O.JAR):
            try:
                need(O.request('/v1/owner/logout', method='POST') == {'schema_version': 1, 'authenticated': False}
                     and not list(O.JAR), 'logout_unconfirmed')
                RESULT['owner_logged_out'] = True
            except Exception:
                RESULT['logout'] = 'unconfirmed'
        RESULT['session_unknown'] = SESSION_POSSIBLE and not RESULT.get('owner_logged_out', False)
        if RESULT['session_unknown']:
            RESULT['outcome'] = 'failed'
        if CLAIMED:
            try:
                O.save('result.json', RESULT)
            except Exception:
                RESULT.update(outcome='failed', evidence='result_write_unconfirmed')
    return RESULT


if __name__ == '__main__':
    os.umask(0o077)
    result = main(); print(json.dumps(result, sort_keys=True))
    raise SystemExit(0 if result['outcome'] == 'pass' else 1)
