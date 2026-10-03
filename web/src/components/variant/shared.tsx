"use client";

import { ArrowRightIcon } from "lucide-react";
import { cn } from "cn";

import { ButtonLink } from "@/components/data/button-link";
import {
  DefinitionList,
  DefinitionRow,
} from "@/components/data/definition-list";
import { ExternalLink } from "@/components/data/external-link";
import { LearnTerm } from "@/components/science/learn-term";
import { ClinicalSignificanceChip } from "@/components/science/legends";
import { EmptyState } from "@/components/states/empty-state";
import { QueryErrorState, RowsSkeleton } from "@/components/states/query-state";
import type { Schema } from "@/lib/api/types";
import { formatDate } from "@/lib/format";
import { routes } from "@/lib/ids";
import { Swatch } from "@/components/science/swatch";
import { plainClassifiedBy, plainReview } from "@/lib/plain-language";
import {
  CLINICAL_SIGNIFICANCE,
  parseClinicalSignificance,
} from "@/lib/science/clinical-significance";
import { useWorkspaceSelection } from "@/lib/state/selection";
import { withSelection } from "@/lib/state/selection-url";
import { useResidue } from "@/lib/workspace-data";

import { EvidenceMark, type ApiEvidence } from "./evidence";

type VariantCondition = Schema<"VariantCondition">;
type GnomadObservation = Schema<"GnomadObservation">;
type GnomadFrequency = Schema<"GnomadFrequency">;

/** A stage path carrying the current selection, so structure and view settings survive the move. */
export function useStagePath(): (path: string) => string {
  const selection = useWorkspaceSelection();
  return (path) => withSelection(path, selection);
}

export interface VariantRoutesProps {
  gene: string;
  variantId: string;
  /** "p.Arg28His"; compare and mechanism need a single-residue substitution */
  change: string | null;
  /** leave out the link to the variant page itself */
  onVariantPage?: boolean;
  className?: string;
}

/** The onward routes of a variant: its analysis page, Compare (stage 4) and Mechanism (stage 5). */
export function VariantRoutes({
  gene,
  variantId,
  change,
  onVariantPage = false,
  className,
}: VariantRoutesProps) {
  const stagePath = useStagePath();
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {onVariantPage ? null : (
        <ButtonLink
          size="sm"
          variant="default"
          href={stagePath(routes.variant(variantId))}
        >
          Variant analysis
          <ArrowRightIcon data-icon="inline-end" />
        </ButtonLink>
      )}
      {change ? (
        <>
          <ButtonLink
            size="sm"
            variant={onVariantPage ? "default" : "outline"}
            href={stagePath(routes.compare(gene, change))}
          >
            Compare reference and variant
            <ArrowRightIcon data-icon="inline-end" />
          </ButtonLink>
          <ButtonLink size="sm" href={stagePath(routes.mechanism(variantId))}>
            Mechanism
            <ArrowRightIcon data-icon="inline-end" />
          </ButtonLink>
        </>
      ) : (
        <span className="text-2xs text-subtle-foreground">
          Compare and Mechanism need a single-residue substitution.
        </span>
      )}
    </div>
  );
}

export interface ClassificationLineProps {
  /** the database's own wording */
  classification: string | null | undefined;
  reviewStatus?: string | null;
  reviewStars?: number | null;
  lastEvaluated?: string | null;
  evidence?: ApiEvidence | null;
}

/** A ClinVar germline classification with its review status, worded as ClinVar words it. */
export function ClassificationLine({
  classification,
  reviewStatus,
  reviewStars,
  lastEvaluated,
  evidence,
}: ClassificationLineProps) {
  const significance = parseClinicalSignificance(classification);
  return (
    <div className="flex flex-col gap-1 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <EvidenceMark evidence={evidence} />
        {significance ? (
          <ClinicalSignificanceChip significance={significance} />
        ) : null}
        <span className="font-medium text-foreground">
          {classification ?? "No classification"}
        </span>
      </div>
      <p className="text-muted-foreground">
        {reviewStatus ?? "Review status unknown"}
        {reviewStars !== null && reviewStars !== undefined ? (
          <span
            className="tabular ml-1.5 font-mono text-foreground"
            title="ClinVar review status, gold stars out of 4"
          >
            {reviewStars}/4
          </span>
        ) : null}
        {lastEvaluated ? (
          <span className="ml-1.5 text-subtle-foreground">
            last evaluated {formatDate(lastEvaluated) ?? lastEvaluated}
          </span>
        ) : null}
      </p>
    </div>
  );
}

/** Simple mode: the ClinVar class as one sentence, and how well it was checked. */
export function PlainClassification({
  classification,
  reviewStatus,
  reviewStars,
  evidence,
}: ClassificationLineProps) {
  const significance = parseClinicalSignificance(classification);
  const meta = significance ? CLINICAL_SIGNIFICANCE[significance] : null;
  return (
    <div className="flex flex-col gap-1 px-3 py-3">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-foreground">
        {meta ? (
          <Swatch swatchClass={meta.swatchClass} hatched={!meta.certain} />
        ) : null}
        {plainClassifiedBy(classification)}
        <EvidenceMark evidence={evidence} />
      </p>
      {reviewStars !== null && reviewStars !== undefined ? (
        <p
          className="text-xs text-muted-foreground"
          title={
            reviewStatus ? `${reviewStatus} (${reviewStars} of 4 stars)` : undefined
          }
        >
          {plainReview(reviewStars)}
        </p>
      ) : null}
    </div>
  );
}

const SHOWN_XREFS = ["MONDO", "OMIM", "Orphanet", "MedGen"];

export function ConditionList({
  conditions,
}: {
  conditions: VariantCondition[];
}) {
  if (conditions.length === 0)
    return (
      <EmptyState
        size="inline"
        title="No condition named"
        description="The source record names no condition for this variant."
      />
    );
  return (
    <ul className="text-xs">
      {conditions.map((condition) => {
        const xrefs = SHOWN_XREFS.flatMap(
          (db) => condition.xrefs.find((xref) => xref.db === db) ?? [],
        );
        return (
          <li
            key={condition.name}
            className="border-b border-border-subtle px-3 py-1.5 last:border-b-0"
          >
            <span className="text-foreground">{condition.name}</span>
            {xrefs.length > 0 ? (
              <span className="flex flex-wrap gap-x-2.5 text-2xs">
                {xrefs.map((xref) =>
                  xref.url ? (
                    <ExternalLink
                      key={`${xref.db}:${xref.id}`}
                      href={xref.url}
                      className="font-mono text-muted-foreground"
                    >
                      {xref.id.includes(":")
                        ? xref.id
                        : `${xref.db}:${xref.id}`}
                    </ExternalLink>
                  ) : (
                    <span
                      key={`${xref.db}:${xref.id}`}
                      className="font-mono text-muted-foreground"
                    >
                      {xref.db}:{xref.id}
                    </span>
                  ),
                )}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

const formatFrequency = (value: number | null) =>
  value === null
    ? "Unknown"
    : value === 0
      ? "0"
      : value < 0.001
        ? value.toExponential(2)
        : value.toFixed(4);

const formatInteger = (value: number | null) =>
  value === null ? "Unknown" : value.toLocaleString("en-US");

function FrequencyRow({
  label,
  frequency,
  hemizygotes,
}: {
  label: string;
  frequency: GnomadFrequency | null;
  hemizygotes: boolean;
}) {
  if (!frequency)
    return (
      <tr className="border-t border-border-subtle">
        <th className="py-1 pr-2 text-left font-sans font-normal text-muted-foreground">
          {label}
        </th>
        <td
          colSpan={hemizygotes ? 5 : 4}
          className="py-1 text-left font-sans text-subtle-foreground"
        >
          Not in this call set
        </td>
      </tr>
    );
  return (
    <tr className="border-t border-border-subtle">
      <th className="py-1 pr-2 text-left font-sans font-normal text-muted-foreground">
        {label}
      </th>
      <td className="py-1 pl-2">{formatInteger(frequency.allele_count)}</td>
      <td className="py-1 pl-2">{formatInteger(frequency.allele_number)}</td>
      <td className="py-1 pl-2 font-medium text-foreground">
        {formatFrequency(frequency.allele_frequency)}
      </td>
      <td className="py-1 pl-2">{formatInteger(frequency.homozygote_count)}</td>
      {hemizygotes ? (
        <td className="py-1 pl-2">
          {formatInteger(frequency.hemizygote_count)}
        </td>
      ) : null}
    </tr>
  );
}

/** What gnomAD observed: counts as the source reports them, per call set, never summarised into a verdict. */
export function PopulationObservation({
  gnomad,
}: {
  gnomad: GnomadObservation;
}) {
  if (gnomad.status !== "observed" || gnomad.alleles.length === 0)
    return (
      <EmptyState
        size="inline"
        title={gnomad.label}
        description={
          gnomad.status === "not_observed"
            ? "Absence from a population database is an observation about that sample, and says nothing on its own about the variant's effect."
            : "gnomAD could not be matched to this variant."
        }
        searched={[gnomad.dataset]}
      />
    );
  const hemizygotes = gnomad.x_linked === true;
  return (
    <div className="text-xs">
      {gnomad.alleles.map((allele) => (
        <div
          key={allele.variant_id}
          className="border-b border-border-subtle px-3 py-2 last:border-b-0"
        >
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <EvidenceMark evidence={allele.evidence} />
            <span className="text-foreground">{gnomad.label}</span>
            {allele.url ? (
              <ExternalLink href={allele.url} className="font-mono text-2xs">
                {allele.variant_id}
              </ExternalLink>
            ) : (
              <span className="font-mono text-2xs">{allele.variant_id}</span>
            )}
          </p>
          <table className="tabular mt-1.5 w-full font-mono text-2xs text-muted-foreground">
            <thead>
              <tr className="text-subtle-foreground">
                <th className="pr-2 text-left font-sans font-normal">
                  Call set
                </th>
                <th className="pl-2 text-left font-sans font-normal">
                  Alleles
                </th>
                <th className="pl-2 text-left font-sans font-normal">Total</th>
                <th className="pl-2 text-left font-sans font-normal">
                  <LearnTerm term="allele-frequency">Frequency</LearnTerm>
                </th>
                <th className="pl-2 text-left font-sans font-normal">Hom.</th>
                {hemizygotes ? (
                  <th className="pl-2 text-left font-sans font-normal">
                    Hemi.
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              <FrequencyRow
                label="Exomes"
                frequency={allele.exome}
                hemizygotes={hemizygotes}
              />
              <FrequencyRow
                label="Genomes"
                frequency={allele.genome}
                hemizygotes={hemizygotes}
              />
            </tbody>
          </table>
          {allele.flags.length > 0 ? (
            <p className="mt-1 text-2xs text-muted-foreground">
              gnomAD flags: {allele.flags.join(", ")}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

const SKIPPED_TRACKS = new Set(["chains"]);

const SHORT_TRACK_LABEL: Record<string, string> = {
  binding_sites: "Binding site",
  secondary_structure: "Sec. structure",
  interpro_domains: "InterPro",
  interpro_superfamilies: "InterPro superfamily",
  natural_variants: "Variants",
};

export interface ResidueContextProps {
  accession: string;
  position: number;
  /** leave the natural-variant track out, for pages that list variants elsewhere */
  withoutVariants?: boolean;
}

/** One residue in its sequence context: the amino acid, the window around it and every feature covering it. */
export function ResidueContext({
  accession,
  position,
  withoutVariants = false,
}: ResidueContextProps) {
  const residue = useResidue(accession, position);
  if (residue.isPending) return <RowsSkeleton rows={4} />;
  if (residue.isError)
    return (
      <QueryErrorState
        size="inline"
        error={residue.error}
        subject={`residue ${position} of ${accession}`}
        onRetry={() => void residue.refetch()}
      />
    );
  const data = residue.data.data;
  const offset = position - data.window_start;
  const tracks = data.tracks.filter(
    (track) =>
      !SKIPPED_TRACKS.has(track.id) &&
      !(withoutVariants && track.id === "natural_variants") &&
      track.features.length > 0,
  );
  const domains = tracks.find((track) => track.id === "domains");
  const others = tracks.filter((track) => track.id !== "domains");

  return (
    <DefinitionList termWidth="6.5rem">
      <DefinitionRow term={<LearnTerm term="residue">Residue</LearnTerm>}>
        <span className="font-mono">
          {data.amino_acid_three ?? data.amino_acid}
          {position}
        </span>
        <span className="ml-2 text-muted-foreground">
          {data.amino_acid_name}, {position} of {data.sequence_length}
        </span>
      </DefinitionRow>
      <DefinitionRow term="Sequence" mono>
        <span className="text-muted-foreground">
          {data.window.slice(0, offset)}
        </span>
        <span className="bg-active px-0.5 font-semibold text-foreground">
          {data.window[offset]}
        </span>
        <span className="text-muted-foreground">
          {data.window.slice(offset + 1)}
        </span>
      </DefinitionRow>
      <DefinitionRow term={<LearnTerm term="protein-domain">Domain</LearnTerm>}>
        {domains ? (
          <FeatureLines features={domains.features} />
        ) : (
          <span className="text-subtle-foreground">
            No domain annotated at this residue
          </span>
        )}
      </DefinitionRow>
      {others.map((track) => (
        <DefinitionRow
          key={track.id}
          term={SHORT_TRACK_LABEL[track.id] ?? track.label}
        >
          <FeatureLines features={track.features} />
        </DefinitionRow>
      ))}
    </DefinitionList>
  );
}

function FeatureLines({ features }: { features: Schema<"Feature">[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {features.map((feature) => (
        <li key={feature.id} className="flex items-baseline gap-1.5">
          <EvidenceMark
            evidence={feature.evidence[0]}
            className="shrink-0 self-center"
          />
          <span className="min-w-0">
            {feature.description ?? feature.ligand?.name ?? feature.type}
            {feature.description || feature.ligand ? (
              <span className="ml-1.5 text-muted-foreground">
                {feature.type}
              </span>
            ) : null}
            {feature.start !== null && feature.end !== null ? (
              <span className="tabular ml-1.5 font-mono text-2xs text-subtle-foreground">
                {feature.start === feature.end
                  ? feature.start
                  : `${feature.start}-${feature.end}`}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
