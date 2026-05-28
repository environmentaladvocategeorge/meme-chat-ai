// PlanPaywall — redesigned
//
// Layout goals (driven by user feedback on the previous version):
//   1. All tiers visible without scrolling — segmented row of 3 paid-tier
//      cards instead of a vertically stacked list.
//   2. Current plan is unmistakable: an inline "Yours" ribbon on the tier
//      card AND a tinted column in the comparison matrix.
//   3. The "BEST" recommendation lives on Wingman (Plus) so the user has
//      a clear default suggestion when they're on free.
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
import { gradients, themes } from "@/nativewind-theme";
import { useSubscriptionStore } from "@/store/subscription";
import { LinearGradient } from "expo-linear-gradient";
import { useColorScheme } from "nativewind";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Platform, Pressable, StyleSheet, View } from "react-native";
import Purchases from "react-native-purchases";

type PaidPlanId = Exclude<PlanId, "free">;

const PAID_TIERS: readonly PaidPlanId[] = ["basic", "plus", "power"] as const;
const RECOMMENDED: PaidPlanId = "plus";
const FEATURE_KEYS: readonly ["chats", "smart", "memory"] = [
  "chats",
  "smart",
  "memory",
] as const;
const MATRIX_PLANS: readonly PlanId[] = ["free", "basic", "plus", "power"] as const;

const PLAN_EMOJI: Record<PlanId, string> = {
  free: "🌱",
  basic: "🚀",
  plus: "🔥",
  power: "⚡",
};

const PLAN_TO_RC_PRODUCT: Record<PaidPlanId, string> = {
  basic: "monthly",
  plus: "monthly_2",
  power: "monthly_3",
};

type Theme = (typeof themes)[keyof typeof themes];
type PrimaryGradient = (typeof gradients)[keyof typeof gradients]["primary"];

interface PlanPaywallProps {
  currentPlan: PlanId;
}

export function PlanPaywall({ currentPlan }: PlanPaywallProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { colorScheme } = useColorScheme();
  const gradient = gradients[colorScheme ?? "light"].primary;
  const subscriptionStatus = useSubscriptionStore((s) => s.status);
  const refresh = useSubscriptionStore((s) => s.refresh);
  const openManagement = useSubscriptionStore((s) => s.openManagement);
  // Plan-change vs first-purchase routing: existing subscribers can't reliably
  // switch tiers via Purchases.purchasePackage() — Apple/Google want plan
  // changes to flow through their subscription-management UI so proration,
  // refunds, and downgrade timing all behave correctly. We only call
  // purchasePackage() when the user is on `free`.
  const hasActiveSubscription = currentPlan !== "free";

  // Default selection prefers the user's current paid plan so the page opens
  // showing what they already have; otherwise the recommended tier.
  const [selected, setSelected] = useState<PaidPlanId>(() => {
    if (currentPlan !== "free") return currentPlan;
    return RECOMMENDED;
  });
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

    const productId = PLAN_TO_RC_PRODUCT[selected];
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

  const isCurrentSelected = selected === currentPlan;
  const isUpgrade = PLAN_RANK[selected] > PLAN_RANK[currentPlan];

  const selectedName = t(`settings.plan.planNames.${selected}`);
  const currentName = t(`settings.plan.planNames.${currentPlan}`);

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
                name: `${PLAN_EMOJI[currentPlan]} ${currentName}`,
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
            current={currentPlan === tier}
            recommended={tier === RECOMMENDED}
            priceString={priceByProduct[PLAN_TO_RC_PRODUCT[tier]] ?? null}
            onPress={() => setSelected(tier)}
            theme={theme}
            gradient={gradient}
          />
        ))}
      </View>

      {/* Selected tier details */}
      <SelectedDetails selected={selected} theme={theme} />

      {/* Comparison matrix */}
      <ComparisonMatrix
        currentPlan={currentPlan}
        selectedPlan={selected}
        theme={theme}
      />

      {/* CTA */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={ctaLabel}
        disabled={isCurrentSelected || busy}
        onPress={() => void handleCta()}
        style={({ pressed }) => ({
          height: 56,
          borderRadius: 28,
          overflow: "hidden",
          opacity: isCurrentSelected ? 0.55 : busy ? 0.7 : pressed ? 0.92 : 1,
        })}
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
      </Pressable>

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
    </View>
  );
}

// ----- Tier card -----

interface TierCardProps {
  tier: PaidPlanId;
  selected: boolean;
  current: boolean;
  recommended: boolean;
  priceString: string | null;
  onPress: () => void;
  theme: Theme;
  gradient: PrimaryGradient;
}

function TierCard({
  tier,
  selected,
  current,
  recommended,
  priceString,
  onPress,
  theme,
  gradient,
}: TierCardProps) {
  const { t } = useTranslation();
  const name = t(`settings.plan.planNames.${tier}`);
  const period = t("settings.plan.pricePeriod");
  const emoji = PLAN_EMOJI[tier];

  // Badge priority: CURRENT > BEST. Only one badge per card.
  const badge = current
    ? { text: t("settings.plan.currentInline"), tint: "primary" as const }
    : recommended
      ? { text: t("settings.plan.bestBadge"), tint: "secondary" as const }
      : null;

  // Badge sits inside the flex flow (not absolute) so the parent's
  // overflow-hidden — required for the gradient-stroke clipping — doesn't
  // clip it. When a tier has no badge we reserve the same vertical slot
  // with a transparent spacer so all three cards' emoji rows line up.
  const BADGE_SLOT_HEIGHT = 16;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
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
    </Pressable>
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
