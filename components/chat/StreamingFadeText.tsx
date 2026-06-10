import { useEffect, useRef } from "react";
import { Text } from "react-native";
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

// ChatGPT/Claude-style streaming fade: as the reply streams, each newly
// appended run of text eases in instead of popping. The store already batches
// SSE deltas to one flush per animation frame, so a "chunk" here is one
// flush's worth of words — fading each chunk over ~FADE_MS gives the soft
// rolling-in look without per-character work.
//
// Mechanics: the text is split into a fully-settled prefix (plain span) plus
// the most recent chunks, each rendered as a nested Animated.Text that
// animates its COLOR from alpha-0 to the message color. Color — not opacity —
// because nested text spans don't reliably support `opacity` on Android,
// while per-span color is supported everywhere. Chunks older than the kept
// window are merged back into the prefix (they're long since fully opaque),
// so the span count stays bounded no matter how long the reply runs.

const FADE_MS = 350;
// Chunks arrive ~1/frame-flush (~100ms apart); 8 kept chunks ≫ FADE_MS, so a
// chunk is always fully faded well before it merges into the prefix.
const KEPT_CHUNKS = 8;

// Theme colors are #RRGGBB (see ThinkingText's lerpHex, same assumption).
// Anything else falls back to "transparent" — a slightly darker mid-fade on
// exotic color formats, never a crash.
function alphaZero(color: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}00` : "transparent";
}

function FadingChunk({ text, color }: { text: string; color: string }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(1, {
      duration: FADE_MS,
      easing: Easing.out(Easing.quad),
    });
  }, [progress]);

  // Resolved on the JS thread; the worklet must only capture plain strings —
  // calling a non-worklet function (alphaZero) from the UI thread crashes.
  const fromColor = alphaZero(color);
  const fadeStyle = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value, [0, 1], [fromColor, color]),
  }));

  // Font metrics inherit from the parent <Text>, so only color lives here.
  return <Animated.Text style={fadeStyle}>{text}</Animated.Text>;
}

type Chunk = { key: number; text: string };

export function StreamingFadeText({
  text,
  color,
  selectionColor,
}: {
  // The full streamed text so far (monotonically growing).
  text: string;
  color: string;
  selectionColor: string;
}) {
  // Chunk bookkeeping lives in refs and is derived during render: this
  // component re-renders exactly when `text` changes, and the equality guard
  // makes a double-invoked render a no-op.
  const prevTextRef = useRef("");
  const prefixRef = useRef("");
  const chunksRef = useRef<Chunk[]>([]);
  const nextKeyRef = useRef(0);

  if (text !== prevTextRef.current) {
    if (text.startsWith(prevTextRef.current)) {
      const delta = text.slice(prevTextRef.current.length);
      if (delta.length > 0) {
        chunksRef.current = [
          ...chunksRef.current,
          { key: nextKeyRef.current++, text: delta },
        ];
      }
    } else {
      // Not an append (new turn reusing the component, or a reset): start over.
      prefixRef.current = "";
      chunksRef.current = [{ key: nextKeyRef.current++, text }];
    }
    prevTextRef.current = text;

    // Fold fully-faded chunks back into the plain prefix.
    if (chunksRef.current.length > KEPT_CHUNKS) {
      const settled = chunksRef.current.slice(
        0,
        chunksRef.current.length - KEPT_CHUNKS,
      );
      prefixRef.current += settled.map((chunk) => chunk.text).join("");
      chunksRef.current = chunksRef.current.slice(-KEPT_CHUNKS);
    }
  }

  return (
    <Text
      selectable
      selectionColor={selectionColor}
      style={{
        color,
        fontFamily: "Poppins-Regular",
        fontSize: 17,
        lineHeight: 24,
        includeFontPadding: false,
        textAlignVertical: "center",
      }}
    >
      {prefixRef.current}
      {chunksRef.current.map((chunk) => (
        <FadingChunk key={chunk.key} text={chunk.text} color={color} />
      ))}
    </Text>
  );
}
