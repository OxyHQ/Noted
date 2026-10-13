import React from 'react';
import { View } from 'react-native';
import * as Skeleton from '@oxy.so/bloom/skeleton';

/** A local read usually answers in a few milliseconds; a placeholder before then is only a flicker. */
const SHOW_AFTER_MS = 250;

/** Card-shaped placeholder lines: not identical, so they read as text rather than as a pattern. */
const CARDS: readonly (readonly number[])[] = [
  [60, 100, 85],
  [45, 90],
  [70, 100, 100, 55],
  [50, 80],
  [65, 95, 70],
  [40, 75],
];

/** The shape of the notes list while it loads. */
export function NotesSkeleton() {
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    const timer = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!visible) return null;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      className="gap-3 py-2"
    >
      {CARDS.map((lines, index) => (
        // The list never reorders, so the index is the identity.
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative list
        <Skeleton.Col key={index} style={{ gap: 8, padding: 16, borderRadius: 16 }}>
          {lines.map((width, line) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative list
            <Skeleton.Text key={line} style={{ width: `${width}%` }} />
          ))}
        </Skeleton.Col>
      ))}
    </View>
  );
}
