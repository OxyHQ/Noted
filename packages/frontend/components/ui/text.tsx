import * as React from 'react';
import { Text as RNText, type TextProps as RNTextProps } from 'react-native';
import { Text as BloomText } from '@oxy.so/bloom/typography';
import { cn } from '@/lib/utils';

const TextClassContext = React.createContext<string | undefined>(undefined);

export type TextProps = RNTextProps & {
  className?: string;
};

const Text = React.forwardRef<RNText, TextProps>(({ className, ...props }, ref) => {
  const textClass = React.useContext(TextClassContext);
  return (
    <BloomText
      variant="body-regular"
      className={cn(textClass, className) || undefined}
      {...{ ref }}
      {...props}
    />
  );
});
Text.displayName = 'Text';

export { Text, TextClassContext };
