"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      // Clears the 24px status line.
      offset={{ bottom: 36, right: 12 }}
      mobileOffset={{ bottom: 36 }}
      gap={8}
      icons={{
        success: <CircleCheckIcon className="size-3.5" />,
        info: <InfoIcon className="size-3.5" />,
        warning: <TriangleAlertIcon className="size-3.5 text-warning" />,
        error: <OctagonXIcon className="size-3.5 text-destructive" />,
        loading: <Loader2Icon className="size-3.5 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "6px",
          "--width": "340px",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            "cn-toast font-sans !text-xs !shadow-popover !py-2.5 !px-3 !gap-2",
          title: "!font-medium",
          description: "!text-muted-foreground",
          actionButton:
            "!h-6 !rounded-md !bg-primary !px-2 !text-xs !text-primary-foreground",
          cancelButton:
            "!h-6 !rounded-md !bg-muted !px-2 !text-xs !text-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
