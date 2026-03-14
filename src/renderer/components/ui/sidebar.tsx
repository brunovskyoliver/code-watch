import type { ComponentPropsWithoutRef, ElementRef } from "react";
import { forwardRef } from "react";
import { cn } from "@renderer/lib/utils";

const SidebarProvider = ({ className, ...props }: ComponentPropsWithoutRef<"div">) => {
  return <div className={cn("sidebar-provider", className)} {...props} />;
};

const Sidebar = forwardRef<ElementRef<"aside">, ComponentPropsWithoutRef<"aside">>(
  ({ className, ...props }, ref) => {
    return <aside ref={ref} className={cn("sidebar", className)} {...props} />;
  }
);
Sidebar.displayName = "Sidebar";

const SidebarHeader = forwardRef<ElementRef<"div">, ComponentPropsWithoutRef<"div">>(
  ({ className, ...props }, ref) => {
    return <div ref={ref} className={cn("sidebar-header", className)} {...props} />;
  }
);
SidebarHeader.displayName = "SidebarHeader";

const SidebarContent = forwardRef<ElementRef<"div">, ComponentPropsWithoutRef<"div">>(
  ({ className, ...props }, ref) => {
    return <div ref={ref} className={cn("sidebar-content", className)} {...props} />;
  }
);
SidebarContent.displayName = "SidebarContent";

const SidebarFooter = forwardRef<ElementRef<"div">, ComponentPropsWithoutRef<"div">>(
  ({ className, ...props }, ref) => {
    return <div ref={ref} className={cn("sidebar-footer", className)} {...props} />;
  }
);
SidebarFooter.displayName = "SidebarFooter";

const SidebarMenu = forwardRef<ElementRef<"ul">, ComponentPropsWithoutRef<"ul">>(
  ({ className, ...props }, ref) => {
    return <ul ref={ref} className={cn("sidebar-menu", className)} {...props} />;
  }
);
SidebarMenu.displayName = "SidebarMenu";

const SidebarMenuItem = forwardRef<ElementRef<"li">, ComponentPropsWithoutRef<"li">>(
  ({ className, ...props }, ref) => {
    return <li ref={ref} className={cn("sidebar-menu-item", className)} {...props} />;
  }
);
SidebarMenuItem.displayName = "SidebarMenuItem";

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarProvider
};
