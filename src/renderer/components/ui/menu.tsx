import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import { cn } from "@renderer/lib/utils";

export function Menu({ children }: { children: ReactNode }) {
  return <BaseMenu.Root modal={false}>{children}</BaseMenu.Root>;
}

export function MenuTrigger({ className, ...props }: ComponentPropsWithoutRef<typeof BaseMenu.Trigger>) {
  return <BaseMenu.Trigger className={withClassName(className)} {...props} />;
}

export function MenuPanel({
  className,
  sideOffset = 6,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof BaseMenu.Positioner>) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner className={withClassName(className, "cw-menu-positioner")} sideOffset={sideOffset} {...props}>
        <BaseMenu.Popup className="cw-menu-panel">{children}</BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

export function MenuGroup(props: ComponentPropsWithoutRef<typeof BaseMenu.Group>) {
  return <BaseMenu.Group {...props} />;
}

export function MenuSeparator(props: ComponentPropsWithoutRef<typeof BaseMenu.Separator>) {
  return <BaseMenu.Separator className="cw-menu-separator" {...props} />;
}

export function MenuItem({ className, ...props }: ComponentPropsWithoutRef<typeof BaseMenu.Item>) {
  return <BaseMenu.Item className={withClassName(className, "cw-menu-item")} {...props} />;
}

export function MenuShortcut({ className, ...props }: ComponentPropsWithoutRef<"span">) {
  return <span className={cn("cw-menu-shortcut", className)} {...props} />;
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
