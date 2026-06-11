// ── Word bank: data + per-turn sampler ───────────────────────────────────────
// The old persona prompt shipped the full ~350-token WORD BANK every turn; the
// model overfit to a handful of favorites ("gng", "side quest", "cooked") and
// the static tokens were pure cost. Now the bank lives here as data and each
// turn gets a small rot-level-weighted sample rendered into the prompt's
// dynamic suffix (AssembleCtx.wordBankSample), with two deterministic wins:
//
// - variety: the model can't overfit to a fixed list it never fully sees, and
//   seasonal slang ("67", "labubu") rotates by editing data, not prompts.
// - anti-repetition: terms detected in the bot's recent replies are excluded
//   from the next sample, so template repetition is solved in code instead of
//   asking a mini model to do cross-turn bookkeeping ("avoid for 3-5 replies").
//
// SAMPLER + ASSEMBLY DEPLOY ORDER: the word_bank_sample dynamic fragment kind
// must be deployed in functions code BEFORE a fragment set referencing it is
// pushed to Firestore (asFragmentedPrompt rejects unknown kinds and prompt
// resolution throws).

type BankTerm = {
  t: string;
  // Minimum rot level at which this term is eligible (default 1 = always).
  // L1 samples only the tame end; the feral end unlocks at 2-3.
  min?: 2 | 3;
  // Short usage gloss rendered after the term, for phrase-shapes that need it.
  gloss?: string;
};

type BankCategory = {
  key: string;
  // Rendered as the category line's header.
  label: string;
  terms: BankTerm[];
};

export const WORD_BANK: BankCategory[] = [
  {
    key: "address",
    label: "Address terms (use rarely)",
    terms: [
      { t: "bro" },
      { t: "bruh" },
      { t: "brochacho" },
      { t: "brosito" },
      { t: "mijo" },
      { t: "son" },
      { t: "sonion", min: 2 },
      { t: "chat" },
      { t: "twin" },
      { t: "boss" },
      { t: "chief" },
      { t: "legend" },
      { t: "homie" },
      { t: "big dog" },
      { t: "bestie" },
      { t: "my guy" },
      { t: "gng", min: 2 },
    ],
  },
  {
    key: "reaction",
    label: "Reactions",
    terms: [
      { t: "real" },
      { t: "valid" },
      { t: "facts" },
      { t: "W" },
      { t: "tragic" },
      { t: "criminal" },
      { t: "nasty work", min: 2 },
      { t: "insane" },
      { t: "cursed" },
      { t: "elite" },
      { t: "unserious" },
      { t: "diabolical", min: 2 },
      { t: "vile work", min: 2 },
      { t: "shii", min: 2 },
      { t: "on god" },
      { t: "fr fr" },
      { t: "ong" },
      { t: "ngl" },
      { t: "say less" },
      { t: "no cap" },
      { t: "i'm shook" },
    ],
  },
  {
    key: "hype",
    label: "Good / hype",
    terms: [
      { t: "ate" },
      { t: "ate no crumbs" },
      { t: "slay" },
      { t: "slayyy", min: 2 },
      { t: "slayyy queen", min: 2 },
      { t: "yassss", min: 2 },
      { t: "yassss queen", min: 3 },
      { t: "clean" },
      { t: "tuff" },
      { t: "ts so tuff", min: 2 },
      { t: "ts bussin", min: 2 },
      {
        t: "first of all, ts tuff 🔥",
        min: 2,
        gloss: "hype opener for something cool, impressive, or interesting",
      },
      { t: "let him cook" },
      { t: "aura recovered", min: 2 },
      { t: "fire" },
      { t: "W behavior" },
      { t: "actually cooking" },
      { t: "king" },
      { t: "queen" },
      { t: "Chad", min: 2 },
      { t: "Gigachad", min: 2 },
      { t: "LeGoat", min: 2 },
    ],
  },
  {
    key: "failure",
    label: "Failure / badness",
    terms: [
      { t: "cooked" },
      { t: "we're cooked" },
      { t: "chalked", min: 2 },
      { t: "dogwater" },
      { t: "buns", min: 2 },
      { t: "ts buns", min: 2 },
      { t: "mid" },
      { t: "scuffed" },
      { t: "chopped" },
      { t: "in shambles" },
      { t: "not beating the allegations", min: 2 },
      { t: "generational fumble", min: 2 },
      { t: "aura debt", min: 2 },
      { t: "red flag" },
    ],
  },
  {
    key: "confusion",
    label: "Confusion",
    terms: [
      { t: "the math is not mathing" },
      { t: "make it make sense" },
      { t: "be so serious" },
      { t: "erm what the sigma", min: 3 },
      { t: "what are we doing" },
      { t: "respectfully confused" },
      { t: "i am looking at this with concern" },
      { t: "lowkey lost in the sauce", min: 2 },
    ],
  },
  {
    key: "lore",
    label: "Story / game / lore metaphors",
    terms: [
      { t: "lore" },
      { t: "deep lore" },
      { t: "canon event" },
      { t: "side quest" },
      { t: "side mission" },
      { t: "bonus objective", min: 2 },
      { t: "side plot" },
      { t: "filler episode" },
      { t: "tutorial skip" },
      { t: "boss fight" },
      { t: "fetch quest", min: 2 },
      { t: "DLC" },
      { t: "patch notes moment", min: 2 },
      { t: "season finale" },
      { t: "villain arc" },
      { t: "speedrun" },
      { t: "main character energy" },
    ],
  },
  {
    key: "archetypes",
    label: "Internet archetypes",
    terms: [
      { t: "NPC behavior" },
      { t: "bot behavior" },
      { t: "discord mod" },
      { t: "normie" },
      { t: "larping" },
      { t: "LinkedIn final boss", min: 2 },
      { t: "Reddit court jester", min: 2 },
      { t: "CEO of" },
      { t: "performative male", min: 2 },
      { t: "clanker", min: 2 },
      { t: "ai slop" },
    ],
  },
  {
    key: "chaos",
    label: "Chaos replacements",
    terms: [
      { t: "mess" },
      { t: "circus" },
      { t: "blender" },
      { t: "reality show" },
      { t: "smoke alarm", min: 2 },
      { t: "group project energy" },
      { t: "evidence confetti", min: 2 },
      { t: "clown car" },
      { t: "disaster casserole", min: 2 },
      { t: "cursed soup", min: 2 },
      { t: "plot turbulence", min: 2 },
      { t: "emotional damage" },
      { t: "this is fine" },
    ],
  },
  {
    key: "trend",
    label: "Culture / trend tokens",
    terms: [
      { t: "rizz" },
      { t: "sigma" },
      { t: "grindset" },
      { t: "maxxing", min: 2 },
      { t: "jestermaxxing", min: 2 },
      { t: "sus" },
      { t: "aura" },
      { t: "doomscrolling" },
      { t: "touch grass" },
      { t: "brainrot" },
      { t: "yapping" },
      { t: "rent free" },
      { t: "spill the tea" },
      { t: "stonks", min: 2 },
      { t: "vibe check" },
      { t: "okay boomer", min: 2 },
      { t: "okay zoomer", min: 2 },
      { t: "skibidi", min: 2 },
      { t: "ohio", min: 2 },
      { t: "roman empire", min: 2 },
      { t: "very demure", min: 2 },
      { t: "67", min: 2 },
      { t: "labubu", min: 2 },
      { t: "matcha", min: 2 },
      { t: "sybau", min: 3 },
      { t: "low taper fade", min: 2 },
      { t: "ninja got a low taper fade", min: 2 },
    ],
  },
  {
    key: "italian",
    label: "Italian brainrot (surreal meme creatures; one is funny, five is algorithm damage)",
    terms: [
      { t: "Tralalero Tralala", min: 2 },
      { t: "Bombardiro Crocodilo", min: 2 },
      { t: "Bombardino Crocodilo", min: 2 },
      { t: "Tung Tung Tung Sahur", min: 2 },
      { t: "Lirili Larila", min: 2 },
      { t: "Brr Brr Patapim", min: 2 },
      { t: "Chimpanzini Bananini", min: 2 },
      { t: "Ballerina Cappuccina", min: 2 },
      { t: "Cappuccino Assassino", min: 2 },
      { t: "Trippi Troppi", min: 2 },
      { t: "Boneca Ambalabu", min: 2 },
      { t: "Frigo Camelo", min: 2 },
      { t: "La Vaca Saturno Saturnita", min: 2 },
      { t: "Bombombini Gusini", min: 2 },
      { t: "Bobritto Bandito", min: 2 },
    ],
  },
];

// Terms drawn per category per turn: the dial controls breadth as well as
// which intensity tiers are eligible. Address terms stay at 1 at every level
// ("use rarely" is enforced by scarcity, not prose).
const TERMS_PER_CATEGORY: Record<1 | 2 | 3, number> = { 1: 2, 2: 2, 3: 3 };
const ADDRESS_TERMS_PER_TURN = 1;

// Same pictographic class the output linters use.
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;

function clampLevel(level: number): 1 | 2 | 3 {
  return Math.min(Math.max(Math.round(level), 1), 3) as 1 | 2 | 3;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Fisher-Yates on a copy, then take the first n.
function sampleN<T>(items: T[], n: number, rng: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

// Scans recent bot replies for bank terms (word-boundary matches, case
// insensitive) so the next sample can exclude them — the model physically
// can't spam a term that isn't in this turn's rotation.
export function detectRecentBankTerms(texts: readonly string[]): Set<string> {
  const found = new Set<string>();
  const haystack = texts.join("\n").toLowerCase();
  if (!haystack) return found;
  for (const category of WORD_BANK) {
    for (const term of category.terms) {
      const bare = term.t.replace(EMOJI_RE, "").trim().toLowerCase();
      const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(bare)}([^a-z0-9]|$)`, "i");
      if (re.test(haystack)) found.add(term.t.toLowerCase());
    }
  }
  return found;
}

export type SampleWordBankOptions = {
  level: number;
  emojisEnabled: boolean;
  // Lowercased term strings to exclude this turn (from detectRecentBankTerms).
  excludeTerms?: ReadonlySet<string>;
  // Injectable for deterministic tests; Math.random in production.
  rng?: () => number;
};

// Renders this turn's WORD BANK section, or "" when nothing is eligible
// (assembly drops the fragment cleanly on "").
export function sampleWordBank({
  level,
  emojisEnabled,
  excludeTerms,
  rng = Math.random,
}: SampleWordBankOptions): string {
  const clamped = clampLevel(level);
  const lines: string[] = [];

  for (const category of WORD_BANK) {
    const eligible = category.terms.filter(
      (term) =>
        (term.min ?? 1) <= clamped &&
        !(excludeTerms?.has(term.t.toLowerCase()) ?? false),
    );
    if (eligible.length === 0) continue;
    const count =
      category.key === "address" ? ADDRESS_TERMS_PER_TURN : TERMS_PER_CATEGORY[clamped];
    const picked = sampleN(eligible, count, rng).map((term) => {
      let rendered = term.t;
      if (!emojisEnabled) rendered = rendered.replace(EMOJI_RE, "").trim();
      return term.gloss ? `${rendered} (${term.gloss})` : rendered;
    });
    lines.push(`${category.label}: ${picked.join(", ")}`);
  }

  if (lines.length === 0) return "";
  return `WORD BANK (this turn's rotation)

Rotate, don't spam; plain words are always fine. Use what's here, not your greatest hits.

${lines.join("\n")}`;
}
