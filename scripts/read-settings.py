"""Summarize saved Codex settings and tool-call categories without exporting text."""
import datetime as dt
import hashlib
import hmac
import json
import math
import pathlib
import re
import sys
import time
from zoneinfo import ZoneInfo

MAX_FILES = 100_000
MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024
MAX_LINES = 3_000_000
MAX_LINE_BYTES = 8_000_000
MAX_READ_SECONDS = 45


class ReadBudget:
    """Count actual session reads, including inventory reads and retries."""
    def __init__(self):
        self.started = time.monotonic()
        self.bytes = 0
        self.lines = 0

    def check(self):
        if time.monotonic() - self.started > MAX_READ_SECONDS:
            raise ValueError('Read time limit')

    def charge(self, data, new_line=True):
        self.check()
        self.bytes += len(data)
        self.lines += int(bool(data) and new_line)
        if self.bytes > MAX_TOTAL_BYTES or self.lines > MAX_LINES:
            raise ValueError('Session read limit')


FIELDS = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens']
EFFORTS = {'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'}
TIERS = {'default':'standard', 'standard':'standard', 'priority':'fast', 'fast':'fast'}

def number(x):
    return x if type(x) in (int, float) and math.isfinite(x) and x >= 0 else None

def label(x):
    return x if isinstance(x, str) and 0 < len(x) <= 100 and all(c.isalnum() or c in '-_./:' for c in x) else 'unknown'

def tool_identifier(value, fallback):
    return value if isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.:/-]{0,199}', value) else fallback

def inventory_metadata(meta, salt):
    """Ephemeral comparison keys only. The collector never saves these keys."""
    payload = meta.get('payload', {}) if isinstance(meta, dict) and meta.get('type') == 'session_meta' else {}
    if not isinstance(payload, dict):
        return None
    def keys(values):
        return [hmac.new(salt.encode(), value.encode(), hashlib.sha256).hexdigest()
                for value in values if isinstance(value, str) and 0 < len(value) <= 128]
    owned = keys([payload.get('id'), payload.get('session_id')])
    parents = keys([payload.get('forked_from_id'), payload.get('parent_thread_id')])
    return dict(keys=owned, parents=parents) if owned else None

def summarize(events, cutoff, retained=None, seen=None, hour_totals=None, read_budget=None):
    model, effort, speed = 'unknown', 'unknown', 'unknown'
    context_model = None
    selected_model = 'unknown'
    selected_speed = 'unknown'
    prior = None
    turn_key = None
    profiles, tools = {}, {}
    seen_calls = set()
    for event in events:
        if read_budget:
            read_budget.check()
        p = event.get('payload') or {}
        if not isinstance(p, dict):
            continue
        if p.get('type') == 'thread_settings_applied':
            s = p.get('thread_settings') or {}
            if not isinstance(s, dict):
                continue
            next_selected = label(s['model']) if 'model' in s else selected_model
            if next_selected != selected_model:
                selected_speed = 'unknown'
            selected_model = next_selected
            if 'service_tier' in s:
                selected_speed = TIERS.get(s['service_tier'], 'unknown')
            # A newly selected model does not relabel the preceding turn.
            if context_model is None:
                model = selected_model
            if selected_model == model:
                if 'reasoning_effort' in s:
                    effort = s['reasoning_effort'] if s['reasoning_effort'] in EFFORTS else 'unknown'
                if 'service_tier' in s:
                    speed = TIERS.get(s['service_tier'], 'unknown')
            else:
                speed = 'unknown'
        if event.get('type') == 'turn_context':
            turn_id = p.get('turn_id')
            turn_key = p.get('usage_turn_key') or (hashlib.sha256(turn_id.encode()).hexdigest() if isinstance(turn_id, str) else None)
            next_model = label(p.get('model'))
            if next_model != model:
                speed = 'unknown'
            model = next_model
            context_model = model
            if model == selected_model:
                speed = selected_speed
            effort = p.get('effort') if p.get('effort') in EFFORTS else 'unknown'
            if 'service_tier' in p:
                speed = TIERS.get(p['service_tier'], 'unknown')
        try:
            stamp = dt.datetime.fromisoformat(event['timestamp'].replace('Z', '+00:00'))
            local = stamp.astimezone(ZoneInfo('America/New_York'))
            date = local.date().isoformat()
        except (ValueError, KeyError, TypeError):
            continue
        if event.get('type') == 'response_item' and p.get('type') in ('function_call', 'custom_tool_call'):
            call_id = p.get('call_id')
            if not isinstance(call_id, str) or call_id in seen_calls:
                continue
            seen_calls.add(call_id)
            tool = tool_identifier(p.get('name'), 'Unknown tool')
            namespace = tool_identifier(p.get('namespace'), '')
            if namespace in ('history', 'notes') or tool.startswith(('history.', 'notes.', 'history__', 'notes__')):
                continue
            name = tool.lower()
            category = 'Shell' if any(x in name for x in ('exec_command','write_stdin','shell')) else 'File edits' if 'apply_patch' in name else 'Browser' if any(x in name for x in ('browser','cua')) else 'Research' if any(x in name for x in ('web','search')) else 'Other tools'
            if stamp >= cutoff:
                key = (date, category, tool, namespace)
                tools[key] = tools.get(key, 0) + 1
        if event.get('type') != 'event_msg' or p.get('type') != 'token_count':
            continue
        raw = (p.get('info') or {}).get('total_token_usage')
        if not isinstance(raw, dict):
            continue
        current = {k:number(raw.get(k, 0 if k == 'cache_write_input_tokens' else None)) for k in FIELDS}
        if any(v is None for v in current.values()):
            continue
        repeated = current == prior
        delta = {k:current[k]-(prior[k] if prior else 0) for k in FIELDS}
        prior = current
        if repeated:
            continue
        # Match the daily reader: use the recorded request counters when the
        # cumulative counter advances. Deltas alone can lose usage after resets.
        last = (p.get('info') or {}).get('last_token_usage')
        if isinstance(last, dict):
            delta = {k:number(last.get(k, 0 if k == 'cache_write_input_tokens' else None)) for k in FIELDS}
            if any(v is None for v in delta.values()):
                continue
        if any(v < 0 for v in delta.values()) or delta['total_tokens'] == 0:
            continue
        # Codex input includes cache reads and writes. Output includes reasoning.
        uncached = delta['input_tokens']-delta['cached_input_tokens']-delta['cache_write_input_tokens']
        if uncached < 0 or abs(delta['input_tokens']+delta['output_tokens']-delta['total_tokens']) > 1:
            continue
        # Copies inherited by related sessions count once. Each file still
        # advances its own cumulative baseline before this shared check.
        if seen is not None and turn_key is not None:
            identity = (turn_key, stamp.isoformat(), model, effort, speed, tuple(current[k] for k in FIELDS), tuple(delta[k] for k in FIELDS))
            if identity in seen:
                continue
            seen.add(identity)
        if hour_totals is not None:
            hour_totals.setdefault(date, [0]*24)[local.hour] += delta['total_tokens']
        key = (date,model,effort,speed)
        destinations = ([retained] if retained is not None else []) + ([profiles] if stamp >= cutoff else [])
        for destination in destinations:
            row = destination.setdefault(key, dict(date=date,model=model,effort=effort,speed=speed,inputTokens=0,cacheReadTokens=0,cacheCreationTokens=0,outputTokens=0,reasoningOutputTokens=0,totalTokens=0))
            for dest, value in dict(inputTokens=uncached,cacheReadTokens=delta['cached_input_tokens'],cacheCreationTokens=delta['cache_write_input_tokens'],outputTokens=delta['output_tokens'],reasoningOutputTokens=delta['reasoning_output_tokens'],totalTokens=delta['total_tokens']).items():
                row[dest] += value
    return list(profiles.values()), [dict(date=d,category=c,tool=t,namespace=s,count=n) for (d,c,t,s),n in tools.items()]

def summarize_sessions(sessions, cutoff, cache, lineages, read_budget):
    profiles, tools, retained, seen, hour_totals = {}, {}, {}, {}, {}
    for identity, (file, info) in sorted(sessions.items()):
        def events():
            with file.open('rb') as stream:
                skipping = False
                while True:
                    read_budget.check()
                    line = stream.readline(MAX_LINE_BYTES + 1)
                    if not line:
                        break
                    read_budget.charge(line, not skipping)
                    if skipping or len(line) > MAX_LINE_BYTES:
                        skipping = not line.endswith(b'\n')
                        continue
                    line = line.decode('utf-8')
                    try:
                        row = json.loads(line)
                        if isinstance(row, dict):
                            yield row
                    except ValueError:
                        pass
        rows, calls = summarize(cache.events(file, info) if cache else events(), cutoff, retained, seen.setdefault(lineages[identity], set()), hour_totals, read_budget)
        for row in rows:
            key = (row['date'], row['model'], row['effort'], row['speed'])
            if key not in profiles:
                profiles[key] = row
            else:
                for field in ('inputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'outputTokens', 'reasoningOutputTokens', 'totalTokens'):
                    profiles[key][field] += row[field]
        for row in calls:
            key = (row['date'], row['category'], row['tool'], row['namespace'])
            tools[key] = tools.get(key, 0) + row['count']
    return profiles, tools, retained, hour_totals


def collect(folder, *, retry_cache=True, cache_budget=None, read_budget=None):
    read_budget = read_budget if read_budget is not None else ReadBudget()
    read_budget.check()
    root = pathlib.Path(folder).resolve(strict=True)
    cutoff = dt.datetime.now(dt.timezone.utc)-dt.timedelta(days=8)
    candidates = []
    for name in ('sessions', 'archived_sessions'):
        for file in (root/name).rglob('*.jsonl'):
            read_budget.check()
            candidates.append(file)
            if len(candidates) > MAX_FILES:
                raise ValueError('Too many files')
    sessions, lineages, selected_metadata = {}, {}, {}
    def lineage(identity):
        lineages.setdefault(identity, identity)
        while lineages[identity] != identity:
            lineages[identity] = lineages[lineages[identity]]
            identity = lineages[identity]
        return identity
    inventory = dict(status='ok', keys=set(), parents=set())
    salt = globals().get('INVENTORY_SALT')
    for file in candidates:
        read_budget.check()
        if file.is_symlink() or not file.resolve().is_relative_to(root):
            inventory['status'] = 'incomplete'
            continue
        info = file.stat()
        with file.open('rb') as stream:
            first = stream.readline(1_000_000)
            read_budget.charge(first)
        try:
            meta = json.loads(first.decode('utf-8'))
        except ValueError:
            meta = {}
        payload = meta.get('payload') if isinstance(meta, dict) and meta.get('type') == 'session_meta' else None
        identity = payload.get('id') if isinstance(payload, dict) else None
        if not isinstance(identity, str) or not identity:
            inventory['status'] = 'incomplete'
        if salt:
            metadata = inventory_metadata(meta, salt)
            if metadata:
                inventory['keys'].update(metadata['keys'])
                inventory['parents'].update(metadata['parents'])
            else:
                inventory['status'] = 'incomplete'
        identity = identity if isinstance(identity, str) and identity else str(file)
        if identity not in sessions or info.st_size > sessions[identity][1].st_size:
            sessions[identity] = (file,info)
            selected_metadata[identity] = payload if isinstance(payload, dict) else {}
    for identity, payload in selected_metadata.items():
        read_budget.check()
        lineage(identity)
        for parent in (payload.get('forked_from_id'), payload.get('parent_thread_id')):
            if isinstance(parent, str) and parent:
                lineages[lineage(identity)] = lineage(parent)
    budget = globals().get('CACHE_SCAN_BUDGET', MAX_TOTAL_BYTES) if cache_budget is None else cache_budget
    cache = SettingsCache(globals()['CACHE_DIRECTORY'], budget) if globals().get('CACHE_DIRECTORY') else None
    if cache:
        cache.read_budget = read_budget
    completed = False
    try:
        profiles, tools, retained, hour_totals = summarize_sessions(sessions, cutoff, cache, {identity: lineage(identity) for identity in sessions}, read_budget)
        completed = True
    finally:
        if cache:
            cache.close(completed=completed)
    if cache:
        if cache.pending:
            # Rebuild metadata and inventory after a transient file change. A
            # second attempt shares the original byte budget and never returns
            # an incomplete first-pass total as a successful report.
            if retry_cache and cache.remaining > 0:
                return collect(folder, retry_cache=False, cache_budget=cache.remaining, read_budget=read_budget)
            raise ValueError('Private Codex cache warming; complete report unavailable')
    result = dict(status='ok',profiles=list(profiles.values()),tokenProfiles=list(retained.values()),hourTotals=[dict(date=date,hours=hours) for date,hours in sorted(hour_totals.items())],tools=[dict(date=d,category=c,tool=t,namespace=s,count=n) for (d,c,t,s),n in sorted(tools.items())],scope='Recent saved Codex logs only')
    if salt:
        result['inventory'] = {k:sorted(v) if isinstance(v,set) else v for k,v in inventory.items()}
    read_budget.check()
    return result

if __name__ == '__main__':
    print(json.dumps(collect(sys.argv[1]),allow_nan=False))
