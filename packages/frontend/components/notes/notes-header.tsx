import { AppShellMenuButton } from "@oxy.so/bloom/app-shell";
import { PageHeader } from "@oxy.so/bloom/page-header";
import { ButtonGroup, ButtonGroupItem } from "@oxy.so/bloom/button-group";
import { RiLayoutGridLine } from "@oxy.so/bloom/icons/RiLayoutGridLine";
import { RiListView } from "@oxy.so/bloom/icons/RiListView";
import { useTranslation } from "@/hooks/useTranslation";
import { useNotesUIStore } from "@/lib/stores/notes-ui-store";

interface NotesHeaderProps {
  title: string;
}

export function NotesHeader({ title }: NotesHeaderProps) {
  const { t } = useTranslation();
  const viewMode = useNotesUIStore((state) => state.viewMode);
  const toggleViewMode = useNotesUIStore((state) => state.toggleViewMode);

  return (
    <PageHeader
      safeArea={false}
      leading={<AppShellMenuButton />}
      title={title}
      titleAlign="center"
      presentation="floating"
      actions={
        <ButtonGroup>
        <ButtonGroupItem
          iconOnly
          leadingIcon={viewMode === "grid" ? RiListView : RiLayoutGridLine}
          onPress={toggleViewMode}
          accessibilityLabel={t(viewMode === "grid" ? "notes.listView" : "notes.gridView")}
        />
        </ButtonGroup>
      }
    />
  );
}
