"""Private, reconstructible cache of allowlisted Codex events, not log text."""
import os
import sqlite3
import stat


def cache_event(event, cached=False):
    if not isinstance(event, dict) or not isinstance(event.get('payload'), dict):
        return None
    payload, kind = event['payload'], event.get('type')
    subtype = payload.get('type')
    safe = None
    if subtype == 'thread_settings_applied':
        settings = payload.get('thread_settings')
        if not isinstance(settings, dict):
            return None
        values = {}
        for key in ('model', 'reasoning_effort', 'service_tier'):
            if key in settings:
                value = settings[key]
                values[key] = label(value) if key == 'model' else value if isinstance(value, str) and value in (EFFORTS if key == 'reasoning_effort' else TIERS) else 'unknown'
        safe = dict(type=subtype, thread_settings=values)
        kind = kind if kind in ('event_msg', 'turn_context', 'response_item') else 'event_msg'
    elif kind == 'turn_context':
        safe = dict(model=label(payload.get('model')), effort=payload.get('effort') if payload.get('effort') in EFFORTS else 'unknown')
        turn_id = payload.get('usage_turn_key') if cached else payload.get('turn_id')
        if isinstance(turn_id, str):
            if cached and not re.fullmatch('[a-f0-9]{64}', turn_id):
                return None
            safe['usage_turn_key'] = turn_id if cached else hashlib.sha256(turn_id.encode()).hexdigest()
        if 'service_tier' in payload:
            tier = payload['service_tier']
            safe['service_tier'] = tier if isinstance(tier, str) and tier in TIERS else 'unknown'
    elif kind == 'event_msg' and subtype == 'token_count':
        info = payload.get('info')
        if not isinstance(info, dict) or not isinstance(info.get('total_token_usage'), dict):
            return None
        values = {}
        for key in ('total_token_usage', 'last_token_usage'):
            if isinstance(info.get(key), dict):
                values[key] = {field: number(info[key].get(field, 0 if field == 'cache_write_input_tokens' else None)) for field in FIELDS}
        safe = dict(type=subtype, info=values)
    elif kind == 'response_item' and subtype in ('function_call', 'custom_tool_call'):
        identity = payload.get('call_id')
        if not isinstance(identity, str):
            return None
        if cached:
            if not re.fullmatch('[a-f0-9]{64}', identity):
                return None
        else:
            identity = hashlib.sha256(identity.encode('utf-8')).hexdigest()
        safe = dict(type=subtype, call_id=identity, name=tool_identifier(payload.get('name'), 'Unknown tool'), namespace=tool_identifier(payload.get('namespace'), ''))
    if safe is None:
        return None
    result = dict(type=kind, payload=safe)
    timestamp = event.get('timestamp')
    if isinstance(timestamp, str) and len(timestamp) <= 64:
        try:
            stamp = dt.datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
            if stamp.tzinfo is not None:
                result['timestamp'] = stamp.isoformat()
        except ValueError:
            pass
    return result


class SettingsCache:
    """Unchanged files reuse sanitized events; changed files are reread in full.

    File-granularity invalidation deliberately avoids assuming logs are append
    only. A cold cache advances within the existing per-run scan budget and
    withholds the report until every selected file has complete coverage.
    """
    def __init__(self, directory, budget=1_000_000_000):
        root = pathlib.Path(directory)
        if not root.is_absolute() or root.resolve(strict=True) != root or root.is_symlink():
            raise ValueError('Unsafe cache directory')
        if os.name != 'nt' and root.stat().st_mode & 0o077:
            raise ValueError('Unsafe cache permissions')
        self.remaining = budget
        self.used = set()
        self.pending = False
        self.scanned_bytes = 0
        self.hits = 0
        file = root / 'events.sqlite'
        created = False
        try:
            descriptor = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            os.close(descriptor)
            created = True
        except FileExistsError:
            pass
        before = file.lstat()
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > 134_217_728 or (os.name != 'nt' and before.st_mode & 0o077):
            raise ValueError('Unsafe cache file')
        for suffix in ('-journal', '-wal', '-shm'):
            sidecar = pathlib.Path(str(file) + suffix)
            if sidecar.exists() or sidecar.is_symlink():
                info = sidecar.lstat()
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or (os.name != 'nt' and info.st_mode & 0o077):
                    raise ValueError('Unsafe cache sidecar')
        self.db = sqlite3.connect(file, timeout=1, isolation_level=None)
        after = file.lstat()
        if (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino):
            self.db.close()
            raise ValueError('Changing cache file')
        self.db.execute('PRAGMA trusted_schema=OFF')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('PRAGMA max_page_count=32768')
        schema = 'CREATE TABLE events (key TEXT PRIMARY KEY, signature TEXT NOT NULL, data TEXT NOT NULL)'
        if created:
            self.db.execute(schema)
            self.db.execute('PRAGMA user_version=1')
        objects = self.db.execute("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").fetchall()
        if self.db.execute('PRAGMA user_version').fetchone()[0] != 1 or self.db.execute('PRAGMA journal_mode').fetchone()[0] != 'delete' or self.db.execute('PRAGMA page_size').fetchone()[0] != 4096 or objects != [('table', 'events', schema)]:
            self.db.close()
            raise ValueError('Unsupported cache format')

    @staticmethod
    def signature(info):
        # Windows path stat may report creation time as ctime while fstat reports
        # change time. Do not compare these different fields across APIs.
        values = [2, str(info.st_dev), str(info.st_ino), info.st_size, str(info.st_mtime_ns)]
        if os.name != 'nt':
            values.append(str(info.st_ctime_ns))
        return json.dumps(values)

    def events(self, file, expected):
        key = hashlib.sha256(str(file).encode('utf-8')).hexdigest()
        self.used.add(key)
        signature = self.signature(expected)
        current = file.stat()
        if self.signature(current) != signature:
            self.pending = True
            return []
        row = self.db.execute('SELECT signature, data FROM events WHERE key=?', (key,)).fetchone()
        if row and row[0] == signature and len(row[1]) <= 16_000_000:
            try:
                saved = json.loads(row[1])
                if isinstance(saved, list) and all(isinstance(event, dict) and cache_event(event, cached=True) == event for event in saved):
                    self.hits += 1
                    return saved
            except (ValueError, TypeError):
                pass
        if expected.st_size > self.remaining:
            self.pending = True
            return []
        self.remaining -= expected.st_size
        self.scanned_bytes += expected.st_size
        events, retained = [], 0
        with file.open('rb') as stream:
            if self.signature(os.fstat(stream.fileno())) != signature:
                self.pending = True
                return []
            remaining = expected.st_size
            skipping = False
            while remaining:
                line = stream.readline(min(8_000_001, remaining))
                if not line:
                    break
                remaining -= len(line)
                if skipping or len(line) > 8_000_000:
                    skipping = not line.endswith(b'\n')
                    continue
                try:
                    safe = cache_event(json.loads(line))
                except (ValueError, UnicodeError, TypeError):
                    continue
                if safe is not None:
                    retained += len(json.dumps(safe))
                    if retained > 16_000_000:
                        raise ValueError('Private event cache entry limit')
                    events.append(safe)
            if remaining or self.signature(os.fstat(stream.fileno())) != signature:
                self.pending = True
                return []
        self.db.execute('INSERT INTO events VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET signature=excluded.signature, data=excluded.data', (key, signature, json.dumps(events)))
        return events

    def close(self):
        # Remove metadata for logs no longer in the selected session and archive set.
        try:
            for (key,) in self.db.execute('SELECT key FROM events').fetchall():
                if key not in self.used:
                    self.db.execute('DELETE FROM events WHERE key=?', (key,))
        finally:
            self.db.close()
