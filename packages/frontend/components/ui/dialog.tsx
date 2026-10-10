import * as React from 'react';
import { View, Pressable } from 'react-native';
import { Dialog as BloomDialog } from '@oxy.so/bloom/dialog';
import { CloseButton } from '@oxy.so/bloom/button';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { Text } from './text';

interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

const Dialog = ({ open, onOpenChange, children }: DialogProps) => {
  return (
    <DialogContext.Provider value={{ open: open ?? false, onOpenChange }}>
      {children}
    </DialogContext.Provider>
  );
};

const DialogContext = React.createContext<{
  open: boolean;
  onOpenChange?: (open: boolean) => void;
}>({
  open: false,
});

const DialogTrigger = React.forwardRef<
  React.ElementRef<typeof Pressable>,
  React.ComponentPropsWithoutRef<typeof Pressable>
>(({ onPress, ...props }, ref) => {
  const { onOpenChange } = React.useContext(DialogContext);

  return (
    <Pressable
      ref={ref}
      onPress={(e) => {
        onOpenChange?.(true);
        onPress?.(e);
      }}
      {...props}
    />
  );
});

DialogTrigger.displayName = 'DialogTrigger';

interface DialogContentProps extends React.ComponentPropsWithoutRef<typeof View> {
  overlayClassName?: string;
  showCloseButton?: boolean;
  /** @deprecated Use showCloseButton instead */
  closeButton?: boolean;
}

const DialogContent = React.forwardRef<React.ElementRef<typeof View>, DialogContentProps>(
  ({ className, overlayClassName, showCloseButton, closeButton, children, ...props }, ref) => {
    const { open, onOpenChange } = React.useContext(DialogContext);
    const shouldShowClose = showCloseButton ?? closeButton ?? true;
    const { t } = useTranslation();
    const findTitle = (nodes: React.ReactNode): string | undefined => {
      for (const node of React.Children.toArray(nodes)) {
        if (!React.isValidElement<{ children?: React.ReactNode }>(node)) continue;
        if (node.type === DialogTitle && typeof node.props.children === 'string')
          return node.props.children;
        const title = findTitle(node.props.children);
        if (title) return title;
      }
      return undefined;
    };
    return (
      <BloomDialog
        open={open}
        onClose={() => onOpenChange?.(false)}
        label={findTitle(children)}
        maxWidth={className?.includes('max-w-xs') ? 320 : 512}
      >
        <View ref={ref} className={cn('gap-4', className)} {...props}>
          {shouldShowClose && (
            <View className="items-end">
              <CloseButton
                accessibilityLabel={t('common.close')}
                onPress={() => onOpenChange?.(false)}
              />
            </View>
          )}
          {children}
        </View>
      </BloomDialog>
    );
  },
);

DialogContent.displayName = 'DialogContent';

const DialogHeader = React.forwardRef<
  React.ElementRef<typeof View>,
  React.ComponentPropsWithoutRef<typeof View>
>(({ className, ...props }, ref) => {
  return (
    <View
      ref={ref}
      className={cn('flex-col gap-2 text-center sm:text-left', className)}
      {...props}
    />
  );
});

DialogHeader.displayName = 'DialogHeader';

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof Text>,
  React.ComponentPropsWithoutRef<typeof Text>
>(({ className, ...props }, ref) => {
  return (
    <Text
      ref={ref}
      className={cn('text-lg leading-none font-semibold text-foreground', className)}
      {...props}
    />
  );
});

DialogTitle.displayName = 'DialogTitle';

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof Text>,
  React.ComponentPropsWithoutRef<typeof Text>
>(({ className, ...props }, ref) => {
  return <Text ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />;
});

DialogDescription.displayName = 'DialogDescription';

const DialogFooter = React.forwardRef<
  React.ElementRef<typeof View>,
  React.ComponentPropsWithoutRef<typeof View>
>(({ className, ...props }, ref) => {
  return (
    <View
      ref={ref}
      className={cn('flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
});

DialogFooter.displayName = 'DialogFooter';

const DialogClose = React.forwardRef<
  React.ElementRef<typeof Pressable>,
  React.ComponentPropsWithoutRef<typeof Pressable>
>(({ onPress, ...props }, ref) => {
  const { onOpenChange } = React.useContext(DialogContext);

  return (
    <Pressable
      ref={ref}
      onPress={(e) => {
        onOpenChange?.(false);
        onPress?.(e);
      }}
      {...props}
    />
  );
});

DialogClose.displayName = 'DialogClose';

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
};
