import {
  collection,
  doc,
  onSnapshot,
  type DocumentData,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseServices } from "./app";

export type MemoryCategory =
  | "identity"
  | "preference"
  | "relationship"
  | "ongoing"
  | "lore";

export type MemoryFactView = {
  id: string;
  text: string;
  category: MemoryCategory;
  updatedAt: Date | null;
};

export type MemoryMeta = {
  enabled: boolean;
  factCount: number;
  // When memory last changed (a fact was written) — shown as "last updated".
  updatedAt: Date | null;
};

const CATEGORIES: readonly MemoryCategory[] = [
  "identity",
  "preference",
  "relationship",
  "ongoing",
  "lore",
];

function asDate(value: unknown): Date | null {
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate();
  }
  return null;
}

function asCategory(value: unknown): MemoryCategory {
  return CATEGORIES.includes(value as MemoryCategory)
    ? (value as MemoryCategory)
    : "lore";
}

// Live state of the user's memory doc (on/off, count, last-updated). A missing
// doc means "on, nothing saved yet" so a paid user who hasn't chatted still
// reads as enabled.
export function subscribeToMemoryMeta(
  uid: string,
  cb: (meta: MemoryMeta) => void,
): Unsubscribe {
  const firebase = getFirebaseServices();
  if (!firebase.available) {
    cb({ enabled: true, factCount: 0, updatedAt: null });
    return () => {};
  }
  return onSnapshot(
    doc(firebase.services.firestore, "memories", uid),
    (snap) => {
      const d = snap.exists() ? (snap.data() as DocumentData) : undefined;
      cb({
        enabled: typeof d?.enabled === "boolean" ? d.enabled : true,
        factCount: typeof d?.factCount === "number" ? d.factCount : 0,
        updatedAt: asDate(d?.updatedAt),
      });
    },
    (error) => {
      if ((error as { code?: string }).code === "permission-denied") return;
      console.warn("[memory] meta snapshot error:", error);
    },
  );
}

// Live list of remembered facts, newest-first. Read-only — the client can never
// write here (firestore.rules); mutations go through the callables.
export function subscribeToMemoryFacts(
  uid: string,
  cb: (facts: MemoryFactView[]) => void,
): Unsubscribe {
  const firebase = getFirebaseServices();
  if (!firebase.available) {
    cb([]);
    return () => {};
  }
  return onSnapshot(
    collection(firebase.services.firestore, "memories", uid, "facts"),
    (snap) => {
      const facts = snap.docs
        .map((d) => {
          const data = d.data() as DocumentData;
          return {
            id: d.id,
            text: typeof data.text === "string" ? data.text : "",
            category: asCategory(data.category),
            updatedAt: asDate(data.updatedAt),
          };
        })
        .filter((f) => f.text.length > 0)
        .sort(
          (a, b) =>
            (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0),
        );
      cb(facts);
    },
    (error) => {
      if ((error as { code?: string }).code === "permission-denied") return;
      console.warn("[memory] facts snapshot error:", error);
    },
  );
}
