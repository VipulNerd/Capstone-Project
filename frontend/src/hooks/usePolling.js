import { useEffect, useRef } from 'react';

/**
 * Calls `callback` every `interval` ms while `active` is true.
 * Runs once immediately and always uses the latest callback.
 */
export default function usePolling(callback, interval, active = true) {
  const saved = useRef(callback);

  useEffect(() => {
    saved.current = callback;
  });

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    let timer;
    const tick = async () => {
      try {
        await saved.current();
      } catch {
        // Errors are handled by the callback; keep polling.
      } finally {
        if (!cancelled) timer = setTimeout(tick, interval);
      }
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [interval, active]);
}
