import { useCallback, useEffect, useRef, useState } from 'react';
export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch(path, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } }); }
  catch (error) { if (error instanceof DOMException && error.name === 'AbortError') throw error; throw new ApiError('接続できませんでした。Wi-Fiとサーバーを確認してください。', 0); }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(body?.error || '処理できませんでした。もう一度お試しください。', response.status);
  return body as T;
}
export function usePoll<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const reload = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout>, controller: AbortController | null = null, failures = 0;
    setData(null); setError(''); setLoading(!!url);
    async function fetchData() {
      clearTimeout(timer);
      controller?.abort();
      if (!url || !active || document.hidden) return;
      const request = new AbortController(); controller = request;
      try {
        const result = await api<T>(url, { signal: request.signal });
        if (!active || request.signal.aborted) return;
        setData(result); setError(''); failures = 0;
      } catch (e) {
        if (!active || request.signal.aborted) return;
        setError((e as Error).message); failures++;
      } finally {
        if (active && !request.signal.aborted) { setLoading(false); timer = setTimeout(fetchData, Math.min(15000, 3000 * (failures + 1))); }
      }
    }
    reload.current = fetchData;
    void fetchData();
    const visibility = () => { if (document.hidden) { clearTimeout(timer); controller?.abort(); } else void fetchData(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { active = false; clearTimeout(timer); controller?.abort(); document.removeEventListener('visibilitychange', visibility); };
  }, [url]);
  const refresh = useCallback(() => reload.current(), []);
  return { data, error, loading, refresh };
}
// crypto.randomUUID is not available on many LAN HTTP origins. getRandomValues is.
export function requestKey() {
  const bytes = new Uint8Array(24); crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
