"use client";

import { XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { DataTable, type DataTableColumn } from "@/components/data/data-table";
import { KeyHint } from "@/components/data/key-hint";
import { SectionHeader } from "@/components/data/section-header";
import { TextLink } from "@/components/data/text-link";
import { ClaimLabel } from "@/components/evidence/evidence-badge";
import { JobStatusTag, stageProgressText } from "@/components/jobs/job-status";
import { RunJobButton } from "@/components/jobs/run-job";
import { AddToProjectButton } from "@/components/project/add-to-project";
import { Disclosure } from "@/components/protein/disclosure";
import { LearnTerm } from "@/components/science/learn-term";
import { EmptyState } from "@/components/states/empty-state";
import { QueryErrorState, RowsSkeleton } from "@/components/states/query-state";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  SubjectBarActions,
  WorkspaceZones,
  Zone,
  useAxisDock,
  useWorkspaceSubject,
} from "@/components/workspace";
import { aminoAcidName, routes, toThreeLetter } from "@/lib/ids";
import { setWorkspaceHover } from "@/lib/state/hover";
import { startJobWatcher, useJobs, type JobOut } from "@/lib/state/jobs";
import {
  COMPARE_WORDS,
  DETAILS_LABEL,
  plainChange,
  plainMutationRow,
  plainSpot,
} from "@/lib/plain-language";
import { useAdvancedMode } from "@/lib/state/preferences";
import {
  resolveColorMode,
  useWorkspaceSelection,
  type ColorMode,
  type CompareMode,
} from "@/lib/state/selection";
import { withSelection } from "@/lib/state/selection-url";
import { useReportSources } from "@/lib/state/shell";
import { compareSubjectsFromUrl } from "@/lib/subject-refs";
import {
  mergeSources,
  subjectChain,
  useComparePlan,
  useCompareResult,
  useGene,
  useProteinAxis,
  useProteinColorings,
  useVariant,
  type ComparePlanResponse,
  type CompareResultResponse,
} from "@/lib/workspace-data";

import { CaveatLine, CompareInstrument } from "./compare-instrument";
import {
  comparisonTracks,
  constructRange,
  formatAngstrom,
  largestDisplacement,
  modelEvidence,
  type DisplacementScale,
  type ProviderOption,
  type ShownModels,
} from "./model";
import { ResidueInspectorBody } from "./residue-inspector";

const MODES: Array<[CompareMode, string]> = [
  ["split", "Split"],
  ["overlay", "Overlay"],
  ["difference", "Difference"],
];

const PLAIN_MODES: Record<CompareMode, string> = {
  split: COMPARE_WORDS.sideBySide,
  overlay: COMPARE_WORDS.overlaid,
  difference: COMPARE_WORDS.difference,
};

const SPLIT_COLORS: Array<[ColorMode, string]> = [
  ["confidence", "Confidence"],
  ["domain", "Domain"],
  ["secondary-structure", "Secondary structure"],
];

interface ResidueRow extends Record<string, unknown> {
  id: string;
  position: number;
  residue: string;
  displacement: number | null;
  masked: boolean;
  plddtReference: number;
  plddtVariant: number;
  context: string | null;
}

function residueRows(result: CompareResultResponse): ResidueRow[] {
  const { difference, variant } = result;
  const gained = new Set(difference.contacts.gained);
  const lost = new Set(difference.contacts.lost);
  const kept = new Set(difference.contacts.kept);
  const near = new Set(
    difference.neighbours.residues.map((entry) => entry.position),
  );
  return difference.per_residue.map((entry) => {
    const isSite = entry.position === variant.position;
    const reference =
      toThreeLetter(entry.reference_residue) ?? entry.reference_residue;
    return {
      id: String(entry.position),
      position: entry.position,
      residue: isSite
        ? `${reference}${entry.position}${toThreeLetter(entry.variant_residue) ?? entry.variant_residue}`
        : `${reference}${entry.position}`,
      displacement: entry.masked ? null : entry.ca_displacement,
      masked: entry.masked,
      plddtReference: entry.plddt_reference,
      plddtVariant: entry.plddt_variant,
      context: isSite
        ? "site"
        : gained.has(entry.position)
          ? "+ contact"
          : lost.has(entry.position)
            ? "− contact"
            : kept.has(entry.position)
              ? "contact"
              : near.has(entry.position)
                ? `≤ ${difference.neighbours.radius} Å`
                : null,
    };
  });
}

const COLUMNS: DataTableColumn<ResidueRow>[] = [
  {
    id: "position",
    header: "Res",
    width: 76,
    mono: true,
    accessor: (row) => row.position,
    cell: (row) => row.residue,
  },
  {
    id: "displacement",
    header: <span title="Cα displacement after superposition, Å">Shift</span>,
    width: 76,
    align: "right",
    accessor: (row) => row.displacement,
    cell: (row) =>
      row.displacement === null ? (
        <span className="font-sans text-subtle-foreground">masked</span>
      ) : (
        row.displacement.toFixed(3)
      ),
  },
  {
    id: "plddt",
    header: (
      <span title="pLDDT in the reference model / in the variant model">
        pLDDT
      </span>
    ),
    width: 80,
    align: "right",
    accessor: (row) => Math.min(row.plddtReference, row.plddtVariant),
    cell: (row) =>
      `${row.plddtReference.toFixed(0)}/${row.plddtVariant.toFixed(0)}`,
  },
  {
    id: "context",
    header: (
      <span title="Relation to the variant site in the two models">At site</span>
    ),
    width: "minmax(4.5rem,1fr)",
    accessor: (row) => row.context,
    cell: (row) =>
      row.context ?? <span className="text-subtle-foreground">·</span>,
  },
];

function JobLines({ jobs }: { jobs: JobOut[] }) {
  if (jobs.length === 0) return null;
  return (
    <ul data-slot="comparison-jobs" className="border-b border-border-subtle">
      {jobs.map((job) => {
        const stage = job.stages.find(
          (entry) => entry.id === job.current_stage,
        );
        return (
          <li
            key={job.id}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-1.5 text-xs"
          >
            <JobStatusTag status={job.status} />
            <span className="text-foreground">
              {stage?.label ?? job.current_stage ?? "Waiting for a worker"}
            </span>
            {stage && stageProgressText(stage) ? (
              <span className="tabular font-mono text-muted-foreground">
                {stageProgressText(stage)}
              </span>
            ) : null}
            <TextLink href={routes.job(job.id)} className="ml-auto font-mono">
              {job.id.slice(0, 12)}
            </TextLink>
          </li>
        );
      })}
    </ul>
  );
}

function ProviderRow({
  provider,
  jobKind,
}: {
  provider: ProviderOption;
  jobKind: string;
}) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 border-b border-border-subtle px-3 py-2 text-xs last:border-b-0">
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium text-foreground">{provider.name}</span>
          <span className="font-mono text-2xs text-muted-foreground">
            {[
              provider.model_version,
              provider.execution_mode.replaceAll("_", " "),
              provider.max_residues
                ? `up to ${provider.max_residues} residues`
                : null,
              provider.performs_inference
                ? "runs a model"
                : "retrieval only, no model is run",
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </p>
        {provider.can_run ? (
          <p className="mt-0.5 text-muted-foreground">
            Can run
            {provider.construct
              ? ` on residues ${constructRange(provider.construct)}. ${provider.construct.rationale}`
              : "."}
          </p>
        ) : (
          <p className="mt-0.5 text-muted-foreground">
            Cannot run. {provider.reasons.join(" ") || "No reason reported."}
          </p>
        )}
      </div>
      {provider.can_run ? (
        <RunJobButton
          kind={jobKind}
          params={provider.job_params ?? undefined}
          label={provider.performs_inference ? "Run comparison" : "Load cached"}
          size="sm"
        />
      ) : (
        <span className="pt-0.5 text-2xs text-subtle-foreground">
          Unavailable
        </span>
      )}
    </li>
  );
}

function NoComparison({
  plan,
  jobs,
  simple,
}: {
  plan: ComparePlanResponse;
  jobs: JobOut[];
  simple: boolean;
}) {
  const { variant, proposed_construct: construct } = plan;
  const runnable = plan.providers.some((provider) => provider.can_run);
  const first = plan.providers.find((provider) => provider.can_run);
  if (simple)
    return (
      <div data-slot="no-comparison" className="mx-auto max-w-xl py-10">
        <div className="flex flex-col items-start gap-3 px-4 pb-6">
          <h2 className="text-base font-medium text-foreground">
            {COMPARE_WORDS.none}
          </h2>
          <p className="text-sm text-muted-foreground">
            {jobs.length
              ? COMPARE_WORDS.running
              : first
                ? `${first.name} can predict both shapes.`
                : COMPARE_WORDS.cannotRun}
          </p>
          {jobs.length ? null : first ? (
            <RunJobButton
              kind={plan.job_kind}
              params={first.job_params ?? { variant_id: variant.variant_id }}
              label={
                first.performs_inference
                  ? COMPARE_WORDS.run
                  : COMPARE_WORDS.loadSaved
              }
              variant="default"
            />
          ) : null}
        </div>
        <JobLines jobs={jobs} />
        <Disclosure label={DETAILS_LABEL}>
          <ul>
            {plan.providers.map((provider) => (
              <ProviderRow
                key={provider.id}
                provider={provider}
                jobKind={plan.job_kind}
              />
            ))}
          </ul>
          {construct ? (
            <p className="px-3 py-2 text-xs leading-5 text-muted-foreground">
              <span className="tabular font-mono text-foreground">
                {variant.uniprot_accession} residues {constructRange(construct)}
              </span>
              . {construct.rationale}
            </p>
          ) : null}
        </Disclosure>
      </div>
    );
  return (
    <div data-slot="no-comparison" className="mx-auto max-w-3xl py-4">
      <div className="px-3 pb-3">
        <h2 className="text-sm font-medium text-foreground">
          No comparison computed for {variant.gene_symbol} {variant.hgvs_p}
        </h2>
        <p className="mt-1 max-w-prose text-xs leading-5 text-muted-foreground">
          A comparison sends the reference sequence and the sequence carrying
          the substitution to the same structure predictor with the same
          settings, superposes the two{" "}
          <LearnTerm term="predicted-structure">predicted models</LearnTerm> and
          reports per-residue geometry. No stored result exists for this
          variant, so there are no models to show.{" "}
          {plan.reference_check.message}
        </p>
      </div>

      {jobs.length ? (
        <>
          <SectionHeader title="Run in progress" count={jobs.length} />
          <JobLines jobs={jobs} />
          <p className="px-3 py-1.5 text-2xs text-subtle-foreground">
            The result loads here when the run finishes. The rest of the page
            stays usable.
          </p>
        </>
      ) : null}

      <SectionHeader
        title="Providers"
        count={plan.providers.length}
        actions={
          runnable ? null : (
            <RunJobButton
              kind={plan.job_kind}
              params={{ variant_id: variant.variant_id }}
              label="Open run dialog"
              size="xs"
              variant="ghost"
            />
          )
        }
      />
      <ul>
        {plan.providers.map((provider) => (
          <ProviderRow
            key={provider.id}
            provider={provider}
            jobKind={plan.job_kind}
          />
        ))}
      </ul>

      {construct ? (
        <>
          <SectionHeader title="Proposed construct" />
          <p className="px-3 py-2 text-xs leading-5 text-muted-foreground">
            <span className="tabular font-mono text-foreground">
              {variant.uniprot_accession} residues {constructRange(construct)}
            </span>
            . {construct.rationale}
          </p>
        </>
      ) : null}
    </div>
  );
}

export interface CompareStageProps {
  /** HGNC symbol from the URL */
  gene: string;
  /** protein change from the URL, e.g. "p.Arg28His" */
  change: string;
}

/** Stage 4: the reference model and the variant model of one substitution, side by side. */
export function CompareStage({ gene, change }: CompareStageProps) {
  const plan = useComparePlan(gene, change);
  const planData = plan.data?.data ?? null;
  const variant = planData?.variant ?? null;
  const accession = variant?.uniprot_accession ?? null;

  const [chosenResult, setChosenResult] = useState<string | null>(null);
  const results = planData?.results ?? [];
  const summary =
    results.find((entry) => entry.result_id === chosenResult) ??
    results[0] ??
    null;
  const resultQuery = useCompareResult(summary?.result_id);
  const result = resultQuery.data?.data ?? null;

  const geneRecord = useGene(gene);
  const variantRecord = useVariant(variant?.variant_id);
  const axis = useProteinAxis(accession, { gene, feed: false });
  const { colorings, domains } = useProteinColorings(accession);

  const ranges = useWorkspaceSelection((state) => state.ranges);
  const mode = useWorkspaceSelection((state) => state.compareMode);
  const colorMode = useWorkspaceSelection((state) => state.colorMode);
  const setCompareMode = useWorkspaceSelection((state) => state.setCompareMode);
  const setColorMode = useWorkspaceSelection((state) => state.setColorMode);
  const selectResidue = useWorkspaceSelection((state) => state.selectResidue);
  const snapshot = useWorkspaceSelection();

  const [shown, setShown] = useState<ShownModels>("both");
  const [scale, setScale] = useState<DisplacementScale>("fixed");
  const simple = !useAdvancedMode();
  const [siteDetails, setSiteDetails] = useState(false);

  useWorkspaceSubject({
    ...compareSubjectsFromUrl(gene, change),
    ...subjectChain({
      gene: geneRecord.data?.data,
      protein: axis.protein ?? accession ?? undefined,
      variant: variantRecord.data?.data,
      structure: result
        ? shown === "reference"
          ? result.reference_model
          : result.variant_model
        : undefined,
    }),
  });

  const dock = useMemo(() => {
    if (!axis.data) return null;
    if (!result) return axis.data;
    const tracks = [...axis.data.tracks];
    const after = tracks.findIndex((track) => track.kind === "domain") + 1;
    tracks.splice(
      after,
      0,
      ...comparisonTracks(result, axis.data.sequence.length),
    );
    return { ...axis.data, tracks };
  }, [axis.data, result]);
  useAxisDock(dock, { loadingAccession: axis.isPending ? accession : null });

  const planSources = plan.data?.sources;
  const resultSources = resultQuery.data?.sources;
  const sources = useMemo(
    () => mergeSources(axis.sources, planSources ?? [], resultSources ?? []),
    [axis.sources, planSources, resultSources],
  );
  useReportSources("compare-page", sources);

  // the variant site is the default selection; a residue carried in the URL wins
  const variantId = variant?.variant_id;
  useEffect(() => {
    if (!variant) return;
    const state = useWorkspaceSelection.getState();
    if (state.ranges.length === 0)
      state.selectVariant({
        reference: variant.reference,
        position: variant.position,
        alternate: variant.alternate,
        sourceId: null,
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantId]);

  // Difference colours by displacement; Overlay starts from the reference and variant tokens.
  useEffect(() => {
    const state = useWorkspaceSelection.getState();
    if (mode === "difference") {
      if (state.colorMode !== "reference-variant")
        state.setColorMode("reference-variant");
    } else if (mode === "overlay" || state.colorMode === "reference-variant") {
      if (state.colorMode !== null) state.setColorMode(null);
    }
  }, [mode]);
  useEffect(
    () => () => {
      const state = useWorkspaceSelection.getState();
      if (state.colorMode === "reference-variant") state.setColorMode(null);
    },
    [],
  );

  const activeJobs = useJobs((state) => state.active);
  const revision = useJobs((state) => state.revision);
  const jobs = useMemo(
    () =>
      activeJobs.filter(
        (job) =>
          job.kind === (planData?.job_kind ?? "variant_comparison") &&
          job.params.variant_id === variantId,
      ),
    [activeJobs, planData?.job_kind, variantId],
  );
  const watched = useRef(new Set<string>());
  useEffect(() => startJobWatcher(), []);
  useEffect(() => {
    for (const job of jobs) watched.current.add(job.id);
  }, [jobs]);
  const refetchPlan = plan.refetch;
  useEffect(() => {
    if (revision === 0) return;
    void refetchPlan().then((next) => {
      const finished = next.data?.data.results.find((entry) =>
        watched.current.has(entry.result_id),
      );
      if (finished) setChosenResult(finished.result_id);
    });
  }, [revision, refetchPlan]);

  const rows = useMemo(() => (result ? residueRows(result) : []), [result]);
  const position =
    ranges.length === 1 && ranges[0].start === ranges[0].end
      ? ranges[0].start
      : null;
  const sequence = axis.data?.sequence ?? null;
  const selectedLetter =
    position && variant
      ? (sequence?.[position - 1] ??
        (position === variant.position ? variant.reference : null))
      : null;
  const isSite = Boolean(variant && position === variant.position);

  const topShifts = useMemo(
    () =>
      rows
        .filter((row) => !row.masked && row.displacement !== null)
        .sort(
          (left, right) => (right.displacement ?? 0) - (left.displacement ?? 0),
        )
        .slice(0, 8),
    [rows],
  );

  const route = withSelection(routes.compare(gene, change), snapshot);
  const changeMode = (next: CompareMode) => {
    setCompareMode(next);
    if (next === "difference" && shown === "both") setShown("reference");
  };
  const splitColor = resolveColorMode(colorMode, "predicted_orphafold");

  if (plan.isPending)
    return (
      <WorkspaceZones
        layoutId="compare"
        instrument={
          <Zone zone="instrument" title="Reference and variant">
            <RowsSkeleton rows={6} />
          </Zone>
        }
      />
    );
  if (plan.isError || !planData || !variant)
    return (
      <WorkspaceZones
        layoutId="compare"
        instrument={
          <Zone
            zone="instrument"
            title={simple ? COMPARE_WORDS.title : "Reference and variant"}
          >
            <QueryErrorState
              error={plan.error}
              subject={`the comparison plan for ${gene} ${change}`}
              onRetry={() => void plan.refetch()}
            />
          </Zone>
        }
      />
    );

  const variantLabel = `${variant.gene_symbol} ${variant.hgvs_p}`;
  const canRunInference = planData.providers.some(
    (provider) => provider.can_run && provider.performs_inference,
  );
  const largest = result ? largestDisplacement(result.difference) : 0;
  const compared = rows.filter((row) => !row.masked).length;
  const siteDomain = planData.domains.find(
    (entry) => variant.position >= entry.start && variant.position <= entry.end,
  );
  const inspecting =
    position !== null && (position !== variant.position || siteDetails);

  const modeToggle = (
    <ToggleGroup
      size="sm"
      variant="outline"
      spacing={0}
      aria-label="Comparison mode"
      value={[mode]}
      onValueChange={(value) => {
        if (value.length) changeMode(value[0] as CompareMode);
      }}
    >
      {MODES.map(([value, label]) => (
        <ToggleGroupItem key={value} value={value}>
          {simple ? PLAIN_MODES[value] : label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );

  return (
    <>
      <SubjectBarActions>
        {simple && result ? null : (
        <AddToProjectButton
          size="sm"
          variant="ghost"
          label={simple ? undefined : "Add variant"}
          item={{
            kind: "variant",
            ref: variant.variant_id ?? `${gene}-${change}`,
            label: variantLabel,
            origin: { route },
            data: {
              uniprot_accession: variant.uniprot_accession,
              position: variant.position,
            },
          }}
        />
        )}
        {result ? (
          <AddToProjectButton
            size="sm"
            variant="ghost"
            label={simple ? undefined : "Add comparison"}
            item={{
              kind: "job",
              ref: result.job_id,
              label: `Comparison ${variantLabel}, ${result.provider.model_name ?? result.provider.name}`,
              origin: { route, note: result.label },
              evidence: [modelEvidence(result, result.title)],
              data: {
                reference_structure: result.reference_model.id,
                variant_structure: result.variant_model.id,
                construct: constructRange(result.construct),
                summary: result.difference.summary,
              },
            }}
          />
        ) : null}
      </SubjectBarActions>
      <WorkspaceZones
        layoutId="compare"
        ledgerLabel={simple ? "Variant" : "Changed residues"}
        inspectorLabel="Residue"
        ledger={
          simple ? (
            <Zone zone="ledger" title={variant.gene_symbol}>
              <div className="flex flex-col items-start gap-3 px-4 py-4">
                <div className="flex flex-col gap-1">
                  <p
                    className="text-base font-medium text-foreground"
                    title={variant.hgvs_p}
                  >
                    {plainChange(
                      aminoAcidName(variant.reference),
                      aminoAcidName(variant.alternate),
                      variant.position,
                    ) ?? plainMutationRow(variant.hgvs_p)}
                  </p>
                  {siteDomain ? (
                    <p className="text-xs text-muted-foreground">
                      In the {siteDomain.name} region
                    </p>
                  ) : null}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  data-action="site-details"
                  onClick={() => {
                    selectResidue(variant.position);
                    setSiteDetails(true);
                  }}
                >
                  {DETAILS_LABEL}
                </Button>
              </div>
              {!summary ? null : resultQuery.isPending ? (
                <RowsSkeleton rows={6} />
              ) : resultQuery.isError || !result ? (
                <QueryErrorState
                  error={resultQuery.error}
                  subject={`comparison result ${summary.result_id}`}
                  onRetry={() => void resultQuery.refetch()}
                />
              ) : (
                <div className="flex flex-col border-t border-border-subtle py-3">
                  <span className="flex items-center gap-2 px-4 pb-1 text-2xs text-subtle-foreground">
                    {COMPARE_WORDS.movedMost}
                    <ClaimLabel
                      evidenceClass="computational_prediction"
                      className="sr-only"
                    />
                  </span>
                  <ul>
                    {topShifts.map((row) => (
                      <li key={row.id}>
                        <button
                          type="button"
                          aria-pressed={position === row.position}
                          onClick={() => selectResidue(row.position)}
                          onMouseEnter={() =>
                            accession
                              ? setWorkspaceHover({
                                  accession,
                                  position: row.position,
                                  origin: "ledger",
                                })
                              : undefined
                          }
                          onMouseLeave={() => setWorkspaceHover(null)}
                          className="flex h-8 w-full cursor-pointer items-center gap-2 px-4 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset aria-pressed:bg-active"
                        >
                          <span className="min-w-0 flex-1 truncate text-foreground">
                            {plainSpot(sequence?.[row.position - 1], row.position)}
                          </span>
                          <span
                            className="tabular shrink-0 font-mono text-xs text-muted-foreground"
                            title={COMPARE_WORDS.angstrom}
                          >
                            {formatAngstrom(row.displacement ?? 0)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <JobLines jobs={jobs} />
                </div>
              )}
            </Zone>
          ) : (
          <Zone
            zone="ledger"
            title="Changed residues"
            count={result ? compared : null}
            scroll={false}
            actions={
              result && canRunInference ? (
                <RunJobButton
                  kind={planData.job_kind}
                  params={{ variant_id: variant.variant_id }}
                  label="New run"
                  size="xs"
                  variant="ghost"
                />
              ) : null
            }
            footer={<KeyHint keys="enter" label="Select residue" />}
          >
            {!summary ? (
              <EmptyState
                title="No comparison computed"
                description="Residues ranked by Cα displacement appear here once a run exists."
              />
            ) : resultQuery.isPending ? (
              <RowsSkeleton rows={8} />
            ) : resultQuery.isError || !result ? (
              <QueryErrorState
                error={resultQuery.error}
                subject={`comparison result ${summary.result_id}`}
                onRetry={() => void resultQuery.refetch()}
              />
            ) : (
              <div className="flex h-full min-h-0 flex-col">
                <div className="shrink-0">
                  <SectionHeader
                    title="Result"
                    actions={
                      <ClaimLabel
                        evidenceClass="computational_prediction"
                        className="text-2xs"
                      />
                    }
                  />
                  <p className="px-3 pt-1.5 text-2xs leading-4 text-muted-foreground">
                    {result.label}
                  </p>
                  <p className="px-3 pt-1 pb-1.5 text-2xs leading-4 text-subtle-foreground">
                    Largest Cα displacement{" "}
                    <span className="tabular font-mono text-foreground">
                      {formatAngstrom(largest, 3)}
                    </span>{" "}
                    among {compared} compared residues;{" "}
                    {result.difference.masking.masked_residues} masked.{" "}
                    {
                      result.caveats.find(
                        (entry) => entry.id === "similar_fold_is_uninformative",
                      )?.text
                    }
                  </p>
                  {results.length > 1 ? (
                    <div className="flex flex-wrap gap-1 px-3 pb-1.5">
                      {results.map((entry) => (
                        <Button
                          key={entry.result_id}
                          size="xs"
                          variant={
                            entry.result_id === summary.result_id
                              ? "secondary"
                              : "ghost"
                          }
                          onClick={() => setChosenResult(entry.result_id)}
                        >
                          {entry.provider.model_name ?? entry.provider.name}{" "}
                          {entry.generated_at?.slice(0, 10)}
                          {entry.origin === "cached_example" ? " cached" : ""}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                  <JobLines jobs={jobs} />
                </div>
                <div className="min-h-0 flex-1 border-t border-border-subtle">
                  <DataTable
                    label={`Residues of the ${variantLabel} comparison`}
                    columns={COLUMNS}
                    data={rows}
                    getRowId={(row) => row.id}
                    selectedRowId={position ? String(position) : null}
                    onRowSelect={(row) => selectResidue(row.position)}
                    onRowHover={(row) =>
                      setWorkspaceHover(
                        row && accession
                          ? {
                              accession,
                              position: row.position,
                              origin: "ledger",
                            }
                          : null,
                      )
                    }
                    defaultSort={{ id: "displacement", desc: true }}
                    groupBy={(row) => (row.masked ? "masked" : "compared")}
                    groupOrder={["compared", "masked"]}
                    groupLabel={(group) =>
                      group === "masked"
                        ? `Masked: pLDDT below ${result.difference.masking.plddt_threshold} in either model`
                        : "Compared"
                    }
                  />
                </div>
              </div>
            )}
          </Zone>
          )
        }
        instrument={
          <Zone
            zone="instrument"
            title={simple ? COMPARE_WORDS.title : planData.title}
            scroll={!summary}
            actions={
              summary ? (
                <div className={simple ? undefined : "hidden sm:block"}>
                  {modeToggle}
                </div>
              ) : null
            }
            toolbar={
              !summary || simple ? undefined : mode === "split" ? (
                <>
                  <div className="sm:hidden">{modeToggle}</div>
                  <span className="text-2xs text-muted-foreground">Colour</span>
                  <ToggleGroup
                    size="sm"
                    variant="outline"
                    spacing={0}
                    aria-label="Colour both models by"
                    value={[splitColor]}
                    onValueChange={(value) => {
                      if (value.length) setColorMode(value[0] as ColorMode);
                    }}
                  >
                    {SPLIT_COLORS.map(([value, label]) => (
                      <ToggleGroupItem key={value} value={value}>
                        {label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </>
              ) : (
                <>
                  <div className="sm:hidden">{modeToggle}</div>
                  <span className="text-2xs text-muted-foreground">Show</span>
                  <ToggleGroup
                    size="sm"
                    variant="outline"
                    spacing={0}
                    aria-label="Models shown"
                    value={[shown]}
                    onValueChange={(value) => {
                      if (value.length) setShown(value[0] as ShownModels);
                    }}
                  >
                    {mode === "overlay" ? (
                      <ToggleGroupItem value="both">Both</ToggleGroupItem>
                    ) : null}
                    <ToggleGroupItem value="reference">
                      Reference
                    </ToggleGroupItem>
                    <ToggleGroupItem value="variant">Variant</ToggleGroupItem>
                  </ToggleGroup>
                  {mode === "difference" ? (
                    <>
                      <span className="ml-2 text-2xs text-muted-foreground">
                        Scale
                      </span>
                      <ToggleGroup
                        size="sm"
                        variant="outline"
                        spacing={0}
                        aria-label="Displacement colour scale"
                        value={[scale]}
                        onValueChange={(value) => {
                          if (value.length)
                            setScale(value[0] as DisplacementScale);
                        }}
                      >
                        <ToggleGroupItem value="fixed">
                          Fixed 0 to 2 Å
                        </ToggleGroupItem>
                        <ToggleGroupItem value="data">
                          Data range
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </>
                  ) : null}
                </>
              )
            }
            footer={
              <CaveatLine
                caveats={result?.caveats ?? planData.caveats}
                simple={simple}
              />
            }
          >
            {!summary ? (
              <NoComparison plan={planData} jobs={jobs} simple={simple} />
            ) : resultQuery.isPending ? (
              <RowsSkeleton rows={6} />
            ) : resultQuery.isError || !result ? (
              <QueryErrorState
                error={resultQuery.error}
                subject={`comparison result ${summary.result_id}`}
                onRetry={() => void resultQuery.refetch()}
              />
            ) : (
              <CompareInstrument
                key={`${result.job_id}:${mode}:${simple ? "simple" : "full"}`}
                simple={simple}
                result={result}
                mode={mode}
                shown={
                  mode === "difference" && shown === "both"
                    ? "reference"
                    : shown
                }
                scale={scale}
                colorings={colorings}
                domains={domains}
              />
            )}
          </Zone>
        }
        inspector={
          simple && !inspecting ? undefined : (
          <Zone
            zone="inspector"
            title={
              position && selectedLetter
                ? simple
                  ? isSite
                    ? plainMutationRow(variant.hgvs_p)
                    : plainSpot(selectedLetter, position)
                  : isSite
                    ? `${toThreeLetter(variant.reference)}${position} → ${toThreeLetter(variant.alternate)}`
                    : `${toThreeLetter(selectedLetter) ?? selectedLetter}${position}`
                : "Residue"
            }
            detail={
              simple ? null : position ? (
                <span className="text-2xs text-muted-foreground">
                  {isSite
                    ? "variant site"
                    : selectedLetter
                      ? aminoAcidName(selectedLetter)
                      : null}
                </span>
              ) : null
            }
            actions={
              simple ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Close"
                  title="Close"
                  onClick={() => {
                    setSiteDetails(false);
                    selectResidue(variant.position);
                  }}
                >
                  <XIcon />
                </Button>
              ) : undefined
            }
            footer={
              simple ? undefined : <KeyHint keys="i" label="Hide inspector" />
            }
          >
            {position ? (
              <ResidueInspectorBody
                plan={planData}
                result={result}
                sequence={sequence}
                position={position}
                simple={simple}
              />
            ) : (
              <EmptyState
                title="No residue selected"
                description="Click a residue in a model, in the table or on the sequence axis."
                actions={
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => selectResidue(variant.position)}
                  >
                    Select the variant site
                  </Button>
                }
              />
            )}
          </Zone>
          )
        }
      />
    </>
  );
}
