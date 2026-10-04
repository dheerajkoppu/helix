"use client";

import { Rotate3dIcon } from "lucide-react";

import {
  DefinitionList,
  DefinitionRow,
} from "@/components/data/definition-list";
import { MonoId } from "@/components/data/mono-id";
import { SectionHeader } from "@/components/data/section-header";
import { EvidenceBadge } from "@/components/evidence/evidence-badge";
import { EvidencePopover } from "@/components/evidence/evidence-popover";
import { Detail } from "@/components/intervention/fold";
import { Button } from "@/components/ui/button";
import {
  DISCOVERY_WORDS,
  plainAffinity,
  plainAffinityDetail,
  plainBridgeMeaning,
  plainDirection,
  plainIndication,
  plainMoleculeAction,
  plainRequiredActions,
  plainSimilarityMetric,
} from "@/lib/plain-language";
import { useAdvancedMode } from "@/lib/state/preferences";
import { toDiscoveryEvidence } from "@/lib/workspace-data";

import {
  badgeEvidence,
  moleculeFacts,
  refName,
  targetFacts,
  type CandidateRow,
} from "./model";

/** One numbered step of the chain: a single claim with its own evidence. */
function Step({
  index,
  statement,
  evidence,
}: {
  index: number;
  statement: string;
  evidence: React.ReactNode;
}) {
  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2 border-b border-border-subtle px-3 py-2 last:border-b-0">
      <span
        aria-hidden
        className="tabular pt-px font-mono text-2xs text-subtle-foreground"
      >
        {index}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-xs leading-snug text-foreground">{statement}</p>
        {evidence ? (
          <div className="flex flex-wrap items-center gap-1.5">{evidence}</div>
        ) : null}
      </div>
    </li>
  );
}

export interface CandidateChainProps {
  row: CandidateRow;
  /** required actions from the response, for the direction statement */
  requiredActions: readonly string[] | null | undefined;
  /** shown when the bridge carries two structures */
  onShowPockets?: () => void;
  pocketsShown?: boolean;
}

/**
 * The chain behind one candidate: the numbered path, the direction check as a short statement, the
 * reasons it might be wrong, and — in Advanced — the identifiers, action types, measured affinities,
 * similarity metrics by name and the full evidence list.
 */
export function CandidateChain({
  row,
  requiredActions,
  onShowPockets,
  pocketsShown = false,
}: CandidateChainProps) {
  const advanced = useAdvancedMode();
  const { candidate } = row;
  const steps = candidate.bridge?.steps ?? [];
  const check = candidate.direction_check ?? null;
  const verdict = plainDirection(row.verdict);
  const needed =
    plainRequiredActions(
      Array.isArray(check?.required)
        ? check?.required
        : check?.required
          ? [check.required]
          : requiredActions,
    ) ?? null;
  const does = candidate.molecule?.action_type
    ? plainMoleculeAction(candidate.molecule.action_type)
    : check?.molecule_action
      ? plainMoleculeAction(check.molecule_action)
      : null;
  const fromDisease = plainIndication(refName(candidate.bridge?.from_disease));
  const similar = candidate.structure?.similar_to ?? null;
  const metrics = Object.entries(similar?.metrics ?? {}).filter(
    ([, value]) => value !== null && value !== undefined,
  );
  const shared = candidate.structure?.residues ?? [];
  const strength = candidate.molecule?.measured_affinity
    ? advanced
      ? plainAffinityDetail(candidate.molecule.measured_affinity)
      : plainAffinity(candidate.molecule.measured_affinity)
    : null;

  return (
    <div>
      <div className="flex flex-col gap-1 border-b border-border-subtle px-3 py-3">
        <div className="flex items-center gap-2">
          <EvidenceBadge evidenceClass="helix_hypothesis" size="compact" />
          {advanced ? (
            <span className="text-2xs text-muted-foreground">
              {candidate.label ?? "Helix hypothesis"}
            </span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {row.bridgeTag}
          {plainBridgeMeaning(row.bridgeKind)
            ? ` — ${plainBridgeMeaning(row.bridgeKind)}`
            : ""}
        </p>
        {fromDisease ? (
          <p className="text-xs text-muted-foreground">
            Came from {fromDisease}.
          </p>
        ) : null}
      </div>

      <SectionHeader title={DISCOVERY_WORDS.chain} count={steps.length} />
      {steps.length > 0 ? (
        <ol>
          {steps.map((step, index) => (
            <Step
              key={`step-${index}`}
              index={index + 1}
              statement={step.statement ?? "No statement recorded."}
              evidence={badgeEvidence(step.evidence, advanced).map(
                (item, position) => (
                  <EvidencePopover
                    key={`step-${index}-evidence-${position}`}
                    evidence={toDiscoveryEvidence(item, step.statement)}
                    size="compact"
                  />
                ),
              )}
            />
          ))}
        </ol>
      ) : (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          No chain was reported for this candidate.
        </p>
      )}

      <SectionHeader title={DISCOVERY_WORDS.check} />
      <div className="flex flex-col gap-1 px-3 py-2 text-xs">
        <p className="font-medium text-foreground">{verdict}</p>
        {needed ? (
          <p className="text-muted-foreground">
            {DISCOVERY_WORDS.needed}: {needed}.
          </p>
        ) : null}
        {does ? (
          <p className="text-muted-foreground">
            {DISCOVERY_WORDS.molecule} {does}.
          </p>
        ) : null}
        {check?.why ? <p className="text-foreground">{check.why}</p> : null}
        {strength ? (
          <p className="text-muted-foreground">
            {DISCOVERY_WORDS.strength}: {strength}
          </p>
        ) : null}
        {row.unknownDirection ? (
          <p className="text-warning">{DISCOVERY_WORDS.unknownDirectionWhy}</p>
        ) : null}
        {advanced && check?.molecule_action ? (
          <p className="font-mono text-2xs text-subtle-foreground">
            {check.molecule_action}
            {check.verdict ? ` · ${check.verdict}` : ""}
          </p>
        ) : null}
      </div>

      {row.structural || shared.length > 0 ? (
        <>
          <SectionHeader
            title={
              row.twoPockets ? DISCOVERY_WORDS.pockets : DISCOVERY_WORDS.pocket
            }
            actions={
              onShowPockets ? (
                <Button
                  size="sm"
                  variant={pocketsShown ? "secondary" : "outline"}
                  onClick={onShowPockets}
                >
                  <Rotate3dIcon aria-hidden />
                  3D
                </Button>
              ) : null
            }
          />
          {candidate.structure?.note ? (
            <p className="border-b border-border-subtle px-3 py-2 text-xs leading-snug text-muted-foreground">
              {candidate.structure.note}
            </p>
          ) : null}
          <DefinitionList termWidth="8.5rem">
            {similar?.gene_symbol || similar?.accession ? (
              <DefinitionRow term="Similar protein">
                {similar.gene_symbol ?? similar.accession}
              </DefinitionRow>
            ) : null}
            {shared.length > 0 ? (
              <DefinitionRow
                term={
                  row.twoPockets
                    ? DISCOVERY_WORDS.sharedResidues
                    : DISCOVERY_WORDS.pocketResidues
                }
              >
                {shared.length}
              </DefinitionRow>
            ) : null}
            {advanced
              ? metrics.map(([name, value]) => (
                  <DefinitionRow key={name} term={plainSimilarityMetric(name)}>
                    {String(value)}
                  </DefinitionRow>
                ))
              : null}
          </DefinitionList>
        </>
      ) : null}

      {row.caveats.length > 0 ? (
        <>
          <SectionHeader
            title={DISCOVERY_WORDS.caveats}
            count={row.caveats.length}
          />
          <ul className="flex flex-col">
            {row.caveats.map((caveat, index) => (
              <li
                key={`caveat-${index}`}
                className="border-b border-border-subtle px-3 py-2 text-xs leading-snug text-muted-foreground last:border-b-0"
              >
                {caveat}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {advanced ? <SectionHeader title={DISCOVERY_WORDS.identifiers} /> : null}
      <Detail advanced={advanced} title={DISCOVERY_WORDS.identifiers}>
        <DefinitionList termWidth="8.5rem">
          {moleculeFacts(candidate.molecule).map((fact) => (
            <DefinitionRow key={fact.label} term={fact.label} mono={fact.mono}>
              {fact.mono ? <MonoId value={fact.value} /> : fact.value}
            </DefinitionRow>
          ))}
          {targetFacts(candidate.target).map((fact) => (
            <DefinitionRow
              key={`target-${fact.label}`}
              term={fact.label}
              mono={fact.mono}
            >
              {fact.mono ? <MonoId value={fact.value} /> : fact.value}
            </DefinitionRow>
          ))}
        </DefinitionList>
      </Detail>

      {advanced && (candidate.evidence ?? []).length > 0 ? (
        <>
          <SectionHeader
            title={DISCOVERY_WORDS.evidenceList}
            count={candidate.evidence?.length ?? 0}
          />
          <ul className="flex flex-col">
            {(candidate.evidence ?? []).map((item, index) => (
              <li
                key={`evidence-${index}`}
                className="flex items-baseline gap-2 border-b border-border-subtle px-3 py-2 text-xs last:border-b-0"
              >
                <EvidencePopover
                  evidence={toDiscoveryEvidence(item)}
                  size="compact"
                  className="shrink-0"
                />
                <span className="min-w-0 text-muted-foreground">
                  {item.statement ?? item.source?.database ?? "Record"}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
