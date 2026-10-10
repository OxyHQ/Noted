import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

export interface NotesContentProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  restorationKey?: string;
  ready?: boolean;
}

export const notesContentStyle: ViewStyle = {
  paddingHorizontal: 16,
  paddingTop: 16,
  paddingBottom: 24,
  gap: 24,
};
