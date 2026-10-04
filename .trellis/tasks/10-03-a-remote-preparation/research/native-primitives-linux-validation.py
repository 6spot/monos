#!/usr/bin/env python3
"""Accepted-base independent primitives Linux proof; not integrated lane acceptance."""
import importlib.util
import os
from pathlib import Path

REPOSITORY = Path(__file__).resolve().parents[4]
ACCEPTED_SOURCE = Path('/private/tmp/monos-remote-primitives-uid-i_odpiqg/source')

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError('Validation helper missing')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def main():
    accepted = load('accepted_linux_validation', REPOSITORY / '.trellis/tasks/archive/2026-10/10-03-a-publication-candidate/research/native-linux-validation.py')
    remote = load('remote_linux_checks', REPOSITORY / '.trellis/tasks/10-03-a-remote-preparation/research/native-linux-validation.py')
    program = accepted.REMOTE
    program = program.replace('isolated Linux CGO and service-account actual Git fixture; no installation, Runtime, provider or production state mutation', 'accepted commit 2095660 plus four independent primitive files; isolated Linux UID/process/Git/permissions proof, not integrated protocol/lane or App proof')
    program = program.replace('monos-publication-', 'monos-remote-primitives-')
    # An isolated test container needs an init to reap orphaned synthetic children.
    # Absence is still proved by actual ESRCH, never by accepting zombies.
    program = program.replace("['docker','run','--rm','--network','none'", "['docker','run','--rm','--init','--network','none'")
    program = program.replace("container('module',['go','test','./...'])", "container('primitives',['go','test','./internal/host','-run','^TestRemotePreparation','-count=1'])")
    program = program.replace("container('race',['go','test','-race','./...'])", "container('race',['go','test','-race','./internal/host','-run','^TestRemotePreparation','-count=1'])")
    program = program.replace("container('vet',['go','vet','./...'])", "container('vet',['go','vet','./internal/host'])")
    program = program.replace("for executable in ['monos','monos-runner','monos-probe-launch','monos-probe-exec']:", "for executable in []:")
    program = program.replace("'-test.run','^TestPublication'", "'-test.run','^TestRemotePreparation'")
    marker = "result['permissions']=checks;"
    if program.count(marker) != 1:
        raise RuntimeError('Accepted validation seam changed')
    program = program.replace(marker, remote.REMOTE_RETAINED + '\n' + marker)
    accepted.REMOTE = program
    if not ACCEPTED_SOURCE.is_dir():
        raise RuntimeError('Pinned isolated accepted source missing')
    os.chdir(ACCEPTED_SOURCE)
    accepted.main()

if __name__ == '__main__':
    main()
