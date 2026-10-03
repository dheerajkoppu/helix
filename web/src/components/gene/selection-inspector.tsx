"use client";

import { ArrowRightIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { ButtonLink } from "@/components/data/button-link";
import {
  DefinitionList,
  DefinitionRow,
} from "@/components/data/definition-list";
import { ExternalLink } from "@/components/data/external-link";
import { KeyHint } from "@/components/data/key-hint";
import { MonoId } from "@/components/data/mono-id";
import { SectionHeader } from "@/components/data/section-header";
import { TextLink } from "@/components/data/text-link";
import { AddToProjectButton } from "@/components/project/add-to-project";
import { LearnTerm } from "@/components/science/learn-term";
import { ClinicalSignificanceChip } from "@/components/science/legends";
import { MetricReadout } from "@/components/science/metric-readout";
import { EmptyState } from "@/components/states/empty-state";
import { QueryErrorState, RowsSkeleton } from "@/components/states/query-state";
import { EffectGroups } from "@/components/variant/effect-groups";
import { EvidenceMark } from "@/components/variant/evidence";
import {
  ClassificationLine,
  ConditionList,
  PlainClassification,
  PopulationObservation,
  ResidueContext,
  VariantRoutes,
  useStagePath,
} from "@/components/variant/shared";
import { Button } from "@/components/ui/button";
import { Zone } from "@/components/workspace";
import type { Schema } from "@/lib/api/types";
import { aminoAcidName, routes, toThreeLetter } from "@/lib/ids";
import { parseClinicalSignificance } from "@/lib/science/clinical-significance";
import {
  DETAILS_LABEL,
  MUTATION_WORDS,
  plainChangeKind,
  plainClassifiedBy,
  plainMutationRow,
  plainSpot,
} from "@/lib/plain-language";
import { useAdvancedMode } from "@/lib/state/preferences";
import {
  useResidueEffects,
  useVariant,
  type AxisVariantsResponse,
} from "@/lib/workspace-data";

import { consequenceLabel, type VariantRow } from "./variant-ledger";

type AxisClinicalVariant = Schema<"AxisClinicalVariant">;

export type ActiveSelection =
  | {
      kind: "variant";
      /** Helix variant ID, or a ClinVar VCV for a non-substitution */
      id: string;
      label: string;
      position: number | null;
      /** one-letter codes; null for anything but a single-residue substitution */
      reference: string | null;
      alternate: string | null;
      /** the table row, when the variant is on the loaded page */
      row: VariantRow | null;
      /** the slim axis row, when the table page does not hold the variant */
      slim: AxisClinicalVariant | null;
    }
  | { kind: "residue"; position: number }
  | null;

export interface SelectionInspectorProps {
  symbol: string;
  accession: string | null;
  sequence: string | null;
  active: ActiveSelection;
  axisVariants: AxisVariantsResponse | null;
  onSelectVariant: (variant: AxisClinicalVariant) => void;
  /** clears the selection, which closes the inspector in simple mode */
  onClose?: () => void;
}

function DetailsToggle({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="px-3 py-3">
      <Button variant="ghost" size="sm" aria-expanded={false} onClick={onOpen}>
        {DETAILS_LABEL}
      </Button>
    </div>
  );
}

function ResidueConfidence({
  accession,
  position,
  alternate,
  reference,
  predictions,
  simple = false,
}: {
  accession: string;
  position: number;
  alternate: string | null;
  reference: string | null;
  predictions: boolean;
  simple?: boolean;
}) {
  const effects = useResidueEffects(accession, position, {
    alt: alternate,
    ref: reference,
  });
  if (effects.isPending) return <RowsSkeleton rows={3} />;
  if (effects.isError)
    return (
      <QueryErrorState
        size="inline"
        error={effects.error}
        subject={`effect values at residue ${position}`}
        onRetry={() => void effects.refetch()}
      />
    );
  const data = effects.data.data;
  return (
    <>
      <div className="border-b border-border-subtle px-3 py-2">
        <MetricReadout
          metric="plddt"
          value={data.residue.plddt}
          missingReason={
            simple
              ? "No prediction covers this spot"
              : "No AlphaFold DB model covers this residue"
          }
          label={
            simple ? (
              MUTATION_WORDS.confidenceHere
            ) : (
              <>
                <LearnTerm term="plddt">pLDDT</LearnTerm> at residue {position}
              </>
            )
          }
          producedBy={data.residue.plddt_structure_id}
        />
      </div>
      {predictions ? (
        <EffectGroups
          effects={data}
          only={["computational_predictions"]}
          compact
        />
      ) : null}
    </>
  );
}

function VariantsAtResidue({
  position,
  axisVariants,
  excludeId,
  onSelectVariant,
  simple = false,
}: {
  position: number;
  axisVariants: AxisVariantsResponse | null;
  excludeId: string | null;
  onSelectVariant: (variant: AxisClinicalVariant) => void;
  simple?: boolean;
}) {
  if (!axisVariants) return null;
  const clinical = axisVariants.clinical.filter(
    (variant) => variant.position === position && variant.id !== excludeId,
  );
  const population = axisVariants.population.filter(
    (variant) => variant.position === position,
  );
  return (
    <>
      <SectionHeader
        title={
          simple
            ? "Mutations at this spot"
            : excludeId
              ? "Other variants at this residue"
              : "Variants at this residue"
        }
        count={clinical.length}
      />
      {clinical.length > 0 ? (
        <ul className="text-xs">
          {clinical.map((variant) => {
            const significance = parseClinicalSignificance(
              variant.clinical_significance,
            );
            return (
              <li
                key={variant.row_key}
                className="border-b border-border-subtle last:border-b-0"
              >
                <button
                  type="button"
                  onClick={() => onSelectVariant(variant)}
                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left hover:bg-accent"
                >
                  {simple ? (
                    <span
                      className="w-28 shrink-0 truncate"
                      title={variant.protein_change ?? variant.id}
                    >
                      {plainMutationRow(variant.protein_change ?? variant.id)}
                    </span>
                  ) : (
                    <span className="w-24 shrink-0 font-mono">
                      {variant.protein_change ?? variant.id}
                    </span>
                  )}
                  {significance ? (
                    <ClinicalSignificanceChip
                      significance={significance}
                      reviewStars={simple ? undefined : variant.review_stars}
                      long={simple}
                    />
                  ) : (
                    <span className="text-2xs text-subtle-foreground">
                      {variant.in_uniprot ? "UniProt only" : "Not classified"}
                    </span>
                  )}
                  <span className="min-w-0 truncate text-muted-foreground">
                    {variant.condition}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          size="inline"
          title={
            simple
              ? "No known mutation at this spot"
              : excludeId
                ? "No other clinical variant at this residue"
                : "No clinical variant at this residue"
          }
          searched={["ClinVar", "UniProt natural variants"]}
        />
      )}
      {population.length > 0 && !simple ? (
        <p className="border-t border-border-subtle px-3 py-1.5 text-2xs text-muted-foreground">
          {axisVariants.population_dataset} lists{" "}
          {population.map((variant) => variant.hgvs_p).join(", ")} at this
          residue.
        </p>
      ) : null}
    </>
  );
}

function VariantBody({
  symbol,
  accession,
  active,
  axisVariants,
  onSelectVariant,
  full,
  onDetails,
}: Omit<SelectionInspectorProps, "sequence" | "active" | "onClose"> & {
  active: Extract<NonNullable<ActiveSelection>, { kind: "variant" }>;
  /** false shows the classification and the way onward only */
  full: boolean;
  onDetails: () => void;
}) {
  const stagePath = useStagePath();
  const { row, slim } = active;
  const detail = useVariant(active.id);
  const record = detail.data?.data;
  const substitution = Boolean(
    active.reference && active.alternate && active.position,
  );
  const clinvarEvidence =
    row?.evidence.find(
      (evidence) => evidence.evidence_class === "clinical_database",
    ) ??
    record?.clinvar?.evidence ??
    null;
  const uniprotEvidence =
    row?.evidence.find(
      (evidence) => evidence.evidence_class !== "clinical_database",
    ) ??
    record?.uniprot?.evidence ??
    null;
  const inClinvar =
    row?.in_clinvar ?? slim?.in_clinvar ?? Boolean(record?.clinvar);
  const classification =
    row?.clinical_significance ??
    slim?.clinical_significance ??
    record?.clinvar?.classification;
  const vcv = row?.vcv ?? slim?.vcv ?? record?.clinvar?.vcv ?? null;
  const rsid = row?.rsid ?? record?.clinvar?.rsid ?? null;
  const featureId =
    row?.uniprot_feature_id ??
    slim?.uniprot_feature_id ??
    record?.uniprot?.feature_id ??
    null;
  const conditions = row?.conditions ?? record?.clinvar?.conditions ?? null;
  const hgvs = row?.hgvs ?? record?.hgvs ?? null;
  const pendingRecord = !row && !slim && detail.isPending;
  const consequence =
    consequenceLabel(
      row?.consequence ?? slim?.consequence ?? record?.consequence,
    ) ?? "variant";
  const classificationLine = pendingRecord ? (
    <RowsSkeleton rows={2} />
  ) : inClinvar ? (
    <ClassificationLine
      classification={classification}
      reviewStatus={
        row?.review_status ??
        slim?.review_status ??
        record?.clinvar?.review_status
      }
      reviewStars={
        row?.review_stars ?? slim?.review_stars ?? record?.clinvar?.review_stars
      }
      lastEvaluated={row?.last_evaluated ?? record?.clinvar?.last_evaluated}
      evidence={clinvarEvidence}
    />
  ) : null;

  if (!full)
    return (
      <>
        <div className="flex flex-col gap-3 px-3 py-3">
          <p className="text-sm text-muted-foreground">
            {plainChangeKind(
              row?.consequence ?? slim?.consequence ?? record?.consequence,
            )}
          </p>
          <ButtonLink
            variant="default"
            className="self-start"
            href={stagePath(routes.variant(active.id))}
          >
            Open this mutation
            <ArrowRightIcon data-icon="inline-end" />
          </ButtonLink>
        </div>
        {pendingRecord ? (
          <RowsSkeleton rows={2} />
        ) : inClinvar ? (
          <PlainClassification
            classification={classification}
            reviewStatus={
              row?.review_status ??
              slim?.review_status ??
              record?.clinvar?.review_status
            }
            reviewStars={
              row?.review_stars ??
              slim?.review_stars ??
              record?.clinvar?.review_stars
            }
            evidence={clinvarEvidence}
          />
        ) : (
          <p className="px-3 py-2 text-xs text-subtle-foreground">
            {plainClassifiedBy(null)}
          </p>
        )}
        {conditions?.[0] ?? slim?.condition ? (
          <>
            <SectionHeader
              title={MUTATION_WORDS.disease}
            />
            <p className="px-3 py-2 text-sm text-foreground">
              {conditions?.find((condition) => condition.name !== "not provided")
                ?.name ??
                conditions?.[0]?.name ??
                slim?.condition}
            </p>
          </>
        ) : null}
        <DetailsToggle onOpen={onDetails} />
      </>
    );

  return (
    <>
      <div className="flex flex-col gap-2 border-b border-border px-3 py-2.5">
        <p className="text-xs text-muted-foreground">
          {symbol} {consequence}
          {active.position ? `, residue ${active.position}` : ""}
        </p>
        <VariantRoutes
          gene={symbol}
          variantId={active.id}
          change={substitution ? active.label : null}
        />
      </div>

      <SectionHeader title="Clinical classification" />
      {classificationLine ?? (
        <EmptyState
          size="inline"
          title="No ClinVar record"
          description={
            record?.clinvar_message ??
            (featureId
              ? "This variant is listed by UniProt and has no ClinVar classification."
              : undefined)
          }
          searched={["ClinVar"]}
        />
      )}
      {uniprotEvidence ? (
        <div className="flex items-baseline gap-2 border-t border-border-subtle px-3 py-2 text-xs">
          <EvidenceMark
            evidence={uniprotEvidence}
            className="shrink-0 self-start"
          />
          <span className="min-w-0 text-foreground">
            {uniprotEvidence.statement ?? "UniProt natural variant"}
          </span>
        </div>
      ) : null}

      <SectionHeader title="Conditions" count={conditions?.length ?? null} />
      {conditions ? (
        <ConditionList conditions={conditions} />
      ) : slim?.condition ? (
        <p className="px-3 py-1.5 text-xs">{slim.condition}</p>
      ) : detail.isPending ? (
        <RowsSkeleton rows={2} />
      ) : (
        <ConditionList conditions={[]} />
      )}

      <SectionHeader title="Identifiers" />
      <DefinitionList termWidth="6.5rem">
        <DefinitionRow term="Protein" mono>
          {hgvs?.p ?? (substitution ? active.label : null)}
        </DefinitionRow>
        <DefinitionRow term="Coding" mono>
          {hgvs?.c ? <MonoId value={hgvs.c} /> : null}
        </DefinitionRow>
        <DefinitionRow term="ClinVar">
          {vcv ? (
            <ExternalLink
              href={`https://www.ncbi.nlm.nih.gov/clinvar/variation/${vcv}/`}
              className="font-mono"
            >
              {vcv}
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
          ) : null}
        </DefinitionRow>
        {featureId ? (
          <DefinitionRow term="UniProt" mono>
            {featureId}
          </DefinitionRow>
        ) : null}
      </DefinitionList>

      <SectionHeader title="Population observation" />
      {detail.isPending ? (
        <RowsSkeleton rows={2} />
      ) : detail.isError ? (
        <QueryErrorState
          size="inline"
          error={detail.error}
          subject={`the variant record of ${active.label}`}
          onRetry={() => void detail.refetch()}
        />
      ) : (
        <PopulationObservation gnomad={detail.data.data.gnomad} />
      )}

      {accession && active.position ? (
        <>
          <SectionHeader title="Residue" />
          <ResidueConfidence
            accession={accession}
            position={active.position}
            alternate={substitution ? active.alternate : null}
            reference={substitution ? active.reference : null}
            predictions={substitution}
          />
          <SectionHeader title="Residue annotation" />
          <ResidueContext
            accession={accession}
            position={active.position}
            withoutVariants
          />
          <VariantsAtResidue
            position={active.position}
            axisVariants={axisVariants}
            excludeId={active.id}
            onSelectVariant={onSelectVariant}
          />
        </>
      ) : (
        <>
          <SectionHeader title="Residue" />
          <EmptyState
            size="inline"
            title="No single protein position"
            description="This variant does not map to one residue of the canonical UniProt sequence, so it is not placed on the sequence axis or the structure."
          />
        </>
      )}
    </>
  );
}

function ResidueBody({
  accession,
  position,
  axisVariants,
  onSelectVariant,
  full,
  onDetails,
}: {
  accession: string;
  position: number;
  axisVariants: AxisVariantsResponse | null;
  onSelectVariant: (variant: AxisClinicalVariant) => void;
  full: boolean;
  onDetails: () => void;
}) {
  const stagePath = useStagePath();
  if (!full)
    return (
      <>
        <ResidueConfidence
          simple
          accession={accession}
          position={position}
          alternate={null}
          reference={null}
          predictions={false}
        />
        <VariantsAtResidue
          simple
          position={position}
          axisVariants={axisVariants}
          excludeId={null}
          onSelectVariant={onSelectVariant}
        />
        <DetailsToggle onOpen={onDetails} />
      </>
    );
  return (
    <>
      <ResidueConfidence
        accession={accession}
        position={position}
        alternate={null}
        reference={null}
        predictions={false}
      />
      <SectionHeader title="Residue annotation" />
      <ResidueContext
        accession={accession}
        position={position}
        withoutVariants
      />
      <VariantsAtResidue
        position={position}
        axisVariants={axisVariants}
        excludeId={null}
        onSelectVariant={onSelectVariant}
      />
      <p className="border-t border-border-subtle px-3 py-2 text-xs text-muted-foreground">
        Structures, domains and interactions of this protein are on the{" "}
        <TextLink href={stagePath(routes.protein(accession))}>
          protein stage
        </TextLink>
        .
      </p>
    </>
  );
}

/** The inspector of the gene stage: the selected variant, or the selected residue when no variant is. */
export function SelectionInspector({
  symbol,
  accession,
  sequence,
  active,
  axisVariants,
  onSelectVariant,
  onClose,
}: SelectionInspectorProps) {
  const advanced = useAdvancedMode();
  const [details, setDetails] = useState(false);
  const full = advanced || details;
  const residueLetter =
    active?.kind === "residue" ? sequence?.[active.position - 1] : null;
  const title = !full
    ? active?.kind === "variant"
      ? plainMutationRow(active.label)
      : active?.kind === "residue"
        ? plainSpot(residueLetter, active.position)
        : "Selection"
    : active?.kind === "variant"
      ? active.label
      : active?.kind === "residue"
        ? `${residueLetter ? (toThreeLetter(residueLetter) ?? residueLetter) : "Residue "}${active.position}`
        : "Selection";

  return (
    <Zone
      zone="inspector"
      title={full ? <span className="font-mono">{title}</span> : title}
      detail={
        !full ? null : active?.kind === "residue" && residueLetter ? (
          <span className="text-2xs text-muted-foreground">
            {aminoAcidName(residueLetter)}
          </span>
        ) : active?.kind === "variant" ? (
          <span className="text-2xs text-muted-foreground">Variant</span>
        ) : null
      }
      actions={
        <>
        {active?.kind === "variant" ? (
          <AddToProjectButton
            size="icon-sm"
            variant="ghost"
            item={{
              kind: "variant",
              ref: active.id,
              label: `${symbol} ${active.label}`,
              origin: { route: routes.gene(symbol) },
              evidence: active.row?.evidence ?? [],
              data: {
                gene: symbol,
                accession,
                position: active.position,
                clinical_significance:
                  active.row?.clinical_significance ??
                  active.slim?.clinical_significance ??
                  null,
                vcv: active.row?.vcv ?? active.slim?.vcv ?? null,
              },
            }}
          />
        ) : active?.kind === "residue" && accession ? (
          <AddToProjectButton
            size="icon-sm"
            variant="ghost"
            item={{
              kind: "residue",
              ref: `${accession}:${active.position}`,
              label: `${symbol} ${title}`,
              origin: { route: routes.gene(symbol) },
              data: { gene: symbol, accession, position: active.position },
            }}
          />
        ) : null}
        {!advanced && active && onClose ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
            onClick={onClose}
          >
            <XIcon />
          </Button>
        ) : null}
        </>
      }
      footer={
        advanced ? <KeyHint keys="esc" label="Clear selection" /> : undefined
      }
    >
      {active?.kind === "variant" ? (
        <VariantBody
          key={active.id}
          symbol={symbol}
          accession={accession}
          active={active}
          axisVariants={axisVariants}
          onSelectVariant={onSelectVariant}
          full={full}
          onDetails={() => setDetails(true)}
        />
      ) : active?.kind === "residue" && accession ? (
        <ResidueBody
          accession={accession}
          position={active.position}
          axisVariants={axisVariants}
          onSelectVariant={onSelectVariant}
          full={full}
          onDetails={() => setDetails(true)}
        />
      ) : (
        <EmptyState
          title="No variant or residue selected"
          description="Select a row in the variant table, a marker on the sequence axis or a residue in the structure. The selection is shared by all three."
        />
      )}
    </Zone>
  );
}
