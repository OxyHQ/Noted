import * as React from "react";
import {
  Button as BloomButton,
  type ButtonProps as BloomButtonProps,
} from "@oxy.so/bloom/button";
import { Text as BloomText } from "@oxy.so/bloom/typography";
import { Text, TextClassContext } from "@/components/ui/text";

type Variant =
  | "default"
  | "destructive"
  | "outline"
  | "secondary"
  | "ghost"
  | "link"
  | "pill";
export type ButtonProps = Omit<BloomButtonProps, "size"> & {
  variant?: Variant;
  size?: "default" | "sm" | "lg" | "icon";
  isLoading?: boolean;
};

/** Compatibility for existing app call sites; Bloom owns paint and interaction. */
export const Button = React.forwardRef<
  React.ComponentRef<typeof BloomButton>,
  ButtonProps
>(
  (
    { variant = "default", size = "default", isLoading, children, ...props },
    ref,
  ) => {
    const appearance =
      variant === "outline"
        ? "outline"
        : variant === "ghost" || variant === "link"
          ? "plain"
          : variant === "secondary"
            ? "subtle"
            : "solid";
    const tone =
      variant === "destructive"
        ? "danger"
        : variant === "outline" ||
            variant === "secondary" ||
            variant === "ghost"
          ? "neutral"
          : "accent";
    // Plain labels let Bloom paint the correct foreground for hover/disabled/tone.
    const label = React.Children.map(children, (child) =>
      React.isValidElement<{ children?: React.ReactNode }>(child) &&
      (child.type === Text || child.type === BloomText) &&
      (typeof child.props.children === "string" ||
        typeof child.props.children === "number")
        ? child.props.children
        : child,
    );
    return (
      <TextClassContext.Provider value={undefined}>
        <BloomButton
          ref={ref}
          appearance={appearance}
          tone={tone}
          size={size === "default" || size === "icon" ? "md" : size}
          iconOnly={size === "icon"}
          loading={isLoading}
          underline={variant === "link" ? "hover" : "none"}
          {...props}
        >
          {label}
        </BloomButton>
      </TextClassContext.Provider>
    );
  },
);
Button.displayName = "Button";
