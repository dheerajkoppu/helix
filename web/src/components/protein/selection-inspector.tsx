"use client";

import { useMemo } from "react";

import {
  DefinitionList,
  DefinitionRow,
} from "@/components/data/definition-list";
import { ExternalLink } from "@/components/data/external-link";
import { SectionHeader } from "@/components/data/section-header";
import { TextLink } from "@/components/data/text-link";
import { EvidencePopover } from "@/components/evidence/evidence-popover";
import { AddToProjectButton } from "@/components/project/add-to-project";
import { LearnTerm } from "@/components/science/learn-term";
import { ClinicalSignificanceChip } from "@/components/science/legends";
import { MetricReadout } from "@/components/science/metric-readout";
import type { SequenceVariant } from "@/components/sequence";
import { EmptyState } from "@/components/states/empty-state";
import { QueryErrorState, RowsSkeleton } from "@/components/states/query-state";
import { Button } from "@/components/ui/button";
import type { EvidenceItem } from "@/lib/evidence";
import { routes, toThreeLetter } from "@/lib/ids";
import { setWorkspaceHover } from "@/lib/state/hover";
import {
  useWorkspaceSelection,
  type ResidueRange,
} from "@/lib/state/selection";
import {
  structureDetail,
  useResidue,
  useResidueEffects,
  type ApiStructureDescriptor,
  type ProteinResponse,
  type ResidueEffectsResponse,
  type StructureLedger,
} from "@/lib/workspace-data";

import { Disclosure } from "./disclosure";
import { provenanceEvidence, toEvidenceItem } from "./evidence";
import { featureRows } from "./structure-ledger";

const shortId = (id: string) => id.slice(id.indexOf(":") + 1);
const HIDDEN_TRACKS = new Set(["chains", "natural_variants", "other"]);

const covers = (descriptor: ApiStructureDescriptor, position: number) =>
  (descriptor.coverage?.ranges ?? []).some(
    (range) => position >= range.start && position <= range.end,
  );

function variantEvidence(variant: SequenceVariant): EvidenceItem {
  const recordId = variant.sourceId ?? variant.id;
  return {
    evidenceClass:
      variant.evidenceClass ??
      (variant.group === "clinical" ? "clinical_database" : "curated_database"),
    statement: variant.description ?? variant.label,
    source: {
      database:
        variant.source ?? (variant.group === "clinical" ? "ClinVar" : "gnomAD"),
      recordId,
      url: /^VCV\d+/.test(recordId)
        ? `https://www.ncbi.nlm.nih.gov/clinvar/variation/${recordId}/`
        : null,
    },
  };
}

function VariantRows({
  gene,
  variants,
}: {
  gene: string | null;
  variants: SequenceVariant[];
}) {
  const selected = useWorkspaceSelection((state) => state.variant);
  const selectVariant = useWorkspaceSelection((state) => state.selectVariant);
  return (
    <ul className="pb-2">
      {variants.map((variant) => {
        const active =
          selected?.position === variant.position &&
          selected.alternate === variant.alternate;
        const substitution =
          variant.reference.length === 1 && variant.alternate.length === 1;
        return (
          <li
            key={`${variant.group}:${variant.id}:${variant.sourceId ?? ""}`}
            className="flex items-center gap-2 px-3 py-1 text-xs data-[active=true]:bg-active"
            data-active={active}
          >
            <EvidencePopover
              evidence={variantEvidence(variant)}
              size="compact"
              detail={null}
              className="shrink-0"
            />
            {variant.group === "clinical" && gene ? (
              <TextLink
                href={routes.variant(variant.id)}
                className="shrink-0 font-mono"
              >
                {variant.label}
              </TextLink>
            ) : (
              <span className="shrink-0 font-mono">{variant.label}</span>
            )}
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {variant.significance ? (
                <ClinicalSignificanceChip
                  significance={variant.significance}
                  reviewStars={variant.reviewStars}
                />
              ) : variant.alleleFrequency !== null &&
                variant.alleleFrequency !== undefined ? (
                <span className="tabular font-mono text-2xs">
                  AF {variant.alleleFrequency.toExponential(2)}
                </span>
              ) : (
                <span className="text-2xs">{variant.consequence}</span>
              )}
            </span>
            {substitution ? (
              <Button
                size="xs"
                variant={active ? "outline" : "ghost"}
                aria-pressed={active}
                onClick={() =>
                  selectVariant(
                    active
                      ? null
                      : {
                          reference: variant.reference,
                          position: variant.position,
                          alternate: variant.alternate,
                          sourceId: variant.sourceId ?? null,
                        },
                  )
                }
              >
                {active ? "Shown" : "Show in 3D"}
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function EffectGroups({ effects }: { effects: ResidueEffectsResponse }) {
  return (
    <>
      {effects.groups.map((group) => (
        <div key={group.id} className="pb-2">
          <p className="px-3 pt-1 pb-1 text-2xs font-medium tracking-[0.04em] text-subtle-foreground uppercase">
            {group.label}
          </p>
          {group.values.length === 0 ? (
            <p className="px-3 text-2xs text-muted-foreground">
              {group.empty_message ?? "No source found"}
            </p>
          ) : (
            <ul>
              {group.values.map((value) => {
                const evidence = value.evidence
                  ? toEvidenceItem(value.evidence, value.label)
                  : provenanceEvidence(
                      value.provenance,
                      group.evidence_class,
                      value.label,
                      [value.tool, value.tool_version]
                        .filter(Boolean)
                        .join(" ") || null,
                    );
                return (
                  <li
                    key={value.key}
                    className="flex items-baseline gap-2 px-3 py-1 text-xs"
                  >
                    <EvidencePopover
                      evidence={evidence}
                      size="compact"
                      detail={null}
                      className="shrink-0"
                    />
                    {value.key.startsWith("alphamissense") &&
                    typeof value.value === "number" ? (
                      <MetricReadout
                        metric="alphamissense"
                        value={value.value}
                        label={value.label}
                        producedBy={[value.tool, value.tool_version]
                          .filter(Boolean)
                          .join(" ")}
                      />
                    ) : (
                      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                        <span className="text-muted-foreground">
                          {value.label}
                        </span>
                        {value.state === "ok" &&
                        value.value !== null &&
                        value.value !== undefined ? (
                          <span className="tabular font-mono text-foreground">
                            {typeof value.value === "number"
                              ? Number(value.value.toFixed(3))
                              : String(value.value)}
                            {value.unit ? ` ${value.unit}` : ""}
                          </span>
                        ) : (
                          <span className="text-subtle-foreground">
                            {value.message ?? "Unknown"}
                          </span>
                        )}
                        {value.class_label ? (
                          <span className="text-foreground">
                            {value.class_label}
                          </span>
                        ) : null}
                        {value.scale ? (
                          <span className="text-2xs text-subtle-foreground">
                            {value.scale}
                          </span>
                        ) : null}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}
      {effects.groups.find((group) => group.note)?.note ? (
        <p className="px-3 pb-3 text-2xs leading-relaxed text-subtle-foreground">
          {effects.groups.find((group) => group.note)?.note}
        </p>
      ) : null}
    </>
  );
}

export interface ResidueInspectorProps {
  accession: string;
  gene: string | null;
  position: number;
  /** null while the variant sources are loading or when they failed */
  variants: SequenceVariant[] | null;
  active: ApiStructureDescriptor | null;
  /** key readout and variants first, the rest under Details */
  simple?: boolean;
}

export function ResidueInspector({
  accession,
  gene,
  position,
  variants,
  active,
  simple = false,
}: ResidueInspectorProps) {
  const residue = useResidue(accession, position);
  const selectedVariant = useWorkspaceSelection((state) => state.variant);
  const selectRange = useWorkspaceSelection((state) => state.selectRange);
  const alternate =
    selectedVariant?.position === position ? selectedVariant.alternate : null;
  const effects = useResidueEffects(accession, position, { alt: alternate });
  const record = residue.data?.data;
  const effectData = effects.data?.data;
  const here = useMemo(
    () =>
      (variants ?? [])
        .filter((variant) => variant.position === position)
        .sort((left, right) => left.group.localeCompare(right.group)),
    [variants, position],
  );

  if (residue.isPending) return <RowsSkeleton rows={8} />;
  if (residue.isError || !record)
    return (
      <QueryErrorState
        error={residue.error}
        subject={`residue ${position} of ${accession}`}
        onRetry={() => void residue.refetch()}
      />
    );

  const name = `${record.amino_acid_three ?? record.amino_acid}${position}`;
  const features = record.tracks
    .filter((track) => !HIDDEN_TRACKS.has(track.id))
    .flatMap((track) =>
      track.features.map((feature) => ({ track: track.label, feature })),
    );
  const offset = position - record.window_start;

  const positionBlock = (
    <>
      <SectionHeader
        title="Position"
        actions={
          <EvidencePopover
            evidence={provenanceEvidence(
              record.provenance,
              "curated_database",
              `${name} in the canonical sequence of ${accession}`,
            )}
            size="compact"
          />
        }
      />
      <DefinitionList>
        <DefinitionRow term={<LearnTerm term="residue">Residue</LearnTerm>}>
          <span className="font-mono">{record.amino_acid}</span>{" "}
          {record.amino_acid_name} {position} of {record.sequence_length}
        </DefinitionRow>
        <DefinitionRow term="Context" mono>
          <span className="text-muted-foreground">
            {record.window.slice(0, offset)}
          </span>
          <span className="font-semibold text-foreground underline underline-offset-2">
            {record.window[offset]}
          </span>
          <span className="text-muted-foreground">
            {record.window.slice(offset + 1)}
          </span>
        </DefinitionRow>
        <DefinitionRow term="Numbering">
          UniProt canonical, {accession}
        </DefinitionRow>
        <DefinitionRow term="In the 3D view">
          {active
            ? covers(active, position)
              ? `Has coordinates in ${shortId(active.id)}`
              : `No coordinates in ${shortId(active.id)}`
            : "No structure loaded"}
        </DefinitionRow>
      </DefinitionList>

      <SectionHeader title="Annotations" count={features.length} />
      {features.length === 0 ? (
        <EmptyState
          size="inline"
          title="No feature annotated at this residue"
          searched={["UniProtKB", "InterPro"]}
        />
      ) : (
        <ul className="pb-2">
          {features.map(({ track, feature }, index) => {
            const start = feature.start;
            const end = feature.end;
            const label =
              [feature.description, feature.ligand?.name]
                .filter(Boolean)
                .join(", ") || track;
            return (
              <li
                key={`${feature.id}:${index}`}
                className="flex items-baseline gap-2 px-3 py-1 text-xs"
              >
                {feature.evidence[0] ? (
                  <EvidencePopover
                    evidence={toEvidenceItem(
                      feature.evidence[0],
                      `${feature.type}: ${label}`,
                    )}
                    size="compact"
                    detail={null}
                    className="shrink-0"
                  />
                ) : null}
                <span className="shrink-0 text-muted-foreground">
                  {feature.type}
                </span>
                <span className="min-w-0 flex-1 truncate" title={label}>
                  {label}
                </span>
                {typeof start === "number" && typeof end === "number" ? (
                  <button
                    type="button"
                    className="tabular shrink-0 cursor-pointer rounded-xs font-mono text-2xs text-muted-foreground underline decoration-border-strong underline-offset-2 hover:text-foreground"
                    onClick={() => selectRange({ start, end })}
                  >
                    {start === end ? start : `${start}-${end}`}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

    </>
  );
  const variantBlock = (
    <>
      <SectionHeader
        title={simple ? "Variants here" : "Variants at this position"}
        count={variants ? here.length : null}
      />
      {variants === null ? (
        <EmptyState
          size="inline"
          title="Variant sources have not answered"
          description="ClinVar, UniProt and gnomAD rows appear here once they load."
        />
      ) : here.length === 0 ? (
        <EmptyState
          size="inline"
          title="No variant recorded at this position"
          searched={["ClinVar", "UniProt", "gnomAD v4.1"]}
        />
      ) : (
        <VariantRows gene={gene} variants={here} />
      )}

    </>
  );
  const effectBlock = (
    <>
      <SectionHeader
        title="Variant effect summary"
        description={
          alternate
            ? `Values for ${name}${toThreeLetter(alternate) ?? alternate}.`
            : "Residue-level values. Show a variant in 3D for its own scores."
        }
      />
      {effects.isPending ? (
        <RowsSkeleton rows={4} />
      ) : effects.isError || !effectData ? (
        <QueryErrorState
          error={effects.error}
          subject={`effect values at ${name}`}
          onRetry={() => void effects.refetch()}
        />
      ) : (
        <EffectGroups effects={effectData} />
      )}

    </>
  );
  const addBlock = (
      <div className="flex flex-wrap gap-2 border-t border-border-subtle px-3 py-2">
        <AddToProjectButton
          size="sm"
          label="Add residue"
          item={{
            kind: "residue",
            ref: `${accession}:${position}`,
            label: `${gene ?? accession} ${name}`,
            origin: { route: `${routes.protein(accession)}?sel=${position}` },
            data: {
              accession,
              position,
              amino_acid: record.amino_acid,
              structure_id: active?.id ?? null,
            },
          }}
        />
      </div>
  );

  return (
    <div
      onMouseEnter={() =>
        setWorkspaceHover({ accession, position, origin: "ledger" })
      }
      onMouseLeave={() => setWorkspaceHover(null)}
    >
      <div className="border-b border-border-subtle px-3 py-3">
        <MetricReadout
          metric="plddt"
          value={effectData?.residue.plddt}
          missingReason={
            effects.isPending
              ? "Loading"
              : "No predicted model for this residue"
          }
          label={
            <>
              <LearnTerm term="plddt">pLDDT</LearnTerm> at {name}
              {effectData?.residue.plddt_structure_id ? (
                <span className="font-mono text-2xs">
                  {" "}
                  in {shortId(effectData.residue.plddt_structure_id)}
                </span>
              ) : null}
            </>
          }
          producedBy={effectData?.residue.plddt_structure_id ?? null}
        />
      </div>

      {simple ? (
        <>
          {variantBlock}
          <Disclosure label="Details">
            {positionBlock}
            {effectBlock}
            {addBlock}
          </Disclosure>
        </>
      ) : (
        <>
          {positionBlock}
          {variantBlock}
          {effectBlock}
          {addBlock}
        </>
      )}
    </div>
  );
}

export interface RangeInspectorProps {
  accession: string;
  gene: string | null;
  range: ResidueRange;
  protein: ProteinResponse;
  ledger: StructureLedger | null;
  variants: SequenceVariant[] | null;
  /** pLDDT of the canonical predicted model, index 0 is residue 1 */
  plddt: Array<number | null> | null;
  plddtSource: string | null;
  onStructure: (structureId: string) => void;
  /** key readout first, the rest under Details */
  simple?: boolean;
}

const SITE_GROUPS = new Set([
  "Active sites",
  "Binding sites",
  "Modified residues",
  "Motifs",
]);

export function RangeInspector({
  accession,
  gene,
  range,
  protein,
  ledger,
  variants,
  plddt,
  plddtSource,
  onStructure,
  simple = false,
}: RangeInspectorProps) {
  const selectResidue = useWorkspaceSelection((state) => state.selectResidue);
  const rows = useMemo(() => featureRows(protein), [protein]);
  const match = rows.find(
    (row) => row.start === range.start && row.end === range.end,
  );
  const sites = rows.filter(
    (row) =>
      SITE_GROUPS.has(row.group) &&
      row.start >= range.start &&
      row.end <= range.end,
  );
  const inside = useMemo(
    () =>
      (variants ?? []).filter(
        (variant) =>
          variant.position >= range.start && variant.position <= range.end,
      ),
    [variants, range.start, range.end],
  );
  const clinical = inside.filter((variant) => variant.group === "clinical");
  const population = inside.length - clinical.length;
  const scores = (plddt ?? [])
    .slice(range.start - 1, range.end)
    .filter((score): score is number => typeof score === "number");
  const mean =
    scores.length > 0
      ? scores.reduce((sum, score) => sum + score, 0) / scores.length
      : null;
  const covering = (ledger?.experimental ?? []).filter((entry) =>
    (entry.structure.coverage?.ranges ?? []).some(
      (covered) => covered.start <= range.end && covered.end >= range.start,
    ),
  );
  const span = `${range.start}-${range.end}`;

  const detail = (
    <>
      <SectionHeader
        title={match ? match.group.replace(/s$/, "") : "Range"}
        actions={
          match?.feature.evidence[0] ? (
            <EvidencePopover
              evidence={toEvidenceItem(
                match.feature.evidence[0],
                `${match.feature.type}: ${match.label}`,
              )}
              size="compact"
            />
          ) : null
        }
      />
      <DefinitionList>
        {match ? (
          <DefinitionRow
            term={<LearnTerm term="protein-domain">Feature</LearnTerm>}
          >
            {match.label}
          </DefinitionRow>
        ) : null}
        <DefinitionRow term="Residues" mono>
          {span} ({range.end - range.start + 1} aa)
        </DefinitionRow>
        <DefinitionRow term="Numbering">
          UniProt canonical, {accession}
        </DefinitionRow>
        <DefinitionRow term="Experimental entries">
          {ledger
            ? covering.length > 0
              ? `${covering.length} overlap this range`
              : "None overlaps this range"
            : null}
        </DefinitionRow>
      </DefinitionList>
      {covering.length > 0 ? (
        <ul className="flex flex-wrap gap-1 px-3 pb-3">
          {covering.slice(0, 8).map((entry) => (
            <li key={entry.structure.id}>
              <Button
                size="xs"
                variant="outline"
                className="font-mono"
                title={`${structureDetail(entry.structure)}. Load in the 3D view.`}
                onClick={() => onStructure(entry.structure.id)}
              >
                {shortId(entry.structure.id)}
              </Button>
            </li>
          ))}
          {covering.length > 8 ? (
            <li className="self-center text-2xs text-subtle-foreground">
              and {covering.length - 8} more in the ledger
            </li>
          ) : null}
        </ul>
      ) : null}

      <SectionHeader title="Functional sites inside" count={sites.length} />
      {sites.length === 0 ? (
        <EmptyState
          size="inline"
          title="No site annotated in this range"
          searched={["UniProtKB"]}
        />
      ) : (
        <ul className="pb-2">
          {sites.map((row) => (
            <li
              key={row.id}
              className="flex items-baseline gap-2 px-3 py-1 text-xs"
            >
              {row.feature.evidence[0] ? (
                <EvidencePopover
                  evidence={toEvidenceItem(
                    row.feature.evidence[0],
                    `${row.feature.type}: ${row.label}`,
                  )}
                  size="compact"
                  detail={null}
                  className="shrink-0"
                />
              ) : null}
              <span className="min-w-0 flex-1 truncate" title={row.label}>
                {row.label}
              </span>
              <button
                type="button"
                className="tabular shrink-0 cursor-pointer rounded-xs font-mono text-2xs text-muted-foreground underline decoration-border-strong underline-offset-2 hover:text-foreground"
                onClick={() => selectResidue(row.start)}
              >
                {row.start === row.end ? row.start : `${row.start}-${row.end}`}
              </button>
            </li>
          ))}
        </ul>
      )}

      <SectionHeader
        title="Variants in this range"
        count={variants ? inside.length : null}
        description={
          variants
            ? `${clinical.length} in clinical databases, ${population} in gnomAD.`
            : undefined
        }
      />
      {variants === null ? (
        <EmptyState size="inline" title="Variant sources have not answered" />
      ) : clinical.length === 0 ? (
        <EmptyState
          size="inline"
          title="No clinical-database variant in this range"
          searched={["ClinVar", "UniProt"]}
        />
      ) : (
        <>
          <VariantRows gene={gene} variants={clinical.slice(0, 25)} />
          {clinical.length > 25 ? (
            <p className="px-3 pb-3 text-2xs text-subtle-foreground">
              First 25 of {clinical.length} by position.{" "}
              {gene ? (
                <TextLink href={routes.gene(gene)}>
                  Full table on the gene stage
                </TextLink>
              ) : null}
            </p>
          ) : null}
        </>
      )}
    </>
  );

  return (
    <div>
      <div className="border-b border-border-subtle px-3 py-3">
        <MetricReadout
          metric="plddt"
          value={mean}
          missingReason="No predicted model covers this range"
          label={
            <>
              Mean <LearnTerm term="plddt">pLDDT</LearnTerm> over {span}
              {plddtSource ? (
                <span className="font-mono text-2xs">
                  {" "}
                  in {plddtSource.split(", ").pop()}
                </span>
              ) : null}
            </>
          }
          producedBy={
            plddtSource
              ? `${plddtSource}; mean of ${scores.length} per-residue values`
              : null
          }
        />
      </div>
      {simple ? (
        <>
          <dl className="flex gap-6 px-3 py-3 text-xs">
            {(
              [
                ["Residues", `${span}`],
                ["Clinical variants", variants ? clinical.length : null],
                ["Sites", sites.length],
              ] as const
            ).map(([term, value]) => (
              <div key={term} className="flex flex-col gap-0.5">
                <dt className="text-2xs text-subtle-foreground">{term}</dt>
                <dd className="tabular font-mono text-sm text-foreground">
                  {value ?? "Loading"}
                </dd>
              </div>
            ))}
          </dl>
          <Disclosure label="Details">{detail}</Disclosure>
        </>
      ) : (
        detail
      )}
    </div>
  );
}

export function ProteinOverview({
  protein,
  ledger,
}: {
  protein: ProteinResponse;
  ledger: StructureLedger | null;
}) {
  const statement = protein.function[0];
  const provenance = provenanceEvidence(
    protein.provenance,
    "curated_database",
    `UniProtKB entry ${protein.accession}`,
  );
  return (
    <div>
      <SectionHeader
        title="Protein"
        actions={<EvidencePopover evidence={provenance} size="compact" />}
      />
      <DefinitionList>
        <DefinitionRow term="Name">{protein.names.recommended}</DefinitionRow>
        <DefinitionRow term="Gene">
          {protein.gene ? (
            <TextLink href={routes.gene(protein.gene.id)} className="font-mono">
              {protein.gene.id}
            </TextLink>
          ) : null}
        </DefinitionRow>
        <DefinitionRow term="UniProt">
          <ExternalLink
            href={`https://www.uniprot.org/uniprotkb/${protein.accession}`}
            className="font-mono"
          >
            {protein.accession}
          </ExternalLink>{" "}
          <span className="text-muted-foreground">
            {protein.reviewed ? "reviewed" : "unreviewed"}
          </span>
        </DefinitionRow>
        <DefinitionRow term="Length" mono>
          {protein.sequence.value.length} aa
        </DefinitionRow>
        <DefinitionRow term="Existence">
          {protein.protein_existence}
        </DefinitionRow>
      </DefinitionList>

      <SectionHeader title="Function" />
      {statement ? (
        <div className="flex items-baseline gap-2 px-3 pb-3 text-xs leading-relaxed">
          {statement.evidence[0] ? (
            <EvidencePopover
              evidence={toEvidenceItem(statement.evidence[0], statement.text)}
              size="compact"
              detail={null}
              className="shrink-0"
            />
          ) : (
            <EvidencePopover
              evidence={provenance}
              size="compact"
              detail={null}
              className="shrink-0"
            />
          )}
          <p className="line-clamp-[9]" title={statement.text}>
            {statement.text}
          </p>
        </div>
      ) : (
        <EmptyState
          size="inline"
          title="No function statement"
          searched={["UniProtKB"]}
        />
      )}

      {ledger?.recommended ? (
        <>
          <SectionHeader title="Structure shown by default" />
          <p className="px-3 pb-3 text-2xs leading-relaxed text-muted-foreground">
            {ledger.recommended.reason}
          </p>
        </>
      ) : null}

      <p className="border-t border-border-subtle px-3 py-2 text-2xs text-subtle-foreground">
        Click a residue in 3D or on the sequence axis, or a feature in the
        ledger, to inspect it here.
      </p>
    </div>
  );
}
