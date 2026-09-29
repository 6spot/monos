#!/usr/bin/env python3
"""Hold an admitted unavailable open inside the native Node until Owner Stop."""
import argparse
import json
import os
import pathlib
import re
import time

from driver import formal
from workspace_driver import save


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--attempt', required=True)
    parser.add_argument('--resource', required=True)
    args = parser.parse_args()
    if os.getuid() == 0 or any(not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', value) for value in vars(args).values()):
        raise RuntimeError('Native execution account and valid identities required')
    scratch = pathlib.Path('/var/lib/monos-probe/execution') / args.attempt / 'scratch'
    report_path = scratch / 'workspace-driver.json'
    report = {'attempt_id': args.attempt, 'resource_id': args.resource, 'execution_uid': os.getuid(), 'stage': 'starting'}
    save(report_path, report, initial=True)
    payload = scratch / 'unavailable-open.json'
    payload.write_text(json.dumps({'resource_id': args.resource}))
    code, result = formal('open_workspace', 'unavailable-open', payload)
    report.update(open=result, stage='unavailable_open_admitted', hold_expires_at=time.time() + 300)
    save(report_path, report)
    if code or result.get('status') != 'admitted' or not result.get('operation_id'):
        raise RuntimeError('Expected recoverable unavailable open admission')
    time.sleep(300)
    raise RuntimeError('Unavailable-open trial expired; inspect ownership')


if __name__ == '__main__':
    main()
