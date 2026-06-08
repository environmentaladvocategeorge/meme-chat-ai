import {
  subscribeToMemoryFacts,
  subscribeToMemoryMeta,
  type MemoryFactView,
  type MemoryMeta,
} from "@/services/firebase/memory";
import { useAuthStore } from "@/store/auth";
import { useEffect, useState } from "react";

// Live memory meta (on/off, count, last-updated) for the signed-in user. Used by
// the settings row and the sheet header. Resolves to a sane default when there's
// no user yet.
export function useMemoryMeta(): { meta: MemoryMeta; loaded: boolean } {
  const uid = useAuthStore((s) => s.uid);
  const [meta, setMeta] = useState<MemoryMeta>({
    enabled: true,
    factCount: 0,
    updatedAt: null,
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!uid) {
      setMeta({ enabled: true, factCount: 0, updatedAt: null });
      setLoaded(true);
      return;
    }
    setLoaded(false);
    const unsub = subscribeToMemoryMeta(uid, (next) => {
      setMeta(next);
      setLoaded(true);
    });
    return unsub;
  }, [uid]);

  return { meta, loaded };
}

// Live list of remembered facts. Only subscribes while `active` (i.e. the sheet
// is open) so the listener isn't running app-wide.
export function useMemoryFacts(active: boolean): {
  facts: MemoryFactView[];
  loading: boolean;
} {
  const uid = useAuthStore((s) => s.uid);
  const [facts, setFacts] = useState<MemoryFactView[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!active || !uid) {
      setLoading(active);
      return;
    }
    setLoading(true);
    const unsub = subscribeToMemoryFacts(uid, (next) => {
      setFacts(next);
      setLoading(false);
    });
    return unsub;
  }, [active, uid]);

  return { facts, loading };
}
