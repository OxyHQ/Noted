import React from 'react';
import { View, type TextInput } from 'react-native';
import { X, Plus } from 'lucide-react-native';
import { GlyphButton } from '@oxy.so/bloom/button';
import { Checkbox } from '@oxy.so/bloom/checkbox';
import { TextField, TextFieldInput } from '@oxy.so/bloom/text-field';
import { useColorScheme } from '@/lib/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';
import { generateUUID } from '@/lib/utils';
import type { ChecklistItem } from '@noted/shared-types';

interface ChecklistEditorProps {
  items: ChecklistItem[];
  onChange: (items: ChecklistItem[]) => void;
}

/** Editable checklist: toggle, edit text, remove, and add new items. */
export function ChecklistEditor({ items, onChange }: ChecklistEditorProps) {
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const [draft, setDraft] = React.useState('');
  const draftRef = React.useRef('');
  const inputRef = React.useRef<TextInput>(null);

  const toggle = (id: string) =>
    onChange(items.map((it) => (it.id === id ? { ...it, checked: !it.checked } : it)));

  const editText = (id: string, text: string) =>
    onChange(items.map((it) => (it.id === id ? { ...it, text } : it)));

  const remove = (id: string) => onChange(items.filter((it) => it.id !== id));

  const addItem = () => {
    const text = draftRef.current.trim();
    if (!text) return;
    draftRef.current = '';
    onChange([...items, { id: generateUUID(), text, checked: false }]);
    setDraft('');
  };

  return (
    <View className="gap-1">
      {items.map((item) => {
        return (
          <View key={item.id} className="flex-row items-center gap-2">
            <Checkbox
              checked={item.checked}
              onCheckedChange={() => toggle(item.id)}
              accessibilityLabel={item.text}
              size="sm"
            />
            <TextField className="flex-1">
              <TextFieldInput
                label={item.text || t('notes.addItem')}
                value={item.text}
                onValueChange={(text) => editText(item.id, text)}
                placeholderTextColor={colors.mutedForeground}
                className="flex-1 py-1 text-base text-foreground"
                style={item.checked ? { textDecorationLine: 'line-through' } : undefined}
              />
            </TextField>
            <GlyphButton
              onPress={() => remove(item.id)}
              size={32}
              glyphSize={16}
              accessibilityLabel={t('notes.removeItem')}
            >
              {(foreground) => <X size={20} color={foreground} />}
            </GlyphButton>
          </View>
        );
      })}

      <View className="flex-row items-center gap-2">
        <GlyphButton
          onPress={() => {
            addItem();
            inputRef.current?.focus();
          }}
          accessibilityLabel={t('notes.addItem')}
          size={32}
          glyphSize={20}
        >
          {(foreground) => <Plus size={20} color={foreground} />}
        </GlyphButton>
        <TextField className="flex-1">
          <TextFieldInput
            label={t('notes.addItem')}
            inputRef={inputRef}
            value={draft}
            onChangeText={(text) => {
              draftRef.current = text;
              setDraft(text);
            }}
            onBlur={addItem}
            onSubmitEditing={addItem}
            blurOnSubmit={false}
            placeholder={t('notes.addItem')}
            placeholderTextColor={colors.mutedForeground}
            className="flex-1 py-1 text-base text-foreground"
            returnKeyType="done"
          />
        </TextField>
      </View>
    </View>
  );
}
