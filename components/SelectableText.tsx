import Constants from "expo-constants";
import { forwardRef } from "react";
import { Platform, Text, type TextProps } from "react-native";

// SelectableText
//
// React Native's <Text> is backed by a UILabel on iOS, whose only selection
// affordance is press-and-hold → "Copy" (it selects the whole block; there are
// no drag handles, so you can't highlight part of a message). True ChatGPT-style
// partial selection needs a UITextView, which react-native-uitextview provides.
//
// That library is a NATIVE component, so — exactly like the AdMob split in
// domain/ads/mobileAds.native.ts — it only exists in a real build (dev build /
// TestFlight / store), never in Expo Go. We require it lazily and guarded so
// Expo Go (and web/Android, where it's a no-op anyway) never touch the native
// side: there this falls back to a plain <Text>, keeping today's select-all +
// Copy behavior. In a real iOS build it renders the UITextView and selection
// becomes fully draggable.
const canUseNativeSelection =
  Platform.OS === "ios" && Constants.appOwnership !== "expo";

type UITextViewComponent = React.ForwardRefExoticComponent<
  TextProps & { uiTextView?: boolean } & React.RefAttributes<Text>
>;

let UITextView: UITextViewComponent | null = null;
if (canUseNativeSelection) {
  try {
    // Guarded so the native module is only ever touched outside Expo Go.
    UITextView = require("react-native-uitextview").UITextView;
  } catch {
    UITextView = null;
  }
}

// True only when the UITextView-backed path is live (real iOS build). Lets
// callers branch on whether drag-selection is actually available.
export const SUPPORTS_NATIVE_TEXT_SELECTION = UITextView != null;

export type SelectableTextProps = TextProps & {
  // Activates the UITextView host (required by react-native-uitextview along
  // with `selectable`). Set it on the OUTERMOST text node of a block; nested
  // runs render as child UITextViews without it. Ignored on the Text fallback.
  uiTextView?: boolean;
};

// Drop-in for <Text>. Renders the UITextView-backed component when it's
// available, otherwise a plain selectable <Text>.
export const SelectableText = forwardRef<Text, SelectableTextProps>(
  function SelectableText({ uiTextView, ...props }, ref) {
    if (UITextView) {
      return <UITextView ref={ref} uiTextView={uiTextView} {...props} />;
    }
    // Expo Go / web / Android: plain RN Text. `uiTextView` is dropped — it's not
    // a valid Text prop.
    return <Text ref={ref} {...props} />;
  },
);
