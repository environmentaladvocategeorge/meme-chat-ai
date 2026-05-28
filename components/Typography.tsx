import { Text, TextProps, TextStyle } from "react-native";

// Two font families:
//   - Body: Poppins, registered as per-weight static TTFs
//     ("Poppins-Regular", "Poppins-Medium", "Poppins-SemiBold",
//     "Poppins-Bold"). React Native does not reliably engage variable
//     fonts' wght axis through the `fontWeight` style on iOS, so we route
//     each weight to its own font-family name and the OS picks the
//     correct physical file. That's the only reason `bodyFamilyMap` exists
//     here — without it, body text rendered at the variable font's
//     default weight regardless of what `fontWeight` we passed.
//   - Display: Fredoka, a variable font whose weight axis does engage in
//     our setup. Kept as a single registration with `fontWeight` driving
//     the axis.
//
// Fredoka was chosen for the display face after Baloo 2 shipped with a
// Devanagari-tuned descent metric that pushed Latin glyphs into the upper
// portion of every line box, making centered titles look visibly higher
// than any icon next to them on iOS. Fredoka has normal Latin metrics so
// flex centering "just works".
type Family = "sans" | "display";
type Weight =
  | "extralight"
  | "light"
  | "regular"
  | "medium"
  | "semibold"
  | "bold"
  | "extrabold";

type Variant =
  | "display"
  | "title-xl"
  | "title-lg"
  | "title-md"
  | "title-sm"
  | "body-lg"
  | "body"
  | "body-sm"
  | "label"
  | "caption"
  | "micro"
  | "overline";

interface TypographyProps extends TextProps {
  variant?: Variant;
  family?: Family;
  weight?: Weight;
  italic?: boolean;
}

const fontWeightMap: Record<Weight, TextStyle["fontWeight"]> = {
  extralight: "200",
  light: "300",
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
  extrabold: "800",
};

const variantStyles: Record<
  Variant,
  {
    fontSize: number;
    lineHeight: number;
    weight: Weight;
    defaultFamily: Family;
    uppercase?: boolean;
    tracking?: number;
  }
> = {
  display: {
    fontSize: 28,
    lineHeight: 34,
    weight: "medium",
    defaultFamily: "display",
  },
  "title-xl": {
    fontSize: 23,
    lineHeight: 29,
    weight: "medium",
    defaultFamily: "display",
  },
  "title-lg": {
    fontSize: 20,
    lineHeight: 26,
    weight: "medium",
    defaultFamily: "display",
  },
  "title-md": {
    fontSize: 17,
    lineHeight: 23,
    weight: "medium",
    defaultFamily: "display",
  },
  "title-sm": {
    fontSize: 15,
    lineHeight: 20,
    weight: "medium",
    defaultFamily: "display",
  },
  "body-lg": {
    fontSize: 14,
    lineHeight: 21,
    weight: "regular",
    defaultFamily: "sans",
  },
  body: {
    fontSize: 13,
    lineHeight: 20,
    weight: "regular",
    defaultFamily: "sans",
  },
  "body-sm": {
    fontSize: 12,
    lineHeight: 17,
    weight: "medium",
    defaultFamily: "sans",
  },
  label: {
    fontSize: 12,
    lineHeight: 16,
    weight: "semibold",
    defaultFamily: "sans",
  },
  caption: {
    fontSize: 12,
    lineHeight: 18,
    weight: "regular",
    defaultFamily: "sans",
  },
  micro: {
    fontSize: 10,
    lineHeight: 13,
    weight: "semibold",
    defaultFamily: "sans",
  },
  overline: {
    fontSize: 10,
    lineHeight: 14,
    weight: "semibold",
    defaultFamily: "sans",
    uppercase: true,
    tracking: 0.08,
  },
};

// Map our weight tokens to the corresponding Poppins static-TTF family
// names registered in app/_layout.tsx. Weights below 400 collapse to
// Regular, above 700 collapse to Bold — Poppins ships those four physical
// files and we don't pull more to keep the bundle small.
const bodyFamilyMap: Record<Weight, string> = {
  extralight: "Poppins-Regular",
  light: "Poppins-Regular",
  regular: "Poppins-Regular",
  medium: "Poppins-Medium",
  semibold: "Poppins-SemiBold",
  bold: "Poppins-Bold",
  extrabold: "Poppins-Bold",
};

function getFontStyle(
  family: Family,
  weight: Weight,
  italic: boolean,
): TextStyle {
  if (family === "display") {
    return {
      fontFamily: "Fredoka",
      fontWeight: fontWeightMap[weight],
    };
  }
  return {
    fontFamily: bodyFamilyMap[weight],
    // RN will apply a synthetic italic transform when fontStyle: italic is
    // set and the registered family has no italic face — fine for the
    // occasional italic body run; we don't bundle separate italic files.
    fontStyle: italic ? "italic" : "normal",
  };
}

export function Typography({
  variant = "body",
  family,
  weight,
  italic = false,
  style,
  children,
  ...props
}: TypographyProps) {
  const base = variantStyles[variant];
  const resolvedFamily = family ?? base.defaultFamily;
  const resolvedWeight = weight ?? base.weight;
  const fontStyle = getFontStyle(resolvedFamily, resolvedWeight, italic);

  return (
    <Text
      style={[
        {
          ...fontStyle,
          fontSize: base.fontSize,
          lineHeight: base.lineHeight,
          // Android-only: removes the reserved ascent/descent padding so
          // the glyph box (not the line-box) is what gets vertically
          // centered next to inline siblings. No-op on iOS.
          includeFontPadding: false,
          textAlignVertical: "center",
          ...(base.uppercase
            ? {
                textTransform: "uppercase",
                letterSpacing: (base.tracking ?? 0.08) * base.fontSize,
              }
            : {}),
        },
        style,
      ]}
      {...props}
    >
      {children}
    </Text>
  );
}
