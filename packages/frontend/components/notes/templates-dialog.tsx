import { Pressable, ScrollView } from 'react-native';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/useTranslation';
import { TEMPLATE_IDS, renderTemplate, type RenderedTemplate } from '@/lib/notes/templates';

interface TemplatesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (template: RenderedTemplate) => void;
}

/** Choose a starting point for a new note. */
export function TemplatesDialog({ open, onOpenChange, onPick }: TemplatesDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('templates.pick')}</DialogTitle>
        </DialogHeader>
        <ScrollView className="max-h-72">
          {TEMPLATE_IDS.map((id) => (
            <Pressable
              key={id}
              accessibilityRole="button"
              accessibilityLabel={t(`templates.${id}.name`)}
              onPress={() => {
                const date = new Date().toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                });
                onPick(renderTemplate(id, t, date));
                onOpenChange(false);
              }}
              className="border-b border-border py-3"
            >
              <Text className="text-base text-foreground">{t(`templates.${id}.name`)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </DialogContent>
    </Dialog>
  );
}
