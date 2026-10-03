"use client";

import { FlaskConicalIcon } from "lucide-react";
import { useState } from "react";

import { ExternalLink } from "@/components/data/external-link";
import { SectionHeader } from "@/components/data/section-header";
import { EvidenceBadge } from "@/components/evidence/evidence-badge";
import { EvidencePopover } from "@/components/evidence/evidence-popover";
import { StructureOriginTag } from "@/components/evidence/structure-origin-tag";
import { Detail } from "@/components/intervention/fold";
import { LearnTerm } from "@/components/science/learn-term";
import { MetricReadout } from "@/components/science/metric-readout";
import { ModelResultStrip } from "@/components/science/model-result-strip";
import { EmptyState } from "@/components/states/empty-state";
import { Button } from "@/components/ui/button";
import { toThreeLetter } from "@/lib/ids";
import { setWorkspaceHover } from "@/lib/state/hover";
import { useAdvancedMode } from "@/lib/state/preferences";

import {
  PROXIMITY_LABEL,
  SUPPORT_CLASS,
  plural,
  raises,
  toEvidenceItem,
  type MechanismCandidate,
  type MechanismObservation,
  type MechanismsResponse,
  type UnsupportedCategory,
} from "./data";
import { SaveHypothesis } from "./save-hypothesis";

function ObservationRow({
  observation,
  accession,
  shownStructureId,
  onShowStructure,
  advanced,
}: {
  observation: MechanismObservation;
  accession: string | null;
  shownStructureId: string | null;
  onShowStructure: (structureId: string) => void;
  advanced: boolean;
}) {
  const { structure_id: structureId, structure_origin: origin } = observation;
  const anchor =
    observation.positions.length === 1 ? observation.positions[0] : null;
  const ddg =
    observation.metric === "foldx.ddg" && typeof observation.value === "number"
      ? observation.value
      : null;
  const showIn3d =
    structureId && structureId !== shownStructureId ? (
      <Button
        variant="ghost"
        size="xs"
        className="ml-auto shrink-0"
        onClick={() => onShowStructure(structureId)}
      >
        Show in 3D
      </Button>
    ) : null;
  return (
    <li
      className="flex flex-col gap-1 border-b border-border-subtle px-3 py-2 text-xs"
      onMouseEnter={() =>
        anchor && accession
          ? setWorkspaceHover({ accession, position: anchor, origin: "ledger" })
          : null
      }
      onMouseLeave={() => setWorkspaceHover(null)}
    >
      <div className="flex items-baseline gap-2">
        <EvidencePopover
          evidence={toEvidenceItem(observation.evidence, observation.summary)}
          size="compact"
          className="shrink-0"
        />
        <span
          className={
            advanced
              ? "min-w-0 text-foreground"
              : "line-clamp-2 min-w-0 text-foreground"
          }
          title={advanced ? undefined : observation.summary}
        >
          {observation.summary}
        </span>
        {advanced ? null : showIn3d}
      </div>
      {advanced && observation.source_statement ? (
        <p className="border-l border-border pl-2 text-muted-foreground">
          <span className="text-subtle-foreground">Source text: </span>
          {observation.source_statement}
        </p>
      ) : null}
      {ddg === null ? null : advanced ? (
        <MetricReadout
          metric="ddg"
          value={ddg}
          label={<LearnTerm term="delta-delta-g">ΔΔG</LearnTerm>}
          producedBy="FoldX 5.0 through EBI ProtVar, on the AlphaFold DB model"
        />
      ) : (
        <ModelResultStrip
          frame="none"
          className="pt-1 pl-6"
          model="FoldX"
          version="5.0"
          metrics={[
            {
              label: "Predicted ΔΔG",
              value: ddg,
              unit: "kcal/mol",
              explainer: "ddg",
            },
          ]}
        />
      )}
      {advanced ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-subtle-foreground">
          <span>
            Rule <span className="font-mono">{observation.rule}</span>
          </span>
          <span>{PROXIMITY_LABEL[observation.proximity]}</span>
          {observation.direction === "disputes" ? (
            <span className="text-foreground">Disputes</span>
          ) : null}
          {structureId && origin ? (
            <StructureOriginTag
              origin={origin}
              size="compact"
              detail={structureId}
            />
          ) : null}
          {observation.ligand?.url ? (
            <ExternalLink href={observation.ligand.url}>
              {observation.ligand.comp_id}
            </ExternalLink>
          ) : null}
          {showIn3d}
        </div>
      ) : null}
    </li>
  );
}

function ObservationList(props: {
  observations: MechanismObservation[];
  accession: string | null;
  shownStructureId: string | null;
  onShowStructure: (structureId: string) => void;
  advanced: boolean;
}) {
  const { observations, ...rest } = props;
  return (
    <ul>
      {observations.map((observation) => (
        <ObservationRow
          key={observation.id}
          observation={observation}
          {...rest}
        />
      ))}
    </ul>
  );
}

const TextList = ({ items }: { items: string[] }) => (
  <ul className="flex flex-col gap-1.5 px-3 py-2 text-xs text-muted-foreground">
    {items.map((item) => (
      <li key={item} className="border-l border-border pl-2">
        {item}
      </li>
    ))}
  </ul>
);

export interface CandidateInspectorProps {
  data: MechanismsResponse;
  candidate: MechanismCandidate | null;
  unsupported: UnsupportedCategory | null;
  shownStructureId: string | null;
  onShowStructure: (structureId: string) => void;
  /** pLDDT of the AlphaFold DB model at the residue, when the effects request has answered */
  plddt?: number | null;
}

/** The evidence chain of one candidate: what raises it, what disputes it, how to test it. */
export function CandidateInspector({
  data,
  candidate,
  unsupported,
  shownStructureId,
  onShowStructure,
  plddt,
}: CandidateInspectorProps) {
  const advanced = useAdvancedMode();
  const [saving, setSaving] = useState(false);
  const accession = data.protein?.id ?? null;
  const rowProps = { accession, shownStructureId, onShowStructure, advanced };

  if (unsupported) {
    const checked = (
      <>
        <SectionHeader title="Checked" count={unsupported.checked.length} />
        <TextList items={unsupported.checked} />
        {unsupported.not_checked.length ? (
          <>
            <SectionHeader
              title="Not checked"
              count={unsupported.not_checked.length}
              description={
                advanced
                  ? "The source did not answer, so these rules were not applied."
                  : undefined
              }
            />
            <TextList items={unsupported.not_checked} />
          </>
        ) : null}
      </>
    );
    return (
      <>
        <div className="border-b border-border-subtle px-3 py-3">
          <p className="text-sm font-medium text-foreground">
            No supporting data found
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {advanced
              ? `No retrieved record raises ${unsupported.label.toLowerCase()} as a candidate for this variant. That does not rule it out.`
              : "This does not rule it out."}
          </p>
        </div>
        {advanced ? checked : null}
        <SectionHeader
          title="Records read"
          count={unsupported.observations.length}
          description={
            advanced && unsupported.observations.length
              ? "Read at this residue; none of them raises the candidate."
              : undefined
          }
        />
        {unsupported.observations.length ? (
          <ObservationList
            observations={unsupported.observations}
            {...rowProps}
          />
        ) : (
          <EmptyState size="inline" title="No record at this residue" />
        )}
        {advanced ? null : (
          <Detail advanced={false} title="What was checked">
            {checked}
          </Detail>
        )}
      </>
    );
  }

  if (!candidate) {
    return (
      <EmptyState
        title="No candidate selected"
        description="Choose a candidate to see its records."
      />
    );
  }

  const raising = candidate.observations.filter(raises);
  const other = candidate.observations.filter(
    (observation) => !raises(observation),
  );
  const residue = `${toThreeLetter(data.reference ?? "") ?? data.reference}${data.position}`;

  const plddtReadout = (
    <MetricReadout
      metric="plddt"
      value={plddt}
      missingReason="No AlphaFold DB value"
      label={
        <>
          <LearnTerm term="plddt">pLDDT</LearnTerm> at {residue}
        </>
      }
      producedBy="AlphaFold DB model of the canonical sequence"
    />
  );

  const rest = (
    <>
      {other.length ? (
        <>
          <SectionHeader
            title={advanced ? "Context and disputing records" : "Other records"}
            count={other.length}
            description={
              advanced
                ? "Read for this candidate; they do not raise it."
                : undefined
            }
          />
          <ObservationList observations={other} {...rowProps} />
        </>
      ) : null}

      <SectionHeader title="To test it" count={candidate.tests.length} />
      <TextList items={candidate.tests} />

      <SectionHeader title="Limits" />
      <TextList items={[...candidate.limitations, ...data.limitations]} />

      {candidate.highlight.partners.length ? (
        <p className="px-3 pb-3 text-2xs text-subtle-foreground">
          {plural(candidate.highlight.partners.length, "partner")} named:{" "}
          {candidate.highlight.partners
            .map((partner) => partner.label ?? partner.id)
            .join(", ")}
        </p>
      ) : null}
    </>
  );

  return (
    <>
      <div className="flex flex-col gap-2.5 border-b border-border-subtle px-3 py-3 text-xs">
        <div className="flex items-center gap-2">
          <EvidenceBadge evidenceClass="orphafold_hypothesis" size="compact" />
          <span className="text-2xs tracking-[0.04em] text-subtle-foreground uppercase">
            {advanced ? "Candidate to test, not a finding" : "To test"}
          </span>
        </div>
        <p className="text-sm leading-snug text-foreground">
          {candidate.claim}
        </p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-muted-foreground">Support</span>
          <EvidenceBadge
            evidenceClass={SUPPORT_CLASS[candidate.support]}
            size={advanced ? "compact" : "standard"}
          />
          <span className="font-medium text-foreground">
            {candidate.support_label}
          </span>
        </div>
        {advanced ? (
          <>
            <p className="text-muted-foreground">
              {candidate.confidence_basis} The label names a kind of{" "}
              <LearnTerm term="evidence-class">evidence</LearnTerm>, not a
              probability.
            </p>
            {plddtReadout}
          </>
        ) : null}
        <div>
          <Button
            size="sm"
            variant={advanced ? "outline" : "default"}
            onClick={() => setSaving(true)}
          >
            <FlaskConicalIcon data-icon="inline-start" />
            Save as hypothesis
          </Button>
        </div>
      </div>

      <SectionHeader
        title={advanced ? "Evidence chain" : "Evidence"}
        count={raising.length}
        description={
          advanced
            ? "Each record raises the candidate under one rule. Open a badge for its source."
            : undefined
        }
      />
      <ObservationList observations={raising} {...rowProps} />

      {advanced ? (
        rest
      ) : (
        <Detail advanced={false}>
          <div className="flex flex-col gap-2 border-y border-border-subtle px-3 py-2 text-xs">
            <p className="text-muted-foreground">
              {candidate.confidence_basis}
            </p>
            {plddtReadout}
          </div>
          {rest}
        </Detail>
      )}

      <SaveHypothesis
        open={saving}
        onOpenChange={setSaving}
        data={data}
        candidate={candidate}
      />
    </>
  );
}
