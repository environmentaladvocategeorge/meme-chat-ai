import { useTheme } from "@/hooks/useTheme";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { forwardRef } from "react";
import { TextInput, TextInputProps, View } from "react-native";
import { GlassSurface, liquidGlassAvailable } from "./GlassSurface";
import { Typography } from "./Typography";

interface InputProps extends Omit<TextInputProps, "style"> {
  label?: string;
  error?: string | null;
  // "glass" renders translucent white-on-gradient styling for the auth
  // screens that sit over the brand gradient; "default" is the standard
  // theme-surfaced field used everywhere else.
  tone?: "default" | "glass";
  // When rendered inside a @gorhom bottom sheet, swap the plain TextInput for
  // BottomSheetTextInput so focus + keyboard avoidance is handled by the sheet.
  bottomSheet?: boolean;
  // Number of text rows to show. Implies a multiline, top-aligned field sized
  // to roughly this many lines (it still grows with content). Omit for the
  // standard single-line field.
  rows?: number;
  // Show a live "current/limit" counter in the corner. Uses `limit` if set,
  // otherwise `maxLength`.
  showCount?: boolean;
  // A SOFT character limit: the field still accepts more, but the counter and
  // the field's border go red once `value.length` exceeds it (and form
  // validation blocks publish). Use this — not a hard `maxLength` — when you
  // want the "you went over" red feedback the user can see and fix.
  limit?: number;
}

// One line of text in the field, used to size multi-row inputs.
const LINE_HEIGHT = 22;

// Glass palette is fixed (not theme-derived) because it always sits over the
// dark brand gradient, in both light and dark mode.
const GLASS = {
  label: "rgba(255,255,255,0.86)",
  background: "rgba(255,255,255,0.1)",
  border: "rgba(255,255,255,0.28)",
  borderError: "#FF9DB0",
  text: "#FFFFFF",
  placeholder: "rgba(255,255,255,0.5)",
  error: "#FFC2CC",
  // Tint fed to the native glass material. Untinted "regular" glass over the
  // dark brand gradient reads as nearly nothing (the "no background" bug) —
  // a soft white tint gives the field a visible frosted body while still
  // refracting the gradient behind it.
  tint: "rgba(255,255,255,0.16)",
} as const;

export const Input = forwardRef<TextInput, InputProps>(function Input(
  {
    label,
    error,
    placeholder,
    tone = "default",
    bottomSheet = false,
    rows,
    showCount = false,
    limit,
    value,
    maxLength,
    multiline,
    ...rest
  },
  ref,
) {
  const theme = useTheme();
  const isGlass = tone === "glass";
  const Field = bottomSheet ? BottomSheetTextInput : TextInput;

  // A field with `rows` (or an explicit multiline) grows vertically and aligns
  // its text to the top, rather than sitting in the fixed single-line height.
  const isMultiline = multiline === true || rows != null;
  const minHeight = (rows ?? 4) * LINE_HEIGHT + 24;
  const count = typeof value === "string" ? value.length : 0;
  // The number the counter shows + compares against: the soft `limit` if given,
  // else a hard `maxLength` (which can never actually be exceeded).
  const displayLimit = limit ?? (typeof maxLength === "number" ? maxLength : undefined);
  const counterVisible = showCount && displayLimit != null;
  const over = displayLimit != null && count > displayLimit;
  // The field reads as errored when the form flagged it OR it's over the limit
  // (immediate, before the form's onTouched validation has fired).
  const hasError = Boolean(error) || over;

  const labelColor = isGlass ? GLASS.label : theme["--color-foreground-secondary"];
  const errorColor = isGlass ? GLASS.error : theme["--color-error"];
  const counterColor = over
    ? errorColor
    : isGlass
      ? GLASS.placeholder
      : theme["--color-foreground-muted"];

  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Typography variant="label" style={{ color: labelColor }}>
          {label}
        </Typography>
      ) : null}
      {/* The surface (background/border) lives on the wrapper, not the
          TextInput, so Liquid Glass can replace it where available. The resting
          border is fallback-only (glass has its own edge); the error signal
          rides fallbackStyle on the non-glass path and a glass-safe overlay
          ring on the glass path (a border on the GlassView kills the material). */}
      <GlassSurface
        tintColor={isGlass ? GLASS.tint : undefined}
        style={
          isMultiline
            ? { minHeight, borderRadius: isGlass ? 16 : 14 }
            : { height: isGlass ? 50 : 44, borderRadius: isGlass ? 16 : 14 }
        }
        // NOTE: the error border is NOT applied to `style`. On the iOS 26 glass
        // path that style goes straight to the GlassView, and a border there
        // paints over the material — killing the glass and flashing a red
        // rectangle (see GlassSurface). The fallback path keeps its border via
        // fallbackStyle; the glass path gets a glass-safe overlay ring below.
        fallbackStyle={{
          backgroundColor: isGlass ? GLASS.background : theme["--color-input"],
          borderWidth: isGlass ? 1.5 : 1,
          borderColor: hasError
            ? isGlass
              ? GLASS.borderError
              : theme["--color-error"]
            : isGlass
              ? GLASS.border
              : theme["--color-border"],
        }}
      >
        <Field
          ref={ref as never}
          placeholder={placeholder}
          placeholderTextColor={
            isGlass ? GLASS.placeholder : theme["--color-foreground-muted"]
          }
          value={value}
          maxLength={maxLength}
          multiline={isMultiline}
          textAlignVertical={isMultiline ? "top" : "center"}
          style={{
            flex: 1,
            paddingLeft: 16,
            // Reserve room for the corner counter so text never runs under it:
            // below it on a multiline field, beside it on a single-line one.
            paddingRight: counterVisible && !isMultiline ? 64 : 16,
            paddingTop: isMultiline ? 12 : 0,
            paddingBottom: isMultiline ? (counterVisible ? 28 : 12) : 0,
            color: isGlass ? GLASS.text : theme["--color-foreground"],
            fontFamily: "Poppins-Regular",
            fontSize: 15,
            lineHeight: isMultiline ? LINE_HEIGHT : undefined,
          }}
          {...rest}
        />
        {counterVisible ? (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              right: 12,
              // Multiline: pin to the bottom edge. Single-line: fill the height
              // and center the counter vertically beside the text.
              ...(isMultiline ? { bottom: 8 } : { top: 0, bottom: 0 }),
              justifyContent: "center",
            }}
          >
            <Typography variant="caption" style={{ color: counterColor }}>
              {`${count}/${displayLimit}`}
            </Typography>
          </View>
        ) : null}
        {/* Error ring for the glass path: drawn as an overlay so the GlassView
            itself never gets a border (which would kill the material). The
            non-glass path shows its red border via fallbackStyle instead. */}
        {liquidGlassAvailable && hasError ? (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              borderRadius: isGlass ? 16 : 14,
              borderWidth: isGlass ? 1.5 : 1,
              borderColor: isGlass ? GLASS.borderError : theme["--color-error"],
            }}
          />
        ) : null}
      </GlassSurface>
      {error ? (
        <Typography variant="caption" style={{ color: errorColor }}>
          {error}
        </Typography>
      ) : null}
    </View>
  );
});
