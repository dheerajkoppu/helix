"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { decideApproval, labKeys } from "@/components/lab/api";
import { formatClock, humanise } from "@/components/lab/format";
import type { ApprovalEntry } from "@/components/lab/record";
import {
  ANCHOR_OFFSET,
  useAgentLabel,
  useEntryProps,
  useRun,
} from "@/components/lab/run-context";
import { ByLine, IdLink, NotRecorded, Subhead } from "@/components/lab/section";
import { isActiveStatus } from "@/components/lab/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isApiError } from "@/lib/api/client";

type Decision = "approved" | "rejected";

function DecisionControls({ approval }: { approval: ApprovalEntry }) {
  const { run } = useRun();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const decide = useMutation({
    mutationFn: (decision: Decision) =>
      decideApproval(run.run_id, approval.id, decision, note.trim()),
    onSuccess: (_, decision) => {
      toast(`${approval.id} ${decision}`);
      void queryClient.invalidateQueries({ queryKey: labKeys.run(run.run_id) });
      void queryClient.invalidateQueries({ queryKey: labKeys.runs() });
    },
    onError: (error) => {
      toast.error("Decision not recorded", {
        description: isApiError(error)
          ? error.message
          : "The API did not accept the decision.",
      });
    },
  });
  const noteId = `approval-note-${approval.id}`;

  return (
    <form
      className="mt-2.5 flex flex-wrap items-center gap-2"
      onSubmit={(event) => event.preventDefault()}
    >
      <label htmlFor={noteId} className="sr-only">
        Note for {approval.id}
      </label>
      <Input
        id={noteId}
        value={note}
        maxLength={500}
        placeholder="Note recorded with the decision (optional)"
        onChange={(event) => setNote(event.target.value)}
        disabled={decide.isPending}
        className="w-full max-w-sm"
      />
      <Button
        type="button"
        disabled={decide.isPending}
        onClick={() => decide.mutate("approved")}
      >
        {decide.isPending && decide.variables === "approved"
          ? "Recording"
          : "Approve"}
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={decide.isPending}
        onClick={() => decide.mutate("rejected")}
      >
        {decide.isPending && decide.variables === "rejected"
          ? "Recording"
          : "Reject"}
      </Button>
      {decide.isError ? (
        <p role="alert" className="w-full text-xs text-destructive">
          {isApiError(decide.error)
            ? decide.error.message
            : "The decision was not recorded."}
        </p>
      ) : null}
    </form>
  );
}

function DecisionLine({
  decision,
}: {
  decision: NonNullable<ApprovalEntry["decision"]>;
}) {
  const agentLabel = useAgentLabel();
  const props = useEntryProps(
    decision.event.seq,
    "mt-1.5 grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs",
  );
  return (
    <dl {...props}>
      <dt className="text-muted-foreground">Decided by</dt>
      <dd className="text-foreground">
        <span className="font-medium">
          {decision.by ?? agentLabel(decision.event.agent)}
        </span>
        <span className="tabular font-mono text-muted-foreground">
          {" · line "}
          {decision.event.seq}
          {decision.event.at ? ` · ${formatClock(decision.event.at)}` : null}
        </span>
      </dd>
      <dt className="text-muted-foreground">Note</dt>
      <dd className="text-foreground">
        {decision.note ?? (
          <span className="text-subtle-foreground">No note</span>
        )}
      </dd>
    </dl>
  );
}

function ApprovalRow({ approval }: { approval: ApprovalEntry }) {
  const { run, replaying } = useRun();
  const props = useEntryProps(
    approval.request.seq,
    "border-b border-border-subtle px-3 py-3 last:border-b-0",
  );
  const decision = approval.decision;
  const canDecide = !decision && !replaying && isActiveStatus(run.status);

  return (
    <li {...props}>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-xs">
        <span className="font-mono font-medium text-foreground" translate="no">
          {approval.id}
        </span>
        <span className="font-medium text-foreground">
          {decision
            ? decision.decision
              ? humanise(decision.decision).replace(/^./, (first) =>
                  first.toUpperCase(),
                )
              : "Decided"
            : canDecide
              ? "Waiting for a human decision"
              : "No decision recorded"}
        </span>
        <ByLine event={approval.request} className="ml-auto" />
      </div>
      <dl className="mt-2 grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">Action</dt>
        <dd className="text-sm text-foreground">
          {approval.action ?? (
            <span className="text-subtle-foreground">Not stated</span>
          )}
          {approval.test_id || approval.tool ? (
            <span className="flex flex-wrap items-baseline gap-x-3 pt-0.5 text-xs text-muted-foreground">
              {approval.test_id ? (
                <span>
                  Test <IdLink id={approval.test_id} />
                </span>
              ) : null}
              {approval.tool ? (
                <span>
                  Tool{" "}
                  <span className="font-mono text-foreground" translate="no">
                    {approval.tool}
                  </span>
                </span>
              ) : null}
            </span>
          ) : null}
        </dd>
        <dt className="text-muted-foreground">Why it needs approval</dt>
        <dd className="text-foreground">
          {approval.reason ?? (
            <span className="text-subtle-foreground">Not stated</span>
          )}
        </dd>
        <dt className="text-muted-foreground">Risk</dt>
        <dd className="text-foreground">
          {approval.risk ?? (
            <span className="text-subtle-foreground">Not stated</span>
          )}
        </dd>
      </dl>
      {decision ? <DecisionLine decision={decision} /> : null}
      {canDecide ? <DecisionControls approval={approval} /> : null}
    </li>
  );
}

/**
 * Requests the safety agent routed to a human. The run waits until a person approves or rejects;
 * the decision, who made it and their note become lines of the record.
 */
export function Approvals() {
  const { view } = useRun();
  return (
    <div id="approvals" className={ANCHOR_OFFSET}>
      <Subhead
        title="Human approval"
        count={view.approvals.length}
        detail="Consequential actions wait for a person"
        className="border-t border-t-border"
      />
      {view.approvals.length ? (
        <ul>
          {view.approvals.map((approval) => (
            <ApprovalRow key={approval.id} approval={approval} />
          ))}
        </ul>
      ) : (
        <NotRecorded what="approval requests" />
      )}
    </div>
  );
}
