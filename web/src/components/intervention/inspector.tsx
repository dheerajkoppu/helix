"use client";

import { CompoundDepiction } from "@/components/compound/depiction";
import {
  measuredAmount,
  measuredBasis,
  measuredValue,
  phaseLabel,
  toEvidenceItem,
  type ApiEvidence,
  type Treatment,
} from "@/components/compound/format";
import { ButtonLink } from "@/components/data/button-link";
import {
  DefinitionList,
  DefinitionRow,
} from "@/components/data/definition-list";
import { ExternalLink } from "@/components/data/external-link";
import { MonoId } from "@/components/data/mono-id";
import { SectionHeader } from "@/components/data/section-header";
import { TextLink } from "@/components/data/text-link";
import { EvidencePopover } from "@/components/evidence/evidence-popover";
import { SourceChip } from "@/components/evidence/source-chip";
import { StructureOriginTag } from "@/components/evidence/structure-origin-tag";
import { RunJobButton } from "@/components/jobs/run-job";
import { AddToProjectButton } from "@/components/project/add-to-project";
import { LearnTerm } from "@/components/science/learn-term";
import { MetricReadout } from "@/components/science/metric-readout";
import { ModelResultStrip } from "@/components/science/model-result-strip";
import { EmptyState } from "@/components/states/empty-state";
import { SourceUnavailable } from "@/components/states/source-unavailable";
import { Button } from "@/components/ui/button";
import { routes } from "@/lib/ids";
import {
  OPTIONS_WORDS,
  plainConcentration,
  plainDrugKind,
  plainDrugStage,
  plainLabTests,
  plainLength,
  plainStageLabel,
} from "@/lib/plain-language";
import type { ProviderInfo } from "@/lib/state/jobs";
import type {
  PocketsResponse,
  ProteinCompoundsResponse,
} from "@/lib/workspace-data";

import { Detail } from "./fold";
import type { CuratedPartner, StringPartner } from "./ledgers";
import {
  formatPositions,
  pocketOverlap,
  TIER_META,
  type BindingRun,
  type ComparisonRow,
  type MechanismClass,
  type PredictedPocket,
  type Selected,
  type SourcesDown,
} from "./model";

const Note = ({ children }: { children: React.ReactNode }) => (
  <p className="px-3 py-2 text-xs text-muted-foreground">{children}</p>
);

function Cite({
  evidence,
  compact = false,
}: {
  evidence: ApiEvidence | null | undefined;
  compact?: boolean;
}) {
  const item = toEvidenceItem(evidence);
  return item ? (
    <EvidencePopover
      evidence={item}
      side="left"
      size={compact ? "compact" : "standard"}
    />
  ) : null;
}

function TreatmentBlock({
  treatment,
  actsOnTarget,
  advanced,
}: {
  treatment: Treatment;
  actsOnTarget: boolean;
  advanced: boolean;
}) {
  const stage = (
    <DefinitionRow term="Stage">
      {advanced
        ? treatment.clinical_stage_label
        : plainStageLabel(treatment.clinical_stage_label)}
      {actsOnTarget ? null : ` ${OPTIONS_WORDS.forDisease}`}
    </DefinitionRow>
  );
  const note = (
    <Note>
      {actsOnTarget
        ? "A stage is the status of the source record for the indications listed there. It is not an approval for an inborn error of immunity unless that indication is listed."
        : "This record names the disease as an indication. Its recorded mechanism does not act on this protein, so no binding data applies."}
    </Note>
  );
  return (
    <>
      <SectionHeader
        title={advanced ? "Clinical record" : OPTIONS_WORDS.inPatients}
        actions={<Cite evidence={treatment.evidence} />}
      />
      {advanced ? null : <DefinitionList>{stage}</DefinitionList>}
      <Detail advanced={advanced}>
      <DefinitionList>
        {advanced ? stage : null}
        <DefinitionRow term={advanced ? "Modality" : OPTIONS_WORDS.kindRow}>
          {treatment.modality === "Unknown"
            ? null
            : advanced
              ? treatment.modality
              : plainDrugKind(treatment.modality)}
        </DefinitionRow>
        <DefinitionRow term={advanced ? "Indications" : OPTIONS_WORDS.usedFor}>
          {treatment.indications.length > 0
            ? treatment.indications
                .slice(0, 8)
                .map((indication) => indication.name)
                .join("; ") +
              (treatment.indications.length > 8
                ? `; ${treatment.indications.length - 8} more in the source`
                : "")
            : null}
        </DefinitionRow>
        <DefinitionRow term="Reports">
          {treatment.reports.length > 0 ? (
            <span className="flex flex-col gap-0.5">
              {treatment.reports.slice(0, 4).map((report) =>
                report.url ? (
                  <ExternalLink key={report.id} href={report.url}>
                    {report.source}{" "}
                    {report.clinical_stage?.replace("_", " ").toLowerCase()}
                  </ExternalLink>
                ) : (
                  <span key={report.id}>{report.source}</span>
                ),
              )}
              {treatment.report_total > 4 ? (
                <span className="text-muted-foreground">
                  {treatment.report_total - 4} more in Open Targets
                </span>
              ) : null}
            </span>
          ) : null}
        </DefinitionRow>
      </DefinitionList>
      {note}
      </Detail>
    </>
  );
}

function RunBlock({
  run,
  onShowPose,
  single,
  advanced,
}: {
  run: BindingRun;
  onShowPose: () => void;
  single: boolean;
  advanced: boolean;
}) {
  const result = run.result;
  if (!result)
    return (
      <div className="flex items-baseline gap-2 border-b border-border-subtle px-3 py-2 text-xs">
        <span className="text-muted-foreground">
          Run {run.status}
          {run.error ? `: ${run.error.message}` : ""}
        </span>
        <TextLink href={routes.job(run.jobId)} className="ml-auto shrink-0">
          Job
        </TextLink>
      </div>
    );
  const model =
    [result.structure.model_name, result.structure.model_version]
      .filter(Boolean)
      .join(" ") || run.providerId;
  if (!advanced)
    return (
      <div className="flex flex-col gap-2 border-b border-border-subtle py-2.5">
        <ModelResultStrip
          frame="none"
          className="gap-x-5 px-3"
          model={result.structure.model_name ?? run.providerId ?? "Unknown model"}
          version={result.structure.model_version}
          origin="predicted_orphafold"
          metrics={[
            {
              label: "Predicted affinity",
              value: result.affinity?.affinity_pred_value,
              caption: OPTIONS_WORDS.lowerStronger,
              explainer: "affinity",
              missingReason:
                result.affinity_status === "not_requested"
                  ? "Not requested"
                  : "Not produced",
            },
            {
              label: "Binder probability",
              value: result.affinity?.affinity_probability_binary,
              explainer: "binder_probability",
              missingReason: "Not produced",
            },
            {
              label: "ipTM",
              value: result.pose_confidence.ligand_iptm,
              explainer: "iptm",
              missingReason: "Not reported",
            },
          ]}
          href={routes.job(run.jobId)}
        />
        <div className="px-3">
          <Button size="sm" variant="outline" onClick={onShowPose}>
            {OPTIONS_WORDS.showIn3d}
          </Button>
        </div>
        <Detail advanced={false}>
          <div className="flex flex-col gap-1.5 px-3 pb-1 text-2xs text-muted-foreground">
            <p>
              Co-folded with the ligand, residues{" "}
              {result.protein.residue_start}-{result.protein.residue_end}.
              {result.pocket_constraint
                ? ` Pose constrained to ${result.pocket_constraint.uniprot_positions.length} residues within ${result.pocket_constraint.max_distance_angstrom} Å.`
                : " No pocket constraint."}
            </p>
            {single && result.affinity ? (
              <p>
                A single predicted value carries no interpretation. Compare
                against a known active.
              </p>
            ) : null}
            {result.caveats.length > 0 ? (
              <ul className="list-inside list-disc">
                {result.caveats.map((caveat) => (
                  <li key={caveat}>{caveat.replaceAll("_", " ")}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </Detail>
      </div>
    );
  return (
    <div className="flex flex-col gap-2 border-b border-border-subtle px-3 py-2.5">
      <div className="flex items-center gap-2 text-2xs">
        <StructureOriginTag
          origin="predicted_orphafold"
          detail={model}
          size="compact"
        />
        <TextLink href={routes.job(run.jobId)} className="ml-auto">
          Job record
        </TextLink>
      </div>
      {result.affinity ? (
        <>
          <MetricReadout
            metric="affinity"
            value={result.affinity.affinity_pred_value}
            producedBy={model}
          />
          <MetricReadout
            metric="binder_probability"
            value={result.affinity.affinity_probability_binary}
            producedBy={model}
          />
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          {result.affinity_status === "not_requested"
            ? "Affinity was not requested in this run."
            : "The model wrote no affinity for this run."}
        </p>
      )}
      <MetricReadout
        metric="iptm"
        label="Ligand ipTM"
        value={result.pose_confidence.ligand_iptm}
        missingReason="Not provided by this run"
        producedBy={model}
      />
      <p className="text-2xs text-muted-foreground">
        Receptor: co-folded with the ligand in this run, residues{" "}
        {result.protein.residue_start}-{result.protein.residue_end} (predicted
        structure).
        {result.pocket_constraint
          ? ` Pose constrained to ${result.pocket_constraint.uniprot_positions.length} residues within ${result.pocket_constraint.max_distance_angstrom} Å.`
          : " No pocket constraint."}
      </p>
      {single && result.affinity ? (
        <p className="text-2xs text-muted-foreground">
          A single predicted value carries no interpretation. Add at least one
          known active for this target to compare against.
        </p>
      ) : null}
      {result.caveats.length > 0 ? (
        <ul className="list-inside list-disc text-2xs text-muted-foreground">
          {result.caveats.map((caveat) => (
            <li key={caveat}>{caveat.replaceAll("_", " ")}</li>
          ))}
        </ul>
      ) : null}
      <div>
        <Button size="sm" variant="outline" onClick={onShowPose}>
          Show pose in 3D
        </Button>
      </div>
    </div>
  );
}

function CompoundDetail({
  accession,
  row,
  pockets,
  affinityRule,
  chemblDown,
  provider,
  constraintId,
  onConstraint,
  predictedCount,
  onShowStructure,
  onShowPose,
  advanced,
  shownStructureId,
}: {
  advanced: boolean;
  /** structure in the 3D view right now; null while the table is shown */
  shownStructureId: string | null;
  accession: string;
  row: ComparisonRow;
  pockets: PredictedPocket[];
  affinityRule: string | null;
  chemblDown: SourcesDown["chembl"];
  provider: ProviderInfo | null | undefined;
  constraintId: string;
  onConstraint: (id: string) => void;
  predictedCount: number;
  onShowStructure: (pdbId: string) => void;
  onShowPose: (run: BindingRun) => void;
}) {
  const { compound, treatment } = row;
  const measured = compound?.measured_affinity ?? null;
  const coCrystal = compound?.co_crystal ?? null;
  const overlap = pocketOverlap(coCrystal?.binding_positions, pockets);
  const status =
    phaseLabel(compound?.max_phase, compound?.first_approval) ??
    treatment?.clinical_stage_label;
  const measuredEvidence = compound?.evidence.find(
    (record) => record.predicate === "measured_activity",
  );
  const observedEvidence = compound?.evidence.find(
    (record) => record.predicate === "co_crystallised_with",
  );
  const constraint =
    constraintId === "observed"
      ? (coCrystal?.binding_positions ?? [])
      : (pockets.find((pocket) => pocket.id === constraintId)?.positions ?? []);
  const compoundRef = compound?.id ?? treatment?.drug_id ?? row.id;

  return (
    <div>
      <div className="flex flex-col gap-2 border-b border-border-subtle px-3 py-3">
        <CompoundDepiction
          depictionUrl={compound?.depiction_url}
          name={row.name}
          absentLabel={
            !advanced
              ? row.smallMolecule === false
                ? plainDrugKind(row.modality)
                : OPTIONS_WORDS.noDrawing
              : row.smallMolecule === false
                ? `${row.modality}: no small-molecule structure`
                : "No 2D structure stored"
          }
          className="h-36 w-full"
        />
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="text-muted-foreground">
            {advanced ? row.modality : plainDrugKind(row.modality)}
          </span>
          <span className="text-subtle-foreground" aria-hidden>
            ·
          </span>
          <span className="text-muted-foreground">
            {!advanced
              ? (plainDrugStage(compound?.max_phase, compound?.first_approval) ??
                plainStageLabel(treatment?.clinical_stage_label) ??
                OPTIONS_WORDS.noStage)
              : status
                ? `${status}${compound?.max_phase && compound.max_phase >= 4 ? ", any indication" : ""}`
                : "No clinical record"}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {!advanced &&
          coCrystal?.pdb_ids[0] &&
          shownStructureId !== `pdb:${coCrystal.pdb_ids[0].toUpperCase()}` ? (
            <Button
              size="sm"
              onClick={() => onShowStructure(coCrystal.pdb_ids[0])}
            >
              Show bound in 3D
            </Button>
          ) : null}
          {row.id.startsWith("job:") ? null : (
            <ButtonLink
              size="sm"
              href={`${routes.compound(compoundRef)}?target=${accession}`}
            >
              {advanced ? "Compound record" : OPTIONS_WORDS.fullPage}
            </ButtonLink>
          )}
          <AddToProjectButton
            size="sm"
            item={{
              kind: "compound",
              ref: compoundRef,
              label: row.name,
              origin: {
                route: routes.interventions(accession),
                note: `Compared against ${accession}`,
              },
              evidence: compound?.evidence ?? [],
              data: {
                target_accession: accession,
                evidence_tier: row.tier,
                modality: row.modality,
                measured_affinity: measured,
              },
            }}
          />
        </div>
      </div>

      <SectionHeader
        title={advanced ? "Measured affinity" : OPTIONS_WORDS.strength}
        actions={<Cite evidence={measuredEvidence} />}
      />
      {measured ? (
        <>
          {advanced ? null : (
            <p className="px-3 pt-2.5 pb-1">
              <span
                className="tabular block font-mono text-xl leading-7 font-medium text-foreground"
                title={`${measuredValue(measured)} (${plainConcentration(measured.representative.units)})`}
              >
                {measuredAmount(measured)}
              </span>
              <span className="text-xs text-muted-foreground">
                {plainLabTests(measured.assay_count)}.{" "}
                {OPTIONS_WORDS.lowerStronger}
              </span>
            </p>
          )}
          <Detail advanced={advanced}>
          <DefinitionList>
            {advanced ? (
              <DefinitionRow term="Printed value" mono>
                {measuredValue(measured)}
              </DefinitionRow>
            ) : null}
            <DefinitionRow term="Basis">
              {measuredBasis(measured)}
            </DefinitionRow>
            <DefinitionRow term="pChEMBL range" mono>
              {measured.min_pchembl.toFixed(2)} to{" "}
              {measured.max_pchembl.toFixed(2)}
            </DefinitionRow>
            <DefinitionRow term="Assay format">
              {measured.assay_format}
              {measured.incomplete
                ? "; ChEMBL holds more rows than were read"
                : ""}
            </DefinitionRow>
            <DefinitionRow term="Printed row">
              {measured.representative.url ? (
                <ExternalLink href={measured.representative.url}>
                  {measured.representative.assay_chembl_id ?? "ChEMBL assay"}
                </ExternalLink>
              ) : (
                measured.representative.assay_chembl_id
              )}
              {measured.representative.assay_description ? (
                <span
                  className="line-clamp-4 text-muted-foreground"
                  title={measured.representative.assay_description}
                >
                  {measured.representative.assay_description}
                  {measured.representative.year
                    ? ` (${measured.representative.year})`
                    : ""}
                </span>
              ) : null}
            </DefinitionRow>
          </DefinitionList>
          {affinityRule ? (
            <Note>
              <span className="text-foreground">Best-measured rule.</span>{" "}
              {affinityRule}
            </Note>
          ) : null}
          </Detail>
        </>
      ) : chemblDown ? (
        <SourceUnavailable
          source={chemblDown.name ?? "ChEMBL"}
          message={chemblDown.message}
        />
      ) : (
        <EmptyState
          size="inline"
          title={
            advanced
              ? "No measured affinity for this target"
              : OPTIONS_WORDS.none
          }
          description={
            advanced ? "A prediction is never printed in its place." : undefined
          }
          searched={["ChEMBL"]}
        />
      )}

      <SectionHeader
        title={
          advanced
            ? "Observed in experimental structures"
            : OPTIONS_WORDS.seenIn3d
        }
        count={coCrystal?.pdb_entry_count}
        actions={<Cite evidence={observedEvidence} />}
      />
      {coCrystal ? (
        <DefinitionList>
          {advanced ? (
            <DefinitionRow term="Component">
              <span className="font-mono">{coCrystal.ccd_id}</span>
            </DefinitionRow>
          ) : null}
          <DefinitionRow
            term={advanced ? "PDB entries" : OPTIONS_WORDS.labStructures}
          >
            <span className="flex flex-wrap gap-1">
              {coCrystal.pdb_ids.slice(0, 10).map((pdbId) => (
                <button
                  key={pdbId}
                  type="button"
                  onClick={() => onShowStructure(pdbId)}
                  title={`Show ${pdbId.toUpperCase()} with this ligand in 3D`}
                  className="rounded-xs border border-border px-1 font-mono text-2xs hover:border-border-strong hover:bg-accent"
                >
                  {pdbId.toUpperCase()}
                </button>
              ))}
              {coCrystal.pdb_ids.length > 10 ? (
                <span className="text-muted-foreground">
                  {coCrystal.pdb_ids.length - 10} more
                </span>
              ) : null}
            </span>
          </DefinitionRow>
          <DefinitionRow
            term={
              advanced ? (
                <LearnTerm term="binding-site">Binding site</LearnTerm>
              ) : (
                OPTIONS_WORDS.bindsAt
              )
            }
            mono={advanced}
          >
            {advanced
              ? formatPositions(coCrystal.binding_positions)
              : plainLength(coCrystal.binding_positions.length)}
          </DefinitionRow>
          {advanced ? (
          <DefinitionRow term="Predicted pocket">
            {overlap
              ? `${overlap.shared} of ${coCrystal.binding_positions.length} site residues lie in pocket ${overlap.pocket.rank}${
                  overlap.pocket.probability !== null
                    ? ` (P2Rank probability ${overlap.pocket.probability.toFixed(2)})`
                    : ""
                }`
              : pockets.length > 0
                ? "The observed site shares no residue with a predicted pocket"
                : null}
          </DefinitionRow>
          ) : null}
        </DefinitionList>
      ) : (
        <EmptyState
          size="inline"
          title={
            advanced
              ? "Not observed in a PDB entry of this protein"
              : OPTIONS_WORDS.notSeenIn3d
          }
          searched={["PDBe"]}
        />
      )}

      {compound && compound.mechanisms.length > 0 ? (
        <>
          <SectionHeader
            title={advanced ? "Mechanism" : OPTIONS_WORDS.howItWorks}
            count={compound.mechanisms.length}
            actions={
              <Cite
                evidence={compound.evidence.find((record) =>
                  record.source?.record_id?.startsWith("mechanism"),
                )}
              />
            }
          />
          <DefinitionList>
            {compound.mechanisms.map((mechanism) => (
              <DefinitionRow
                key={mechanism.mechanism_id}
                term={mechanism.action_type?.toLowerCase() ?? "Mechanism"}
              >
                {mechanism.mechanism_of_action}
                {(advanced
                  ? [mechanism.mechanism_comment, mechanism.binding_site_comment]
                  : []
                )
                  .filter(Boolean)
                  .map((comment) => (
                    <span key={comment} className="block text-muted-foreground">
                      {comment}
                    </span>
                  ))}
                {mechanism.references[0]?.url ? (
                  <ExternalLink
                    href={mechanism.references[0].url}
                    className="text-2xs"
                  >
                    {mechanism.references[0].type} reference
                  </ExternalLink>
                ) : null}
              </DefinitionRow>
            ))}
          </DefinitionList>
        </>
      ) : null}

      {treatment ? (
        <TreatmentBlock treatment={treatment} actsOnTarget advanced={advanced} />
      ) : null}

      <SectionHeader
        title={advanced ? "Binding prediction" : OPTIONS_WORDS.predictedBinding}
        count={advanced || row.runs.length > 0 ? row.runs.length : null}
      />
      {row.runs.map((run) => (
        <RunBlock
          key={run.jobId}
          run={run}
          advanced={advanced}
          single={predictedCount === 1}
          onShowPose={() => onShowPose(run)}
        />
      ))}
      {row.eligible && compound?.smiles ? (
        <div className="flex flex-col gap-2 py-2.5 text-xs">
          {advanced ? (
            <p className="px-3 text-muted-foreground">
              Co-folds {accession} with this molecule and predicts an affinity
              for the pair. The result is a computational prediction, not a
              measurement.
            </p>
          ) : null}
          <div className="flex items-center gap-2 px-3">
            <RunJobButton
              kind="binding_prediction"
              size="sm"
              label="Predict binding"
              params={{
                uniprot_accession: accession,
                ligand_smiles: compound.smiles,
                ligand_label: row.name,
                ligand_xrefs: compound.chembl_id
                  ? [`chembl:${compound.chembl_id}`]
                  : [],
                ...(constraint.length > 0
                  ? { pocket_residues: constraint }
                  : {}),
              }}
            />
            {provider ? (
              <span className="truncate text-2xs text-muted-foreground">
                {[provider.model_name, provider.model_version]
                  .filter(Boolean)
                  .join(" ") || provider.name}
                {!advanced && !provider.availability.available
                  ? ` · ${OPTIONS_WORDS.notAvailable}`
                  : ""}
              </span>
            ) : null}
          </div>
          <Detail advanced={advanced} title="Options">
            <div className="flex flex-col gap-2 px-3">
              <label className="flex items-center gap-2">
                <span className="shrink-0 text-muted-foreground">
                  Pocket constraint
                </span>
                <select
                  value={constraintId}
                  onChange={(event) => onConstraint(event.target.value)}
                  className="h-6 min-w-0 flex-1 rounded-xs border border-border bg-background px-1 text-xs text-foreground"
                >
                  <option value="none">None</option>
                  {coCrystal ? (
                    <option value="observed">
                      Observed site, {coCrystal.binding_positions.length}{" "}
                      residues
                    </option>
                  ) : null}
                  {pockets.map((pocket) => (
                    <option key={pocket.id} value={pocket.id}>
                      Predicted pocket {pocket.rank}
                      {pocket.probability !== null
                        ? `, p ${pocket.probability.toFixed(2)}`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
              {provider && !provider.availability.available ? (
                <p className="border-l border-border-strong pl-2 text-2xs text-muted-foreground">
                  <span className="text-foreground">
                    No compute backend is attached.
                  </span>{" "}
                  A job submitted now fails with provider_unavailable.{" "}
                  {provider.availability.reason}
                </p>
              ) : null}
            </div>
          </Detail>
        </div>
      ) : (
        <EmptyState
          size="inline"
          title={
            !advanced
              ? OPTIONS_WORDS.notOffered
              : row.smallMolecule === false
                ? "Not applicable"
                : "Binding prediction not offered"
          }
          description={advanced ? row.eligibility : undefined}
        />
      )}

      {advanced ? <SectionHeader title="Sources" /> : null}
      <Detail advanced={advanced} title="Sources">
      <div className="flex flex-wrap gap-1.5 px-3 py-2.5">
        {compound?.chembl_id ? (
          <SourceChip
            source="ChEMBL"
            id={compound.chembl_id}
            href={`https://www.ebi.ac.uk/chembl/explore/compound/${compound.chembl_id}`}
          />
        ) : null}
        {coCrystal ? (
          <SourceChip
            source="PDBe"
            id={coCrystal.ccd_id}
            href={`https://www.ebi.ac.uk/pdbe-srv/pdbechem/chemicalCompound/show/${coCrystal.ccd_id}`}
          />
        ) : null}
        {treatment ? (
          <SourceChip
            source="Open Targets"
            id={treatment.drug_id}
            href={treatment.source_url}
          />
        ) : null}
      </div>
      {compound?.inchikey ? (
        <div className="px-3 pb-3">
          <MonoId value={compound.inchikey} className="text-2xs" />
        </div>
      ) : null}
      </Detail>
    </div>
  );
}

function PocketDetail({
  pocket,
  response,
  rows,
  position,
  constraintId,
  onConstraint,
  onResidue,
  onSelect,
  advanced,
}: {
  advanced: boolean;
  pocket: PredictedPocket;
  response: PocketsResponse;
  rows: ComparisonRow[];
  position: number | null;
  constraintId: string;
  onConstraint: (id: string) => void;
  onResidue: (position: number) => void;
  onSelect: (selected: Selected) => void;
}) {
  const inside = new Set(pocket.positions);
  const ligands = rows
    .map((row) => ({
      row,
      shared:
        row.compound?.co_crystal?.binding_positions.filter((site) =>
          inside.has(site),
        ).length ?? 0,
    }))
    .filter((entry) => entry.shared > 0)
    .sort((left, right) => right.shared - left.shared);
  const method = [response.method?.model_name, response.method?.model_version]
    .filter(Boolean)
    .join(" ");

  return (
    <div>
      {advanced ? (
        <>
          <div className="flex flex-col gap-2 border-b border-border-subtle px-3 py-3">
            <StructureOriginTag
              origin={response.structure_origin ?? "predicted_external"}
              detail={response.structure_id}
              caption
            />
            <MetricReadout
              metric="plddt"
              label="Mean pLDDT of pocket residues"
              value={pocket.mean_plddt}
              missingReason="Not a predicted model"
              producedBy={response.structure_id}
            />
          </div>
          <SectionHeader
            title="Prediction"
            actions={<Cite evidence={pocket.evidence} compact />}
          />
          <DefinitionList>
            <DefinitionRow term="Probability">
              <span className="tabular font-mono">
                {pocket.probability !== null
                  ? pocket.probability.toFixed(3)
                  : "Unknown"}
              </span>
              <span className="block text-muted-foreground">
                {method || "P2Rank"}, calibrated, 0 to 1
              </span>
            </DefinitionRow>
            <DefinitionRow term="Rank" mono>
              {pocket.rank} of {response.pockets.length}
            </DefinitionRow>
            <DefinitionRow term="Raw score" mono>
              {pocket.score}
            </DefinitionRow>
            <DefinitionRow term="Selected residue">
              {position === null
                ? "No residue selected"
                : inside.has(position)
                  ? `Residue ${position} is one of the pocket residues`
                  : `Residue ${position} is not a pocket residue`}
            </DefinitionRow>
          </DefinitionList>
        </>
      ) : (
        <div className="flex flex-col gap-2 border-b border-border-subtle px-3 py-3">
          <ModelResultStrip
            frame="none"
            className="gap-x-5"
            model={response.method?.model_name ?? "P2Rank"}
            version={response.method?.model_version}
            metrics={[
              {
                label: "Probability",
                value: pocket.probability,
                unit: "0 to 1",
                missingReason: "Unknown",
              },
              {
                label: "Rank",
                value: `${pocket.rank} of ${response.pockets.length}`,
              },
              {
                label: "Mean pLDDT",
                value: pocket.mean_plddt,
                explainer: "plddt",
                missingReason: "Not a model",
              },
            ]}
          />
          <div className="flex items-center gap-2">
            <StructureOriginTag
              origin={response.structure_origin ?? "predicted_external"}
              detail={response.structure_id}
            />
            <Cite evidence={pocket.evidence} compact />
          </div>
        </div>
      )}
      <SectionHeader
        title="Pocket residues"
        count={pocket.residues.length}
        actions={
          <Button
            size="xs"
            variant={constraintId === pocket.id ? "secondary" : "ghost"}
            onClick={() =>
              onConstraint(constraintId === pocket.id ? "none" : pocket.id)
            }
          >
            {constraintId === pocket.id
              ? "Set as pose constraint"
              : "Use as pose constraint"}
          </Button>
        }
      />
      <div className="flex flex-wrap gap-1 px-3 py-2.5">
        {pocket.residues.map((residue) => (
          <button
            key={residue.position}
            type="button"
            onClick={() => onResidue(residue.position)}
            className={
              residue.position === position
                ? "rounded-xs border border-foreground bg-active px-1 font-mono text-2xs"
                : "rounded-xs border border-border px-1 font-mono text-2xs hover:border-border-strong hover:bg-accent"
            }
          >
            {residue.residue}
            {residue.position}
          </button>
        ))}
      </div>
      <Detail advanced={advanced}>
        {pocket.unmapped_residue_count > 0 ? (
          <Note>
            {pocket.unmapped_residue_count} pocket residues have no UniProt
            position and are left out.
          </Note>
        ) : null}
        {advanced ? null : (
          <DefinitionList>
            <DefinitionRow term="Raw score" mono>
              {pocket.score}
            </DefinitionRow>
            <DefinitionRow term="Selected residue">
              {position === null
                ? "No residue selected"
                : inside.has(position)
                  ? `Residue ${position} is one of the pocket residues`
                  : `Residue ${position} is not a pocket residue`}
            </DefinitionRow>
          </DefinitionList>
        )}
        <SectionHeader
          title="Ligands observed at these residues"
          count={ligands.length}
        />
        {ligands.length > 0 ? (
          <ul>
            {ligands.slice(0, 8).map(({ row, shared }) => (
              <li key={row.id} className="border-b border-border-subtle">
                <button
                  type="button"
                  onClick={() => onSelect({ kind: "compound", id: row.id })}
                  className="flex min-h-7 w-full cursor-pointer items-center gap-2 px-3 text-left text-xs hover:bg-accent"
                >
                  <span className="truncate">{row.name}</span>
                  <span className="tabular ml-auto shrink-0 font-mono text-2xs text-muted-foreground">
                    {shared} of{" "}
                    {row.compound!.co_crystal!.binding_positions.length} site
                    residues
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            size="inline"
            title="No ligand of an experimental structure contacts these residues"
            searched={["PDBe"]}
          />
        )}
        <SectionHeader title="Limits" />
        <ul className="flex flex-col gap-1 px-3 py-2.5 text-xs text-muted-foreground">
          {response.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </Detail>
    </div>
  );
}

function PartnerDetail({
  curated,
  physical,
  advanced,
}: {
  curated: CuratedPartner | null;
  physical: StringPartner | null;
  advanced: boolean;
}) {
  const partner = curated?.partner ?? physical?.partner ?? null;
  return (
    <div>
      {curated ? (
        <>
          <SectionHeader
            title="Curated interaction"
            actions={<Cite evidence={curated.evidence} />}
          />
          <DefinitionList>
            <DefinitionRow term="Partner">
              {partner?.href ? (
                <TextLink href={partner.href}>{curated.partner_id}</TextLink>
              ) : (
                curated.partner_id
              )}
              {curated.in_catalog ? " (in the catalog)" : ""}
            </DefinitionRow>
            <DefinitionRow term="MI score" mono>
              {curated.mi_score}
            </DefinitionRow>
            <DefinitionRow term="Records" mono>
              {curated.evidence_count}
            </DefinitionRow>
            <DefinitionRow term="Methods">
              {curated.methods.map((method) => method.label).join("; ") || null}
            </DefinitionRow>
            <DefinitionRow term="Type">
              {curated.interaction_types
                .map((entry) => entry.label)
                .join("; ") || null}
            </DefinitionRow>
            <DefinitionRow term="Publications">
              {curated.pmids.length > 0 ? (
                <span className="flex flex-wrap gap-x-2">
                  {curated.pmids.slice(0, 6).map((pmid) => (
                    <ExternalLink
                      key={pmid}
                      href={`https://europepmc.org/article/MED/${pmid}`}
                      className="font-mono"
                    >
                      {pmid}
                    </ExternalLink>
                  ))}
                </span>
              ) : null}
            </DefinitionRow>
            <DefinitionRow term="Source">
              {curated.url ? (
                <ExternalLink href={curated.url}>IntAct</ExternalLink>
              ) : (
                "IntAct"
              )}
            </DefinitionRow>
          </DefinitionList>
          {curated.measured_with_mutant ? (
            <Note>At least one record was measured with a mutant form.</Note>
          ) : null}
        </>
      ) : null}
      {physical ? (
        <>
          <SectionHeader
            title="Physical association"
            actions={<Cite evidence={physical.evidence} />}
          />
          <DefinitionList>
            <DefinitionRow term="Partner">
              {physical.partner?.href ? (
                <TextLink href={physical.partner.href}>
                  {physical.partner.id}
                </TextLink>
              ) : (
                physical.string_id
              )}
            </DefinitionRow>
            <DefinitionRow term="STRING score" mono>
              {physical.score?.toFixed(3)}
            </DefinitionRow>
            <DefinitionRow term="Largest channel" mono>
              {physical.dominant_channel}
            </DefinitionRow>
            <DefinitionRow term="Source">
              {physical.url ? (
                <ExternalLink href={physical.url}>STRING</ExternalLink>
              ) : (
                "STRING"
              )}
            </DefinitionRow>
          </DefinitionList>
          <Detail advanced={advanced} title="About this score">
            <Note>
              The STRING score is a combined confidence over experiments,
              curated databases and text mining. It is not a curated interaction
              record.
            </Note>
          </Detail>
        </>
      ) : null}
    </div>
  );
}

function ClassDetail({
  entry,
  rows,
  onSelect,
  advanced,
}: {
  advanced: boolean;
  entry: MechanismClass;
  rows: ComparisonRow[];
  onSelect: (selected: Selected) => void;
}) {
  return (
    <div>
      <DefinitionList>
        <DefinitionRow term="Mechanism">{entry.mechanism}</DefinitionRow>
        <DefinitionRow term="Action type">
          {entry.actionType?.toLowerCase()}
        </DefinitionRow>
        <DefinitionRow term="Target">{entry.targetName}</DefinitionRow>
        <DefinitionRow term="Modality">
          {entry.modalities
            .map((modality) =>
              modality === "Unknown" ? "Unknown modality" : modality,
            )
            .join(", ")}
        </DefinitionRow>
      </DefinitionList>
      <SectionHeader title="Records" count={entry.drugs.length} />
      <ul>
        {entry.drugs.map((drug) => {
          const row = rows.find(
            (candidate) => candidate.treatment?.drug_id === drug.drug_id,
          );
          const item = toEvidenceItem(drug.evidence);
          return (
            <li
              key={drug.drug_id}
              className="flex min-h-7 items-center gap-2 border-b border-border-subtle px-3 text-xs hover:bg-accent"
            >
              {item ? <EvidencePopover evidence={item} size="compact" /> : null}
              <button
                type="button"
                disabled={!row}
                onClick={() =>
                  row ? onSelect({ kind: "compound", id: row.id }) : null
                }
                className="flex min-h-7 min-w-0 flex-1 items-center gap-2 text-left"
              >
                <span className="truncate">{drug.name}</span>
                <span className="ml-auto shrink-0 text-2xs text-muted-foreground">
                  {drug.clinical_stage_label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {advanced ? (
        <Note>
          The grouping repeats the mechanism text of the source records. Small
          molecules in it can be sent to a binding prediction; other modalities
          cannot.
        </Note>
      ) : null}
    </div>
  );
}

function Overview({
  compounds,
  down,
  provider,
  rows,
}: {
  compounds: ProteinCompoundsResponse | null;
  down: SourcesDown;
  provider: ProviderInfo | null | undefined;
  rows: ComparisonRow[];
}) {
  const tierA = rows.filter((row) => row.tier === "A_experimental").length;
  return (
    <div>
      <Note>
        Select a compound, pocket or partner in the ledger. This overview states
        what was retrieved and how the set was chosen.
      </Note>
      <SectionHeader title="Retrieved for this target" />
      <DefinitionList termWidth="9.5rem">
        <DefinitionRow term="ChEMBL target">
          {compounds?.target ? (
            <ExternalLink href={compounds.target.url}>
              {compounds.target.chembl_id}
            </ExternalLink>
          ) : down.chembl ? (
            `ChEMBL did not answer: ${down.chembl.message ?? down.chembl.state}`
          ) : compounds ? (
            "No ChEMBL target for this protein"
          ) : null}
        </DefinitionRow>
        <DefinitionRow term="With a mechanism" mono>
          {down.chembl ? null : compounds?.counts.with_mechanism}
        </DefinitionRow>
        <DefinitionRow term="With measured affinity" mono>
          {compounds && !down.chembl
            ? `${compounds.counts.with_measured_affinity} shown${
                compounds.counts.qualifying_activities_in_chembl !== null &&
                compounds.counts.qualifying_activities_in_chembl !== undefined
                  ? ` of ${compounds.counts.qualifying_activities_in_chembl} qualifying rows`
                  : ""
              }`
            : null}
        </DefinitionRow>
        <DefinitionRow term="In PDB entries" mono>
          {compounds
            ? `${compounds.counts.co_crystallised} shown of ${compounds.counts.pdb_ligands_total}`
            : null}
        </DefinitionRow>
        <DefinitionRow term={`Tier ${TIER_META.A_experimental.code} rows`} mono>
          {tierA}
        </DefinitionRow>
        <DefinitionRow term="Predictions" mono>
          {rows.filter((row) => row.pose).length}
        </DefinitionRow>
      </DefinitionList>
      {compounds ? (
        <>
          <SectionHeader title="How the set was chosen" />
          <Note>{compounds.selection_rule}</Note>
          <SectionHeader title="Best-measured rule" />
          <Note>{compounds.affinity_rule}</Note>
        </>
      ) : null}
      <SectionHeader title="Compute for predictions" />
      {provider ? (
        <DefinitionList termWidth="9.5rem">
          <DefinitionRow term="Model">
            {[provider.model_name, provider.model_version]
              .filter(Boolean)
              .join(" ")}
          </DefinitionRow>
          <DefinitionRow term="Backend">
            {provider.availability.available
              ? "Attached"
              : "No compute backend attached"}
          </DefinitionRow>
          <DefinitionRow term="Detail">
            {provider.availability.reason}
          </DefinitionRow>
        </DefinitionList>
      ) : (
        <EmptyState
          size="inline"
          title="No binding predictor is registered"
          description="The model registry lists no provider for binding_prediction jobs."
        />
      )}
    </div>
  );
}

export interface InterventionInspectorProps {
  /** false: the short view, detail behind toggles */
  advanced: boolean;
  /** structure in the 3D view right now; null while the table is shown */
  shownStructureId: string | null;
  accession: string;
  selected: Selected;
  rows: ComparisonRow[];
  row: ComparisonRow | null;
  treatment: Treatment | null;
  pocket: PredictedPocket | null;
  pocketsResponse: PocketsResponse | null;
  curated: CuratedPartner | null;
  physical: StringPartner | null;
  mechanismClass: MechanismClass | null;
  compounds: ProteinCompoundsResponse | null;
  down: SourcesDown;
  provider: ProviderInfo | null | undefined;
  position: number | null;
  constraintId: string;
  onConstraint: (id: string) => void;
  onResidue: (position: number) => void;
  onSelect: (selected: Selected) => void;
  onShowStructure: (pdbId: string) => void;
  onShowPose: (run: BindingRun) => void;
}

/** Evidence for the current selection; without one, what was retrieved and by which rules. */
export function InterventionInspector(props: InterventionInspectorProps) {
  const { selected, rows, compounds, provider, advanced } = props;
  const pockets = props.pocketsResponse?.pockets ?? [];
  if (selected?.kind === "compound" && props.row)
    return (
      <CompoundDetail
        advanced={advanced}
        shownStructureId={props.shownStructureId}
        accession={props.accession}
        row={props.row}
        pockets={pockets}
        affinityRule={compounds?.affinity_rule ?? null}
        chemblDown={props.down.chembl}
        provider={provider}
        constraintId={props.constraintId}
        onConstraint={props.onConstraint}
        predictedCount={rows.filter((row) => row.pose?.result?.affinity).length}
        onShowStructure={props.onShowStructure}
        onShowPose={props.onShowPose}
      />
    );
  if (selected?.kind === "treatment" && props.treatment)
    return (
      <div>
        <div className="flex flex-wrap gap-1.5 border-b border-border-subtle px-3 py-3">
          <ButtonLink size="sm" href={routes.compound(props.treatment.drug_id)}>
            Compound record
          </ButtonLink>
          <SourceChip
            source="Open Targets"
            id={props.treatment.drug_id}
            href={props.treatment.source_url}
          />
        </div>
        <TreatmentBlock
          treatment={props.treatment}
          actsOnTarget={false}
          advanced={advanced}
        />
      </div>
    );
  if (selected?.kind === "pocket" && props.pocket && props.pocketsResponse)
    return (
      <PocketDetail
        advanced={advanced}
        pocket={props.pocket}
        response={props.pocketsResponse}
        rows={rows}
        position={props.position}
        constraintId={props.constraintId}
        onConstraint={props.onConstraint}
        onResidue={props.onResidue}
        onSelect={props.onSelect}
      />
    );
  if (selected?.kind === "partner" && (props.curated || props.physical))
    return (
      <PartnerDetail
        advanced={advanced}
        curated={props.curated}
        physical={props.physical}
      />
    );
  if (selected?.kind === "class" && props.mechanismClass)
    return (
      <ClassDetail
        advanced={advanced}
        entry={props.mechanismClass}
        rows={rows}
        onSelect={props.onSelect}
      />
    );
  return (
    <Overview
      compounds={compounds}
      down={props.down}
      provider={provider}
      rows={rows}
    />
  );
}
