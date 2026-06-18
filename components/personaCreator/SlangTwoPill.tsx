// A two-column "term → meaning" editor for the persona's slang glossary. The
// left pill is the word, the right is what it means. Stored as the existing
// free-text `slangGlosses` string ("term = meaning; …") so nothing downstream
// changes — this is purely a friendlier input over the same value.

import { AppPressable } from "@/components/AppPressable";
import { Input } from "@/components/Input";
import { Typography } from "@/components/Typography";
import { useTheme } from "@/hooks/useTheme";
import { Plus, X } from "phosphor-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

type Pair = { term: string; meaning: string };

// "cooked = done for; locked in = focused" → pairs. Splits on ";", then the
// FIRST "=" (so a meaning may contain "="). Tolerant of the legacy free-text.
function parsePairs(value: string): Pair[] {
  return value
    .split(";")
    .map((chunk) => {
      const eq = chunk.indexOf("=");
      if (eq === -1) return { term: chunk.trim(), meaning: "" };
      return { term: chunk.slice(0, eq).trim(), meaning: chunk.slice(eq + 1).trim() };
    })
    .filter((p) => p.term.length > 0 || p.meaning.length > 0);
}

// Pairs → the stored string. Drops blank rows; a term with no meaning still
// rides along (the bot at least learns the word).
function serializePairs(pairs: Pair[]): string {
  return pairs
    .map((p) => ({ term: p.term.trim(), meaning: p.meaning.trim() }))
    .filter((p) => p.term.length > 0)
    .map((p) => (p.meaning ? `${p.term} = ${p.meaning}` : p.term))
    .join("; ");
}

// Strip the two delimiters so a typed term/meaning can't corrupt the encoding.
const clean = (s: string) => s.replace(/[;=]/g, "");

const MAX_PAIRS = 12;
const TERM_MAX = 40;
const MEANING_MAX = 120;

export function SlangTwoPill({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  // Local editing state (so typing doesn't re-parse and jump the cursor). Seeded
  // once from the incoming value; the parent value is kept in sync on each edit.
  const [pairs, setPairs] = useState<Pair[]>(() => {
    const parsed = parsePairs(value);
    return parsed.length > 0 ? parsed : [{ term: "", meaning: "" }];
  });

  const commit = (next: Pair[]) => {
    setPairs(next);
    onChange(serializePairs(next));
  };
  const setAt = (i: number, patch: Partial<Pair>) =>
    commit(pairs.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const removeAt = (i: number) => {
    const next = pairs.filter((_, idx) => idx !== i);
    commit(next.length > 0 ? next : [{ term: "", meaning: "" }]);
  };

  return (
    <View style={{ gap: 10 }}>
      {pairs.map((pair, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Input
              value={pair.term}
              onChangeText={(text) => setAt(i, { term: clean(text) })}
              placeholder={t("personasCreator.slangPill.termPlaceholder")}
              maxLength={TERM_MAX}
            />
          </View>
          <Typography variant="caption" style={{ color: theme["--color-foreground-muted"] }}>
            =
          </Typography>
          <View style={{ flex: 1.4 }}>
            <Input
              value={pair.meaning}
              onChangeText={(text) => setAt(i, { meaning: clean(text) })}
              placeholder={t("personasCreator.slangPill.meaningPlaceholder")}
              maxLength={MEANING_MAX}
            />
          </View>
          <AppPressable
            onPress={() => removeAt(i)}
            accessibilityLabel={t("common.remove")}
            hitSlop={8}
            pressScale={0.04}
            style={{ padding: 4 }}
          >
            <X size={16} weight="bold" color={theme["--color-foreground-muted"]} />
          </AppPressable>
        </View>
      ))}
      {pairs.length < MAX_PAIRS ? (
        <AppPressable
          onPress={() => commit([...pairs, { term: "", meaning: "" }])}
          accessibilityLabel={t("personasCreator.slangPill.add")}
          pressScale={0.02}
          style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 }}
        >
          <Plus size={14} weight="bold" color={theme["--color-primary"]} />
          <Typography variant="caption" weight="semibold" style={{ color: theme["--color-primary"] }}>
            {t("personasCreator.slangPill.add")}
          </Typography>
        </AppPressable>
      ) : null}
    </View>
  );
}
