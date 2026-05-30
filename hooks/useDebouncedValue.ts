import { useEffect, useState } from "react";

// Returns `value` after it has stayed unchanged for `delayMs`. The timer
// resets on every change, so a user typing continuously won't trigger a
// downstream effect (fuzzy search, network call, etc.) until they pause.
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}
