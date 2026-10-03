"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon, PlayIcon } from "lucide-react";
import { cn } from "cn";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { labKeys, startRun } from "@/components/lab/api";
import { modeLabel, variantLabel } from "@/components/lab/format";
import { RUN_MODES, type RunMode } from "@/components/lab/types";
import { QueryErrorState, RowsSkeleton } from "@/components/states/query-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { apiFetch, isApiError } from "@/lib/api/client";
import { apiQuery } from "@/lib/api/query";
import type { Schema } from "@/lib/api/types";
import { parseVariantId } from "@/lib/ids";
import { useAdvancedMode } from "@/lib/state/preferences";

/** The lab's demonstration case. */
const DEMONSTRATION_VARIANT = "BTK-p.Arg28His";
const DEMONSTRATION_GENE = "BTK";

const DEFAULT_OBJECTIVE =
  "Which molecular mechanism best explains the loss of function of this variant, and does a targeted computational test change the conclusion the starting evidence suggested?";

const MODE_NOTE: Record<RunMode, string> = {
  specialist_lab:
    "An orchestrator dispatches the specialist agents listed under Agents.",
  single_agent_baseline:
    "One agent with the same tools: the control arm of the measured comparison.",
};

type ExplorePage = Schema<"ExploreGenesResponse">;
type SearchResponse = Schema<"SearchResponse">;

/** Symbols of the genes whose variants the seeded catalog carries in full. */
async function fetchFlagshipGenes(signal: AbortSignal): Promise<string[]> {
  const symbols: string[] = [];
  let offset = 0;
  for (;;) {
    const page = await apiFetch<ExplorePage>("/explore/genes", {
      query: { limit: 500, offset },
      signal,
    });
    for (const gene of page.items)
      if (gene.is_flagship) symbols.push(gene.symbol);
    offset += page.items.length;
    if (!page.has_more || page.items.length === 0) break;
  }
  return symbols.sort((left, right) => left.localeCompare(right));
}

function useDebounced<Value>(value: Value, delayMs: number): Value {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** A run takes a protein substitution; other variant records cannot be started. */
const substitutionHits = (response: SearchResponse | undefined) =>
  (
    response?.groups.find((group) => group.type === "variant")?.results ?? []
  ).filter((hit) => parseVariantId(hit.id)?.kind === "substitution");

/** The limits the API accepts for a run budget. */
const TOOL_CALL_LIMITS = { minimum: 20, maximum: 400 };
const COMPUTE_SECOND_LIMITS = { minimum: 0, maximum: 1800 };

/** A number inside the limits, null for an empty field, or "invalid". */
function readBudget(
  value: string,
  limits: { minimum: number; maximum: number },
  wholeNumber: boolean,
): number | null | "invalid" {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return "invalid";
  const parsed = Number(trimmed);
  if (wholeNumber && !Number.isInteger(parsed)) return "invalid";
  return parsed >= limits.minimum && parsed <= limits.maximum
    ? parsed
    : "invalid";
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  /** shown in Advanced only */
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  const advanced = useAdvancedMode();
  return (
    <div className="grid gap-x-6 gap-y-1.5 py-3 md:grid-cols-[7rem_minmax(0,1fr)]">
      <div className="flex flex-col gap-0.5 pt-1">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm text-muted-foreground">
            {label}
          </label>
        ) : (
          <span className="text-sm text-muted-foreground">{label}</span>
        )}
        {advanced && hint ? (
          <span className="text-2xs text-subtle-foreground">{hint}</span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-2">{children}</div>
    </div>
  );
}

export type LabApiState = "ready" | "checking" | "unreachable" | "not_served";

const API_NOTE: Record<Exclude<LabApiState, "ready">, string> = {
  checking: "Checking the lab API.",
  unreachable: "The lab API did not answer.",
  not_served: "This API build does not serve the lab.",
};

export interface StartRunProps {
  /** whether the lab routes answered: a run can be started only when they are ready */
  apiState: LabApiState;
  /** the budget a run gets when the fields are left empty, when the API states it */
  defaultBudget: {
    max_tool_calls: number | null;
    max_compute_seconds: number | null;
  } | null;
}

/** Pick a flagship variant and run. Objective, mode, budget and any other variant sit under Options. */
export function StartRun({ apiState, defaultBudget }: StartRunProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const advanced = useAdvancedMode();
  const fieldId = useId();
  const [gene, setGene] = useState(DEMONSTRATION_GENE);
  const [picked, setPicked] = useState(DEMONSTRATION_VARIANT);
  const [text, setText] = useState("");
  const [optionsToggled, setOptionsToggled] = useState<boolean | null>(null);
  const [objective, setObjective] = useState("");
  const [mode, setMode] = useState<RunMode>("specialist_lab");
  const [maxToolCalls, setMaxToolCalls] = useState("");
  const [maxComputeSeconds, setMaxComputeSeconds] = useState("");
  const optionsOpen = optionsToggled ?? advanced;

  const flagshipGenes = useQuery({
    queryKey: ["lab", "flagship-genes"],
    queryFn: ({ signal }) => fetchFlagshipGenes(signal),
    staleTime: 30 * 60 * 1000,
  });
  const flagshipVariants = useQuery(
    apiQuery<SearchResponse>("/search", {
      q: gene,
      types: "variant",
      limit: 25,
    }),
  );
  const needle = useDebounced(text.trim(), 200);
  const search = useQuery({
    ...apiQuery<SearchResponse>("/search", {
      q: needle,
      types: "variant",
      limit: 25,
    }),
    enabled: optionsOpen && needle.length > 0,
  });

  const start = useMutation({
    mutationFn: startRun,
    onSuccess: (runId) => {
      void queryClient.invalidateQueries({ queryKey: labKeys.runs() });
      router.push(`/lab/${encodeURIComponent(runId)}`);
    },
    onError: (error) => {
      toast.error("Run not started", {
        description: isApiError(error)
          ? error.message
          : "The lab API did not start the run.",
      });
    },
  });

  const geneVariants = substitutionHits(flagshipVariants.data?.data).filter(
    (hit) => hit.id.startsWith(`${gene}-`),
  );
  const hits = substitutionHits(search.data?.data);
  // a gene without a choice of its own runs its first flagship variant
  const selectedId = picked || (geneVariants[0]?.id ?? "");
  const toolCalls = readBudget(maxToolCalls, TOOL_CALL_LIMITS, true);
  const computeSeconds = readBudget(
    maxComputeSeconds,
    COMPUTE_SECOND_LIMITS,
    false,
  );
  const budgetInvalid = toolCalls === "invalid" || computeSeconds === "invalid";
  const canStart =
    apiState === "ready" &&
    selectedId.length > 0 &&
    !budgetInvalid &&
    !start.isPending;

  function chooseGene(symbol: string) {
    setGene(symbol);
    if (!picked.startsWith(`${symbol}-`)) setPicked("");
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canStart) return;
    const budget =
      toolCalls !== null || computeSeconds !== null
        ? {
            ...(toolCalls !== null ? { max_tool_calls: toolCalls } : {}),
            ...(computeSeconds !== null
              ? { max_compute_seconds: computeSeconds }
              : {}),
          }
        : undefined;
    start.mutate({
      variant_id: selectedId,
      mode,
      ...(objective.trim() ? { objective: objective.trim() } : {}),
      ...(budget ? { budget } : {}),
    });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-2.5">
        <div
          role="group"
          aria-label="Flagship gene"
          className="flex flex-wrap items-center gap-1"
        >
          {flagshipGenes.isPending ? (
            <span className="text-xs text-subtle-foreground">
              Loading genes
            </span>
          ) : flagshipGenes.isError || flagshipGenes.data.length === 0 ? (
            <span className="text-xs text-subtle-foreground">
              Flagship genes not available
            </span>
          ) : (
            flagshipGenes.data.map((symbol) => (
              <Button
                key={symbol}
                type="button"
                size="sm"
                variant={gene === symbol ? "secondary" : "ghost"}
                aria-pressed={gene === symbol}
                onClick={() => chooseGene(symbol)}
                className={cn(
                  "font-mono",
                  gene !== symbol && "text-muted-foreground",
                )}
              >
                {symbol}
              </Button>
            ))
          )}
        </div>
        <div
          role="radiogroup"
          aria-label={`Flagship variants of ${gene}`}
          className="flex min-h-10 flex-wrap items-center gap-2"
        >
          {flagshipVariants.isPending ? (
            <span className="text-sm text-subtle-foreground">
              Loading variants
            </span>
          ) : flagshipVariants.isError ? (
            <QueryErrorState
              error={flagshipVariants.error}
              subject={`variants of ${gene}`}
              onRetry={() => void flagshipVariants.refetch()}
              retrying={flagshipVariants.isFetching}
              size="inline"
            />
          ) : geneVariants.length === 0 ? (
            <span className="text-sm text-muted-foreground">
              No flagship variant found for {gene}.
            </span>
          ) : (
            geneVariants.map((hit) => {
              const selected = hit.id === selectedId;
              return (
                <button
                  key={hit.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  title={hit.description ?? undefined}
                  onClick={() => setPicked(hit.id)}
                  className={cn(
                    "h-10 rounded-md border px-3.5 font-mono text-base outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
                    selected
                      ? "border-foreground bg-active font-medium text-foreground"
                      : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
                  )}
                  translate="no"
                >
                  {variantLabel(hit.id)}
                </button>
              );
            })
          )}
          {picked &&
          !flagshipVariants.isPending &&
          !geneVariants.some((hit) => hit.id === picked) ? (
            <span
              className="flex h-10 items-center rounded-md border border-foreground bg-active px-3.5 font-mono text-base font-medium text-foreground"
              translate="no"
            >
              {variantLabel(picked)}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          type="submit"
          size="lg"
          disabled={!canStart}
          className="h-10 px-5 text-sm"
        >
          <PlayIcon data-icon="inline-start" />
          {start.isPending ? "Starting" : "Run"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          aria-expanded={optionsOpen}
          aria-controls={`${fieldId}-options`}
          onClick={() => setOptionsToggled(!optionsOpen)}
          className="h-10"
        >
          Options
          <ChevronDownIcon
            data-icon="inline-end"
            className={cn("transition-transform", optionsOpen && "rotate-180")}
          />
        </Button>
        {apiState !== "ready" ? (
          <p role="status" className="text-sm text-muted-foreground">
            {API_NOTE[apiState]}
          </p>
        ) : null}
      </div>

      <div
        id={`${fieldId}-options`}
        hidden={!optionsOpen}
        className="divide-y divide-border-subtle border-y border-border"
      >
        <Field
          label="Other variant"
          htmlFor={`${fieldId}-variant`}
          hint="One missense variant per run."
        >
          <Input
            id={`${fieldId}-variant`}
            type="search"
            value={text}
            placeholder="BTK R28H"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setText(event.target.value)}
            className="max-w-md"
          />
          {needle.length === 0 ? null : (
            <div
              className="scroll-thin max-h-[8.75rem] max-w-2xl overflow-y-auto border border-border-subtle"
              role="radiogroup"
              aria-label="Variants matching the search"
            >
              {search.isPending ? (
                <RowsSkeleton rows={3} />
              ) : search.isError ? (
                <QueryErrorState
                  error={search.error}
                  subject={`variants matching ${needle}`}
                  onRetry={() => void search.refetch()}
                  retrying={search.isFetching}
                  size="inline"
                />
              ) : hits.length === 0 ? (
                <p className="px-2.5 py-2 text-xs text-muted-foreground">
                  No protein substitution matches{" "}
                  <span className="font-mono text-foreground">{needle}</span>.
                </p>
              ) : (
                hits.map((hit) => {
                  const selected = hit.id === selectedId;
                  return (
                    <button
                      key={hit.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setPicked(hit.id)}
                      className={cn(
                        "grid min-h-7 w-full grid-cols-[0.75rem_11rem_minmax(0,1fr)] items-center gap-x-2.5 border-b border-border-subtle px-2.5 py-1 text-left text-xs outline-offset-[-2px] last:border-b-0 hover:bg-accent",
                        selected &&
                          "bg-active shadow-[inset_2px_0_0_var(--foreground)]",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "size-2 rounded-full border border-border-strong",
                          selected && "border-foreground bg-foreground",
                        )}
                      />
                      <span
                        className="truncate font-mono text-foreground"
                        translate="no"
                      >
                        {variantLabel(hit.id)}
                      </span>
                      <span className="truncate text-muted-foreground">
                        {hit.description ?? hit.match_reason}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </Field>

        <Field
          label="Objective"
          htmlFor={`${fieldId}-objective`}
          hint="Empty uses the lab's question."
        >
          <Textarea
            id={`${fieldId}-objective`}
            value={objective}
            maxLength={600}
            placeholder={DEFAULT_OBJECTIVE}
            onChange={(event) => setObjective(event.target.value)}
            className="max-w-2xl"
          />
        </Field>

        <Field label="Mode" hint={MODE_NOTE[mode]}>
          <ToggleGroup
            variant="outline"
            spacing={0}
            value={[mode]}
            onValueChange={(value) => {
              const next = value[0];
              if (next && (RUN_MODES as readonly string[]).includes(next))
                setMode(next as RunMode);
            }}
            aria-label="Mode"
          >
            {RUN_MODES.map((option) => (
              <ToggleGroupItem key={option} value={option}>
                {modeLabel(option)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>

        <Field
          label="Budget"
          hint="The planner chooses its test inside it. Empty uses the default."
        >
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
            <label className="flex flex-col gap-1 text-2xs text-muted-foreground">
              Tool calls
              <Input
                inputMode="numeric"
                value={maxToolCalls}
                placeholder={
                  defaultBudget?.max_tool_calls?.toString() ?? "default"
                }
                aria-invalid={toolCalls === "invalid"}
                onChange={(event) => setMaxToolCalls(event.target.value)}
                className="w-32 font-mono"
              />
            </label>
            <label className="flex flex-col gap-1 text-2xs text-muted-foreground">
              Compute seconds
              <Input
                inputMode="numeric"
                value={maxComputeSeconds}
                placeholder={
                  defaultBudget?.max_compute_seconds?.toString() ?? "default"
                }
                aria-invalid={computeSeconds === "invalid"}
                onChange={(event) => setMaxComputeSeconds(event.target.value)}
                className="w-32 font-mono"
              />
            </label>
          </div>
          {budgetInvalid ? (
            <p role="alert" className="text-xs text-destructive">
              Tool calls: a whole number from {TOOL_CALL_LIMITS.minimum} to{" "}
              {TOOL_CALL_LIMITS.maximum}. Compute seconds: from{" "}
              {COMPUTE_SECOND_LIMITS.minimum} to {COMPUTE_SECOND_LIMITS.maximum}
              .
            </p>
          ) : null}
        </Field>
      </div>
    </form>
  );
}
