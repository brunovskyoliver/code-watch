import type { ComponentPropsWithoutRef } from "react";
import { Toggle as BaseToggle } from "@base-ui/react/toggle";
import { ToggleGroup as BaseToggleGroup } from "@base-ui/react/toggle-group";
import { cn } from "@renderer/lib/utils";

export function ToggleGroup({ className, ...props }: ComponentPropsWithoutRef<typeof BaseToggleGroup>) {
  return <BaseToggleGroup className={withClassName(className, "cw-toggle-group")} {...props} />;
}

export function Toggle({ className, ...props }: ComponentPropsWithoutRef<typeof BaseToggle>) {
  return <BaseToggle className={withClassName(className, "cw-toggle")} {...props} />;
}

function withClassName(
  className: string | ((state: any) => string | undefined) | undefined,
  baseClassName?: string
): string | ((state: any) => string | undefined) | undefined {
  if (!baseClassName) {
    return className;
  }

  if (typeof className === "function") {
    return (state) => cn(baseClassName, className(state));
  }

  return cn(baseClassName, className);
}
