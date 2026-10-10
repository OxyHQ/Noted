import { Button } from "@oxy.so/bloom/button";
import { ButtonGroup } from "@oxy.so/bloom/button-group";
import { PageHeader } from "@oxy.so/bloom/page-header";
import { RiCloseLine } from "@oxy.so/bloom/icons/RiCloseLine";
import { RiPushpinLine } from "@oxy.so/bloom/icons/RiPushpinLine";
import { RiPaletteLine } from "@oxy.so/bloom/icons/RiPaletteLine";
import { RiArchiveLine } from "@oxy.so/bloom/icons/RiArchiveLine";
import { RiDeleteBinLine } from "@oxy.so/bloom/icons/RiDeleteBinLine";
import { useTranslation } from "@/hooks/useTranslation";

interface BulkActionBarProps {
  count: number;
  onClose: () => void;
  onPin: () => void;
  onColor: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

/** Selection shares the same header and control surfaces as the rest of the app. */
export function BulkActionBar({ count, onClose, onPin, onColor, onArchive, onDelete }: BulkActionBarProps) {
  const { t } = useTranslation();
  return <PageHeader safeArea={false} title={String(count)}
    leading={<ButtonGroup><Button iconOnly icon={RiCloseLine}
      accessibilityLabel={t("common.cancel")} onPress={onClose} /></ButtonGroup>}
    actions={<ButtonGroup>
      <Button iconOnly icon={RiPushpinLine} accessibilityLabel={t("notes.pin")} onPress={onPin} />
      <Button iconOnly icon={RiPaletteLine} accessibilityLabel={t("notes.pickColor")} onPress={onColor} />
      <Button iconOnly icon={RiArchiveLine} accessibilityLabel={t("notes.archive")} onPress={onArchive} />
      <Button iconOnly icon={RiDeleteBinLine} tone="danger" accessibilityLabel={t("common.delete")} onPress={onDelete} />
    </ButtonGroup>}
  />;
}
