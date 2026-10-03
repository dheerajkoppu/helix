"use client";

import {
  ArrowRightIcon,
  CrosshairIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ButtonLink } from "@/components/data/button-link";
import {
  DefinitionList,
  DefinitionRow,
} from "@/components/data/definition-list";
import { ExternalLink } from "@/components/data/external-link";
import { MonoId } from "@/components/data/mono-id";
import { SectionHeader } from "@/components/data/section-header";
import { TextLink } from "@/components/data/text-link";
import { EvidenceBadge } from "@/components/evidence/evidence-badge";
import { RunJobButton } from "@/components/jobs/run-job";
import { LiteraturePanel } from "@/components/literature/literature-panel";
import { AddToProjectButton } from "@/components/project/add-to-project";
import { LearnTerm } from "@/components/science/learn-term";
import { ClinicalSignificanceChip } from "@/components/science/legends";
import { MetricReadout } from "@/components/science/metric-readout";
import {
  ModelResultStrip,
  type ModelResultStripProps,
} from "@/components/science/model-result-strip";
import { EmptyState } from "@/components/states/empty-state";
import { QueryErrorState, RowsSkeleton } from "@/components/states/query-state";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  SubjectBarActions,
  WorkspaceZones,
  Zone,
  useWorkspaceSubject,
} from "@/components/workspace";
import { formatDate } from "@/lib/format";
import { parseVariantId, routes, toThreeLetter } from "@/lib/ids";
import { parseClinicalSignificance } from "@/lib/science/clinical-significance";
import { useAdvancedMode } from "@/lib/state/preferences";
import { useWorkspaceSelection } from "@/lib/state/selection";
import { useReportSources } from "@/lib/state/shell";
import { variantSubjectsFromUrl } from "@/lib/subject-refs";
import {
  findLedgerStructure,
  mergeSources,
  subjectChain,
  useComparePlan,
  useProteinAxis,
  useResidueEffects,
  useVariant,
  type ComparePlanResponse,
  type ResidueEffectsResponse,
  type StructureLedger,
  type VariantDetail,
} from "@/lib/workspace-data";

import { EffectGroups } from "./effect-groups";
import { EvidenceMark } from "./evidence";
import {
  ClassificationLine,
  ConditionList,
  PopulationObservation,
  ResidueContext,
  VariantRoutes,
  useStagePath,
} from "./shared";
import { StructureInstrument, useShownStructure } from "./structure-pane";

const consequenceText = (term: string | null | undefined) =>
  term ? term.replace(/_/g, " ") : null;

const LISTED_ELSEWHERE = new Set([
  "ClinVar",
  "dbSNP",
  "UniProt",
  "UniProtKB",
  "UniProtKB/Swiss-Prot",
]);

function Identity({ record }: { record: VariantDetail }) {
  const { hgvs, clinvar, vrs, reference_check: check } = record;
  const rsid = clinvar?.rsid ?? record.gnomad.alleles[0]?.rsids[0] ?? null;
  const others = record.cross_references.filter(
    (xref) => !LISTED_ELSEWHERE.has(xref.db),
  );
  const expected = check.expected
    ? (toThreeLetter(check.expected) ?? check.expected)
    : null;
  return (
    <DefinitionList termWidth="6rem">
      <DefinitionRow term="HGVS protein" mono>
        {hgvs.p ? <MonoId value={hgvs.p} /> : null}
      </DefinitionRow>
      <DefinitionRow term="HGVS coding" mono>
        {hgvs.c ? <MonoId value={hgvs.c} /> : null}
      </DefinitionRow>
      <DefinitionRow term="HGVS genomic" mono>
        {hgvs.g ? <MonoId value={hgvs.g} /> : null}
      </DefinitionRow>
      <DefinitionRow term="SPDI" mono>
        {hgvs.spdi ? <MonoId value={hgvs.spdi} /> : null}
      </DefinitionRow>
      <DefinitionRow term="ClinVar">
        {clinvar?.vcv ? (
          <ExternalLink
            href={
              clinvar.url ??
              `https://www.ncbi.nlm.nih.gov/clinvar/variation/${clinvar.vcv}/`
            }
            className="font-mono"
          >
            {clinvar.vcv_version ?? clinvar.vcv}
          </ExternalLink>
        ) : (
          <span className="text-subtle-foreground">No source found</span>
        )}
      </DefinitionRow>
      <DefinitionRow term="dbSNP">
        {rsid ? (
          <ExternalLink
            href={`https://www.ncbi.nlm.nih.gov/snp/${rsid}`}
            className="font-mono"
          >
            {rsid}
          </ExternalLink>
        ) : (
          <span className="text-subtle-foreground">No source found</span>
        )}
      </DefinitionRow>
      <DefinitionRow term="GA4GH VRS">
        {vrs.id ? (
          <>
            <MonoId value={vrs.id} className="break-all" />
            <span className="block text-2xs text-subtle-foreground">
              {[vrs.level, vrs.reference, vrs.method]
                .filter(Boolean)
                .join(". ")}
            </span>
          </>
        ) : (
          <span className="text-subtle-foreground">
            {vrs.message ?? "Not computed"}
          </span>
        )}
      </DefinitionRow>
      {others.length > 0 ? (
        <DefinitionRow term="Other IDs">
          <span className="flex flex-wrap gap-x-2.5 gap-y-0.5">
            {others.map((xref) =>
              xref.url ? (
                <ExternalLink
                  key={`${xref.db}:${xref.id}`}
                  href={xref.url}
                  className="font-mono"
                >
                  {xref.db}:{xref.id}
                </ExternalLink>
              ) : (
                <span key={`${xref.db}:${xref.id}`} className="font-mono">
                  {xref.db}:{xref.id}
                </span>
              ),
            )}
          </span>
        </DefinitionRow>
      ) : null}
      <DefinitionRow term="Reference">
        {check.status === "match" ? (
          <span>
            <span className="font-mono">
              {expected}
              {check.position}
            </span>{" "}
            matches the UniProt sequence of{" "}
            <span className="font-mono">{check.accession}</span>
          </span>
        ) : check.status === "not_checked" ? (
          <span className="text-subtle-foreground">
            {check.message ?? "Not checked against the UniProt sequence"}
          </span>
        ) : (
          <span className="flex items-start gap-1.5">
            <TriangleAlertIcon
              aria-hidden
              className="mt-0.5 size-3 shrink-0 text-warning"
            />
            <span>
              {check.message ??
                `Expected ${check.expected} at ${check.position}, found ${check.found ?? "nothing"} in ${check.accession}.`}
            </span>
          </span>
        )}
      </DefinitionRow>
    </DefinitionList>
  );
}

const SUBMISSIONS_SHOWN = 4;

function Classification({ record }: { record: VariantDetail }) {
  const { clinvar } = record;
  if (!clinvar)
    return (
      <EmptyState
        size="inline"
        title="No ClinVar record"
        description={
          record.clinvar_message ??
          "ClinVar holds no record matching this variant."
        }
        searched={["ClinVar"]}
      />
    );
  const summary = clinvar.submission_summary;
  return (
    <>
      <ClassificationLine
        classification={clinvar.classification}
        reviewStatus={clinvar.review_status}
        reviewStars={clinvar.review_stars}
        lastEvaluated={clinvar.last_evaluated}
        evidence={clinvar.evidence}
      />
      <DefinitionList
        termWidth="6rem"
        className="border-t border-border-subtle"
      >
        <DefinitionRow term="Variant type">
          {clinvar.variant_type}
        </DefinitionRow>
        {summary ? (
          <DefinitionRow term="Submissions">
            <span className="tabular font-mono">{summary.scv_count}</span>{" "}
            submitted records in{" "}
            <span className="tabular font-mono">{summary.rcv_count}</span>{" "}
            condition records
            {summary.by_classification.length > 0 ? (
              <span className="block text-muted-foreground">
                {summary.by_classification
                  .map((row) => `${row.value} ${row.count}`)
                  .join(", ")}
              </span>
            ) : null}
          </DefinitionRow>
        ) : null}
        <DefinitionRow term="Release" mono>
          {record.clinvar_release}
        </DefinitionRow>
      </DefinitionList>
    </>
  );
}

function Submissions({ record }: { record: VariantDetail }) {
  const { clinvar } = record;
  const summary = clinvar?.submission_summary;
  if (!clinvar || !summary) return null;
  return (
    <>
      <SectionHeader
        title="ClinVar submissions"
        count={summary.submissions_loaded ? summary.submissions.length : null}
      />
      {summary.submissions.length > 0 ? (
        <ul className="text-xs">
          {summary.submissions.slice(0, SUBMISSIONS_SHOWN).map((submission) => (
            <li
              key={submission.scv ?? submission.submitter}
              className="border-b border-border-subtle px-3 py-1.5 last:border-b-0"
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-foreground">
                  {submission.submitter ?? "Submitter not named"}
                </span>
                <span className="shrink-0 text-foreground">
                  {submission.classification}
                </span>
              </span>
              <span className="flex items-baseline justify-between gap-2 text-2xs text-subtle-foreground">
                <span className="min-w-0 truncate">
                  {submission.review_status}
                </span>
                <span className="tabular shrink-0 font-mono">
                  {submission.scv}
                  {submission.last_evaluated
                    ? ` ${formatDate(submission.last_evaluated) ?? submission.last_evaluated}`
                    : ""}
                </span>
              </span>
            </li>
          ))}
          {summary.submissions.length > SUBMISSIONS_SHOWN && clinvar.url ? (
            <li className="px-3 py-1.5 text-2xs text-muted-foreground">
              {summary.submissions.length - SUBMISSIONS_SHOWN} more at{" "}
              <ExternalLink href={clinvar.url}>ClinVar</ExternalLink>
            </li>
          ) : null}
        </ul>
      ) : (
        <EmptyState
          size="inline"
          title="Submissions not loaded"
          description={`ClinVar lists ${summary.scv_count} submitted records for this variant.`}
        />
      )}
      {record.other_clinvar_records.length > 0 ? (
        <p className="border-t border-border-subtle px-3 py-1.5 text-xs text-muted-foreground">
          Other ClinVar records with the same protein change:{" "}
          {record.other_clinvar_records.map((other, index) => (
            <span key={other.variation_id}>
              {index > 0 ? ", " : ""}
              {other.url ? (
                <ExternalLink href={other.url} className="font-mono">
                  {other.vcv ?? other.variation_id}
                </ExternalLink>
              ) : (
                <span className="font-mono">
                  {other.vcv ?? other.variation_id}
                </span>
              )}{" "}
              {other.classification}
            </span>
          ))}
        </p>
      ) : null}
    </>
  );
}

const PMIDS_SHOWN = 8;

function UniProtAnnotation({ record }: { record: VariantDetail }) {
  const { uniprot } = record;
  if (!uniprot)
    return (
      <EmptyState
        size="inline"
        title="No UniProt natural-variant annotation"
        searched={["UniProt variants (EBI Proteins API)"]}
      />
    );
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2 text-xs">
      <p className="flex items-start gap-2">
        <EvidenceMark evidence={uniprot.evidence} className="mt-0.5 shrink-0" />
        <span className="min-w-0">
          {uniprot.descriptions.length > 0
            ? uniprot.descriptions.join("; ")
            : "Listed without a description"}
          {uniprot.feature_id ? (
            uniprot.url ? (
              <ExternalLink href={uniprot.url} className="ml-2 font-mono">
                {uniprot.feature_id}
              </ExternalLink>
            ) : (
              <span className="ml-2 font-mono">{uniprot.feature_id}</span>
            )
          ) : null}
        </span>
      </p>
      {uniprot.pmids.length > 0 ? (
        <p className="text-2xs text-muted-foreground">
          Cited by UniProt:{" "}
          {uniprot.pmids.slice(0, PMIDS_SHOWN).map((pmid, index) => (
            <span key={pmid}>
              {index > 0 ? ", " : ""}
              <ExternalLink
                href={`https://pubmed.ncbi.nlm.nih.gov/${pmid}/`}
                className="font-mono"
                bare
              >
                PMID:{pmid}
              </ExternalLink>
            </span>
          ))}
          {uniprot.pmids.length > PMIDS_SHOWN
            ? ` and ${uniprot.pmids.length - PMIDS_SHOWN} more`
            : ""}
        </p>
      ) : null}
    </div>
  );
}

function Consequence({ record }: { record: VariantDetail }) {
  const { vep } = record;
  if (!vep)
    return (
      <EmptyState
        size="inline"
        title="No consequence prediction"
        description="Ensembl VEP returned nothing for this variant."
        searched={["Ensembl VEP"]}
      />
    );
  return (
    <DefinitionList termWidth="6rem">
      <DefinitionRow term="Most severe">
        {consequenceText(vep.most_severe_consequence)}
      </DefinitionRow>
      <DefinitionRow term="VEP impact" mono>
        {vep.impact}
      </DefinitionRow>
      <DefinitionRow term="Transcript" mono>
        {vep.mane_select}
        {vep.is_mane_select ? (
          <span className="ml-2 font-sans text-muted-foreground">
            MANE Select
          </span>
        ) : null}
      </DefinitionRow>
      <DefinitionRow term="Exon" mono>
        {vep.exon}
      </DefinitionRow>
      <DefinitionRow term="Codons" mono>
        {vep.codons}
      </DefinitionRow>
      <DefinitionRow term="Location" mono>
        {vep.chromosome && vep.start
          ? `chr${vep.chromosome}:${vep.start.toLocaleString("en-US")} ${vep.assembly ?? ""}`
          : null}
      </DefinitionRow>
    </DefinitionList>
  );
}

function StructuralAnalysis({
  gene,
  change,
  variantId,
  plan,
  isPending,
  error,
  onRetry,
}: {
  gene: string;
  change: string;
  variantId: string;
  plan: ComparePlanResponse | null;
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const stagePath = useStagePath();
  if (isPending) return <RowsSkeleton rows={2} />;
  if (error || !plan)
    return (
      <QueryErrorState
        size="inline"
        error={error}
        subject={`the comparison plan of ${change}`}
        onRetry={onRetry}
      />
    );
  const runnable = plan.providers.find(
    (provider) => provider.performs_inference && provider.can_run,
  );
  const jobParams = runnable?.job_params ?? { variant_id: variantId };
  const construct = plan.proposed_construct;

  if (plan.results.length === 0)
    return (
      <EmptyState
        size="inline"
        title="No structural comparison exists for this variant"
        description={
          runnable
            ? `A reference and a variant model can be predicted with ${runnable.name}${construct ? ` on residues ${construct.start}-${construct.end}` : ""}. The output is a pair of predictions, labelled as such.`
            : (plan.providers.flatMap((provider) => provider.reasons)[0] ??
              "No structure predictor can run this comparison right now.")
        }
        actions={
          <>
            {runnable ? (
              <RunJobButton
                kind={plan.job_kind}
                params={jobParams}
                label="Generate comparison"
                size="sm"
              />
            ) : null}
            <ButtonLink
              size="sm"
              href={stagePath(routes.compare(gene, change))}
            >
              Open Compare
            </ButtonLink>
          </>
        }
      />
    );

  return (
    <ul className="text-xs">
      {plan.results.map((result) => (
        <li
          key={result.result_id}
          className="flex flex-col gap-1 border-b border-border-subtle px-3 py-2 last:border-b-0"
        >
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <EvidenceBadge evidenceClass="computational_prediction" />
            <span className="font-medium text-foreground">
              {result.provider.name}
            </span>
            <span className="tabular font-mono text-2xs text-muted-foreground">
              residues {result.construct.start}-{result.construct.end}
            </span>
            <span className="text-2xs text-subtle-foreground">
              {result.origin === "cached_example" ? "cached output" : "job"}
            </span>
          </span>
          <span className="text-2xs text-muted-foreground">{result.label}</span>
          <span>
            <TextLink href={stagePath(routes.compare(gene, change))}>
              Open the reference and variant models
            </TextLink>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Beside the onward routes: whether a predicted comparison exists, and the offer to generate one when none does. */
function ComparisonStatus({
  plan,
  variantId,
}: {
  plan: ComparePlanResponse | null;
  variantId: string;
}) {
  if (!plan) return null;
  if (plan.results.length > 0)
    return (
      <span className="text-2xs text-muted-foreground">
        <span className="tabular font-mono text-foreground">
          {plan.results.length}
        </span>{" "}
        predicted comparison{plan.results.length === 1 ? "" : "s"} available
      </span>
    );
  const runnable = plan.providers.find(
    (provider) => provider.performs_inference && provider.can_run,
  );
  return (
    <span className="flex items-center gap-2 text-2xs text-muted-foreground">
      No structural comparison yet
      {runnable ? (
        <RunJobButton
          kind={plan.job_kind}
          params={runnable.job_params ?? { variant_id: variantId }}
          label="Generate"
          size="sm"
        />
      ) : null}
    </span>
  );
}

/** Simple mode: what ClinVar says, the first named condition and whether gnomAD saw the variant. */
function VariantSummary({ record }: { record: VariantDetail }) {
  const { clinvar, gnomad } = record;
  const significance = parseClinicalSignificance(clinvar?.classification);
  const conditions = clinvar?.conditions ?? [];
  const condition =
    conditions.find((entry) => entry.name !== "not provided") ?? conditions[0];
  return (
    <>
      <SectionHeader title="Classification" />
      {clinvar ? (
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-3">
          {significance ? (
            <ClinicalSignificanceChip
              significance={significance}
              long
              className="text-base font-medium"
            />
          ) : (
            <span className="text-base font-medium text-foreground">
              {clinvar.classification ?? "No classification"}
            </span>
          )}
          {clinvar.review_stars !== null ? (
            <span
              className="tabular font-mono text-xs text-muted-foreground"
              title={clinvar.review_status ?? undefined}
            >
              {clinvar.review_stars}/4 review
            </span>
          ) : null}
          <EvidenceMark evidence={clinvar.evidence} />
        </p>
      ) : (
        <p className="px-3 py-3 text-sm text-subtle-foreground">
          No ClinVar record
        </p>
      )}
      <SectionHeader
        title="Condition"
        count={conditions.length > 1 ? conditions.length : null}
      />
      <p className="px-3 py-3 text-sm text-foreground">
        {condition?.name ?? (
          <span className="text-subtle-foreground">No condition named</span>
        )}
      </p>
      <SectionHeader title="Population" />
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-3 text-sm text-foreground">
        {gnomad.label}
        <EvidenceMark evidence={gnomad.alleles[0]?.evidence} />
      </p>
    </>
  );
}

const STRIP_KEYS = ["alphamissense.pathogenicity", "foldx.ddg"];

/** One strip per model: the predicted values at this substitution, each on its own scale. */
function predictionStrips(
  effects: ResidueEffectsResponse | null,
  ledger: StructureLedger | null,
  residueLabel: string | null,
): ModelResultStripProps[] {
  if (!effects) return [];
  const values = effects.groups
    .find((group) => group.id === "computational_predictions")
    ?.values.filter((value) => value.state === "ok");
  const strips: ModelResultStripProps[] = [];

  const pathogenicity = values?.find((value) => value.key === STRIP_KEYS[0]);
  if (pathogenicity && typeof pathogenicity.value === "number")
    strips.push({
      model: pathogenicity.tool ?? "AlphaMissense",
      version: pathogenicity.tool_version?.split(" (")[0] ?? null,
      metrics: [
        {
          label: "Pathogenicity",
          value: pathogenicity.value,
          // the score has no unit; the tool's own class is printed in that place
          unit: pathogenicity.class_label?.split(" (")[0] ?? null,
          explainer: "alphamissense",
        },
      ],
    });

  const model = findLedgerStructure(ledger, effects.residue.plddt_structure_id);
  if (effects.residue.plddt !== null && effects.residue.plddt !== undefined)
    strips.push({
      model:
        model?.provider_name ??
        effects.residue.plddt_structure_id ??
        "Predicted model",
      version: model?.model_version ?? null,
      origin: model?.origin ?? null,
      metrics: [
        {
          label: residueLabel ? `pLDDT at ${residueLabel}` : "Residue pLDDT",
          value: effects.residue.plddt,
          explainer: "plddt",
        },
      ],
    });

  const stability = values?.find((value) => value.key === STRIP_KEYS[1]);
  if (stability && typeof stability.value === "number")
    strips.push({
      model: stability.tool ?? "FoldX",
      version: stability.tool_version,
      metrics: [
        {
          label: "Predicted ΔΔG",
          value: stability.value,
          unit: stability.unit ?? "kcal/mol",
          explainer: "ddg",
        },
      ],
    });

  return strips;
}

type InspectorTab = "analysis" | "literature";

/** The variant analysis page: the record on the left, the residue in 3D, effect values and literature on the right. */
export function VariantWorkspace({ variantId }: { variantId: string }) {
  const parsed = parseVariantId(variantId);
  const variant = useVariant(variantId);
  const record = variant.data?.data ?? null;
  const symbol =
    record?.gene.id ?? (parsed?.kind === "substitution" ? parsed.gene : null);
  const accession = record?.protein?.id ?? null;
  const axis = useProteinAxis(accession, { gene: symbol });
  const structure = useShownStructure(accession, axis.ledger);

  const position = record?.position ?? null;
  const reference = record?.reference_residue ?? null;
  const alternate = record?.alternate_residue ?? null;
  const substitution =
    record?.change_kind === "substitution" &&
    position !== null &&
    reference !== null &&
    alternate !== null;
  const change = substitution ? record.protein_change : null;

  const effects = useResidueEffects(accession, position, {
    alt: substitution ? alternate : null,
    ref: substitution ? reference : null,
  });
  const plan = useComparePlan(symbol, change);
  const stagePath = useStagePath();
  const [tab, setTab] = useState<InspectorTab>("analysis");
  const advanced = useAdvancedMode();
  const [details, setDetails] = useState(false);
  const full = advanced || details;

  useWorkspaceSubject(
    record
      ? subjectChain({
          variant: record,
          protein: axis.protein ?? undefined,
          structure: structure.shown.descriptor ?? undefined,
        })
      : variantSubjectsFromUrl(variantId),
  );

  const selectVariant = useWorkspaceSelection((state) => state.selectVariant);
  const selectResidue = useWorkspaceSelection((state) => state.selectResidue);
  const sourceId = record?.clinvar?.vcv ?? record?.uniprot?.feature_id ?? null;
  const focusVariant = () => {
    if (position === null) return;
    if (substitution && reference && alternate)
      selectVariant({ reference, position, alternate, sourceId });
    else selectResidue(position);
  };
  useEffect(() => {
    focusVariant();
    // the page's variant is selected once per record; later selections are the reader's
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.id, accession]);

  const sources = useMemo(
    () =>
      mergeSources(
        variant.data?.sources,
        axis.sources,
        effects.data?.sources,
        plan.data?.sources,
      ),
    [variant.data, axis.sources, effects.data, plan.data],
  );
  useReportSources("variant-stage", sources);

  if (variant.isError)
    return (
      <WorkspaceZones
        layoutId="variant"
        instrument={
          <Zone zone="instrument" title="Variant">
            <QueryErrorState
              error={variant.error}
              subject={`variant ${variantId}`}
              onRetry={() => void variant.refetch()}
              retrying={variant.isFetching}
            />
          </Zone>
        }
      />
    );

  const label = record?.protein_change ?? record?.name ?? variantId;
  const residueLabel =
    reference && position !== null
      ? `${toThreeLetter(reference) ?? reference}${position}`
      : null;
  const effectsData = effects.data?.data ?? null;
  const strips = advanced
    ? []
    : predictionStrips(effectsData, axis.ledger, residueLabel);

  return (
    <>
      <SubjectBarActions>
        {record ? (
          <AddToProjectButton
            size="sm"
            variant="ghost"
            item={{
              kind: "variant",
              ref: record.id,
              label: `${record.gene.id} ${label}`,
              origin: { route: routes.variant(record.id) },
              evidence: [
                record.clinvar?.evidence,
                record.uniprot?.evidence,
              ].filter(Boolean),
              data: {
                gene: record.gene.id,
                accession,
                position,
                hgvs: record.hgvs,
                vcv: record.clinvar?.vcv ?? null,
                classification: record.clinvar?.classification ?? null,
                review_status: record.clinvar?.review_status ?? null,
                vrs_id: record.vrs.id,
              },
            }}
          />
        ) : null}
      </SubjectBarActions>
      <WorkspaceZones
        layoutId="variant"
        ledgerLabel={advanced ? "Record" : "Variant"}
        inspectorLabel="Analysis"
        ledger={
          <Zone
            zone="ledger"
            title={advanced ? "Record" : "Variant"}
            detail={
              record && advanced ? (
                <span className="text-2xs text-muted-foreground">
                  resolved from{" "}
                  {record.resolved_from === "protein"
                    ? "the protein change"
                    : record.resolved_from}
                </span>
              ) : null
            }
          >
            {!record ? (
              <RowsSkeleton rows={10} />
            ) : !full ? (
              <>
                <div className="flex flex-col gap-1.5 px-3 pt-4 pb-3">
                  <h1 className="flex flex-wrap items-baseline gap-x-2 font-mono text-xl font-semibold text-foreground">
                    <TextLink
                      href={routes.gene(record.gene.id)}
                      className="font-mono"
                    >
                      {record.gene.id}
                    </TextLink>
                    <span>{label}</span>
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    <LearnTerm
                      term={
                        record.consequence === "missense_variant"
                          ? "missense-mutation"
                          : "variant"
                      }
                    >
                      {consequenceText(record.consequence) ?? "Variant"}
                    </LearnTerm>
                  </p>
                </div>
                <VariantSummary record={record} />
                <div className="border-t border-border-subtle px-3 py-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-expanded={false}
                    onClick={() => setDetails(true)}
                  >
                    Details
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-1 border-b border-border px-3 py-2.5">
                  <h1 className="flex flex-wrap items-baseline gap-x-2 font-mono text-base font-semibold text-foreground">
                    <TextLink
                      href={routes.gene(record.gene.id)}
                      className="font-mono"
                    >
                      {record.gene.id}
                    </TextLink>
                    <span>{label}</span>
                  </h1>
                  <p className="text-xs text-muted-foreground">
                    <LearnTerm
                      term={
                        record.consequence === "missense_variant"
                          ? "missense-mutation"
                          : "variant"
                      }
                    >
                      {consequenceText(record.consequence) ?? "Variant"}
                    </LearnTerm>
                    {record.name ? (
                      <span className="mt-0.5 block font-mono text-2xs break-all text-subtle-foreground">
                        {record.name}
                      </span>
                    ) : null}
                  </p>
                </div>
                <SectionHeader title="Clinical classification" />
                <Classification record={record} />
                <SectionHeader
                  title="Conditions"
                  count={record.clinvar?.conditions.length ?? null}
                />
                <ConditionList conditions={record.clinvar?.conditions ?? []} />
                <SectionHeader title="Population observation" />
                <PopulationObservation gnomad={record.gnomad} />
                <SectionHeader title="Identity" />
                <Identity record={record} />
                <Submissions record={record} />
                <SectionHeader title="UniProt annotation" />
                <UniProtAnnotation record={record} />
                <SectionHeader
                  title="Consequence"
                  actions={<EvidenceMark evidence={record.vep?.evidence} />}
                />
                <Consequence record={record} />
              </>
            )}
          </Zone>
        }
        instrument={
          record && !accession ? (
            <Zone zone="instrument" title="3D">
              <EmptyState
                title="No protein mapped for this variant"
                description="The record names no UniProt accession, so the variant cannot be placed on a sequence or a structure."
                searched={["UniProt"]}
              />
            </Zone>
          ) : (
            <StructureInstrument
              accession={accession}
              subject={symbol ?? variantId}
              ledger={axis.ledger}
              ledgerSettled={axis.isComplete}
              structure={structure}
              position={position}
              residueLabel={residueLabel}
              variant={record && position !== null ? { position, label } : null}
              title="3D"
              caption={
                residueLabel ? (
                  <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                    {residueLabel} highlighted
                  </span>
                ) : null
              }
              actions={
                !advanced && record && symbol && change ? (
                  <>
                    <ButtonLink
                      size="sm"
                      variant="ghost"
                      className="hidden sm:inline-flex"
                      href={stagePath(routes.mechanism(record.id))}
                    >
                      Mechanism
                    </ButtonLink>
                    <ButtonLink
                      size="sm"
                      variant="default"
                      className="mr-1"
                      href={stagePath(routes.compare(symbol, change))}
                    >
                      Compare structures
                      <ArrowRightIcon data-icon="inline-end" />
                    </ButtonLink>
                  </>
                ) : null
              }
              bottom={
                strips.length > 0 ? (
                  <div className="flex shrink-0 gap-x-10 gap-y-4 overflow-x-auto border-t border-border px-4 py-3 lg:flex-wrap lg:overflow-visible">
                    {strips.map((strip) => (
                      <ModelResultStrip
                        key={strip.model}
                        {...strip}
                        frame="none"
                        className="shrink-0 flex-nowrap gap-x-6 lg:shrink"
                      />
                    ))}
                  </div>
                ) : null
              }
              top={
                !advanced ? null : record && symbol ? (
                  <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border bg-background px-3 py-1.5">
                    <VariantRoutes
                      gene={symbol}
                      variantId={record.id}
                      change={change}
                      onVariantPage
                    />
                    {change ? (
                      <ComparisonStatus
                        plan={plan.data?.data ?? null}
                        variantId={record.id}
                      />
                    ) : null}
                    {position !== null ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto"
                        onClick={focusVariant}
                      >
                        <CrosshairIcon data-icon="inline-start" />
                        Focus {residueLabel ?? `residue ${position}`}
                      </Button>
                    ) : null}
                  </div>
                ) : null
              }
            />
          )
        }
        inspector={
          !full ? undefined : (
          <Zone
            zone="inspector"
            title={tab === "analysis" ? "Analysis" : "Literature"}
            scroll={tab === "analysis"}
            actions={
              advanced ? null : (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Close the details"
                  onClick={() => setDetails(false)}
                >
                  <XIcon />
                </Button>
              )
            }
            toolbar={
              <ToggleGroup
                size="sm"
                variant="outline"
                spacing={0}
                value={[tab]}
                onValueChange={(value) =>
                  value.length ? setTab(value[0] as InspectorTab) : null
                }
              >
                <ToggleGroupItem value="analysis">
                  Effects and context
                </ToggleGroupItem>
                <ToggleGroupItem value="literature">Literature</ToggleGroupItem>
              </ToggleGroup>
            }
          >
            {!record ? (
              <RowsSkeleton rows={8} />
            ) : tab === "literature" ? (
              <LiteraturePanel
                context={{
                  gene: record.gene.id,
                  variant: record.id,
                  accession,
                  residue: position,
                }}
                defaultFocused
              />
            ) : (
              <>
                <SectionHeader title="Residue context" />
                {accession && position !== null ? (
                  <>
                    <div className="border-b border-border-subtle px-3 py-2">
                      <MetricReadout
                        metric="plddt"
                        value={effectsData?.residue.plddt}
                        missingReason={
                          effects.isPending
                            ? "Loading"
                            : "No AlphaFold DB model covers this residue"
                        }
                        label={
                          <>
                            <LearnTerm term="plddt">pLDDT</LearnTerm> at{" "}
                            {residueLabel ?? `residue ${position}`}
                          </>
                        }
                        producedBy={effectsData?.residue.plddt_structure_id}
                      />
                    </div>
                    <ResidueContext
                      accession={accession}
                      position={position}
                      withoutVariants
                    />
                  </>
                ) : (
                  <EmptyState
                    size="inline"
                    title="No single protein position"
                    description="This variant does not map to one residue of the canonical UniProt sequence."
                  />
                )}

                {!substitution ? (
                  <>
                    <SectionHeader title="Variant effect values" />
                    <EmptyState
                      size="inline"
                      title="No per-substitution values"
                      description="Effect predictors and assays report values for single amino-acid substitutions. This variant is not one."
                    />
                  </>
                ) : effects.isPending ? (
                  <>
                    <SectionHeader title="Variant effect values" />
                    <RowsSkeleton rows={5} />
                  </>
                ) : effects.isError || !effectsData ? (
                  <>
                    <SectionHeader title="Variant effect values" />
                    <QueryErrorState
                      size="inline"
                      error={effects.error}
                      subject={`effect values of ${label}`}
                      onRetry={() => void effects.refetch()}
                    />
                  </>
                ) : (
                  <EffectGroups effects={effectsData} curated="variants" />
                )}

                {change && symbol && record ? (
                  <>
                    <SectionHeader
                      title="Structural analysis"
                      count={plan.data?.data.results.length ?? null}
                      actions={
                        <EvidenceBadge evidenceClass="computational_prediction" />
                      }
                      description="Reference and variant models predicted with the same provider and construct."
                    />
                    <StructuralAnalysis
                      gene={symbol}
                      change={change}
                      variantId={record.id}
                      plan={plan.data?.data ?? null}
                      isPending={plan.isPending}
                      error={plan.error}
                      onRetry={() => void plan.refetch()}
                    />
                  </>
                ) : null}

                {effectsData && effectsData.limitations.length > 0 ? (
                  <>
                    <SectionHeader title="Limits of these values" />
                    <ul className="flex flex-col gap-1 px-3 py-2 text-2xs text-muted-foreground">
                      {effectsData.limitations.map((limitation) => (
                        <li key={limitation}>{limitation}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </>
            )}
          </Zone>
          )
        }
      />
    </>
  );
}
