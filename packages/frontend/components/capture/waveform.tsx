import { View } from "react-native";

import { WAVEFORM_BARS } from "@/lib/capture/recording";
import { useColorScheme } from "@/lib/useColorScheme";

/** Shortest bar drawn, as a fraction of the track, so silence still reads as "listening". */
const MIN_BAR_SCALE = 0.12;

interface WaveformProps {
  /** Recent levels, 0–1, oldest first. Null before the first sample. */
  levels: number[] | null;
  height?: number;
}

/**
 * A live level meter.
 *
 * Plain Views rather than an animated canvas: the levels already arrive at the
 * recorder's own sampling rate, so re-rendering on each one is the animation.
 * Adding a second, interpolated one on top would only make the bars lag behind
 * the sound they represent.
 */
export function Waveform({ levels, height = 28 }: WaveformProps) {
  const { colors } = useColorScheme();
  const bars = levels ?? Array<number>(WAVEFORM_BARS).fill(0);

  return (
    <View
      className="flex-1 flex-row items-center gap-[2px]"
      style={{ height }}
      accessibilityRole="progressbar"
      accessibilityLabel="Audio level"
    >
      {bars.map((level, index) => (
        <View
          key={index}
          className="flex-1 rounded-full"
          style={{
            height: Math.max(MIN_BAR_SCALE, level) * height,
            backgroundColor: colors.primary,
            // Older samples fade out, so the bar reads left-to-right as time.
            opacity: 0.35 + (index / bars.length) * 0.65,
          }}
        />
      ))}
    </View>
  );
}
