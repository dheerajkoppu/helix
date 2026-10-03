"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { JobWatcher } from "@/components/jobs/run-job";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createQueryClient } from "@/lib/api/query";
import { usePreferences } from "@/lib/state/preferences";
import { getWorkspaceId } from "@/lib/workspace-identity";

export function Providers({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [queryClient] = useState(createQueryClient);

  useEffect(() => {
    void usePreferences.persist.rehydrate();
    getWorkspaceId();
  }, []);

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        {/* The only TooltipProvider in the app: the first tooltip waits, neighbours open at once. */}
        <TooltipProvider delay={500} closeDelay={0} timeout={400}>
          {children}
        </TooltipProvider>
        <JobWatcher />
        <Toaster position="bottom-right" />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
