"""Read numeric Claude Code usage metadata without exporting conversation data."""
import datetime as dt
import json
import math
import os
import pathlib
import re
import sys
from zoneinfo import ZoneInfo

MAX_FILES = 2_000
MAX_BYTES = 10_000_000
MAX_LINES = 1_000_000
MAX_SAFE = 2**53 - 1
FIELDS = ('input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'output_tokens')
MODEL = re.compile(r'^claude-[a-z0-9][a-z0-9.-]{0,98}$')


def unavailable():
    return {'provider': 'claude-code', 'status': 'unavailable'}


def number(value):
    return value if type(value) is int and 0 <= value <= MAX_SAFE else None


def timestamp(value):
    if not isinstance(value, str) or len(value) > 80:
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(ZoneInfo('America/New_York')).date().isoformat()


def model_name(value):
    return value if isinstance(value, str) and MODEL.fullmatch(value) else 'unknown'


def beneath(child, root):
    try:
        child.relative_to(root)
        return True
    except ValueError:
        return False


def collect(folder):
    """Return complete, deduplicated daily numeric usage or a fail-closed status."""
    try:
        supplied = pathlib.Path(folder)
        if supplied.is_symlink() or not supplied.is_dir():
            return unavailable()
        root = supplied.resolve(strict=True)
        projects = root / 'projects'
        if not projects.exists():
            return {'provider': 'claude-code', 'status': 'not-found'}
        if projects.is_symlink() or not projects.is_dir() or projects.resolve() != projects:
            return unavailable()
        files = []
        for directory, directory_names, names in os.walk(projects, followlinks=False):
            current = pathlib.Path(directory)
            if current.is_symlink() or not beneath(current.resolve(), projects):
                return unavailable()
            if any((current / name).is_symlink() for name in directory_names):
                return unavailable()
            for name in names:
                if name.endswith('.jsonl'):
                    files.append(current / name)
                    if len(files) > MAX_FILES:
                        return unavailable()
        if not files:
            return {'provider': 'claude-code', 'status': 'not-found'}
        records, saw_assistant, lines = {}, False, 0
        for file in sorted(files):
            if file.is_symlink() or not file.is_file() or file.stat().st_size > MAX_BYTES:
                return unavailable()
            resolved = file.resolve(strict=True)
            if not beneath(resolved, projects) or resolved != file:
                return unavailable()
            with file.open('r', encoding='utf-8') as stream:
                for line in stream:
                    lines += 1
                    if lines > MAX_LINES:
                        return unavailable()
                    try:
                        event = json.loads(line)
                    except (TypeError, ValueError):
                        continue
                    if not isinstance(event, dict):
                        continue
                    message = event.get('message')
                    if not isinstance(message, dict) or message.get('role') != 'assistant':
                        continue
                    usage = message.get('usage')
                    if not isinstance(usage, dict):
                        continue
                    saw_assistant = True
                    values = tuple(number(usage.get(field)) for field in FIELDS)
                    identity = (message.get('id'), event.get('requestId'))
                    day = timestamp(event.get('timestamp'))
                    if (not all(isinstance(value, str) and 0 < len(value) <= 256 for value in identity)
                            or day is None or any(value is None for value in values)):
                        return unavailable()
                    raw_model = message.get('model')
                    current = (day, model_name(raw_model), raw_model, values)
                    prior = records.get(identity)
                    if prior is None:
                        records[identity] = current
                        continue
                    if prior[0] != current[0] or prior[2] != current[2]:
                        return unavailable()
                    before, after = prior[3], current[3]
                    if before == after:
                        continue
                    if all(a >= b for a, b in zip(after, before)):
                        records[identity] = current
                    elif not all(a <= b for a, b in zip(after, before)):
                        return unavailable()
        if not saw_assistant or not records:
            return unavailable()
        days = {}
        for day, model, _, values in records.values():
            row = days.setdefault(day, {'date': day, 'inputTokens': 0, 'cacheReadTokens': 0,
                'cacheCreationTokens': 0, 'outputTokens': 0, 'totalTokens': 0,
                'requestCount': 0, 'models': {}})
            model_row = row['models'].setdefault(model, {'model': model, 'inputTokens': 0,
                'cacheReadTokens': 0, 'cacheCreationTokens': 0, 'outputTokens': 0,
                'totalTokens': 0, 'requestCount': 0})
            amounts = (values[0], values[1], values[2], values[3], sum(values))
            for target in (row, model_row):
                for key, amount in zip(('inputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'outputTokens', 'totalTokens'), amounts):
                    if target[key] + amount > MAX_SAFE:
                        return unavailable()
                    target[key] += amount
                if target['requestCount'] >= MAX_SAFE:
                    return unavailable()
                target['requestCount'] += 1
        output = []
        for day in sorted(days):
            row = days[day]
            row['models'] = [row['models'][name] for name in sorted(row['models'])]
            output.append(row)
        return {'provider': 'claude-code', 'status': 'ok', 'scope': 'Recorded Claude Code requests', 'days': output}
    except (OSError, UnicodeError):
        return unavailable()


if __name__ == '__main__':
    try:
        result = collect(sys.argv[1])
    except (IndexError, TypeError):
        result = unavailable()
    print(json.dumps(result, allow_nan=False))
