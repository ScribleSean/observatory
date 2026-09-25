"""Read numeric Claude Code usage metadata without exporting conversation data."""
import datetime as dt
import json
import os
import pathlib
import re
import sys
from zoneinfo import ZoneInfo

MAX_FILES = 2_000
MAX_TOTAL_BYTES = 128 * 1024 * 1024
MAX_LINE_BYTES = 4 * 1024 * 1024
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
        files, total_bytes = [], 0
        for directory, directory_names, names in os.walk(projects, followlinks=False):
            current = pathlib.Path(directory)
            if current.is_symlink() or not beneath(current.resolve(), projects):
                return unavailable()
            if any((current / name).is_symlink() for name in directory_names):
                return unavailable()
            for name in names:
                if name.endswith('.jsonl'):
                    file = current / name
                    if file.is_symlink() or not file.is_file():
                        return unavailable()
                    total_bytes += file.stat().st_size
                    if total_bytes > MAX_TOTAL_BYTES:
                        return unavailable()
                    files.append(file)
                    if len(files) > MAX_FILES:
                        return unavailable()
        if not files:
            return {'provider': 'claude-code', 'status': 'not-found'}
        records, saw_assistant, lines, bytes_read = {}, False, 0, 0
        for file in sorted(files):
            if file.is_symlink() or not file.is_file():
                return unavailable()
            resolved = file.resolve(strict=True)
            if not beneath(resolved, projects) or resolved != file:
                return unavailable()
            before_stat = file.stat()
            with file.open('rb') as stream:
                while True:
                    line = stream.readline(MAX_LINE_BYTES + 1)
                    if not line:
                        break
                    lines += 1
                    bytes_read += len(line)
                    if lines > MAX_LINES or len(line) > MAX_LINE_BYTES or bytes_read > MAX_TOTAL_BYTES:
                        return unavailable()
                    if not line.strip():
                        continue
                    try:
                        event = json.loads(line.decode('utf-8'))
                    except (TypeError, UnicodeError, ValueError):
                        return unavailable()
                    if not isinstance(event, dict):
                        continue
                    if event.get('type') != 'assistant':
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
                    if prior[2] != current[2]:
                        return unavailable()
                    before, after = prior[3], current[3]
                    if before == after:
                        records[identity] = (min(prior[0], current[0]), prior[1], prior[2], prior[3])
                        continue
                    if all(a >= b for a, b in zip(after, before)):
                        # A streamed request can finish after local midnight.
                        # Keep its earliest retained timestamp as its day.
                        records[identity] = (min(prior[0], current[0]), current[1], current[2], current[3])
                    elif not all(a <= b for a, b in zip(after, before)):
                        return unavailable()
                    else:
                        records[identity] = (min(prior[0], current[0]), prior[1], prior[2], prior[3])
            after_stat = file.stat()
            if (before_stat.st_dev, before_stat.st_ino, before_stat.st_size, before_stat.st_mtime_ns) != (
                    after_stat.st_dev, after_stat.st_ino, after_stat.st_size, after_stat.st_mtime_ns):
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
