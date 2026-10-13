import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/useTranslation';
import { useBacklinks } from '@/lib/hooks/use-backlinks';

/** Other notes that link here with `[[this note's title]]`. Renders nothing when none do. */
export function LinkedMentions({ noteId, title }: { noteId: string; title: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const notes = useBacklinks(noteId ? { id: noteId, title } : null);
  if (notes.length === 0) return null;

  return (
    <View className="mt-4 gap-1 border-t border-border pt-3">
      <Text className="text-xs font-medium uppercase text-muted-foreground">
        {t('notes.linkedMentions')} · {notes.length}
      </Text>
      {notes.map((note) => (
        <Pressable
          key={note.id}
          accessibilityRole="link"
          accessibilityLabel={note.title || t('notes.linkUntitled')}
          onPress={() => router.push(`/n/${note.id}`)}
          className="py-2"
        >
          <Text className="text-base text-primary" numberOfLines={1}>
            {note.title || t('notes.linkUntitled')}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
