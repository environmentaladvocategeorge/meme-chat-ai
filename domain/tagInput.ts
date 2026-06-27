// Pure helpers behind the chip/pill inputs (type-to-pill, multi-select pills,
// emoji palette). Kept out of the components so the add/dedupe/cap rules are
// unit-tested and identical everywhere.

export function normalizeTag(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

function hasTag(list: string[], tag: string): boolean {
  const lower = tag.toLowerCase();
  return list.some((t) => t.toLowerCase() === lower);
}

// Adds a tag if it's non-empty, not already present (case-insensitive), and the
// list isn't at its cap. Returns the same list reference's contents otherwise.
export function addTag(list: string[], raw: string, max: number): string[] {
  const tag = normalizeTag(raw);
  if (!tag) return list;
  if (hasTag(list, tag)) return list;
  if (list.length >= max) return list;
  return [...list, tag];
}

export function removeTag(list: string[], tag: string): string[] {
  const lower = tag.toLowerCase();
  return list.filter((t) => t.toLowerCase() !== lower);
}

// Toggles a tag for curated pickers: present → remove, absent → add (capped).
export function toggleTag(list: string[], tag: string, max: number): string[] {
  return hasTag(list, tag) ? removeTag(list, tag) : addTag(list, tag, max);
}
