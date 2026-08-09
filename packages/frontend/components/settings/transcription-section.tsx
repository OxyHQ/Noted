import { View, Pressable, ActivityIndicator } from "react-native";
import { Check, Download, Trash2 } from "lucide-react-native";

import { Text } from "@/components/ui/text";
import { useTranslation } from "@/hooks/useTranslation";
import { useColorScheme } from "@/lib/useColorScheme";
import { hasDownloadableModels } from "@/lib/capture/support";
import { DEFAULT_STT_MODEL, type SttModelId } from "@/lib/stt/models";
import { useSttModels, type ModelEntry } from "@/lib/stt/use-models";
import { useLlmModel } from "@/lib/enhance/use-llm-model";
import {
  readSetting,
  SETTING_KEYS,
  useSettings,
  writeSetting,
} from "@/lib/db/settings-repo";

const MEGABYTE = 1024 * 1024;

function formatSize(bytes: number): string {
  return `${String(Math.round(bytes / MEGABYTE))} MB`;
}

function isModelId(value: unknown): value is SttModelId {
  return value === "tiny" || value === "base" || value === "small";
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/**
 * One model: what it costs, whether it is here, and the one action available.
 *
 * Selecting and downloading are the same gesture on purpose. A model that is not
 * downloaded cannot be selected, and a downloaded model nobody selected is dead
 * weight — so the row's press means "use this one", and fetches it if needed.
 */
function ModelRow({
  entry,
  isSelected,
  onSelect,
  onRemove,
}: {
  entry: ModelEntry;
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const isDownloading = entry.state === "downloading";

  return (
    <View className="flex-row items-center gap-3 rounded-2xl border border-border px-4 py-3">
      <Pressable
        onPress={onSelect}
        disabled={isDownloading}
        className="flex-1 flex-row items-center gap-3"
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected, disabled: isDownloading }}
      >
        <View className="flex-1">
          <Text className="text-base font-medium text-foreground">
            {t(`transcription.models.${entry.model.id}.name`)}
          </Text>
          <Text className="text-sm text-muted-foreground">
            {formatSize(entry.model.bytes)} ·{" "}
            {t(`transcription.models.${entry.model.id}.note`)}
          </Text>
        </View>

        {isDownloading ? (
          <View className="flex-row items-center gap-2">
            <ActivityIndicator size="small" />
            <Text className="font-mono text-sm tabular-nums text-muted-foreground">
              {/* The percentage matters more than the spinner: these files are
                  tens of megabytes, and a bare spinner on a slow connection is
                  indistinguishable from a stall. */}
              {String(Math.round((entry.progress ?? 0) * 100))}%
            </Text>
          </View>
        ) : entry.state === "ready" ? (
          isSelected ? (
            <Check size={18} color={colors.primary} />
          ) : null
        ) : (
          <Download size={18} color={colors.mutedForeground} />
        )}
      </Pressable>

      {entry.state === "ready" && !isSelected ? (
        <Pressable
          onPress={onRemove}
          accessibilityLabel={t("transcription.remove")}
          hitSlop={8}
          className="active:opacity-70"
        >
          <Trash2 size={18} color={colors.mutedForeground} />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The optional download that turns pattern-matching into reading.
 *
 * Presented as what it is: an improvement with a real cost, not a requirement.
 * The note gets written either way, and saying so is what makes 469 MB an
 * honest offer rather than a toll.
 */
function UnderstandingRow() {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const model = useLlmModel();
  const isDownloading = model.state === "downloading";

  return (
    <View className="gap-2">
      <Text className="text-sm font-medium text-muted-foreground">
        {t("transcription.understanding.title")}
      </Text>
      <View className="flex-row items-center gap-3 rounded-2xl border border-border px-4 py-3">
        <View className="flex-1">
          <Text className="text-base text-foreground">
            {t("transcription.understanding.label")}
          </Text>
          <Text className="text-sm text-muted-foreground">
            {model.state === "ready"
              ? t("transcription.understanding.ready")
              : t("transcription.understanding.note", { size: formatSize(model.bytes) })}
          </Text>
        </View>

        {isDownloading ? (
          <View className="flex-row items-center gap-2">
            <ActivityIndicator size="small" />
            <Text className="font-mono text-sm tabular-nums text-muted-foreground">
              {String(Math.round((model.progress ?? 0) * 100))}%
            </Text>
          </View>
        ) : model.state === "ready" ? (
          <Pressable
            onPress={() => void model.remove()}
            accessibilityLabel={t("transcription.remove")}
            hitSlop={8}
            className="active:opacity-70"
          >
            <Trash2 size={18} color={colors.mutedForeground} />
          </Pressable>
        ) : (
          <Pressable
            onPress={() => void model.download().catch(() => undefined)}
            accessibilityLabel={t("transcription.understanding.download")}
            hitSlop={8}
            className="active:opacity-70"
          >
            <Download size={18} color={colors.mutedForeground} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

export function TranscriptionSection() {
  const { t } = useTranslation();
  const { entries, isLoading, download, remove } = useSttModels();
  const { settings } = useSettings();

  const selected = readSetting(
    settings,
    SETTING_KEYS.sttModel,
    isModelId,
    DEFAULT_STT_MODEL,
  );
  const live = readSetting(settings, SETTING_KEYS.liveNotes, isBoolean, true);

  // The browser transcribes too, but it has nothing to manage: transformers.js
  // fetches and caches its own model, there is no file on disk to size or
  // delete, and there is no live mode to switch off. Showing the phone's
  // controls here would offer choices that do nothing.
  if (!hasDownloadableModels()) {
    return (
      <View className="gap-2">
        <Text className="text-base font-semibold text-foreground">
          {t("transcription.title")}
        </Text>
        <Text className="text-sm text-muted-foreground">
          {t("transcription.browser")}
        </Text>
      </View>
    );
  }

  return (
    <View className="gap-6">
      <View className="gap-1">
        <Text className="text-base font-semibold text-foreground">
          {t("transcription.title")}
        </Text>
        <Text className="text-sm text-muted-foreground">
          {t("transcription.explainer")}
        </Text>
      </View>

      <Pressable
        onPress={() => void writeSetting(SETTING_KEYS.liveNotes, !live)}
        className="flex-row items-center justify-between rounded-2xl border border-border px-4 py-3"
        accessibilityRole="switch"
        accessibilityState={{ checked: live }}
      >
        <View className="flex-1 pr-3">
          <Text className="text-base text-foreground">
            {t("transcription.live.label")}
          </Text>
          <Text className="text-sm text-muted-foreground">
            {t("transcription.live.note")}
          </Text>
        </View>
        <View
          className={`h-6 w-6 items-center justify-center rounded-full border ${
            live ? "border-primary bg-primary" : "border-border"
          }`}
        >
          {live ? <Text className="text-xs text-primary-foreground">✓</Text> : null}
        </View>
      </Pressable>

      <UnderstandingRow />

      <View className="gap-2">
        <Text className="text-sm font-medium text-muted-foreground">
          {t("transcription.modelsTitle")}
        </Text>
        {isLoading ? (
          <ActivityIndicator size="small" />
        ) : (
          entries.map((entry) => (
            <ModelRow
              key={entry.model.id}
              entry={entry}
              isSelected={entry.model.id === selected}
              onSelect={() => {
                if (entry.state === "ready") {
                  void writeSetting(SETTING_KEYS.sttModel, entry.model.id);
                  return;
                }
                // Selecting a model it does not have yet is a request for it.
                void download(entry.model.id).then(
                  () => writeSetting(SETTING_KEYS.sttModel, entry.model.id),
                  () => undefined,
                );
              }}
              onRemove={() => void remove(entry.model.id)}
            />
          ))
        )}
      </View>
    </View>
  );
}
