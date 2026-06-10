// Public surface of the user-memory service. Import from here, not the internals.
export { MemoryService } from "./MemoryService";
export type { MemoryServiceDeps, RefreshResult } from "./MemoryService";
export { MemoryRepository } from "./repository";
export { planHasMemory, memoryEnabledForUser } from "./gating";
export { compileMemoryBlock, MEMORY_BLOCK_HEADER } from "./compile";
export { consolidateFacts } from "./consolidate";
export {
  MEMORY_MAX_TOKENS,
  MEMORY_MAX_FACTS,
  MEMORY_CATEGORIES,
  type MemoryFact,
  type MemoryCategory,
  type MemoryOp,
  type MemoryState,
} from "./types";
