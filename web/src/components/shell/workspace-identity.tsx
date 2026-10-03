"use client";

import { MonoId } from "@/components/data/mono-id";
import { useHydrated } from "@/hooks/use-hydrated";
import { getWorkspaceId } from "@/lib/workspace-identity";

/** Shows the anonymous workspace this browser writes as. No account is involved. */
export function WorkspaceIdentity({ className }: { className?: string }) {
  const hydrated = useHydrated();
  const workspaceId = hydrated ? getWorkspaceId() : null;
  return (
    <p className={className}>
      <span className="text-muted-foreground">Anonymous workspace </span>
      {workspaceId ? (
        <MonoId value={workspaceId} />
      ) : (
        <span className="text-subtle-foreground">not created yet</span>
      )}
    </p>
  );
}
