import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';

/**
 * Runs an async loader whenever the screen gains focus or any data changes
 * (store.dataVersion bumps after every write).
 */
export function useAsyncData<T>(loader: () => Promise<T>, deps: unknown[] = []): { data: T | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const version = useAppStore(s => s.dataVersion);
  const alive = useRef(true);
  const latest = useRef(0);

  const load = useCallback(() => {
    // Loads can finish out of order (e.g. switching range quickly); only the newest may update state.
    const id = ++latest.current;
    setLoading(true);
    loader()
      .then(v => {
        if (alive.current && id === latest.current) setData(v);
      })
      .catch(() => {})
      .finally(() => {
        if (alive.current && id === latest.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return { data, loading, reload: load };
}

/** Same as useAsyncData but for components outside a navigator (no focus effect). */
export function useAsyncValue<T>(loader: () => Promise<T>, deps: unknown[] = []): T | null {
  const [data, setData] = useState<T | null>(null);
  const version = useAppStore(s => s.dataVersion);
  useEffect(() => {
    let alive = true;
    loader()
      .then(v => {
        if (alive) setData(v);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps]);
  return data;
}
