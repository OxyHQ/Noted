import { cn } from '@/lib/utils';
import * as SeparatorPrimitive from '@rn-primitives/separator';

function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
  // No ref: under React Native 0.88 `RootRef` (rn-primitives' `ElementRef<typeof
  // View>`) names the component rather than its instance, so a forwarded ref
  // cannot typecheck. Nothing in the app passes one.
}: Omit<SeparatorPrimitive.RootProps, 'ref'>) {
  return (
    <SeparatorPrimitive.Root
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'bg-border shrink-0',
        orientation === 'horizontal' ? 'h-[1px] w-full' : 'h-full w-[1px]',
        className,
      )}
      {...props}
    />
  );
}

export { Separator };
