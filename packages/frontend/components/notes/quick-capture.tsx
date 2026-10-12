import { Button, GlyphButton } from '@oxy.so/bloom/button';
import { Card } from '@oxy.so/bloom/card';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import React from 'react';
import { View, type TextInput } from 'react-native';
import Animated, { LinearTransition, FadeIn } from 'react-native-reanimated';
import { CheckSquare, X, Palette, Paperclip, Archive } from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import { NoteColorPicker } from '@/components/notes/note-color-picker';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getNoteColorTint } from '@/lib/note-colors';
import { useColorScheme } from '@/lib/useColorScheme';
import { useReducedMotion } from '@/lib/hooks/use-reduced-motion';
import { useTranslation } from '@/hooks/useTranslation';
import { DEFAULT_NEW_NOTE_COLOR, type NoteColor } from '@noted/shared-types';
import { newNoteId } from '@/lib/db/ids';

interface QuickCaptureInput {
  title: string;
  body: string;
  color?: NoteColor;
  archived?: boolean;
}
export interface QuickCaptureCreation extends QuickCaptureInput {
  creationId: string;
  initialInput: QuickCaptureInput;
}

interface QuickCaptureProps {
  /** Create a plain note from the composed title/body/color. */
  onCreate: (input: QuickCaptureCreation) => Promise<{ id: string }>;
  onOpenNote: (id: string, mode: 'checklist' | 'attachment') => void;
  /** Open the full editor in checklist mode for a new note. */
  onCreateChecklist: () => void;
  /** Open the full editor for a new note with an attachment. */
  onCreateAttachment: () => void;
}

/** Small circular toolbar button used in the expanded composer. */
function ToolButton({
  icon: Icon,
  label,
  color,
  onPress,
  active,
  activeColor,
  disabled,
}: {
  icon: typeof Palette;
  label: string;
  color: string;
  onPress: () => void;
  active?: boolean;
  activeColor?: string;
  disabled?: boolean;
}) {
  return (
    <GlyphButton
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      size={36}
      glyphSize={18}
      color={color}
      pressed={active}
      activeColor={activeColor}
    >
      {(foreground) => <Icon size={18} color={foreground} />}
    </GlyphButton>
  );
}

/**
 * Home-screen quick-capture bar. Collapsed it shows a single "Take a note…"
 * affordance with checklist + image shortcuts; tapping expands it to a title +
 * body composer that commits on close (Keep-style — no explicit save button).
 * The composer card tints to the selected note color.
 */
export function QuickCapture({
  onCreate,
  onOpenNote,
  onCreateChecklist,
  onCreateAttachment,
}: QuickCaptureProps) {
  const { t } = useTranslation();
  const { colors, colorScheme } = useColorScheme();
  const reduceMotion = useReducedMotion();
  const [expanded, setExpanded] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [color, setColor] = React.useState<NoteColor>(DEFAULT_NEW_NOTE_COLOR);
  const [colorOpen, setColorOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saveFailed, setSaveFailed] = React.useState(false);
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const savingRef = React.useRef(false);
  const creation = React.useRef<{ id: string; input: QuickCaptureInput } | null>(null);
  const bodyRef = React.useRef<TextInput>(null);

  const tint = getNoteColorTint(color, colorScheme);

  const reset = React.useCallback(() => {
    creation.current = null;
    setTitle('');
    setBody('');
    setColor(DEFAULT_NEW_NOTE_COLOR);
    setColorOpen(false);
    setExpanded(false);
    setSaveFailed(false);
    setDiscardOpen(false);
  }, []);

  const commit = React.useCallback(
    async (archived = false, mode?: 'checklist' | 'attachment') => {
      if (savingRef.current) return;
      const trimmedTitle = title.trim();
      const trimmedBody = body.trim();
      if (!trimmedTitle && !trimmedBody) {
        reset();
        if (mode === 'checklist') onCreateChecklist();
        if (mode === 'attachment') onCreateAttachment();
        return;
      }
      savingRef.current = true;
      setSaving(true);
      setSaveFailed(false);
      try {
        const input = { title: trimmedTitle, body: trimmedBody, color, archived };
        creation.current ??= { id: newNoteId(), input };
        const created = await onCreate({
          ...input,
          creationId: creation.current.id,
          initialInput: creation.current.input,
        });
        reset();
        if (mode) onOpenNote(created.id, mode);
      } catch {
        // The mutation reports its error; keep the complete draft available to retry.
        setSaveFailed(true);
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [title, body, color, onCreate, onOpenNote, onCreateChecklist, onCreateAttachment, reset],
  );

  const expand = React.useCallback(() => {
    setExpanded(true);
    // Focus the body after the layout expands.
    requestAnimationFrame(() => bodyRef.current?.focus());
  }, []);

  const layout = reduceMotion ? undefined : LinearTransition.duration(200);
  const fadeIn = reduceMotion ? undefined : FadeIn.duration(180);

  if (!expanded) {
    return (
      <Animated.View layout={layout} entering={fadeIn} className="w-full max-w-[600px] self-center">
        <Card
          testID="quick-capture"
          appearance="outline"
          elevation="s"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
          }}
        >
          <Button
            appearance="plain"
            tone="neutral"
            onPress={expand}
            style={{ flex: 1, justifyContent: 'flex-start' }}
          >
            {t('notes.takeANote')}
          </Button>
          <GlyphButton
            onPress={onCreateChecklist}
            accessibilityLabel={t('notes.newChecklist')}
            size={40}
            glyphSize={20}
          >
            {(foreground) => <CheckSquare size={20} color={foreground} />}
          </GlyphButton>
          <GlyphButton
            onPress={onCreateAttachment}
            accessibilityLabel={t('notes.attachFile')}
            size={40}
            glyphSize={20}
          >
            {(foreground) => <Paperclip size={20} color={foreground} />}
          </GlyphButton>
        </Card>
      </Animated.View>
    );
  }

  return (
    <Animated.View layout={layout} entering={fadeIn} className="w-full max-w-[600px] self-center">
      <Card
        testID="quick-capture"
        appearance="outline"
        elevation="m"
        style={{
          gap: 8,
          paddingHorizontal: 16,
          paddingVertical: 8,
          backgroundColor: tint ? tint.background : colors.card,
          borderColor: tint ? tint.border : colors.border,
        }}
      >
        <TextFieldInput
          label={t('notes.titlePlaceholder')}
          editable={!saving}
          accessibilityLabel={t('notes.titlePlaceholder')}
          value={title}
          onChangeText={setTitle}
          placeholder={t('notes.titlePlaceholder')}
          placeholderTextColor={colors.mutedForeground}
          className="py-2 text-base font-medium text-foreground"
          returnKeyType="next"
          onSubmitEditing={() => bodyRef.current?.focus()}
        />
        <TextFieldInput
          label={t('notes.takeANote')}
          editable={!saving}
          accessibilityLabel={t('notes.takeANote')}
          inputRef={bodyRef}
          value={body}
          onChangeText={setBody}
          placeholder={t('notes.takeANote')}
          placeholderTextColor={colors.mutedForeground}
          className="min-h-[44px] py-1 text-base text-foreground"
          multiline
        />
        {saveFailed && (
          <Text accessibilityRole="alert" className="py-2 text-sm text-destructive">
            {t('notes.quickSaveFailed')}
          </Text>
        )}
        <View className="mt-1 flex-row items-center justify-between">
          <View className="flex-row items-center gap-0.5">
            <ToolButton
              icon={CheckSquare}
              label={t('notes.newChecklist')}
              color={colors.mutedForeground}
              disabled={saving}
              onPress={() => {
                void commit(false, 'checklist');
              }}
            />
            <ToolButton
              icon={Palette}
              label={t('notes.color')}
              color={colors.mutedForeground}
              disabled={saving}
              onPress={() => setColorOpen(true)}
              active={color !== DEFAULT_NEW_NOTE_COLOR}
              activeColor={colors.foreground}
            />
            <ToolButton
              icon={Paperclip}
              label={t('notes.attachFile')}
              color={colors.mutedForeground}
              disabled={saving}
              onPress={() => {
                void commit(false, 'attachment');
              }}
            />
            <ToolButton
              icon={Archive}
              label={t('notes.archive')}
              color={colors.mutedForeground}
              disabled={saving}
              onPress={() => {
                void commit(true);
              }}
            />
          </View>
          <Button
            appearance="plain"
            tone="neutral"
            disabled={saving}
            loading={saving}
            onPress={() => {
              void commit();
            }}
          >
            {t(saving ? 'notes.saveStatus.saving' : 'common.close')}
          </Button>
        </View>
        <GlyphButton
          disabled={saving}
          onPress={() => (title.trim() || body.trim() ? setDiscardOpen(true) : reset())}
          accessibilityLabel={t('common.cancel')}
          size={28}
          glyphSize={14}
          style={{ position: 'absolute', right: 8, top: 8 }}
        >
          {(foreground) => <X size={14} color={foreground} />}
        </GlyphButton>

        <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('notes.discardDraftTitle')}</DialogTitle>
            </DialogHeader>
            <Text className="text-sm text-muted-foreground">{t('notes.discardDraftSubtitle')}</Text>
            <View className="flex-row justify-end gap-4">
              <Button appearance="plain" tone="neutral" onPress={() => setDiscardOpen(false)}>
                {t('notes.keepEditing')}
              </Button>
              <Button tone="danger" onPress={reset}>
                {t('notes.discardDraft')}
              </Button>
            </View>
          </DialogContent>
        </Dialog>
        <Dialog open={colorOpen} onOpenChange={setColorOpen}>
          <DialogContent className="max-w-xs">
            <DialogHeader>
              <DialogTitle>{t('notes.pickColor')}</DialogTitle>
            </DialogHeader>
            <NoteColorPicker
              selected={color}
              onSelect={(next: NoteColor) => {
                setColor(next);
                setColorOpen(false);
              }}
              scroll={false}
            />
          </DialogContent>
        </Dialog>
      </Card>
    </Animated.View>
  );
}
