import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { updateProfileCallable } from "@/services/firebase/callables";
import { MAX_ALIAS_LENGTH } from "@/store/storage";
import { useSettingsStore } from "@/store/settings";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { AccountBody, ErrorCard, SuccessView } from "./parts";

export function ChangeNameForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const storedAlias = useSettingsStore((s) => s.alias);
  const setAlias = useSettingsStore((s) => s.setAlias);

  const [draft, setDraft] = useState(storedAlias);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const trimmed = draft.trim().slice(0, MAX_ALIAS_LENGTH);

  const handleSave = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await updateProfileCallable({ alias: trimmed });
      setAlias(trimmed);
      setDone(true);
    } catch {
      setError(t("account.changeName.error"));
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <AccountBody>
        <SuccessView
          title={t("account.changeName.successTitle")}
          body={
            trimmed.length > 0
              ? t("account.changeName.successBody", { name: trimmed })
              : t("account.changeName.successBodyCleared")
          }
          onDone={onDone}
        />
      </AccountBody>
    );
  }

  return (
    <AccountBody>
      <View style={{ gap: 16 }}>
        <Input
          label={t("account.changeName.inputLabel")}
          placeholder={t("account.changeName.placeholder")}
          value={draft}
          onChangeText={setDraft}
          maxLength={MAX_ALIAS_LENGTH}
          autoCapitalize="words"
          returnKeyType="done"
          autoFocus
        />
        {error ? <ErrorCard message={error} /> : null}
        <Button
          title={t("account.changeName.save")}
          onPress={handleSave}
          loading={submitting}
          disabled={submitting || trimmed === storedAlias.trim()}
        />
      </View>
    </AccountBody>
  );
}
