import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Pressable,
  Linking,
  Image as RNImage,
  StyleSheet,
  Platform,
  type ViewStyle,
} from "react-native";
import { Image } from "expo-image";
import {
  File as FileIcon,
  FileText,
  FileType,
  Music,
  Play,
  X,
} from "lucide-react-native";
import { useTheme } from "@oxyhq/bloom/theme";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/lib/useColorScheme";
import { useTranslation } from "@/hooks/useTranslation";
import {
  type AttachmentCategory,
  humanizeSize,
} from "@/lib/attachments";
import {
  getCachedAspectRatio,
  setCachedAspectRatio,
  type MeasuredRect,
} from "@/components/notes/attachments/ZoomableImageGallery";

/** Media grid tile geometry (mirrors Mention's MEDIA_CARD_* compose constants). */
const MEDIA_CARD_HEIGHT = 200;
const MEDIA_CARD_WIDTH = 150;
const MEDIA_CARD_RADIUS = 15;
const MIN_WIDTH = 100;
const DEFAULT_ASPECT_RATIO = 4 / 3;

const FULL_DIMENSION = "100%" as const;

// Web-only grab cursor. RN 0.85's `CursorValue` only models `'auto' | 'pointer'`,
// so the web-only `'grab'` value is not assignable to `ViewStyle` directly and
// needs the `unknown` widening. Native ignores the prop.
const webGrabCursorStyle: ViewStyle | null =
  Platform.OS === "web" ? ({ cursor: "grab" } as unknown as ViewStyle) : null;

/**
 * Registers (or clears, on unmount) the measurable host node of an image
 * thumbnail so the parent row can `measureInWindow` ANY thumbnail by index for
 * the gallery close fly-back. Called with the host `View` on mount, `null` on
 * unmount.
 */
export type RegisterThumbHost = (node: View | null) => void;

/** lucide icon for each non-image attachment category. */
const CATEGORY_ICON: Record<
  Exclude<AttachmentCategory, "image">,
  typeof FileIcon
> = {
  // Video is rendered as a tile, not a chip, but kept here for completeness.
  video: Play,
  audio: Music,
  pdf: FileType,
  doc: FileText,
  file: FileIcon,
};

interface AttachmentImageProps {
  src: string;
  onPress?: (rect?: MeasuredRect) => void;
  registerHost?: RegisterThumbHost;
}

/**
 * An image thumbnail tile sized to the image's aspect ratio. Registers its host
 * node for the gallery's fly-back and measures its on-screen rect on press so the
 * gallery can zoom from the tapped origin.
 */
function AttachmentImage({ src, onPress, registerHost }: AttachmentImageProps) {
  const theme = useTheme();
  const wrapperRef = useRef<View | null>(null);
  const [aspectRatio, setAspectRatio] = useState<number | undefined>(() =>
    getCachedAspectRatio(src)
  );

  // Callback ref: keep the local ref (for open-press measurement) AND mirror the
  // host into the parent's index registry (for the close fly-back). Registers on
  // mount, clears on unmount — no effect needed.
  const setHostRef = useCallback(
    (node: View | null) => {
      wrapperRef.current = node;
      registerHost?.(node);
    },
    [registerHost]
  );

  useEffect(() => {
    const cached = getCachedAspectRatio(src);
    if (cached !== undefined) {
      setAspectRatio(cached);
      return;
    }
    let cancelled = false;
    RNImage.getSize(
      src,
      (width, height) => {
        if (cancelled) return;
        if (width > 0 && height > 0) {
          const ratio = width / height;
          setAspectRatio(ratio);
          setCachedAspectRatio(src, ratio);
        }
      },
      () => {
        if (cancelled) return;
        setAspectRatio(DEFAULT_ASPECT_RATIO);
        setCachedAspectRatio(src, DEFAULT_ASPECT_RATIO);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [src]);

  const handlePress = useCallback(() => {
    if (!onPress) return;
    const node = wrapperRef.current;
    if (!node) {
      onPress(undefined);
      return;
    }
    node.measureInWindow((x, y, width, height) => {
      onPress({ x, y, width, height });
    });
  }, [onPress]);

  const computedWidth =
    aspectRatio !== undefined
      ? Math.max(MEDIA_CARD_HEIGHT * aspectRatio, MIN_WIDTH)
      : MEDIA_CARD_WIDTH;

  const containerStyles: ViewStyle[] = [
    styles.itemContainer,
    {
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.backgroundSecondary,
      height: MEDIA_CARD_HEIGHT,
      width: computedWidth,
    },
  ];
  if (webGrabCursorStyle) containerStyles.push(webGrabCursorStyle);

  const image = (
    <View style={containerStyles}>
      <Image
        source={{ uri: src }}
        style={styles.fullSize}
        contentFit="cover"
        transition={150}
      />
    </View>
  );

  if (!onPress) return image;

  return (
    <Pressable
      ref={setHostRef}
      onPress={handlePress}
      accessibilityRole="imagebutton"
      accessibilityLabel="Open image"
      collapsable={false}
    >
      {image}
    </Pressable>
  );
}

interface AttachmentVideoProps {
  src: string;
  poster?: string;
  onPress?: () => void;
}

/**
 * A video tile: poster (thumbnail) with a play affordance. Tapping opens the
 * file in the system viewer (`Linking.openURL`). Kept dependency-light — no
 * embedded player — per Noted's notes use case.
 */
function AttachmentVideo({ src, poster, onPress }: AttachmentVideoProps) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Open video"
      style={[
        styles.itemContainer,
        {
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.backgroundSecondary,
          height: MEDIA_CARD_HEIGHT,
          width: MEDIA_CARD_WIDTH,
        },
        webGrabCursorStyle,
      ]}
    >
      {poster ? (
        <Image
          source={{ uri: poster }}
          style={styles.fullSize}
          contentFit="cover"
          transition={150}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.videoFallback]} />
      )}
      <View style={styles.playBadge} pointerEvents="none">
        <Play size={20} color="#fff" fill="#fff" />
      </View>
    </Pressable>
  );
}

interface AttachmentFileChipProps {
  category: Exclude<AttachmentCategory, "image" | "video">;
  filename?: string;
  length?: number;
  /** Opens the file in the system viewer (URL resolved by the parent). */
  onOpen: () => void;
}

/**
 * A non-media attachment (pdf/doc/audio/file): type icon, filename, size; tap to
 * open via the system viewer.
 */
function AttachmentFileChip({
  category,
  filename,
  length,
  onOpen,
}: AttachmentFileChipProps) {
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const Icon = CATEGORY_ICON[category];
  const size = typeof length === "number" ? humanizeSize(length) : "";

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
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
          {filename ?? t("notes.openAttachment")}
        </Text>
        {size ? (
          <Text className="text-xs text-muted-foreground">{size}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** A circular remove (X) button shown over editor-mode items. */
function RemoveButton({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={t("common.delete")}
      className="h-8 w-8 items-center justify-center rounded-full bg-black/50"
    >
      <X size={16} color="#fff" />
    </Pressable>
  );
}

export {
  AttachmentImage,
  AttachmentVideo,
  AttachmentFileChip,
  RemoveButton,
  MEDIA_CARD_HEIGHT,
};

const styles = StyleSheet.create({
  itemContainer: {
    borderWidth: 1,
    borderRadius: MEDIA_CARD_RADIUS,
    overflow: "hidden",
  },
  fullSize: {
    width: FULL_DIMENSION,
    height: FULL_DIMENSION,
  },
  videoFallback: {
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  playBadge: {
    position: "absolute",
    top: "50%",
    left: "50%",
    marginTop: -22,
    marginLeft: -22,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
});
