// PersonaSheet
//
// The persona picker — a near-full-height sheet (iOS 26 "tap the name" menu
// feel) for choosing which bot you chat as. Top: a hero showing the currently
// selected persona. Below: "Your Brainrot Bots" with a glass + to create one,
// then the selectable list (the default Brainrot Bot first, then the user's
// saved bots), capped by a create row — which becomes an UPGRADE nudge for
// free users who've hit their 1-persona cap. A fixed ad banner sits at the
// bottom for free users (it self-hides for paid).
//
// Selection is cosmetic for now: it updates the local persona store (and the
// chat header pill), but the chat send path does not yet forward personaId.
// Creating/editing personas is a later step — the + button and create row are
// inert except for the free-tier upgrade route.
//
// Mounted once at the root layout (like the other global sheets) so it spans
// the full width and survives navigation.

import { AppPressable, SheetTouchableProvider } from "@/components/AppPressable";
import { AdBanner } from "@/components/ads/AdBanner";
import { IconButton } from "@/components/IconButton";
import { MAX_CONTENT_WIDTH } from "@/components/MaxWidthFrame";
import { PersonaAvatar } from "@/components/PersonaAvatar";
import { SheetBackdrop } from "@/components/SheetBackdrop";
import { Typography } from "@/components/Typography";
import {
  DEFAULT_PERSONA_ID,
  personaCap,
  type ResolvedPersona,
} from "@/domain/personas";
import { useTheme } from "@/hooks/useTheme";
import { useOpenPlan } from "@/hooks/useOpenPlan";
import { useDisplayPlan } from "@/store/entitlement";
import { usePersonaSheetStore } from "@/store/personaSheet";
import { usePersonaStore, useSelectedPersona } from "@/store/personas";
import {
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import { Check, Plus, Sparkle, X } from "phosphor-react-native";
import { type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function PersonaSheet() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const isOpen = usePersonaSheetStore((s) => s.isOpen);
  const close = usePersonaSheetStore((s) => s.close);
  const openPlan = useOpenPlan();

  const personas = usePersonaStore((s) => s.personas);
  const select = usePersonaStore((s) => s.select);
  const selectedPersonaId = usePersonaStore((s) => s.selectedPersonaId);
  const selected = useSelectedPersona();

  const plan = useDisplayPlan();
  const isFree = plan === "free";
  const cap = personaCap(plan);
  const atCap = personas.length >= cap;

  const sheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ["92%"], []);

  useEffect(() => {
    if (isOpen) sheetRef.current?.present();
    else sheetRef.current?.dismiss();
  }, [isOpen]);

  const handleSelect = useCallback(
    (personaId: string) => {
      select(personaId);
      close();
    },
    [select, close],
  );

  // The create affordance. For now only the free-at-cap path does anything:
  // route to the paywall (closing this sheet first so the two don't stack).
  // The actual builder flow lands later; under-cap taps are intentionally inert.
  const handleCreate = useCallback(() => {
    if (atCap && isFree) {
      close();
      openPlan();
    }
    // else: builder flow not built yet (no-op); paid-at-cap is a dead end.
  }, [atCap, isFree, close, openPlan]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <SheetBackdrop {...props} opacity={0.5} />
    ),
    [],
  );

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      backdropComponent={renderBackdrop}
      onDismiss={close}
      backgroundStyle={{
        backgroundColor: theme["--color-background-secondary"],
        borderTopLeftRadius: 8,
        borderTopRightRadius: 8,
      }}
      handleIndicatorStyle={{
        width: 40,
        height: 4,
        borderRadius: 999,
        backgroundColor: theme["--color-border"],
      }}
    >
      <View
        style={{
          flex: 1,
          width: "100%",
          maxWidth: MAX_CONTENT_WIDTH,
          alignSelf: "center",
        }}
      >
        <SheetTouchableProvider>
          {/* Header: close on the left in a fixed slot. */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 16,
              paddingTop: 2,
              paddingBottom: 6,
            }}
          >
            <IconButton
              onPress={close}
              hitSlop={8}
              size={36}
              surfaceStyle={{ backgroundColor: theme["--color-card-muted"] }}
              accessibilityLabel={t("common.close")}
            >
              <X size={18} weight="bold" color={theme["--color-foreground"]} />
            </IconButton>
          </View>

          {/* Hero: the currently selected persona. */}
          <View style={{ alignItems: "center", gap: 8, paddingBottom: 18 }}>
            <PersonaAvatar persona={selected} size={72} />
            <View style={{ alignItems: "center", gap: 2 }}>
              <Typography
                variant="caption"
                style={{ color: theme["--color-foreground-muted"] }}
              >
                {t("personas.currentLabel")}
              </Typography>
              <Typography
                variant="title-lg"
                numberOfLines={1}
                style={{ color: theme["--color-foreground"], textAlign: "center" }}
              >
                {personaName(selected, t("chat.agentName"))}
              </Typography>
            </View>
          </View>

          {/* Section header: "Your Brainrot Bots" + a glass + to create. */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 20,
              paddingBottom: 10,
            }}
          >
            <Typography
              variant="title-sm"
              style={{ color: theme["--color-foreground"] }}
            >
              {t("personas.yourBots")}
            </Typography>
            <IconButton
              onPress={handleCreate}
              size={34}
              glass
              glassTint={theme["--color-primary"]}
              fallbackStyle={{
                backgroundColor: theme["--color-card"],
                borderWidth: 1,
                borderColor: theme["--color-border"],
              }}
              accessibilityLabel={t("personas.createA11y")}
            >
              <Plus size={18} weight="bold" color={theme["--color-foreground"]} />
            </IconButton>
          </View>

          <BottomSheetScrollView
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingBottom: 24,
              gap: 10,
            }}
            showsVerticalScrollIndicator={false}
          >
            {/* The default Brainrot Bot, always first and always selectable so
                a user can switch back from a custom bot. */}
            <PersonaRow
              name={t("chat.agentName")}
              description={t("personas.defaultDescription")}
              avatar={<PersonaAvatar persona={{ kind: "default" }} size={44} />}
              selected={selectedPersonaId === DEFAULT_PERSONA_ID}
              onPress={() => handleSelect(DEFAULT_PERSONA_ID)}
              selectA11y={t("personas.selectA11y", { name: t("chat.agentName") })}
            />

            {personas.map((persona) => (
              <PersonaRow
                key={persona.id}
                name={persona.displayName}
                description={persona.shortDescription}
                avatar={
                  <PersonaAvatar
                    persona={{ kind: "user", persona }}
                    size={44}
                  />
                }
                selected={selectedPersonaId === persona.id}
                onPress={() => handleSelect(persona.id)}
                selectA11y={t("personas.selectA11y", { name: persona.displayName })}
              />
            ))}

            {/* Create row → upgrade nudge (free at cap) → quiet max note
                (paid at cap) → inert create affordance (under cap). */}
            {atCap && isFree ? (
              <UpgradeCard
                count={personaCap("plus")}
                onUpgrade={handleCreate}
              />
            ) : atCap ? (
              <Typography
                variant="caption"
                style={{
                  color: theme["--color-foreground-muted"],
                  textAlign: "center",
                  paddingVertical: 14,
                }}
              >
                {t("personas.maxReached", { count: cap })}
              </Typography>
            ) : (
              <CreateRow label={t("personas.create")} onPress={handleCreate} />
            )}
          </BottomSheetScrollView>

          {/* Fixed ad band (free only — AdBanner renders null for paid). */}
          <View
            style={{
              paddingHorizontal: 16,
              paddingBottom: insets.bottom + 8,
              paddingTop: 4,
            }}
          >
            <AdBanner />
          </View>
        </SheetTouchableProvider>
      </View>
    </BottomSheetModal>
  );
}

// The resolved persona's display name — the localized default name when on the
// default, otherwise the user persona's own name.
function personaName(persona: ResolvedPersona, defaultName: string): string {
  return persona.kind === "default" ? defaultName : persona.persona.displayName;
}

// One selectable persona row: avatar + name + short description, with a check
// on the active one.
function PersonaRow({
  name,
  description,
  avatar,
  selected,
  onPress,
  selectA11y,
}: {
  name: string;
  description?: string;
  avatar: ReactNode;
  selected: boolean;
  onPress: () => void;
  selectA11y: string;
}) {
  const theme = useTheme();
  return (
    <AppPressable
      onPress={onPress}
      accessibilityLabel={selectA11y}
      accessibilityState={{ selected }}
      pressScale={0.02}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 12,
        borderRadius: 16,
        backgroundColor: theme["--color-card"],
        borderWidth: 1,
        borderColor: selected
          ? theme["--color-primary"]
          : theme["--color-border"],
      }}
    >
      {avatar}
      <View style={{ flex: 1, gap: 2 }}>
        <Typography
          variant="body"
          weight="semibold"
          numberOfLines={1}
          style={{ color: theme["--color-foreground"] }}
        >
          {name}
        </Typography>
        {description ? (
          <Typography
            variant="caption"
            numberOfLines={1}
            style={{ color: theme["--color-foreground-secondary"] }}
          >
            {description}
          </Typography>
        ) : null}
      </View>
      <View style={{ width: 24, height: 24, alignItems: "center", justifyContent: "center" }}>
        {selected ? (
          <Check size={20} weight="bold" color={theme["--color-primary"]} />
        ) : null}
      </View>
    </AppPressable>
  );
}

// The "create a new bot" affordance: a dashed, plus-led row. Inert for now
// (the builder flow lands later).
function CreateRow({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <AppPressable
      onPress={onPress}
      accessibilityLabel={label}
      pressScale={0.02}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderStyle: "dashed",
        borderColor: theme["--color-border-strong"],
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme["--color-card-muted"],
        }}
      >
        <Plus size={20} weight="bold" color={theme["--color-foreground"]} />
      </View>
      <Typography
        variant="body"
        weight="semibold"
        style={{ color: theme["--color-foreground"], flex: 1 }}
      >
        {label}
      </Typography>
    </AppPressable>
  );
}

// The free-tier upgrade nudge that replaces the create row at cap — the
// highest-intent conversion moment (the user just tried to make another bot).
function UpgradeCard({
  count,
  onUpgrade,
}: {
  count: number;
  onUpgrade: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <AppPressable
      onPress={onUpgrade}
      accessibilityLabel={t("personas.upgradeCta")}
      pressScale={0.02}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 14,
        borderRadius: 16,
        backgroundColor: theme["--color-primary-muted"],
        borderWidth: 1,
        borderColor: theme["--color-primary"],
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme["--color-primary"],
        }}
      >
        <Sparkle size={20} weight="fill" color={theme["--color-primary-foreground"]} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Typography
          variant="body"
          weight="semibold"
          style={{ color: theme["--color-foreground"] }}
        >
          {t("personas.upgradeTitle")}
        </Typography>
        <Typography
          variant="caption"
          style={{ color: theme["--color-foreground-secondary"] }}
        >
          {t("personas.upgradeBody", { count })}
        </Typography>
      </View>
      <Typography
        variant="body"
        weight="semibold"
        style={{ color: theme["--color-primary"] }}
      >
        {t("personas.upgradeCta")}
      </Typography>
    </AppPressable>
  );
}
