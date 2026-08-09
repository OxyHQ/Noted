import { View, ScrollView } from "react-native";

import { useTranslation } from "@/hooks/useTranslation";
import { SettingsHeader } from "@/components/settings/settings-header";
import { TranscriptionSection } from "@/components/settings/transcription-section";

export default function SettingsTranscriptionScreen() {
  const { t } = useTranslation();

  return (
    <View className="flex-1 bg-background">
      <SettingsHeader title={t("settings.sections.transcription")} />
      <ScrollView className="flex-1" contentContainerClassName="p-5 max-w-2xl">
        <TranscriptionSection />
      </ScrollView>
    </View>
  );
}
