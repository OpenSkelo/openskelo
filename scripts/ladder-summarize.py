#!/usr/bin/env python3
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


def main() -> int:
    in_path = Path(sys.argv[1] if len(sys.argv) > 1 else 'tmp/ladder-results.json')
    out_path = Path(sys.argv[2] if len(sys.argv) > 2 else 'tmp/ladder-summary.md')

    if not in_path.exists():
        raise SystemExit(f'Input not found: {in_path}')

    rows = json.loads(in_path.read_text(encoding='utf-8'))
    counts = Counter(r.get('result', 'UNKNOWN') for r in rows)

    root_failure = next((r for r in rows if r.get('result') == 'FAIL'), None)
    blocked = [r for r in rows if r.get('result') == 'BLOCKED']

    lines = []
    lines.append('# Ladder Summary')
    lines.append('')
    lines.append(f'- Generated: {datetime.now(timezone.utc).isoformat()}')
    lines.append(f'- Input: `{in_path}`')
    lines.append('')
    lines.append('## Outcome')
    lines.append(f'- PASS: {counts.get("PASS", 0)}')
    lines.append(f'- FAIL: {counts.get("FAIL", 0)}')
    lines.append(f'- BLOCKED: {counts.get("BLOCKED", 0)}')
    lines.append('')

    if root_failure:
        lines.append('## Root cause')
        lines.append(f"- Test {root_failure.get('test')}: `{root_failure.get('code', 'UNKNOWN')}`")
        lines.append(f"- Detail: {root_failure.get('detail', '')}")
        if blocked:
            lines.append(f'- Downstream blocked: {len(blocked)} test(s)')
        lines.append('')

    lines.append('## Test matrix')
    for r in rows:
        test = r.get('test', '?')
        result = r.get('result', 'UNKNOWN')
        code = r.get('code', 'UNKNOWN')
        detail = r.get('detail', '')
        lines.append(f'- Test {test}: {result} | {code} | {detail}')

    out_path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(out_path)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
