import argparse
import hashlib
import io
import json
import os
import pathlib
import stat
import subprocess
import tarfile

os.umask(0o077)
ROOT = pathlib.Path('/Users/me/IdeaProjects/monos')
OUT = None
CANDIDATE = '63eaa285ab90fdd6de018671a47ba5583f87bc75'
OLD = None
PATHS = ['apps', 'packages', 'runner', 'infra', 'scripts', 'package.json',
         'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json',
         'tsconfig.build.json', 'eslint.config.mjs']

def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args])

def sha(data):
    return hashlib.sha256(data).hexdigest()

def main():
    global OUT, OLD
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--installed-manifest', required=True)
    args = parser.parse_args()
    OUT, OLD = pathlib.Path(args.output), pathlib.Path(args.installed_manifest)
    OUT.mkdir(mode=0o700)
    assert git('rev-parse', 'HEAD').decode().strip() == CANDIDATE
    index_paths = set(git('ls-files', '-z', '--', *PATHS).decode().split('\0')) - {''}
    entries = {}
    for entry in git('ls-tree', '-r', '-z', CANDIDATE, '--', *PATHS).split(b'\0'):
        if not entry:
            continue
        fields, path = entry.split(b'\t', 1)
        mode, kind, oid = fields.decode().split()
        path = path.decode()
        assert kind == 'blob' and mode in ('100644', '100755'), (path, kind, mode)
        assert not pathlib.PurePosixPath(path).is_absolute() and '..' not in pathlib.PurePosixPath(path).parts
        entries[path] = {'mode': mode, 'git_blob': oid}
    assert set(entries) == index_paths and len(entries) == 493
    files, modes, bodies = {}, {}, {}
    for path, entry in sorted(entries.items()):
        committed = git('cat-file', 'blob', entry['git_blob'])
        work = ROOT / path
        attrs = work.lstat()
        assert stat.S_ISREG(attrs.st_mode), path
        assert bool(attrs.st_mode & 0o111) == (entry['mode'] == '100755'), path
        assert work.read_bytes() == committed, path
        files[path] = sha(committed)
        modes[path] = entry['mode']
        bodies[path] = committed
    old_bytes = OLD.read_bytes()
    old = json.loads(old_bytes)
    added = sorted(set(files) - set(old['files']))
    removed = sorted(set(old['files']) - set(files))
    changed = sorted(p for p in set(files) & set(old['files']) if files[p] != old['files'][p])
    assert len(old['files']) == 372 and not removed
    retained_migrations = sorted(p for p in old['files'] if p.startswith('packages/db/migrations/'))
    assert len(retained_migrations) == 21
    assert all(files[p] == old['files'][p] and modes[p] == old['git_modes'][p] for p in retained_migrations)
    assert len([p for p in files if p.startswith('packages/db/migrations/')]) == 25
    archive = OUT / 'source.tar'
    with archive.open('xb') as raw:
        with tarfile.open(fileobj=raw, mode='w', format=tarfile.PAX_FORMAT) as tar:
            for path, body in sorted(bodies.items()):
                member = tarfile.TarInfo(path)
                member.size = len(body)
                member.mode = int(modes[path], 8) & 0o777
                member.uid = member.gid = member.mtime = 0
                member.uname = member.gname = ''
                tar.addfile(member, io.BytesIO(body))
    manifest = {
        'format_version': 1, 'candidate_commit': CANDIDATE,
        'product_commit': git('rev-parse', '5c26071').decode().strip(),
        'git_tree': git('rev-parse', CANDIDATE + '^{tree}').decode().strip(),
        'source_tar_sha256': sha(archive.read_bytes()),
        'installed_manifest_sha256': sha(old_bytes),
        'package_script_sha256': sha(pathlib.Path(__file__).read_bytes()),
        'files': files, 'git_modes': modes,
        'git_blobs': {p: entries[p]['git_blob'] for p in sorted(entries)},
        'delta': {'added': added, 'changed': changed, 'removed': removed},
        'checks': {'committed_worktree_bytes_and_executable_bits_match': True,
                   'tracked_build_scope_only': True, 'retained_21_migration_bytes_and_modes_match': True},
    }
    with (OUT / 'manifest.json').open('x') as target:
        json.dump(manifest, target, indent=2, sort_keys=True)
        target.write('\n')
    with (OUT / 'installed-manifest.json').open('xb') as target:
        target.write(old_bytes)
    print(json.dumps({'directory': str(OUT), 'files': len(files),
                      'added': len(added), 'changed': len(changed), 'removed': len(removed),
                      'source_tar_sha256': manifest['source_tar_sha256'],
                      'manifest_sha256': sha((OUT / 'manifest.json').read_bytes())}))

if __name__ == '__main__':
    main()
