import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { AliaAvatarIcon } from '@alia.onl/sdk/avatar';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { ButtonGroup, ButtonGroupItem } from '@oxy.so/bloom/button-group';
import { RiLayoutGridLine } from '@oxy.so/bloom/icons/RiLayoutGridLine';
import { RiListView } from '@oxy.so/bloom/icons/RiListView';
import { useOxy } from '@oxy.so/services/ui/client';
import { useTranslation } from '@/hooks/useTranslation';
import { openAliaChat } from '@/lib/alia-chat';
import { useNotesUIStore } from '@/lib/stores/notes-ui-store';

interface NotesHeaderProps {
  title: string;
}

export function NotesHeader({ title }: NotesHeaderProps) {
  const { t } = useTranslation();
  const { isAuthenticated } = useOxy();
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
          {isAuthenticated && (
            <ButtonGroupItem
              iconOnly
              leadingIcon={AliaAvatarIcon}
              onPress={openAliaChat}
              accessibilityLabel={t('alia.askAlia')}
            />
          )}
          <ButtonGroupItem
            iconOnly
            leadingIcon={viewMode === 'grid' ? RiListView : RiLayoutGridLine}
            onPress={toggleViewMode}
            accessibilityLabel={t(viewMode === 'grid' ? 'notes.listView' : 'notes.gridView')}
          />
        </ButtonGroup>
      }
    />
  );
}
