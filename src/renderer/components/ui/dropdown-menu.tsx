import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import { cn } from "@renderer/lib/utils";

export function DropdownMenu({ children, open, onOpenChange }: { children: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  return <BaseMenu.Root modal={false} open={open} onOpenChange={onOpenChange}>{children}</BaseMenu.Root>;
}

export function DropdownMenuTrigger({ className, ...props }: ComponentPropsWithoutRef<typeof BaseMenu.Trigger>) {
  return <BaseMenu.Trigger className={withClassName(className)} {...props} />;
}

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof BaseMenu.Positioner>) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner className={withClassName(className, "cw-dropdown-menu-positioner")} sideOffset={sideOffset} {...props}>
        <BaseMenu.Popup className="cw-dropdown-menu-content">{children}</BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

export function DropdownMenuGroup(props: ComponentPropsWithoutRef<typeof BaseMenu.Group>) {
  return <BaseMenu.Group {...props} />;
}

export function DropdownMenuItem({ className, ...props }: ComponentPropsWithoutRef<typeof BaseMenu.Item>) {
  return <BaseMenu.Item className={withClassName(className, "cw-dropdown-menu-item")} {...props} />;
}

export function DropdownMenuSeparator(props: ComponentPropsWithoutRef<typeof BaseMenu.Separator>) {
  return <BaseMenu.Separator className="cw-dropdown-menu-separator" {...props} />;
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
