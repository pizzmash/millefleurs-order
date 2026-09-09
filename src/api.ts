import { auth } from './auth';
import { useCallback, useEffect, useRef, useState } from 'react';
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export function guestApi(path: string) {
  const barId = location.pathname.match(/^\/b\/([^/]+)/)?.[1];
  if (!barId) throw new ApiError('招待QRから参加してください。', 401);
  return `/api/b/${barId}${path}`;
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const host = path.startsWith('/api/host/');
  const user = auth?.currentUser;
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 30000);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const headers = new Headers(options.headers);
      if (options.body) headers.set('Content-Type', 'application/json');
      if (host) {
        if (!user) throw new ApiError('Googleでログインしてください。', 401);
        try {
          headers.set('Authorization', `Bearer ${await user.getIdToken(attempt === 1)}`);
        } catch (error) {
          const code = (error as { code?: string }).code;
          if (code === 'auth/network-request-failed')
            throw new ApiError('ログインを確認できませんでした。通信環境を確認してください。', 0);
          if (auth?.currentUser?.uid === user.uid)
            window.dispatchEvent(new Event('host-session-expired'));
          throw new ApiError('Googleでログインし直してください。', 401);
        }
      }
      const response = await fetch(path, { ...options, headers, signal: controller.signal });
      if (host && auth?.currentUser?.uid !== user?.uid)
        throw new DOMException('Account changed', 'AbortError');
      if (response.status === 401 && host && attempt === 0) continue;
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 401)
          window.dispatchEvent(new Event(host ? 'host-session-expired' : 'guest-session-expired'));
        throw new ApiError(
          body?.error || '処理できませんでした。もう一度お試しください。',
          response.status,
        );
      }
      return body as T;
    }
    throw new ApiError('再ログインしてください。', 401);
  } catch (e) {
    if (e instanceof ApiError || (e instanceof DOMException && e.name === 'AbortError')) throw e;
    throw new ApiError('接続できませんでした。通信環境を確認してください。', 0);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
type PollInterval<T> = number | false | ((data: T | null) => number | false);
export function usePoll<T>(url: string | null, interval: PollInterval<T> = 3000) {
  const intervalRef = useRef(interval);
  intervalRef.current = interval;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const reload = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let active = true,
      timer: ReturnType<typeof setTimeout>,
      controller: AbortController | null = null,
      failures = 0,
      lastResult: T | null = null,
      lastStarted = -Infinity;
    setData(null);
    setError('');
    setLoading(!!url);
    async function fetchData() {
      clearTimeout(timer);
      controller?.abort();
      if (!url || !active || document.hidden) return;
      lastStarted = Date.now();
      const request = new AbortController();
      controller = request;
      try {
        const result = await api<T>(url, { signal: request.signal });
        if (!active || request.signal.aborted) return;
        lastResult = result;
        setData(result);
        setError('');
        failures = 0;
      } catch (e) {
        if (!active || request.signal.aborted) return;
        setError((e as Error).message);
        failures++;
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) active = false;
      } finally {
        if (active && !request.signal.aborted) {
          setLoading(false);
          const configured = intervalRef.current;
          const delay = failures
            ? Math.min(60000, 3000 * 2 ** Math.min(failures, 5)) + Math.random() * 1000
            : typeof configured === 'function'
              ? configured(lastResult)
              : configured;
          if (delay !== false) timer = setTimeout(fetchData, delay);
        }
      }
    }
    reload.current = fetchData;
    void fetchData();
    const visibility = () => {
      if (document.hidden) {
        clearTimeout(timer);
        controller?.abort();
      } else void fetchData();
    };
    // Visibility and focus often fire together. Avoid an immediate duplicate fetch.
    const focus = () => {
      if (!document.hidden && Date.now() - lastStarted > 1000) void fetchData();
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('focus', focus);
    return () => {
      active = false;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('focus', focus);
    };
  }, [url]);
  const refresh = useCallback(() => reload.current(), []);
  return { data, error, loading, refresh };
}
// crypto.randomUUID is not available on many LAN HTTP origins. getRandomValues is.
export function requestKey() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
