// Age gate — the very first screen, shown before landing/sign-up.
//
// A real date-of-birth gate (not a tappable "I'm 16+" button) whose decision is
// stored device-locally and survives account deletion, so an under-16 user
// can't bypass it by deleting and re-creating an account. The routing
// dispatcher in app/_layout.tsx keeps the user here until the gate passes;
// a blocked result has no escape (only a reinstall clears it).

import { AppPressable } from "@/components/AppPressable";
import { AuthScaffold, GradientButton } from "@/components/AuthScaffold";
import { MemeAvatar } from "@/components/MemeAvatar";
import { Typography } from "@/components/Typography";
import { useAgeGateStore } from "@/store/ageGate";
import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import { CalendarBlank } from "phosphor-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, View } from "react-native";

// Sensible spinner starting point: an adult birthday, so the common case is a
// short scroll rather than spinning back from today.
function defaultStartDate(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  return d;
}

export default function AgeGate() {
  const { t } = useTranslation();
  const status = useAgeGateStore((s) => s.status);
  const submitBirthDate = useAgeGateStore((s) => s.submitBirthDate);

  const [dob, setDob] = useState<Date | null>(null);
  const [iosPickerOpen, setIosPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const maxDate = new Date();

  // Blocked is terminal: show the hard-no and offer no way forward.
  if (status === "blocked") {
    return (
      <AuthScaffold title={t("ageGate.blockedTitle")}>
        <View style={{ alignItems: "center", gap: 18, marginTop: 12 }}>
          <MemeAvatar variant="worried" size={104} />
          <Typography
            variant="body-lg"
            style={{ color: "rgba(255,255,255,0.9)", textAlign: "center" }}
          >
            {t("ageGate.blocked")}
          </Typography>
        </View>
      </AuthScaffold>
    );
  }

  const openPicker = () => {
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: dob ?? defaultStartDate(),
        mode: "date",
        maximumDate: maxDate,
        onChange: (event, selected) => {
          if (event.type === "set" && selected) {
            setErrorMessage(null);
            setDob(selected);
          }
        },
      });
    } else {
      setIosPickerOpen(true);
    }
  };

  const onContinue = async () => {
    if (!dob || submitting) return;
    // The store update flips ageGate status; the dispatcher routes onward when
    // it passes, or this screen re-renders into the blocked state.
    setSubmitting(true);
    setErrorMessage(null);
    try {
      await submitBirthDate(dob);
    } catch {
      setErrorMessage(t("ageGate.saveError"));
    } finally {
      setSubmitting(false);
    }
  };

  const fieldLabel = dob
    ? dob.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : t("ageGate.dobPlaceholder");

  return (
    <AuthScaffold title={t("ageGate.title")} subtitle={t("ageGate.body")}>
      <View style={{ flex: 1, justifyContent: "space-between" }}>
        <View style={{ gap: 14, marginTop: 4 }}>
          <AppPressable
            onPress={openPicker}
            feedback="opacity"
            accessibilityLabel={t("ageGate.dobPlaceholder")}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              height: 54,
              borderRadius: 16,
              paddingHorizontal: 16,
              backgroundColor: "rgba(255,255,255,0.1)",
              borderWidth: 1.5,
              borderColor: "rgba(255,255,255,0.28)",
            }}
          >
            <CalendarBlank size={22} color="rgba(255,255,255,0.9)" weight="bold" />
            <Typography
              variant="body-lg"
              style={{ color: dob ? "#FFFFFF" : "rgba(255,255,255,0.5)" }}
            >
              {fieldLabel}
            </Typography>
          </AppPressable>

          {Platform.OS === "ios" && iosPickerOpen ? (
            <View
              style={{
                borderRadius: 16,
                backgroundColor: "rgba(255,255,255,0.08)",
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.2)",
                overflow: "hidden",
              }}
            >
              <DateTimePicker
                value={dob ?? defaultStartDate()}
                mode="date"
                display="spinner"
                maximumDate={maxDate}
                themeVariant="dark"
                onChange={(_event, selected) => {
                  if (selected) {
                    setErrorMessage(null);
                    setDob(selected);
                  }
                }}
                style={{ alignSelf: "stretch" }}
              />
            </View>
          ) : null}

          {errorMessage ? (
            <Typography
              variant="body-sm"
              style={{ color: "#FFE6B8", textAlign: "center" }}
            >
              {errorMessage}
            </Typography>
          ) : null}
        </View>

        <GradientButton
          title={t("ageGate.cta")}
          onPress={onContinue}
          loading={submitting}
          disabled={!dob}
        />
      </View>
    </AuthScaffold>
  );
}
