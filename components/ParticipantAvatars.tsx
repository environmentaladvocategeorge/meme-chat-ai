// ParticipantAvatars
//
// The stacked, slightly-offset avatar cluster shown on a conversation's history
// row — the bots that have taken part. Up to 3 circles: the first few personas'
// avatars, with a "+N" overflow disc once there are more than 3. Ids resolve
// against the persona store (+ the default Brainrot Bot); an id that's neither
// the default nor an owned persona is a since-deleted bot and shows a winking
// smiley.

import { PersonaAvatar } from "@/components/PersonaAvatar";
import { Typography } from "@/components/Typography";
import { resolvePersonaSlot, type ResolvedPersona } from "@/domain/personas";
import { useTheme } from "@/hooks/useTheme";
import { usePersonaStore } from "@/store/personas";
import { SmileyWink } from "phosphor-react-native";
import { View } from "react-native";

const SIZE = 30;
const RING = 2;
const OVERLAP = 11;
const MAX_CIRCLES = 3;

type Slot =
  | { kind: "persona"; persona: ResolvedPersona }
  | { kind: "unknown" }
  | { kind: "overflow"; count: number };

export function ParticipantAvatars({
  ids,
  ringColor,
}: {
  ids: string[];
  // The color of the gap/ring between overlapping circles — should match the
  // surface the cluster sits on so the circles read as separated.
  ringColor?: string;
}) {
  const theme = useTheme();
  const personas = usePersonaStore((s) => s.personas);

  if (!ids || ids.length === 0) return null;
  const ring = ringColor ?? theme["--color-card"];

  // > 3 participants → show 2 avatars + a "+N" disc (3 circles total).
  const overflow = ids.length > MAX_CIRCLES;
  const shown = overflow ? ids.slice(0, MAX_CIRCLES - 1) : ids.slice(0, MAX_CIRCLES);
  const slots: Slot[] = shown.map((id) => {
    const resolved = resolvePersonaSlot(id, personas);
    return resolved === "unknown"
      ? { kind: "unknown" }
      : { kind: "persona", persona: resolved };
  });
  if (overflow) slots.push({ kind: "overflow", count: ids.length - (MAX_CIRCLES - 1) });

  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {slots.map((slot, i) => (
        <View
          key={i}
          style={{
            width: SIZE,
            height: SIZE,
            borderRadius: SIZE / 2,
            borderWidth: RING,
            borderColor: ring,
            backgroundColor: theme["--color-card-muted"],
            marginLeft: i === 0 ? 0 : -OVERLAP,
            // Leftmost on top so it stays fully visible; the rest peek out right.
            zIndex: MAX_CIRCLES - i + 1,
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {slot.kind === "persona" ? (
            <PersonaAvatar persona={slot.persona} size={SIZE - RING * 2} />
          ) : slot.kind === "overflow" ? (
            <Typography
              variant="caption"
              weight="bold"
              style={{ color: theme["--color-foreground-secondary"] }}
            >
              {`+${slot.count}`}
            </Typography>
          ) : (
            <SmileyWink
              size={SIZE - RING * 2 - 6}
              weight="fill"
              color={theme["--color-foreground-muted"]}
            />
          )}
        </View>
      ))}
    </View>
  );
}
