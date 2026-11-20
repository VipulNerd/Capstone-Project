import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Runs an async function and tracks { data, loading, error }.
 * Re-runs whenever `deps` change; call `refetch()` to run it again manually.
 */
export default function useApi(fn, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const fnRef = useRef(fn);

  useEffect(() => {
    fnRef.current = fn;
  });

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fnRef.current();
      setData(result);
      return result;
    } catch (err) {
      setError(err);
      return undefined;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, setData, loading, error, refetch: run };
}
