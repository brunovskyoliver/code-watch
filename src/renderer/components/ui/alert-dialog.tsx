import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";
import { cn } from "@renderer/lib/utils";

export function AlertDialog({
  children,
  ...props
}: ComponentPropsWithoutRef<typeof BaseAlertDialog.Root> & { children: ReactNode }) {
  return <BaseAlertDialog.Root {...props}>{children}</BaseAlertDialog.Root>;
}

export function AlertDialogPopup({ className, children, ...props }: ComponentPropsWithoutRef<typeof BaseAlertDialog.Popup>) {
  return (
    <BaseAlertDialog.Portal>
      <BaseAlertDialog.Backdrop className="cw-alert-backdrop" />
      <BaseAlertDialog.Popup className={cn("cw-alert-popup", className)} {...props}>
        {children}
      </BaseAlertDialog.Popup>
    </BaseAlertDialog.Portal>
  );
}

export function AlertDialogHeader({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("cw-alert-header", className)} {...props} />;
}

export function AlertDialogTitle({ className, ...props }: ComponentPropsWithoutRef<typeof BaseAlertDialog.Title>) {
  return <BaseAlertDialog.Title className={cn("cw-alert-title", className)} {...props} />;
}

export function AlertDialogDescription({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof BaseAlertDialog.Description>) {
  return <BaseAlertDialog.Description className={cn("cw-alert-description", className)} {...props} />;
}

export function AlertDialogFooter({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("cw-alert-footer", className)} {...props} />;
}

export function AlertDialogAction({ className, ...props }: ComponentPropsWithoutRef<typeof BaseAlertDialog.Close>) {
  return <BaseAlertDialog.Close className={cn("cw-alert-action", className)} {...props} />;
}

export function AlertDialogCancel({ className, ...props }: ComponentPropsWithoutRef<typeof BaseAlertDialog.Close>) {
  return <BaseAlertDialog.Close className={cn("cw-alert-cancel", className)} {...props} />;
}
