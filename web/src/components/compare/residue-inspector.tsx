"use client";

import {
  DefinitionList,
  DefinitionRow,
} from "@/components/data/definition-list";
import { ExternalLink } from "@/components/data/external-link";
import { SectionHeader } from "@/components/data/section-header";
import { TextLink } from "@/components/data/text-link";
import { ClaimLabel } from "@/components/evidence/evidence-badge";
import { EvidencePopover } from "@/components/evidence/evidence-popover";
import { LiteraturePanel } from "@/components/literature/literature-panel";
import { LearnTerm } from "@/components/science/learn-term";
import { Disclosure } from "@/components/protein/disclosure";
import { MetricReadout } from "@/components/science/metric-readout";
import { EmptyState } from "@/components/states/empty-state";
import { QueryErrorState, RowsSkeleton } from "@/components/states/query-state";
import type { Schema } from "@/lib/api/types";
import {
  isEvidenceClass,
  toEvidenceSource,
  type EvidenceClass,
  type EvidenceItem,
} from "@/lib/evidence";
import { aminoAcidName, routes, toThreeLetter } from "@/lib/ids";
import { useWorkspaceSelection } from "@/lib/state/selection";
import { withSelection } from "@/lib/state/selection-url";
import {
  useResidueEffects,
  type ComparePlanResponse,
  type CompareResultResponse,
} from "@/lib/workspace-data";

import {
  citationHref,
  formatAngstrom,
  modelEvidence,
  type Citation,
} from "./model";

type EffectValue = Schema<"EffectValue">;
type EffectGroup = Schema<"EffectGroup">;

const residueLabel = (letter: string | null | undefined, position: number) =>
  letter ? `${toThreeLetter(letter) ?? letter}${position}` : `${position}`;

function ClaimSection({
  title,
  count,
  evidenceClass,
}: {
  title: React.ReactNode;
  count?: number | null;
  evidenceClass: EvidenceClass;
}) {
  return (
    <SectionHeader
      title={title}
      count={count}
      actions={
        <ClaimLabel evidenceClass={evidenceClass} className="text-2xs" />
      }
    />
  );
}

const Note = ({ children }: { children: React.ReactNode }) => (
  <p className="px-3 py-1.5 text-2xs leading-4 text-subtle-foreground">
    {children}
  </p>
);

function effectEvidence(
  value: EffectValue,
  groupClass: EvidenceClass,
): EvidenceItem | null {
  const source =
    toEvidenceSource(value.evidence?.source) ??
    toEvidenceSource(value.provenance);
  if (!source) return null;
  const declared = value.evidence?.evidence_class;
  return {
    evidenceClass: isEvidenceClass(declared) ? declared : groupClass,
    statement: value.evidence?.statement ?? value.label,
    source,
    method: [value.tool, value.tool_version].filter(Boolean).join(" ") || null,
    modifiers: value.structure ? [`computed on ${value.structure.id}`] : [],
  };
}

function effectText(value: EffectValue): string | null {
  const raw = value.value as unknown;
  if (typeof raw === "number") {
    const digits = Number.isInteger(raw) ? 0 : Math.abs(raw) < 10 ? 3 : 1;
    return `${raw.toFixed(digits)}${value.unit ? ` ${value.unit}` : ""}`;
  }
  if (typeof raw === "string" && raw.length > 0) return raw;
  const begin = value.details?.begin;
  const end = value.details?.end;
  if (typeof begin === "string" || typeof begin === "number")
    return end && end !== begin
      ? `residues ${begin}-${end}`
      : `residue ${begin}`;
  return null;
}

function EffectRow({
  value,
  groupClass,
}: {
  value: EffectValue;
  groupClass: EvidenceClass;
}) {
  const evidence =
    value.state === "ok" ? effectEvidence(value, groupClass) : null;
  const text = value.state === "ok" ? effectText(value) : null;
  return (
    <div className="flex items-baseline gap-2 border-b border-border-subtle px-3 py-1.5 text-xs last:border-b-0">
      <span className="w-11 shrink-0">
        {evidence ? (
          <EvidencePopover evidence={evidence} size="compact" side="left" />
        ) : null}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-muted-foreground">{value.label}</span>
          {text ? (
            <span className="tabular font-mono break-words text-foreground">
              {text}
            </span>
          ) : value.state === "ok" ? null : (
            <span className="text-subtle-foreground">No value</span>
          )}
          {value.class_label ? <span>{value.class_label}</span> : null}
        </div>
        {value.state === "ok" && value.scale ? (
          <p className="text-2xs leading-4 text-subtle-foreground">
            {value.scale}
            {value.tool
              ? `. ${value.tool}${value.tool_version ? ` ${value.tool_version}` : ""}`
              : ""}
          </p>
        ) : null}
        {value.message ? (
          <p className="text-2xs leading-4 text-subtle-foreground">
            {value.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function EffectGroupRows({
  group,
  values,
  emptyTitle,
}: {
  group: EffectGroup | undefined;
  values: EffectValue[];
  emptyTitle: string;
}) {
  if (!group) return null;
  if (values.length === 0)
    return (
      <EmptyState
        size="inline"
        title={emptyTitle}
        description={group.empty_message ?? undefined}
      />
    );
  return (
    <>
      {values.map((value) => (
        <EffectRow
          key={value.key}
          value={value}
          groupClass={group.evidence_class}
        />
      ))}
    </>
  );
}

/** The class every row of a group shares, or the group's own class when rows differ. */
function sharedClass(group: EffectGroup | undefined): EvidenceClass {
  const fallback = group?.evidence_class ?? "curated_database";
  const classes = new Set(
    (group?.values ?? [])
      .map((value) => value.evidence?.evidence_class)
      .filter(isEvidenceClass),
  );
  return classes.size === 1 ? [...classes][0] : fallback;
}

function CitationPopover({ citation }: { citation: Citation }) {
  return (
    <EvidencePopover
      size="compact"
      side="left"
      detail={citation.year ?? undefined}
      evidence={{
        evidenceClass: "literature",
        statement: citation.title ?? citation.text,
        source: {
          database: citation.text ?? citation.title ?? "Publication",
          recordId: citation.doi ?? citation.pmid ?? null,
          url: citationHref(citation),
        },
        method:
          "Tabulated residue property; the difference is arithmetic on the two table values",
      }}
    />
  );
}

const signed = (value: number, digits: number) =>
  `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;

export interface ResidueInspectorBodyProps {
  plan: ComparePlanResponse;
  result: CompareResultResponse | null;
  /** canonical UniProt sequence, when it has loaded */
  sequence: string | null;
  position: number;
  /** the few values a first reading needs; the full record sits under Details */
  simple?: boolean;
}

/** Simple mode: the substitution, both pLDDT values and the displacement. */
function SimpleResidueInspector(props: ResidueInspectorBodyProps) {
  const { plan, result, sequence, position } = props;
  const { variant } = plan;
  const isSite = position === variant.position;
  const difference = result?.difference ?? null;
  const row =
    difference?.per_residue.find((entry) => entry.position === position) ??
    null;
  const referenceLetter =
    row?.reference_residue ??
    sequence?.[position - 1] ??
    (isSite ? variant.reference : null);
  const domain = plan.domains.find(
    (entry) => position >= entry.start && position <= entry.end,
  );
  const provider = result
    ? `${result.provider.model_name ?? result.provider.name} ${result.provider.model_version ?? ""}, run ${result.job_id}`
    : null;
  const contacts = isSite ? (difference?.contacts ?? null) : null;

  return (
    <div data-slot="compare-inspector">
      <p className="px-4 pt-4 pb-3 text-xs text-muted-foreground">
        {isSite
          ? `${aminoAcidName(variant.reference)} to ${aminoAcidName(variant.alternate)}, residue ${position}`
          : referenceLetter
            ? `${aminoAcidName(referenceLetter)}, same in both models`
            : `Residue ${position}`}
        {domain ? ` · ${domain.name} domain` : ""}
      </p>
      {result && difference ? (
        row ? (
          <>
            <div className="flex flex-col gap-2 border-t border-border-subtle px-4 py-3">
              <MetricReadout
                metric="plddt"
                value={row.plddt_reference}
                label="pLDDT, reference"
                producedBy={provider}
                terse
              />
              <MetricReadout
                metric="plddt"
                value={row.plddt_variant}
                label="pLDDT, variant"
                producedBy={provider}
                terse
              />
            </div>
            <div className="flex flex-col gap-1 border-t border-border-subtle px-4 py-3">
              <span className="flex items-center gap-2 text-2xs text-subtle-foreground">
                Predicted Cα shift
                <EvidencePopover
                  size="compact"
                  side="left"
                  evidence={modelEvidence(
                    result,
                    `Cα displacement at ${residueLabel(referenceLetter, position)} after superposition over ${difference.superposition.scope}`,
                  )}
                />
              </span>
              {row.masked || row.ca_displacement === null ? (
                <span className="text-sm text-muted-foreground">
                  Masked, pLDDT below {difference.masking.plddt_threshold}
                </span>
              ) : (
                <span className="tabular font-mono text-2xl leading-6 font-medium text-foreground">
                  {row.ca_displacement.toFixed(2)}
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    Å
                  </span>
                </span>
              )}
            </div>
            {contacts ? (
              <dl className="flex gap-6 border-t border-border-subtle px-4 py-3 text-xs">
                {(
                  [
                    ["Contacts gained", contacts.gained.length],
                    ["Lost", contacts.lost.length],
                    ["Kept", contacts.kept.length],
                  ] as const
                ).map(([term, count]) => (
                  <div key={term} className="flex flex-col gap-0.5">
                    <dt className="text-2xs text-subtle-foreground">{term}</dt>
                    <dd className="tabular font-mono text-sm text-foreground">
                      {count}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </>
        ) : (
          <p className="border-t border-border-subtle px-4 py-3 text-xs text-muted-foreground">
            Outside the modelled residues {result.construct.start}-
            {result.construct.end}.
          </p>
        )
      ) : null}
      <Disclosure label="Details">
        <FullResidueInspector {...props} />
      </Disclosure>
    </div>
  );
}

/** One residue of the comparison. Simple mode shows the key values and keeps the full record under Details. */
export function ResidueInspectorBody(props: ResidueInspectorBodyProps) {
  return props.simple ? (
    <SimpleResidueInspector {...props} />
  ) : (
    <FullResidueInspector {...props} />
  );
}

/** Everything known and computed about one residue of the comparison, each row with its claim label. */
function FullResidueInspector({
  plan,
  result,
  sequence,
  position,
}: ResidueInspectorBodyProps) {
  const { variant } = plan;
  const accession = variant.uniprot_accession;
  const isSite = position === variant.position;
  const variantKey =
    variant.variant_id ?? `${variant.gene_symbol}-${variant.hgvs_p}`;
  const selectResidue = useWorkspaceSelection((state) => state.selectResidue);
  const snapshot = useWorkspaceSelection();

  const effects = useResidueEffects(
    accession,
    position,
    isSite ? { alt: variant.alternate, ref: variant.reference } : {},
  );
  const groups = effects.data?.data.groups ?? [];
  const group = (id: EffectGroup["id"]) =>
    groups.find((entry) => entry.id === id);
  const predictions = group("computational_predictions");
  const stability =
    predictions?.values.filter((value) => value.kind === "stability_ddg") ?? [];
  const predictors =
    predictions?.values.filter((value) => value.kind !== "stability_ddg") ?? [];
  const curated = group("curated_annotation");
  const assays = group("experimental_functional");
  const context = group("structural_context");

  const difference = result?.difference ?? null;
  const row =
    difference?.per_residue.find((entry) => entry.position === position) ??
    null;
  const referenceLetter =
    row?.reference_residue ??
    sequence?.[position - 1] ??
    (isSite ? variant.reference : null);
  const variantLetter = isSite
    ? variant.alternate
    : (row?.variant_residue ?? referenceLetter);
  const domain = plan.domains.find(
    (entry) => position >= entry.start && position <= entry.end,
  );
  const caveat = (id: string) =>
    (result?.caveats ?? plan.caveats).find((entry) => entry.id === id)?.text;

  const neighbour = difference?.neighbours.residues.find(
    (entry) => entry.position === position,
  );
  const contacts = difference?.contacts ?? null;
  const contactOf = (
    list: NonNullable<typeof contacts>["reference"],
    at: number,
  ) => list.find((entry) => entry.position === at);
  const provider = result
    ? `${result.provider.model_name ?? result.provider.name} ${result.provider.model_version ?? ""}, run ${result.job_id}`
    : null;
  const proteinEvidence: EvidenceItem = {
    evidenceClass: "curated_database",
    statement: `Canonical sequence of ${accession}`,
    source: {
      database: "UniProt",
      recordId: accession,
      url: `https://www.uniprot.org/uniprotkb/${accession}`,
    },
  };

  const contactLine = (at: number, list: "reference" | "variant") => {
    const contact = contacts ? contactOf(contacts[list], at) : undefined;
    return (
      <button
        key={at}
        type="button"
        onClick={() => selectResidue(at)}
        className="flex w-full items-baseline gap-2 border-b border-border-subtle px-3 py-1 text-left text-xs last:border-b-0 hover:bg-accent"
      >
        <span className="tabular w-16 shrink-0 font-mono text-foreground">
          {residueLabel(contact?.residue, at)}
        </span>
        {contact ? (
          <span className="tabular font-mono text-muted-foreground">
            {formatAngstrom(contact.min_distance)} {contact.site_atom}-
            {contact.partner_atom}
          </span>
        ) : null}
        {contact ? (
          <span className="ml-auto text-2xs text-subtle-foreground">
            pLDDT {contact.plddt.toFixed(0)}
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <div data-slot="compare-inspector">
      <ClaimSection title="Residue" evidenceClass="curated_database" />
      <DefinitionList>
        <DefinitionRow term="Reference amino acid">
          {referenceLetter ? (
            <span className="inline-flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono">
                {toThreeLetter(referenceLetter)} ({referenceLetter})
              </span>
              <span className="text-muted-foreground">
                {aminoAcidName(referenceLetter)}
              </span>
              <EvidencePopover
                evidence={proteinEvidence}
                size="compact"
                side="left"
              />
            </span>
          ) : null}
        </DefinitionRow>
        <DefinitionRow term="Variant amino acid">
          {isSite ? (
            <span className="inline-flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono">
                {toThreeLetter(variant.alternate)} ({variant.alternate})
              </span>
              <span className="text-muted-foreground">
                {aminoAcidName(variant.alternate)}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">
              Not substituted
              {variantLetter
                ? `, ${toThreeLetter(variantLetter)} in both models`
                : ""}
            </span>
          )}
        </DefinitionRow>
        <DefinitionRow term="Position" mono>
          {position}{" "}
          <span className="font-sans text-muted-foreground">
            UniProt canonical, {accession}
          </span>
        </DefinitionRow>
        <DefinitionRow
          term={<LearnTerm term="protein-domain">Domain</LearnTerm>}
        >
          {domain ? (
            <>
              {domain.name}{" "}
              <span className="tabular font-mono text-muted-foreground">
                {domain.start}-{domain.end}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">
              No domain annotated at this position
            </span>
          )}
        </DefinitionRow>
        {isSite ? (
          <DefinitionRow term="Reference check">
            {plan.reference_check.message}
          </DefinitionRow>
        ) : null}
      </DefinitionList>

      {result && difference ? (
        <>
          <ClaimSection
            title="Local confidence"
            evidenceClass="computational_prediction"
          />
          {row ? (
            <div className="flex flex-col gap-1.5 border-b border-border-subtle px-3 py-2">
              <MetricReadout
                metric="plddt"
                value={row.plddt_reference}
                label={
                  <>
                    <LearnTerm term="plddt">pLDDT</LearnTerm>, reference model
                  </>
                }
                producedBy={provider}
              />
              <MetricReadout
                metric="plddt"
                value={row.plddt_variant}
                label="pLDDT, variant model"
                producedBy={provider}
              />
            </div>
          ) : (
            <EmptyState
              size="inline"
              title="Outside the modelled construct"
              description={`Both models cover residues ${result.construct.start}-${result.construct.end}.`}
            />
          )}
          {caveat("plddt_is_model_behaviour") ? (
            <Note>{caveat("plddt_is_model_behaviour")}</Note>
          ) : null}

          {row ? (
            <>
              <ClaimSection
                title="Predicted displacement"
                evidenceClass="computational_prediction"
              />
              <DefinitionList>
                <DefinitionRow term="Cα displacement">
                  <span className="inline-flex flex-wrap items-baseline gap-x-2">
                    {row.masked || row.ca_displacement === null ? (
                      <span className="text-muted-foreground">
                        Masked: pLDDT below {difference.masking.plddt_threshold}{" "}
                        in at least one model
                      </span>
                    ) : (
                      <span className="tabular font-mono">
                        {formatAngstrom(row.ca_displacement, 3)}
                      </span>
                    )}
                    <EvidencePopover
                      size="compact"
                      side="left"
                      evidence={modelEvidence(
                        result,
                        `Cα displacement at ${residueLabel(referenceLetter, position)} after superposition over ${difference.superposition.scope}`,
                      )}
                    />
                  </span>
                </DefinitionRow>
                {isSite ? (
                  <DefinitionRow term="Local Cα RMSD">
                    <span className="tabular font-mono">
                      {difference.local_difference.rmsd_ca_global_fit === null
                        ? "Not reported"
                        : formatAngstrom(
                            difference.local_difference.rmsd_ca_global_fit,
                            3,
                          )}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      over {difference.local_difference.residues} residues
                      within {difference.local_difference.radius} Å of the site
                      {difference.local_difference.rmsd_ca_local_fit === null
                        ? ""
                        : `; ${formatAngstrom(difference.local_difference.rmsd_ca_local_fit, 3)} after a local fit`}
                    </span>
                  </DefinitionRow>
                ) : neighbour ? (
                  <DefinitionRow term="Distance to site">
                    <span className="tabular font-mono">
                      {formatAngstrom(neighbour.ca_distance_reference)}
                    </span>{" "}
                    <span className="text-muted-foreground">reference,</span>{" "}
                    <span className="tabular font-mono">
                      {formatAngstrom(neighbour.ca_distance_variant)}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      variant (Cα to Cα of residue {variant.position})
                    </span>
                  </DefinitionRow>
                ) : null}
              </DefinitionList>
              <Note>
                {caveat("geometry_from_predicted_models")}{" "}
                {caveat("run_to_run_variation_not_estimated")}
              </Note>
            </>
          ) : null}

          {isSite && contacts ? (
            <>
              <ClaimSection
                title="Contacts gained"
                count={contacts.gained.length}
                evidenceClass="computational_prediction"
              />
              {contacts.gained.length ? (
                contacts.gained.map((at) => (
                  contactLine(at, "variant")
                ))
              ) : (
                <EmptyState size="inline" title="None in the variant model" />
              )}
              <ClaimSection
                title="Contacts lost"
                count={contacts.lost.length}
                evidenceClass="computational_prediction"
              />
              {contacts.lost.length ? (
                contacts.lost.map((at) => (
                  contactLine(at, "reference")
                ))
              ) : (
                <EmptyState
                  size="inline"
                  title="None: every reference contact is kept"
                />
              )}
              <Note>
                {contacts.kept.length} contacts kept. Heavy atoms within{" "}
                {contacts.cutoff} Å of the site, {contacts.label}.{" "}
                {contacts.exclusion}
              </Note>

              <ClaimSection
                title="Nearby residues"
                count={difference.neighbours.residues.length}
                evidenceClass="computational_prediction"
              />
              <div className="grid grid-cols-[4rem_1fr_1fr_auto] gap-x-2 border-b border-border-subtle px-3 py-1 text-2xs text-subtle-foreground">
                <span>Residue</span>
                <span>Cα dist. ref</span>
                <span>Cα dist. var</span>
                <span>pLDDT</span>
              </div>
              {difference.neighbours.residues.map((entry) => (
                <button
                  key={entry.position}
                  type="button"
                  onClick={() => selectResidue(entry.position)}
                  className="grid w-full grid-cols-[4rem_1fr_1fr_auto] items-baseline gap-x-2 border-b border-border-subtle px-3 py-1 text-left text-xs last:border-b-0 hover:bg-accent"
                >
                  <span className="tabular font-mono text-foreground">
                    {residueLabel(entry.residue, entry.position)}
                  </span>
                  <span className="tabular font-mono">
                    {formatAngstrom(entry.ca_distance_reference)}
                  </span>
                  <span className="tabular font-mono">
                    {formatAngstrom(entry.ca_distance_variant)}
                  </span>
                  <span className="tabular font-mono text-muted-foreground">
                    {entry.plddt_reference.toFixed(0)}/
                    {entry.plddt_variant.toFixed(0)}
                    {entry.masked ? " M" : ""}
                  </span>
                </button>
              ))}
              <Note>
                Cα within {difference.neighbours.radius} Å of the site in either
                model, {difference.neighbours.label}. M marks a masked residue.
              </Note>
            </>
          ) : null}
        </>
      ) : null}

      <ClaimSection
        title="Known annotation"
        count={curated?.values.length}
        evidenceClass={sharedClass(curated)}
      />
      {effects.isPending ? (
        <RowsSkeleton rows={3} />
      ) : effects.isError ? (
        <QueryErrorState
          size="inline"
          error={effects.error}
          subject={`annotation at residue ${position}`}
          onRetry={() => void effects.refetch()}
        />
      ) : (
        <>
          <EffectGroupRows
            group={curated}
            values={curated?.values ?? []}
            emptyTitle="No curated annotation at this residue"
          />
          <ClaimSection
            title="Functional assays"
            count={assays?.values.length}
            evidenceClass="experimental"
          />
          <EffectGroupRows
            group={assays}
            values={assays?.values ?? []}
            emptyTitle="No assay value at this residue"
          />

          {isSite && plan.property_change ? (
            <>
              <ClaimSection
                title="Substitution properties"
                evidenceClass="literature"
              />
              <DefinitionList>
                <DefinitionRow term="Side-chain volume">
                  <span className="tabular font-mono">
                    {plan.property_change.reference.volume_a3} →{" "}
                    {plan.property_change.variant.volume_a3} Å³ (
                    {signed(plan.property_change.volume_change_a3, 1)})
                  </span>
                </DefinitionRow>
                <DefinitionRow term="Hydropathy">
                  <span className="tabular font-mono">
                    {plan.property_change.reference.hydropathy} →{" "}
                    {plan.property_change.variant.hydropathy} (
                    {signed(plan.property_change.hydropathy_change, 1)})
                  </span>
                </DefinitionRow>
                <DefinitionRow term="Charge class">
                  {plan.property_change.reference.charge_class} →{" "}
                  {plan.property_change.variant.charge_class}
                  <span className="text-muted-foreground">
                    {plan.property_change.charge_changed
                      ? ", changed"
                      : ", unchanged"}
                  </span>
                </DefinitionRow>
                <DefinitionRow term="Polarity class">
                  {plan.property_change.reference.polarity_class} →{" "}
                  {plan.property_change.variant.polarity_class}
                  <span className="text-muted-foreground">
                    {plan.property_change.polarity_changed
                      ? ", changed"
                      : ", unchanged"}
                  </span>
                </DefinitionRow>
              </DefinitionList>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 text-2xs text-subtle-foreground">
                <span>Property tables</span>
                {plan.property_change.sources.map((citation) => (
                  <CitationPopover key={citation.text} citation={citation} />
                ))}
              </div>
            </>
          ) : null}

          <ClaimSection
            title={isSite ? "Predicted effect" : "Predictions at this residue"}
            count={predictors.filter((value) => value.state === "ok").length}
            evidenceClass="computational_prediction"
          />
          <EffectGroupRows
            group={predictions}
            values={predictors}
            emptyTitle="No predictor value at this residue"
          />
          {predictions?.note ? <Note>{predictions.note}</Note> : null}

          <ClaimSection
            title={
              <>
                Stability <LearnTerm term="delta-delta-g">ΔΔG</LearnTerm>,
                retrieved
              </>
            }
            count={stability.filter((value) => value.state === "ok").length}
            evidenceClass="computational_prediction"
          />
          {stability.length === 0 ? (
            <EmptyState
              size="inline"
              title="No stability value retrieved"
              description={
                isSite
                  ? "No source returned a ΔΔG for this substitution."
                  : "Stability values are retrieved per substitution. Select the variant site."
              }
            />
          ) : (
            stability.map((value) => {
              const evidence = effectEvidence(
                value,
                "computational_prediction",
              );
              return (
                <div
                  key={value.key}
                  className="border-b border-border-subtle px-3 py-2 last:border-b-0"
                >
                  <div className="flex items-baseline gap-2">
                    {evidence && value.state === "ok" ? (
                      <EvidencePopover
                        evidence={evidence}
                        size="compact"
                        side="left"
                        className="shrink-0"
                      />
                    ) : null}
                    <MetricReadout
                      metric="ddg"
                      value={
                        typeof value.value === "number" ? value.value : null
                      }
                      missingReason="Not provided by the source"
                      label={value.label}
                      producedBy={[
                        value.tool,
                        value.tool_version,
                        value.structure ? `on ${value.structure.id}` : null,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    />
                  </div>
                  {value.message ? (
                    <p className="mt-1 text-2xs leading-4 text-subtle-foreground">
                      {value.message}
                    </p>
                  ) : null}
                </div>
              );
            })
          )}

          <ClaimSection
            title="Structural context"
            count={
              context?.values.filter((value) => value.state === "ok").length
            }
            evidenceClass="computational_prediction"
          />
          <EffectGroupRows
            group={context}
            values={context?.values ?? []}
            emptyTitle="No structural context value at this residue"
          />
        </>
      )}

      <SectionHeader title="Literature" />
      <div className="h-80 border-b border-border-subtle">
        <LiteraturePanel
          context={{
            gene: variant.gene_symbol,
            accession,
            variant: isSite ? variant.variant_id : undefined,
            residue: position,
          }}
          defaultFocused
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
        <TextLink
          href={withSelection(routes.variant(variantKey), snapshot)}
        >
          Variant record
        </TextLink>
        <TextLink
          href={withSelection(routes.mechanism(variantKey), snapshot)}
        >
          Mechanism
        </TextLink>
        {accession ? (
          <>
            <TextLink href={withSelection(routes.protein(accession), snapshot)}>
              Protein
            </TextLink>
            <ExternalLink
              href={`https://www.uniprot.org/uniprotkb/${accession}`}
            >
              UniProt {accession}
            </ExternalLink>
          </>
        ) : null}
      </div>
    </div>
  );
}
