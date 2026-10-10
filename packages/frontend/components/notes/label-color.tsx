import { View } from 'react-native';
import { Chip } from '@oxy.so/bloom/chip';
import { BloomColorScope, useTheme } from '@oxy.so/bloom/theme';
import { RiPriceTag3Line } from '@oxy.so/bloom/icons/RiPriceTag3Line';
import { RadioGroup } from '@oxy.so/bloom/radio';
import { NOTE_COLORS, type Label, type NoteColor } from '@noted/shared-types';
import { useTranslation } from '@/hooks/useTranslation';

/** A label's uncolored state is null in storage; legacy default reads the same. */
export function LabelChip({ label, onPress }: { label: Pick<Label, 'name' | 'color'>; onPress?: () => void }) {
  const preset = label.color && label.color !== 'default' ? label.color : undefined;
  return <BloomColorScope colorPreset={preset} asChild>
    <Chip size="sm" appearance="subtle" tone={preset ? 'accent' : 'neutral'} leadingIcon={RiPriceTag3Line} onPress={onPress}>
      {label.name}
    </Chip>
  </BloomColorScope>;
}

/** Bloom owns radio semantics, arrow-key navigation and disabled state. */
export function LabelColorPicker({ value, onChange, disabled }: {
  value: NoteColor | null;
  onChange: (color: NoteColor | null) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return <RadioGroup<NoteColor> label={t('notes.labelColor')} value={value ?? 'default'} disabled={disabled}
    onValueChange={color => onChange(color === 'default' ? null : color)}
    style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}
    options={NOTE_COLORS.map(color => ({
      value: color,
      label: t(`notes.labelColors.${color}`),
      labelContent: <LabelChip label={{ name: t(`notes.labelColors.${color}`), color }} />,
    }))} />;
}

/** Unselected glyphs carry the hue; selected rows keep Bloom's paired foreground. */
export function LabelIcon({ color, selected, width, height, fill }: { selected?: boolean; color: Label['color']; width?: number; height?: number; fill?: string }) {
  return <BloomColorScope colorPreset={color && color !== 'default' ? color : undefined} asChild>
    <View><LabelGlyph colored={Boolean(color && color !== 'default' && !selected)} width={width} height={height} fill={fill} /></View>
  </BloomColorScope>;
}
function LabelGlyph({ colored, width, height, fill }: { colored: boolean; width?: number; height?: number; fill?: string }) {
  const { colors } = useTheme();
  return <RiPriceTag3Line width={width} height={height} fill={colored ? colors.primarySubtleForeground : fill} />;
}
