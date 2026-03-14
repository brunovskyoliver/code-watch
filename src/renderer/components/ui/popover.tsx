import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Popover as BasePopover } from "@base-ui/react/popover";
import { cn } from "@renderer/lib/utils";

export function Popover({ children }: { children: ReactNode }) {
  return <BasePopover.Root modal={false}>{children}</BasePopover.Root>;
}

export function PopoverTrigger({ className, ...props }: ComponentPropsWithoutRef<typeof BasePopover.Trigger>) {
  return <BasePopover.Trigger className={withClassName(className)} {...props} />;
}

export function PopoverContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof BasePopover.Positioner>) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner className={withClassName(className, "cw-popover-positioner")} sideOffset={sideOffset} {...props}>
        <BasePopover.Popup className="cw-popover-popup">{children}</BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  );
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
