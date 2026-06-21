import React from "react";
import { View, Pressable, Linking } from "react-native";
import { Image } from "expo-image";
import {
  File as FileIcon,
  FileText,
  FileType,
  Music,
  Video,
  X,
} from "lucide-react-native";
import { useOxy } from "@oxyhq/services";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/lib/useColorScheme";
import { useTranslation } from "@/hooks/useTranslation";
import { useFileMetadata } from "@/lib/hooks/use-file-metadata";
import {
  categorizeContentType,
  humanizeSize,
  type AttachmentCategory,
} from "@/lib/attachments";

/** lucide icon to use for each non-image attachment category. */
const CATEGORY_ICON: Record<
  Exclude<AttachmentCategory, "image">,
  typeof FileIcon
> = {
  video: Video,
  audio: Music,
  pdf: FileType,
  doc: FileText,
  file: FileIcon,
};

interface AttachmentChipProps {
  fileId: string;
  /** When provided, the chip shows a remove (X) button (editor only). */
  onRemove?: (id: string) => void;
}

/**
 * One attachment, resolved by ID. It fetches the file's metadata to decide
 * whether to render an image thumbnail or a typed file chip. While metadata
 * loads it shows a neutral placeholder chip; a failed lookup degrades to a
 * generic file chip (tap still opens the file).
 */
function AttachmentChip({ fileId, onRemove }: AttachmentChipProps) {
  const { oxyServices } = useOxy();
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const { data, isLoading, isError } = useFileMetadata(fileId);

  const open = React.useCallback(() => {
    const url = oxyServices.getFileDownloadUrl(fileId);
    void Linking.openURL(url);
  }, [oxyServices, fileId]);

  const remove = React.useCallback(() => {
    onRemove?.(fileId);
  }, [onRemove, fileId]);

  const removeButton = onRemove ? (
    <Pressable
      onPress={remove}
      accessibilityLabel={t("common.delete")}
      className="h-8 w-8 items-center justify-center rounded-full bg-black/50"
    >
      <X size={16} color="#fff" />
    </Pressable>
  ) : null;

  const category = categorizeContentType(data?.contentType);

  // Image attachment: full-width thumbnail (matches the prior image-only UI).
  if (!isLoading && !isError && category === "image") {
    return (
      <View className="overflow-hidden rounded-xl">
        <Image
          source={{ uri: oxyServices.getFileDownloadUrl(fileId) }}
          style={{ width: "100%", aspectRatio: 4 / 3 }}
          contentFit="cover"
          transition={150}
        />
        {removeButton ? (
          <View className="absolute right-2 top-2">{removeButton}</View>
        ) : null}
      </View>
    );
  }

  // Loading placeholder: neutral chip while metadata resolves.
  if (isLoading) {
    return (
      <View className="flex-row items-center gap-3 rounded-xl border border-border bg-card/60 px-3 py-2.5">
        <View className="h-9 w-9 items-center justify-center rounded-lg bg-foreground/5">
          <FileIcon size={18} color={colors.mutedForeground} />
        </View>
        <View className="h-3 flex-1 rounded bg-foreground/10" />
      </View>
    );
  }

  // Non-image (or failed lookup → generic): typed file chip, tap to open.
  const Icon = CATEGORY_ICON[category as Exclude<AttachmentCategory, "image">];
  const filename = data?.filename ?? t("notes.openAttachment");
  const size =
    typeof data?.length === "number" ? humanizeSize(data.length) : "";

  return (
    <View className="flex-row items-center gap-2">
      <Pressable
        onPress={open}
        accessibilityLabel={t("notes.openAttachment")}
        className="flex-1 flex-row items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 web:transition active:bg-foreground/5 web:hover:bg-foreground/5"
      >
        <View className="h-9 w-9 items-center justify-center rounded-lg bg-foreground/5">
          <Icon size={18} color={colors.foreground} />
        </View>
        <View className="flex-1">
          <Text
            className="text-sm font-medium text-foreground"
            numberOfLines={1}
          >
            {filename}
          </Text>
          {size ? (
            <Text className="text-xs text-muted-foreground">{size}</Text>
          ) : null}
        </View>
      </Pressable>
      {removeButton}
    </View>
  );
}

interface NoteAttachmentsProps {
  /**
   * Optional/defaulted so an undefined value (e.g. a legacy note missing the
   * `attachments` field) can never crash the `.length`/`.map` reads below.
   */
  attachments?: string[];
  /** Editor mode: pass an `onRemove` to show per-attachment remove buttons. */
  onRemove?: (id: string) => void;
}

/**
 * Renders a note's attachments. Each id resolves its own metadata and renders
 * either an image thumbnail or a typed file chip. Used by the editor / detail
 * view (the card uses a compact count indicator instead — see `note-card`).
 */
export function NoteAttachments({
  attachments = [],
  onRemove,
}: NoteAttachmentsProps) {
  if (attachments.length === 0) return null;
  return (
    <View className="gap-2">
      {attachments.map((id) => (
        <AttachmentChip key={id} fileId={id} onRemove={onRemove} />
      ))}
    </View>
  );
}
