import { contract, encodeMessage } from '../../lib/bridge-contract.mjs';
import type { BridgeResultDetail } from '../../lib/bridge-contract.generated';

export type BridgeOutcome = BridgeResultDetail & { local?: boolean; timedOut?: boolean };
export interface Bridge {
  available: boolean;
  send(action: string, args: Record<string, unknown>): Promise<BridgeOutcome>;
  onLateResult(listener: (result: BridgeOutcome, action: string) => void): () => void;
  dispose(): void;
}
type WebView = EventTarget & { postMessage(text: string): void };
export type BridgeWindow = EventTarget & {
  webkit?: { messageHandlers?: { bridge?: { postMessage(text: string): void } } };
  chrome?: { webview?: WebView };
};
const nextIds = new WeakMap<BridgeWindow, number>();
export function createBridge(win: BridgeWindow = window, timeoutMs = contract.limits.resultTimeoutSeconds * 1000): Bridge {
  const mac = win.webkit?.messageHandlers?.bridge;
  const windows = win.chrome?.webview;
  const transport = mac ?? windows;
  const pending = new Map<number, { resolve: (result: BridgeOutcome) => void; timer: ReturnType<typeof setTimeout> }>();
  const late = new Map<number, string>();
  const listeners = new Set<(result: BridgeOutcome, action: string) => void>();
  let disposed = false;
  const handle = (raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    const result = raw as BridgeOutcome;
    if (!['id', 'ok', 'code'].every(key => Object.hasOwn(raw, key)) || Reflect.ownKeys(raw).some(key => !['id', 'ok', 'code', 'value'].includes(String(key))) ||
      !Number.isInteger(result.id) || result.id < contract.message.id.min || result.id > contract.message.id.max ||
      typeof result.ok !== 'boolean' || !contract.codes.includes(result.code) || result.ok !== (result.code === 'done')) return;
    const entry = pending.get(result.id);
    if (entry) {
      clearTimeout(entry.timer);
      pending.delete(result.id);
      entry.resolve(result);
    } else if (late.has(result.id)) {
      const action = late.get(result.id)!;
      late.delete(result.id);
      for (const listener of listeners) listener(result, action);
    }
  };
  const custom = (event: Event) => handle((event as CustomEvent<unknown>).detail);
  const message = (event: Event) => {
    const data: unknown = (event as MessageEvent<unknown>).data;
    if (data && typeof data === 'object' && Reflect.ownKeys(data).length === 1 && Object.hasOwn(data, 'bridgeResult')) {
      handle((data as { bridgeResult: unknown }).bridgeResult);
    }
  };
  win.addEventListener('observatory:bridge-result', custom);
  windows?.addEventListener('message', message);
  return {
    available: !!transport,
    send(action, args) {
      const id = nextIds.get(win) ?? 1;
      let text: string;
      try { text = encodeMessage(id, action, args); }
      catch { return Promise.resolve({ id: 0, ok: false, code: 'refused', local: true }); }
      if (!transport || disposed) return Promise.resolve({ id: 0, ok: false, code: 'unavailable', local: true });
      nextIds.set(win, id + 1);
      return new Promise(resolve => {
        const timer = setTimeout(() => {
          pending.delete(id);
          late.set(id, action);
          resolve({ id, ok: false, code: 'unavailable', timedOut: true });
        }, timeoutMs);
        pending.set(id, { resolve, timer });
        try { transport.postMessage(text); }
        catch {
          clearTimeout(timer);
          pending.delete(id);
          resolve({ id, ok: false, code: 'unavailable', local: true });
        }
      });
    },
    onLateResult(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() {
      disposed = true;
      win.removeEventListener('observatory:bridge-result', custom);
      windows?.removeEventListener('message', message);
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer);
        entry.resolve({ id, ok: false, code: 'unavailable', local: true });
      }
      pending.clear(); late.clear(); listeners.clear();
    },
  };
}
