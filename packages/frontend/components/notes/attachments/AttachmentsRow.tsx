import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { View, Pressable, Linking } from "react-native";
import { Image } from "expo-image";
import { Paperclip } from "lucide-react-native";
import { useOxy } from "@oxyhq/services";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/lib/useColorScheme";
import { useTranslation } from "@/hooks/useTranslation";
import { useFileMetadata } from "@/lib/hooks/use-file-metadata";
import { categorizeContentType } from "@/lib/attachments";
import {
  AttachmentImage,
  AttachmentVideo,
  AttachmentFileChip,
  RemoveButton,
} from "@/components/notes/attachments/AttachmentMedia";
import {
  ZoomableImageGallery,
  type ZoomableImageGalleryHandle,
  type GalleryImage,
  type MeasuredRect,
  type MeasureThumb,
} from "@/components/notes/attachments/ZoomableImageGallery";

/** How many image thumbnails the compact card preview renders before collapsing. */
const CARD_THUMB_CAP = 3;

export interface AttachmentsRowProps {
  /**
   * Oxy file IDs of any type (image/video → media tile; other → file chip).
   * Optional/defaulted so an undefined value (e.g. a legacy note missing the
   * `attachments` field) can never crash the internal array reads.
   */
  attachments?: string[];
  /**
   * `editor`: full per-type chips, remove buttons, image gallery.
   * `card`: compact, cheap — image thumbnails + a generic count chip, no
   * per-item metadata queries.
   */
  variant: "card" | "editor";
  /** Editor only: remove an attachment by ID. */
  onRemove?: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Gallery coordination. Image items register their resolved src + measurable
// host with the parent so the gallery can open at the tapped image and fly back
// to the currently-viewed thumbnail on dismiss. The registry is keyed by the
// stable file ID; the images-only ORDER is derived from the attachments array so
// the gallery index space stays deterministic regardless of async resolution.
// ---------------------------------------------------------------------------
interface GalleryRegistration {
  src: string;
  node: View | null;
}

interface GalleryController {
  register: (fileId: string, src: string) => void;
  unregister: (fileId: string) => void;
  setHost: (fileId: string, node: View | null) => void;
  open: (fileId: string, rect?: MeasuredRect) => void;
}

/**
 * Resolve each attachment ID and render the matching element. Lives in its own
 * component so its `useFileMetadata` hook count is stable per item (one query
 * per editor attachment; the card path renders the cheap variant instead).
 */
function EditorAttachmentItem({
  fileId,
  onRemove,
  gallery,
}: {
  fileId: string;
  onRemove?: (id: string) => void;
  gallery: GalleryController;
}) {
  const { oxyServices } = useOxy();
  const { data, isLoading } = useFileMetadata(fileId);
  const category = categorizeContentType(data?.contentType);

  const openFile = useCallback(() => {
    const url = oxyServices.getFileDownloadUrl(fileId);
    void Linking.openURL(url);
  }, [oxyServices, fileId]);

  const remove = useCallback(() => onRemove?.(fileId), [onRemove, fileId]);

  // Loading placeholder: neutral chip while metadata resolves.
  if (isLoading) {
    return (
      <View className="flex-row items-center gap-3 rounded-xl border border-border bg-card/60 px-3 py-2.5">
        <View className="h-9 w-9 rounded-lg bg-foreground/5" />
        <View className="h-3 flex-1 rounded bg-foreground/10" />
      </View>
    );
  }

  if (category === "image") {
    const src = oxyServices.getFileDownloadUrl(fileId, "thumb");
    return (
      <View className="flex-row items-start gap-2">
        <ImageGalleryItem fileId={fileId} src={src} gallery={gallery} />
        {onRemove ? <RemoveButton onPress={remove} /> : null}
      </View>
    );
  }

  if (category === "video") {
    const poster = oxyServices.getFileDownloadUrl(fileId, "thumb");
    return (
      <View className="flex-row items-start gap-2">
        <AttachmentVideo src={fileId} poster={poster} onPress={openFile} />
        {onRemove ? <RemoveButton onPress={remove} /> : null}
      </View>
    );
  }

  return (
    <View className="flex-row items-center gap-2">
      <AttachmentFileChip
        category={category}
        filename={data?.filename}
        length={data?.length}
        onOpen={openFile}
      />
      {onRemove ? <RemoveButton onPress={remove} /> : null}
    </View>
  );
}

/**
 * An image tile wired into the parent gallery: registers/unregisters its src
 * and host node, and opens the gallery (seeded at this image) on press.
 */
function ImageGalleryItem({
  fileId,
  src,
  gallery,
}: {
  fileId: string;
  src: string;
  gallery: GalleryController;
}) {
  // Subscribe this image to the parent's gallery registry on mount and clear it
  // on unmount. Registration mutates an external store + bumps the parent's
  // image count, so it MUST run as an effect (not during render, which would be
  // a setState-in-render of another component).
  React.useEffect(() => {
    gallery.register(fileId, src);
    return () => gallery.unregister(fileId);
  }, [gallery, fileId, src]);

  const onPress = useCallback(
    (rect?: MeasuredRect) => gallery.open(fileId, rect),
    [gallery, fileId]
  );

  const registerHost = useCallback(
    (node: View | null) => gallery.setHost(fileId, node),
    [gallery, fileId]
  );

  return (
    <AttachmentImage src={src} onPress={onPress} registerHost={registerHost} />
  );
}

/**
 * Compact, cheap card preview. Renders up to {@link CARD_THUMB_CAP} image
 * thumbnails directly from `getFileDownloadUrl(id,'thumb')` (NO per-item
 * `assetGet`) plus a "+N adjuntos" paperclip chip for any remaining/non-shown
 * attachments — matching the performance posture of `note-card`.
 */
function CardPreview({ attachments = [] }: { attachments?: string[] }) {
  const { oxyServices } = useOxy();
  const { colors } = useColorScheme();
  const { t } = useTranslation();

  const shown = attachments.slice(0, CARD_THUMB_CAP);
  const remaining = attachments.length - shown.length;

  return (
    <View className="flex-row flex-wrap items-center gap-2">
      {shown.map((id) => (
        <View key={id} className="h-14 w-14 overflow-hidden rounded-lg">
          <Image
            source={{ uri: oxyServices.getFileDownloadUrl(id, "thumb") }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
            transition={120}
          />
        </View>
      ))}
      {remaining > 0 ? (
        <View className="flex-row items-center gap-1 rounded-full bg-foreground/10 px-2 py-1">
          <Paperclip size={11} color={colors.mutedForeground} />
          <Text className="text-[11px] text-muted-foreground">
            {`+${remaining} ${t("notes.attachments")}`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Note attachment row. Ported from Mention's `PostAttachmentsRow` (media grid +
 * zoomable image gallery), pruned to media/files only and adapted to Noted's
 * `attachments: string[]` contract. The editor variant renders rich per-type
 * chips + a remove button + the image gallery; the card variant renders a cheap
 * compact preview.
 */
export function AttachmentsRow({
  attachments = [],
  variant,
  onRemove,
}: AttachmentsRowProps) {
  const galleryRef = useRef<ZoomableImageGalleryHandle>(null);

  // Stable order of the image-only subset for the gallery, plus per-id src/host.
  const registryRef = useRef<Map<string, GalleryRegistration>>(new Map());
  // Tracks whether any registered image exists (drives gallery mount + re-render
  // when the first image registers so the gallery node appears).
  const [imageCount, setImageCount] = useState(0);

  // Image-only subset in attachments order: deterministic gallery index space.
  const imageOrder = useCallback((): string[] => {
    const order: string[] = [];
    for (const id of attachments) {
      if (registryRef.current.has(id)) order.push(id);
    }
    return order;
  }, [attachments]);

  const gallery = useMemo<GalleryController>(
    () => ({
      register: (fileId, src) => {
        const existing = registryRef.current.get(fileId);
        registryRef.current.set(fileId, { src, node: existing?.node ?? null });
        setImageCount(registryRef.current.size);
      },
      unregister: (fileId) => {
        registryRef.current.delete(fileId);
        setImageCount(registryRef.current.size);
      },
      setHost: (fileId, node) => {
        const existing = registryRef.current.get(fileId);
        if (existing) existing.node = node;
      },
      open: (fileId, rect) => {
        const order = imageOrder();
        const images: GalleryImage[] = order
          .map((id) => registryRef.current.get(id)?.src)
          .filter((s): s is string => Boolean(s))
          .map((uri) => ({ uri }));
        if (images.length === 0) return;
        const index = Math.max(order.indexOf(fileId), 0);
        galleryRef.current?.open(images, index, rect);
      },
    }),
    [imageOrder]
  );

  // Measure ANY image thumbnail by its images-only subset index for the gallery
  // close fly-back. Resolves null when the host is missing so the gallery can
  // fall back to a center fade-out.
  const measureThumb = useCallback<MeasureThumb>(
    (index) => {
      return new Promise<MeasuredRect | null>((resolve) => {
        const order = imageOrder();
        const fileId = order[index];
        const node = fileId ? registryRef.current.get(fileId)?.node : null;
        if (!node) {
          resolve(null);
          return;
        }
        node.measureInWindow((x, y, width, height) => {
          if (width > 0 && height > 0) resolve({ x, y, width, height });
          else resolve(null);
        });
      });
    },
    [imageOrder]
  );

  if (attachments.length === 0) return null;

  if (variant === "card") {
    return <CardPreview attachments={attachments} />;
  }

  return (
    <>
      <View className="gap-2">
        {attachments.map((id) => (
          <EditorAttachmentItem
            key={id}
            fileId={id}
            onRemove={onRemove}
            gallery={gallery}
          />
        ))}
      </View>
      {imageCount > 0 ? (
        <ZoomableImageGallery ref={galleryRef} measureThumb={measureThumb} />
      ) : null}
    </>
  );
}

export default AttachmentsRow;
