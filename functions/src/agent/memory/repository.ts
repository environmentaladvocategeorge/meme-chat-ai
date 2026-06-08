import {
  FieldValue,
  Timestamp,
  getFirestore,
  type Firestore,
} from "firebase-admin/firestore";
import { isMemoryCategory, type MemoryFact, type MemoryState } from "./types";
import type { CompiledMemory } from "./compile";

// Top-level `memories/{uid}` collection (kept separate from profiles so the
// memory service owns its data). The compiled block lives on the parent doc for
// a single hot-path read; individual facts live in the `facts` subcollection for
// the settings list + granular clear.
const COLLECTION = "memories";

function factDocToModel(id: string, data: Record<string, unknown>): MemoryFact | null {
  const text = typeof data.text === "string" ? data.text : "";
  if (!text || !isMemoryCategory(data.category)) return null;
  const createdAt =
    data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : 0;
  const updatedAt =
    data.updatedAt instanceof Timestamp ? data.updatedAt.toMillis() : createdAt;
  return {
    id,
    text,
    category: data.category,
    salience: typeof data.salience === "number" ? data.salience : 1,
    createdAt,
    updatedAt,
    sourceConversationId:
      typeof data.sourceConversationId === "string"
        ? data.sourceConversationId
        : null,
  };
}

// All persistence for user memory. Pure logic (compile/consolidate/extract) lives
// elsewhere; this is the only place that touches Firestore.
export class MemoryRepository {
  private readonly db: Firestore;

  constructor(db: Firestore = getFirestore()) {
    this.db = db;
  }

  private stateRef(uid: string) {
    return this.db.collection(COLLECTION).doc(uid);
  }

  private factsRef(uid: string) {
    return this.stateRef(uid).collection("facts");
  }

  // Hot path: the precompiled block + state. One doc read; null when absent.
  async getState(uid: string): Promise<MemoryState | null> {
    const snap = await this.stateRef(uid).get();
    if (!snap.exists) return null;
    const d = snap.data() as Record<string, unknown>;
    return {
      // Memory is opt-OUT: absent flag means on (a paid user with facts but no
      // explicit toggle still gets memory).
      enabled: typeof d.enabled === "boolean" ? d.enabled : true,
      block: typeof d.block === "string" ? d.block : "",
      blockTokens: typeof d.blockTokens === "number" ? d.blockTokens : 0,
      factCount: typeof d.factCount === "number" ? d.factCount : 0,
      updatedAt: d.updatedAt instanceof Timestamp ? d.updatedAt.toMillis() : null,
    };
  }

  // Flip the on/off switch. Merge so it never clobbers the block/facts state,
  // and never touches `updatedAt` (that tracks fact changes, not toggles).
  async setEnabled(uid: string, enabled: boolean): Promise<void> {
    await this.stateRef(uid).set({ enabled }, { merge: true });
  }

  async listFacts(uid: string): Promise<MemoryFact[]> {
    const snap = await this.factsRef(uid).get();
    return snap.docs.flatMap((doc) => {
      const m = factDocToModel(doc.id, doc.data());
      return m ? [m] : [];
    });
  }

  // Cold path: write the consolidated fact set + recompiled block atomically.
  // Reconciles the subcollection (upserts the new set, deletes anything no longer
  // present) and updates the parent state doc.
  async persist(
    uid: string,
    facts: MemoryFact[],
    compiled: CompiledMemory,
  ): Promise<void> {
    const existing = await this.factsRef(uid).get();
    const keep = new Set(facts.map((f) => f.id));
    const batch = this.db.batch();

    for (const doc of existing.docs) {
      if (!keep.has(doc.id)) batch.delete(doc.ref);
    }
    for (const f of facts) {
      batch.set(this.factsRef(uid).doc(f.id), {
        text: f.text,
        category: f.category,
        salience: f.salience,
        createdAt: Timestamp.fromMillis(f.createdAt),
        updatedAt: Timestamp.fromMillis(f.updatedAt),
        sourceConversationId: f.sourceConversationId ?? null,
      });
    }
    batch.set(
      this.stateRef(uid),
      {
        block: compiled.block,
        blockTokens: compiled.tokens,
        factCount: facts.length,
        updatedAt: FieldValue.serverTimestamp(),
      },
      // Merge so the user's `enabled` toggle is preserved across refreshes.
      { merge: true },
    );

    await batch.commit();
  }

  // Clear everything: drop all facts and reset the block to empty. Preserves the
  // user's on/off toggle (clearing memory shouldn't silently turn it off).
  async clearAll(uid: string): Promise<void> {
    await this.db.recursiveDelete(this.factsRef(uid));
    await this.stateRef(uid).set(
      {
        block: "",
        blockTokens: 0,
        factCount: 0,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  async deleteFact(uid: string, factId: string): Promise<void> {
    await this.factsRef(uid).doc(factId).delete();
  }

  // Rewrite just the state doc (used after a single-fact delete recompiles).
  async saveState(uid: string, compiled: CompiledMemory, factCount: number): Promise<void> {
    await this.stateRef(uid).set(
      {
        block: compiled.block,
        blockTokens: compiled.tokens,
        factCount,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
}
