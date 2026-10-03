"use client";

import { TriangleAlertIcon } from "lucide-react";
import { cn } from "cn";

import { ExternalLink } from "@/components/data/external-link";
import { SectionHeader } from "@/components/data/section-header";
import { EvidenceBadge } from "@/components/evidence/evidence-badge";
import { StructureOriginTag } from "@/components/evidence/structure-origin-tag";
import { LearnTerm } from "@/components/science/learn-term";
import {
  MetricReadout,
  type MetricReadoutProps,
} from "@/components/science/metric-readout";
import { EmptyState } from "@/components/states/empty-state";
import type { Schema } from "@/lib/api/types";
import { toThreeLetter } from "@/lib/ids";
import type { ResidueEffectsResponse } from "@/lib/workspace-data";

import { EvidenceMark, provenanceEvidence } from "./evidence";

type EffectGroup = Schema<"EffectGroup">;
type EffectValue = Schema<"EffectValue">;
type EffectFlag = Schema<"EffectFlag">;
export type EffectGroupId = EffectGroup["id"];

/** Short headings that fit one line of an inspector; the API's full label is the tooltip. */
const GROUP_TITLE: Record<EffectGroupId, string> = {
  computational_predictions: "Computational predictions",
  experimental_functional: "Functional assays (MAVE)",
  curated_annotation: "Curated annotation",
  structural_context: "Predicted pocket, interface",
};

const METRIC_BY_KEY: Record<string, MetricReadoutProps["metric"]> = {
  "alphamissense.pathogenicity": "alphamissense",
  "foldx.ddg": "ddg",
};

const formatValue = (value: number | string) =>
  typeof value === "number"
    ? Number.isInteger(value)
      ? String(value)
      : value.toFixed(Math.abs(value) >= 100 ? 1 : 3)
    : value;

export function FlagLine({ flag }: { flag: EffectFlag }) {
  return (
    <p className="flex items-start gap-1.5 text-2xs text-foreground">
      <TriangleAlertIcon
        aria-hidden
        className="mt-px size-3 shrink-0 text-warning"
      />
      <span>{flag.message}</span>
    </p>
  );
}

function toolLine(value: EffectValue): string | null {
  const tool = [value.tool, value.tool_version].filter(Boolean).join(" ");
  return tool || null;
}

function valueEvidence(value: EffectValue, group: EffectGroup) {
  if (value.evidence) return value.evidence;
  return value.provenance
    ? provenanceEvidence(
        value.provenance,
        group.evidence_class,
        value.label,
        toolLine(value),
      )
    : null;
}

/** A UniProt feature at the residue: the row says whether it describes this substitution. */
function curatedDetail(
  value: EffectValue,
  reference: string | null,
): React.ReactNode {
  const { details } = value;
  const begin = details.begin as string | undefined;
  const end = details.end as string | undefined;
  const alternate = details.alternative_sequence as string | null | undefined;
  if (details.feature_type === "VARIANT" && alternate && begin) {
    const change = `p.${reference ? (toThreeLetter(reference) ?? reference) : ""}${begin}${toThreeLetter(alternate) ?? alternate}`;
    return (
      <span className="font-mono text-2xs text-muted-foreground">
        {change}
        {details.matches_alternate ? (
          <span className="ml-1.5 font-sans text-foreground">
            this substitution
          </span>
        ) : (
          <span className="ml-1.5 font-sans">
            other substitution at this residue
          </span>
        )}
      </span>
    );
  }
  if (begin && end)
    return (
      <span className="tabular font-mono text-2xs text-muted-foreground">
        {begin === end ? begin : `${begin}-${end}`}
      </span>
    );
  return null;
}

function EffectRow({
  value,
  group,
  reference,
}: {
  value: EffectValue;
  group: EffectGroup;
  reference: string | null;
}) {
  const metric = METRIC_BY_KEY[value.key];
  const evidence = valueEvidence(value, group);
  const tool = toolLine(value);
  const curated = value.kind === "curated_feature";

  if (value.state !== "ok") {
    return (
      <li className="flex items-baseline gap-2 border-b border-border-subtle px-3 py-1.5 last:border-b-0">
        <span className="min-w-0 flex-1">
          <span className="text-muted-foreground">{value.label}</span>
          <span className="block text-2xs text-subtle-foreground">
            {value.state === "not_covered" ? "No value. " : "Unavailable. "}
            {value.message}
          </span>
        </span>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-1 border-b border-border-subtle px-3 py-2 last:border-b-0">
      <div className="flex items-start gap-2">
        <EvidenceMark evidence={evidence} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          {metric && typeof value.value === "number" ? (
            <MetricReadout
              metric={metric}
              value={value.value}
              label={value.label}
              producedBy={tool}
            />
          ) : (
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-muted-foreground">{value.label}</span>
              {value.value !== null ? (
                <span
                  className={cn(
                    "text-foreground",
                    typeof value.value === "number" &&
                      "tabular font-mono text-sm font-medium",
                  )}
                >
                  {formatValue(value.value)}
                  {value.unit ? (
                    <span className="ml-1 text-2xs font-normal text-muted-foreground">
                      {value.unit}
                    </span>
                  ) : null}
                </span>
              ) : null}
              {value.class_label ? (
                <span className="text-foreground">{value.class_label}</span>
              ) : null}
              {curated ? curatedDetail(value, reference) : null}
            </p>
          )}
          {value.scale && !curated ? (
            <p className="text-2xs text-subtle-foreground">
              Scale: {value.scale}
              {!metric && tool ? `. ${tool}` : ""}
            </p>
          ) : null}
          {value.structure ? (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-2xs text-muted-foreground">
              <span>Computed on</span>
              <StructureOriginTag
                origin={value.structure.origin}
                size="compact"
                detail={value.structure.id}
              />
              {value.structure.residue_plddt !== null ? (
                <span>
                  <LearnTerm term="plddt">pLDDT</LearnTerm>{" "}
                  <span className="tabular font-mono text-foreground">
                    {value.structure.residue_plddt.toFixed(1)}
                  </span>{" "}
                  at this residue
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>
      {value.flags.map((flag) => (
        <FlagLine key={flag.code} flag={flag} />
      ))}
      {value.message && !curated ? (
        <p className="text-2xs text-subtle-foreground">{value.message}</p>
      ) : null}
    </li>
  );
}

const isVariantFeature = (value: EffectValue) =>
  value.details.feature_type === "VARIANT";

export interface EffectGroupsProps {
  effects: ResidueEffectsResponse;
  /** groups to show, in this order; default is every group the API returns */
  only?: EffectGroupId[];
  /** "variants" keeps only natural-variant rows of the curated group, for pages that list site features elsewhere */
  curated?: "all" | "variants";
  /** hide rows without a value, for a compact inspector */
  compact?: boolean;
}

/**
 * The effect values at a residue under the API's own headings: computational predictions,
 * experimental functional evidence, curated annotation, structural context. Each value keeps its
 * own scale; nothing is combined.
 */
export function EffectGroups({
  effects,
  only,
  curated = "all",
  compact = false,
}: EffectGroupsProps) {
  const groups = only
    ? only.flatMap(
        (id) => effects.groups.find((group) => group.id === id) ?? [],
      )
    : effects.groups;

  return (
    <>
      {effects.flags.length > 0 ? (
        <div className="flex flex-col gap-1 border-b border-border-subtle px-3 py-2">
          {effects.flags.map((flag) => (
            <FlagLine key={flag.code} flag={flag} />
          ))}
        </div>
      ) : null}
      {groups.map((group) => {
        const values = group.values.filter(
          (value) =>
            (!compact || value.state === "ok") &&
            (group.id !== "curated_annotation" ||
              curated === "all" ||
              isVariantFeature(value)),
        );
        const hidden = group.values.length - values.length;
        const scoreSets =
          group.id === "experimental_functional" ? effects.mave_score_sets : [];
        const disabled =
          group.id === "computational_predictions" && !compact
            ? effects.disabled_by_license
            : [];
        return (
          <section key={group.id}>
            <SectionHeader
              title={<span title={group.label}>{GROUP_TITLE[group.id]}</span>}
              count={values.filter((value) => value.state === "ok").length}
              actions={<EvidenceBadge evidenceClass={group.evidence_class} />}
              description={compact ? undefined : group.note}
            />
            {values.length > 0 ? (
              <ul className="text-xs">
                {values.map((value) => (
                  <EffectRow
                    key={value.key}
                    value={value}
                    group={group}
                    reference={effects.reference}
                  />
                ))}
              </ul>
            ) : (
              <EmptyState
                size="inline"
                title={
                  group.id === "experimental_functional"
                    ? "No functional assay at this residue"
                    : "No value at this residue"
                }
                description={
                  group.empty_message ??
                  (hidden > 0
                    ? `${hidden} source${hidden === 1 ? "" : "s"} returned no value here.`
                    : undefined)
                }
                searched={
                  group.id === "experimental_functional"
                    ? ["MaveDB"]
                    : undefined
                }
              />
            )}
            {scoreSets.length > 0 && !compact ? (
              <ul className="border-t border-border-subtle text-xs">
                {scoreSets.map((scoreSet) => (
                  <li
                    key={scoreSet.urn}
                    className="flex items-baseline gap-2 border-b border-border-subtle px-3 py-1.5 last:border-b-0"
                  >
                    <span className="tabular w-16 shrink-0 font-mono text-2xs text-muted-foreground">
                      {scoreSet.uniprot_start !== null &&
                      scoreSet.uniprot_end !== null
                        ? `${scoreSet.uniprot_start}-${scoreSet.uniprot_end}`
                        : "not located"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <ExternalLink href={scoreSet.url}>
                        {scoreSet.title ?? scoreSet.urn}
                      </ExternalLink>
                      <span className="block text-2xs text-subtle-foreground">
                        {scoreSet.covers_residue
                          ? "Covers this residue"
                          : "Does not cover this residue"}
                        {scoreSet.num_variants !== null
                          ? `, ${scoreSet.num_variants} variants scored`
                          : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {disabled.length > 0 ? (
              <ul className="border-t border-border-subtle text-xs">
                {disabled.map((value) => (
                  <li
                    key={value.key}
                    className="border-b border-border-subtle px-3 py-1.5 last:border-b-0"
                  >
                    <span className="text-muted-foreground">{value.label}</span>
                    <span className="block text-2xs text-subtle-foreground">
                      Not requested. {value.message}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}
    </>
  );
}
