import { useState, useEffect, useRef } from 'react';

/**
 * useState that persists to localStorage under the given key.
 * Supports Set<string> via automatic JSON array conversion.
 */
export function usePersistedState<T>(key: string, initialValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const initialRef = useRef(initialValue);
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored === null) return initialRef.current;
      const parsed = JSON.parse(stored);
      // Rehydrate Set if initial value was a Set
      if (initialRef.current instanceof Set) {
        return new Set(Array.isArray(parsed) ? parsed : []) as unknown as T;
      }
      return parsed as T;
    } catch {
      return initialRef.current;
    }
  });

  useEffect(() => {
    try {
      const serializable = value instanceof Set ? Array.from(value) : value;
      localStorage.setItem(key, JSON.stringify(serializable));
    } catch {
      // ignore quota errors
    }
  }, [key, value]);

  return [value, setValue];
}
