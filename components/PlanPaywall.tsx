// PlanPaywall — redesigned
//
// Layout goals (driven by user feedback on the previous version):
//   1. All tiers visible without scrolling — segmented row of 3 paid-tier
//      cards instead of a vertically stacked list.
//   2. Current plan is unmistakable: an inline "Yours" ribbon on the tier
//      card AND a tinted column in the comparison matrix.
//   3. Recommendation badges only show while the user can still move up
//      (free or Sidekick): MVP (Power) is flagged "Best" since it's genuinely
//      the top tier, and Wingman (Plus) is flagged "Popular" as the crowd
//      favorite. On Wingman/MVP both are hidden — nudging an already-high tier
//      elsewhere is counter-intuitive.
//   4. Live prices fetched from RevenueCat Offerings on mount and shown
//      directly on each tier card.
//   5. A single dominant CTA whose copy adapts to selection vs current
//      (Upgrade / Switch / Already on this plan).
//
// The free tier is intentionally NOT a selectable card — it's the implicit
// baseline shown in the comparison matrix.

import { MemeAvatar } from "@/components/MemeAvatar";
import { Typography } from "@/components/Typography";
import { PLAN_RANK, type PlanId } from "@/domain/billing";
import { useTheme } from "@/hooks/useTheme";
import { gradients, type ThemeTokens } from "@/nativewind-theme";
import { useEffectivePlan } from "@/store/entitlement";
import { useSubscriptionStore } from "@/store/subscription";
import { TouchableOpacity as BottomSheetTouchableOpacity } from "@gorhom/bottom-sheet";
import { LinearGradient } from "expo-linear-gradient";
import { useColorScheme } from "nativewind";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Platform, StyleSheet, View } from "react-native";
import Purchases from "react-native-purchases";

type PaidPlanId = Exclude<PlanId, "free">;

const PAID_TIERS: readonly PaidPlanId[] = ["basic", "plus", "power"] as const;
const RECOMMENDED: PaidPlanId = "plus";
const FEATURE_KEYS: readonly ["chats", "memory", "customization", "adFree"] = [
  "chats",
  "memory",
  "customization",
  "adFree",
] as const;
const MATRIX_PLANS: readonly PlanId[] = ["free", "basic", "plus", "power"] as const;

const PLAN_EMOJI: Record<PlanId, string> = {
  free: "🌱",
  basic: "🚀",
  plus: "🔥",
  power: "⚡",
};

// Forward plan→product map, split by store mode. The test store keeps the
// original identifiers; production uses the App Store / Play product IDs.
// The reverse map (domain/billing.ts) recognizes BOTH sets, so entitlement
// resolution works regardless of which build is running.
const RC_PRODUCT_BY_MODE = {
  test: { basic: "monthly", plus: "monthly_2", power: "monthly_3" },
  production: {
    basic: "memeaibasic",
    plus: "memeaiplus",
    power: "memeaipower",
  },
} as const satisfies Record<"test" | "production", Record<PaidPlanId, string>>;

type Theme = ThemeTokens;
type PrimaryGradient = (typeof gradients)[keyof typeof gradients]["primary"];

export function PlanPaywall() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { colorScheme } = useColorScheme();
  const gradient = gradients[colorScheme ?? "light"].primary;
  const subscriptionStatus = useSubscriptionStore((s) => s.status);
  const subscriptionMode = useSubscriptionStore((s) => s.mode);
  const refresh = useSubscriptionStore((s) => s.refresh);
  const openManagement = useSubscriptionStore((s) => s.openManagement);
  // Resolve the plan→product map for the active store. Anything other than the
  // test store (including the pre-init null state in prod builds) uses the
  // production App Store / Play product identifiers.
  const planToProduct =
    RC_PRODUCT_BY_MODE[subscriptionMode === "test" ? "test" : "production"];
  // The paywall reads the EFFECTIVE plan (RC-live ∪ backend mirror) for both
  // its payment routing and its display. RC's client state flips the instant a
  // purchase completes, whereas the backend mirror only catches up after
  // syncRevenueCatPlan writes the profile and the Firestore listener round-
  // trips — so binding the "you're on X" pill, the current-plan badge, and the
  // matrix highlight to the mirror left them stuck on the old tier while the
  // CTA (which already used effectivePlan) had moved on. Using effectivePlan
  // everywhere keeps the whole sheet consistent and updates immediately.
  //
  // Payment routing also depends on this: existing subscribers can't reliably
  // switch tiers via Purchases.purchasePackage() — Apple/Google want plan
  // changes to flow through their subscription-management UI so proration,
  // refunds, and downgrade timing behave correctly — so we only call
  // purchasePackage() when the user is effectively on `free`.
  const effectivePlan = useEffectivePlan();
  const hasActiveSubscription = effectivePlan !== "free";

  // Default selection prefers the user's current paid plan so the page opens
  // showing what they already have; otherwise the recommended tier.
  const [selected, setSelected] = useState<PaidPlanId>(() => {
    if (effectivePlan !== "free") return effectivePlan;
    return RECOMMENDED;
  });

  // The useState initializer only runs on mount, so a purchase made while the
  // sheet is open wouldn't move the selection onto the acquired tier. Re-center
  // it whenever the effective plan becomes a paid tier. This only fires on an
  // actual plan transition, so it never fights a user tapping tiers to compare.
  useEffect(() => {
    if (effectivePlan !== "free") setSelected(effectivePlan);
  }, [effectivePlan]);
  const [busy, setBusy] = useState(false);
  const [priceByProduct, setPriceByProduct] = useState<Record<string, string>>({});

  // Pull live prices from the active offering once on mount. If RC isn't
  // configured (no keys / dev) prices stay blank — the cards still render.
  useEffect(() => {
    if (subscriptionStatus !== "ready") return;
    let cancelled = false;
    (async () => {
      try {
        const offerings = await Purchases.getOfferings();
        const map: Record<string, string> = {};
        for (const pkg of offerings.current?.availablePackages ?? []) {
          map[pkg.product.identifier] = pkg.product.priceString;
        }
        if (!cancelled) setPriceByProduct(map);
      } catch (err) {
        console.warn("[paywall] getOfferings failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [subscriptionStatus]);

  const handleCta = async () => {
    // Subscribers go to store management — they can't swap SKUs through
    // purchasePackage cleanly. Free users go through the standard purchase.
    if (hasActiveSubscription) {
      setBusy(true);
      try {
        const opened = await openManagement();
        // In RC test mode there's no real store to send the user to.
        // openManagement returns false; surface a small explainer instead
        // of silently doing nothing.
        if (!opened) {
          Alert.alert(t("settings.plan.heading"), t("settings.plan.manageNote"));
        }
      } finally {
        setBusy(false);
      }
      return;
    }

    const productId = planToProduct[selected];
    if (subscriptionStatus !== "ready") {
      Alert.alert(t("settings.plan.heading"), t("settings.plan.paywallNote"));
      return;
    }
    setBusy(true);
    try {
      const offerings = await Purchases.getOfferings();
      const pkg = offerings.current?.availablePackages.find(
        (p) => p.product.identifier === productId,
      );
      if (!pkg) {
        Alert.alert(t("settings.plan.heading"), t("settings.plan.paywallNote"));
        return;
      }
      await Purchases.purchasePackage(pkg);
      await refresh();
    } catch (err) {
      console.warn("[paywall] purchase failed:", err);
    } finally {
      setBusy(false);
    }
  };

  const isCurrentSelected = selected === effectivePlan;
  const isUpgrade = PLAN_RANK[selected] > PLAN_RANK[effectivePlan];

  // Recommendation badges only make sense while the user still has room to move
  // up. Once they're on Wingman or MVP, nudging them toward another tier reads
  // as counter-intuitive, so we hide Best/Popular and let only the "Yours"
  // badge stand. MVP is genuinely the top tier (Best); Wingman is the crowd
  // favorite (Popular).
  const showRecommendations =
    effectivePlan === "free" || effectivePlan === "basic";
  const recommendFor = (tier: PaidPlanId): "best" | "popular" | null => {
    if (!showRecommendations) return null;
    if (tier === "power") return "best";
    if (tier === "plus") return "popular";
    return null;
  };

  const selectedName = t(`settings.plan.planNames.${selected}`);
  const currentName = t(`settings.plan.planNames.${effectivePlan}`);

  // CTA copy is keyed off whether this is a first-purchase or a subscriber
  // plan change, so the user knows up-front that tapping will hand them off
  // to the App Store/Play Store rather than charging them inline.
  const ctaLabel = isCurrentSelected
    ? t("settings.plan.alreadyOn")
    : hasActiveSubscription
      ? Platform.OS === "android"
        ? t("settings.plan.manageInPlayStore")
        : t("settings.plan.manageInStore")
      : isUpgrade
        ? t("settings.plan.upgradeTo", { name: `${selectedName} ${PLAN_EMOJI[selected]}` })
        : t("settings.plan.switchTo", { name: `${selectedName} ${PLAN_EMOJI[selected]}` });

  return (
    <View style={{ gap: 22 }}>
      {/* Hero: avatar left, headline/subhead column right (left-aligned) */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <MemeAvatar variant="cool" size={64} pulse />
        <View style={{ flex: 1, gap: 6 }}>
          <View
            style={{
              alignSelf: "flex-start",
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 999,
              backgroundColor: theme["--color-card-muted"],
              borderWidth: 1,
              borderColor: theme["--color-border"],
            }}
          >
            <Typography
              variant="caption"
              style={{ color: theme["--color-foreground"], fontWeight: "700" }}
            >
              {t("settings.plan.youreOn", {
                name: `${PLAN_EMOJI[effectivePlan]} ${currentName}`,
              })}
            </Typography>
          </View>
          <Typography
            variant="title-md"
            style={{
              color: theme["--color-foreground"],
              fontWeight: "800",
            }}
          >
            {t("settings.plan.headline")}
          </Typography>
          <Typography
            variant="caption"
            style={{ color: theme["--color-foreground-secondary"] }}
          >
            {t("settings.plan.subhead")}
          </Typography>
        </View>
      </View>

      {/* Tier selector row */}
      <View style={{ flexDirection: "row", gap: 8 }}>
        {PAID_TIERS.map((tier) => (
          <TierCard
            key={tier}
            tier={tier}
            selected={selected === tier}
            current={effectivePlan === tier}
            recommend={recommendFor(tier)}
            priceString={priceByProduct[planToProduct[tier]] ?? null}
            onPress={() => setSelected(tier)}
            theme={theme}
            gradient={gradient}
          />
        ))}
      </View>

      {/* CTA — placed directly under the tier cards so the primary action is
          visible without scrolling past the details + comparison matrix. */}
      <BottomSheetTouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={ctaLabel}
        disabled={isCurrentSelected || busy}
        onPress={() => void handleCta()}
        activeOpacity={0.9}
        style={{
          height: 56,
          borderRadius: 28,
          overflow: "hidden",
          opacity: isCurrentSelected ? 0.55 : busy ? 0.7 : 1,
        }}
      >
        {!isCurrentSelected ? (
          <LinearGradient
            colors={gradient.colors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
        ) : (
          <View
            style={[
              StyleSheet.absoluteFillObject,
              { backgroundColor: theme["--color-card-muted"] },
            ]}
          />
        )}
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 18,
          }}
        >
          <Typography
            variant="title-sm"
            style={{
              color: isCurrentSelected
                ? theme["--color-foreground-muted"]
                : "#FFFFFF",
              fontWeight: "800",
            }}
          >
            {ctaLabel}
          </Typography>
        </View>
      </BottomSheetTouchableOpacity>

      <Typography
        variant="caption"
        style={{
          color: theme["--color-foreground-muted"],
          textAlign: "center",
        }}
      >
        {hasActiveSubscription
          ? t("settings.plan.manageNote")
          : t("settings.plan.paywallNote")}
      </Typography>

      {!hasActiveSubscription && (
        <RestorePurchasesButton
          busy={busy}
          setBusy={setBusy}
          refresh={refresh}
          theme={theme}
        />
      )}

      {/* Selected tier details */}
      <SelectedDetails selected={selected} theme={theme} />

      {/* Comparison matrix */}
      <ComparisonMatrix
        currentPlan={effectivePlan}
        selectedPlan={selected}
        theme={theme}
      />
    </View>
  );
}

// ----- Tier card -----

interface TierCardProps {
  tier: PaidPlanId;
  selected: boolean;
  current: boolean;
  recommend: "best" | "popular" | null;
  priceString: string | null;
  onPress: () => void;
  theme: Theme;
  gradient: PrimaryGradient;
}

function TierCard({
  tier,
  selected,
  current,
  recommend,
  priceString,
  onPress,
  theme,
  gradient,
}: TierCardProps) {
  const { t } = useTranslation();
  const name = t(`settings.plan.planNames.${tier}`);
  const period = t("settings.plan.pricePeriod");
  const emoji = PLAN_EMOJI[tier];

  // Badge priority: CURRENT > BEST > POPULAR. Only one badge per card.
  const badge = current
    ? { text: t("settings.plan.currentInline"), tint: "primary" as const }
    : recommend === "best"
      ? { text: t("settings.plan.bestBadge"), tint: "secondary" as const }
      : recommend === "popular"
        ? { text: t("settings.plan.popularBadge"), tint: "info" as const }
        : null;

  // Badge sits inside the flex flow (not absolute) so the parent's
  // overflow-hidden — required for the gradient-stroke clipping — doesn't
  // clip it. When a tier has no badge we reserve the same vertical slot
  // with a transparent spacer so all three cards' emoji rows line up.
  const BADGE_SLOT_HEIGHT = 16;

  return (
    <BottomSheetTouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      activeOpacity={0.9}
      style={{
        flex: 1,
        borderRadius: 16,
        overflow: "hidden",
        padding: selected ? 2 : 0,
      }}
    >
      {selected ? (
        <LinearGradient
          colors={gradient.colors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFillObject, { borderRadius: 16 }]}
        />
      ) : null}

      <View
        style={{
          backgroundColor: theme["--color-card"],
          borderRadius: 14,
          borderWidth: selected ? 0 : 1,
          borderColor: theme["--color-border"],
          paddingVertical: 8,
          paddingHorizontal: 8,
          alignItems: "center",
          gap: 4,
        }}
      >
        {/* Badge row — fixed-height slot whether populated or not. */}
        <View
          style={{
            height: BADGE_SLOT_HEIGHT,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {badge ? (
            <View
              style={{
                paddingHorizontal: 8,
                paddingVertical: 2,
                borderRadius: 999,
                backgroundColor:
                  badge.tint === "primary"
                    ? theme["--color-primary"]
                    : badge.tint === "info"
                      ? theme["--color-info"]
                      : theme["--color-secondary"],
              }}
            >
              <Typography
                style={{
                  color: "#FFFFFF",
                  fontSize: 9,
                  fontWeight: "800",
                  letterSpacing: 0.5,
                  lineHeight: 12,
                }}
              >
                {badge.text.toUpperCase()}
              </Typography>
            </View>
          ) : null}
        </View>

        {/* Emoji — explicit lineHeight prevents visual cropping on Android. */}
        <Typography style={{ fontSize: 30, lineHeight: 36 }}>
          {emoji}
        </Typography>

        <Typography
          variant="title-sm"
          style={{ color: theme["--color-foreground"], textAlign: "center" }}
          numberOfLines={1}
        >
          {name}
        </Typography>

        {/* Price + period on one baseline so "/mo" reads as a unit with
            the dollar figure rather than a separate row. */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "baseline",
            gap: 2,
          }}
        >
          <Typography
            variant="title-sm"
            style={{
              color: theme["--color-foreground"],
              fontWeight: "800",
            }}
            numberOfLines={1}
          >
            {priceString ?? t("settings.plan.priceLoading")}
          </Typography>
          <Typography
            variant="caption"
            style={{ color: theme["--color-foreground-muted"] }}
          >
            {period}
          </Typography>
        </View>
      </View>
    </BottomSheetTouchableOpacity>
  );
}

// ----- Selected tier details -----

function SelectedDetails({
  selected,
  theme,
}: {
  selected: PaidPlanId;
  theme: Theme;
}) {
  const { t } = useTranslation();
  const name = t(`settings.plan.planNames.${selected}`);
  const tagline = t(`settings.plan.planTaglines.${selected}`);
  const bullets = t(`settings.plan.planBullets.${selected}`, {
    returnObjects: true,
  }) as string[];

  return (
    <View
      style={{
        backgroundColor: theme["--color-card-muted"],
        borderRadius: 14,
        padding: 14,
        gap: 12,
      }}
    >
      {/* Header: emoji + name + tagline on a single horizontal block. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Typography style={{ fontSize: 22, lineHeight: 28 }}>
          {PLAN_EMOJI[selected]}
        </Typography>
        <View style={{ flex: 1 }}>
          <Typography
            variant="title-sm"
            style={{ color: theme["--color-foreground"] }}
          >
            {name}
          </Typography>
          <Typography
            variant="caption"
            style={{ color: theme["--color-foreground-secondary"] }}
          >
            {tagline}
          </Typography>
        </View>
      </View>

      {/* Benefits as wrap-flowing chips. Each chip is self-sized to its
          content, then the row wraps — fills horizontal space regardless of
          how many bullets the selected tier has, and avoids the right-side
          dead zone that short bullet text used to leave behind. */}
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        {bullets.map((line) => (
          <View
            key={line}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 999,
              backgroundColor: theme["--color-primary-subtle"],
              borderWidth: 1,
              borderColor: theme["--color-primary-muted"],
            }}
          >
            <Typography
              style={{
                color: theme["--color-primary"],
                fontSize: 12,
                fontWeight: "800",
                lineHeight: 14,
              }}
            >
              ✓
            </Typography>
            <Typography
              variant="body-sm"
              style={{
                color: theme["--color-foreground"],
                fontWeight: "600",
              }}
            >
              {line}
            </Typography>
          </View>
        ))}
      </View>
    </View>
  );
}

// ----- Comparison matrix -----

function ComparisonMatrix({
  currentPlan,
  selectedPlan,
  theme,
}: {
  currentPlan: PlanId;
  selectedPlan: PlanId;
  theme: Theme;
}) {
  const { t } = useTranslation();

  return (
    <View
      style={{
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme["--color-border"],
        overflow: "hidden",
        backgroundColor: theme["--color-card"],
      }}
    >
      <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6 }}>
        <Typography
          variant="caption"
          style={{
            color: theme["--color-foreground-muted"],
            fontWeight: "700",
            letterSpacing: 0.5,
          }}
        >
          {t("settings.plan.compareHeading").toUpperCase()}
        </Typography>
      </View>

      {/* Header row: emoji icons per plan, current plan column tinted.
          `gap` between cells prevents adjacent column highlights from
          touching when the user has selected one tier and is currently on
          another (e.g. selected=Sidekick + current=Wingman). */}
      <View
        style={{
          flexDirection: "row",
          paddingHorizontal: 8,
          paddingVertical: 8,
          borderTopWidth: 1,
          borderTopColor: theme["--color-border"],
          backgroundColor: theme["--color-card-muted"],
          gap: 6,
        }}
      >
        <View style={{ flex: 1.4 }} />
        {MATRIX_PLANS.map((p) => (
          <MatrixHeaderCell
            key={p}
            plan={p}
            isCurrent={p === currentPlan}
            isSelected={p === selectedPlan}
            theme={theme}
          />
        ))}
      </View>

      {FEATURE_KEYS.map((feature, idx) => (
        <View
          key={feature}
          style={{
            flexDirection: "row",
            paddingHorizontal: 8,
            paddingVertical: 10,
            borderTopWidth: idx === 0 ? 0 : 1,
            borderTopColor: theme["--color-border"],
            alignItems: "center",
            gap: 6,
          }}
        >
          <View style={{ flex: 1.4, paddingHorizontal: 4 }}>
            <Typography
              variant="body-sm"
              style={{ color: theme["--color-foreground"], fontWeight: "600" }}
            >
              {t(`settings.plan.features.${feature}`)}
            </Typography>
          </View>
          {MATRIX_PLANS.map((p) => (
            <MatrixValueCell
              key={p}
              value={t(`settings.plan.featureValues.${feature}.${p}`)}
              isCurrent={p === currentPlan}
              isSelected={p === selectedPlan}
              theme={theme}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

function MatrixHeaderCell({
  plan,
  isCurrent,
  isSelected,
  theme,
}: {
  plan: PlanId;
  isCurrent: boolean;
  isSelected: boolean;
  theme: Theme;
}) {
  // Background tints follow the value-cell rules so the column reads as a
  // continuous highlight. Child uses width: 100% + textAlign: center instead
  // of alignItems on the parent — emoji glyph metrics make alignItems-based
  // centering drift relative to plain ASCII values in the rows below.
  const bg = isCurrent
    ? theme["--color-primary-muted"]
    : isSelected
      ? theme["--color-primary-subtle"]
      : "transparent";

  return (
    <View
      style={{
        flex: 1,
        paddingVertical: 4,
        borderRadius: 8,
        backgroundColor: bg,
      }}
    >
      <Typography
        style={{
          width: "100%",
          textAlign: "center",
          fontSize: 18,
          lineHeight: 22,
          // Small vertical nudge: emoji glyphs sit lower in their line box
          // than the ASCII values in the rows below, so a -2px tweak pulls
          // the icon up onto the same optical baseline.
          marginTop: -2,
        }}
      >
        {PLAN_EMOJI[plan]}
      </Typography>
    </View>
  );
}

// ----- Restore Purchases -----

function RestorePurchasesButton({
  busy,
  setBusy,
  refresh,
  theme,
}: {
  busy: boolean;
  setBusy: (v: boolean) => void;
  refresh: () => Promise<void>;
  theme: Theme;
}) {
  const { t } = useTranslation();

  const handleRestore = async () => {
    setBusy(true);
    try {
      const info = await Purchases.restorePurchases();
      await refresh();
      const active = Object.values(info.entitlements?.active ?? {});
      if (active.length > 0) {
        Alert.alert(t("settings.plan.heading"), t("settings.plan.restoreSuccess"));
      } else {
        Alert.alert(t("settings.plan.heading"), t("settings.plan.restoreNone"));
      }
    } catch {
      Alert.alert(t("settings.plan.heading"), t("settings.plan.restoreFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheetTouchableOpacity
      onPress={() => void handleRestore()}
      disabled={busy}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityLabel={t("settings.plan.restorePurchases")}
      style={{ alignItems: "center", paddingVertical: 4 }}
    >
      <Typography
        variant="caption"
        style={{
          color: theme["--color-foreground-muted"],
          textDecorationLine: "underline",
        }}
      >
        {t("settings.plan.restorePurchases")}
      </Typography>
    </BottomSheetTouchableOpacity>
  );
}

function MatrixValueCell({
  value,
  isCurrent,
  isSelected,
  theme,
}: {
  value: string;
  isCurrent: boolean;
  isSelected: boolean;
  theme: Theme;
}) {
  const bg = isCurrent
    ? theme["--color-primary-muted"]
    : isSelected
      ? theme["--color-primary-subtle"]
      : "transparent";

  return (
    <View
      style={{
        flex: 1,
        paddingVertical: 4,
        borderRadius: 8,
        backgroundColor: bg,
      }}
    >
      <Typography
        variant="body-sm"
        style={{
          width: "100%",
          textAlign: "center",
          lineHeight: 22,
          color: isCurrent
            ? theme["--color-primary"]
            : theme["--color-foreground"],
          fontWeight: isCurrent ? "800" : "600",
        }}
      >
        {value}
      </Typography>
    </View>
  );
}
