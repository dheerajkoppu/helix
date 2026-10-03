"use client";

import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { ButtonLink } from "@/components/data/button-link";
import {
  DefinitionList,
  DefinitionRow,
} from "@/components/data/definition-list";
import { ExternalLink } from "@/components/data/external-link";
import { MonoId } from "@/components/data/mono-id";
import { TextLink } from "@/components/data/text-link";
import { EvidencePopover } from "@/components/evidence/evidence-popover";
import { SourceChip } from "@/components/evidence/source-chip";
import { SourceStatusList } from "@/components/evidence/source-status-list";
import { AddToProjectButton } from "@/components/project/add-to-project";
import { LearnTerm } from "@/components/science/learn-term";
import {
  Page,
  PageBody,
  PageHeader,
  PageSection,
  Plate,
} from "@/components/shell/page";
import { EmptyState } from "@/components/states/empty-state";
import { Fold } from "@/components/intervention/fold";
import { sourceDown } from "@/components/intervention/model";
import { QueryErrorState, RowsSkeleton } from "@/components/states/query-state";
import { SourceUnavailable } from "@/components/states/source-unavailable";
import { Button } from "@/components/ui/button";
import { isUniProtAccession, routes } from "@/lib/ids";
import {
  OPTIONS_WORDS,
  plainConcentration,
  plainDrugKind,
  plainDrugStage,
  plainLabTests,
} from "@/lib/plain-language";
import { useAdvancedMode } from "@/lib/state/preferences";
import { useCompound, useCompounds } from "@/lib/workspace-data";

import { CompoundDepiction } from "./depiction";
import {
  compoundName,
  measuredBasis,
  measuredAmount,
  measuredValue,
  modalityLabel,
  phaseLabel,
  toEvidenceItem,
} from "./format";
import { useCompoundAnalogs } from "./queries";

const ROW =
  "grid items-baseline gap-x-4 border-b border-border-subtle px-3 py-1.5 text-xs last:border-b-0";

function ShowAll({
  total,
  initial,
  expanded,
  onToggle,
}: {
  total: number;
  initial: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (total <= initial) return null;
  return (
    <Button size="xs" variant="ghost" onClick={onToggle}>
      {expanded ? `Show first ${initial}` : `Show all ${total}`}
    </Button>
  );
}

/** A page section closed to its title and count until opened. */
function PageFold({
  title,
  count,
  children,
}: {
  title: string;
  count?: number | null;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="border-b border-border-subtle last:border-b-0">
      <h2>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex h-12 w-full cursor-pointer items-center gap-2 rounded-xs text-left text-base font-medium text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <ChevronRightIcon
            aria-hidden
            className={`size-4 shrink-0 text-subtle-foreground transition-transform ${open ? "rotate-90" : ""}`}
          />
          {title}
          {count !== undefined && count !== null ? (
            <span className="tabular font-mono text-xs font-normal text-muted-foreground">
              {count}
            </span>
          ) : null}
        </button>
      </h2>
      {open ? <div className="pb-5">{children}</div> : null}
    </section>
  );
}

function MeasuredForTarget({
  compoundId,
  chemblId,
  target,
  advanced,
}: {
  compoundId: string;
  chemblId: string | null;
  target: string;
  advanced: boolean;
}) {
  const compounds = useCompounds(target);
  if (compounds.isPending)
    return (
      <div>
        <p className="px-3 py-2 text-xs text-muted-foreground">
          {advanced
            ? `Reading ChEMBL activities for ${target}. The first request for a protein can take up to 45 seconds.`
            : OPTIONS_WORDS.loading}
        </p>
        <RowsSkeleton rows={3} />
      </div>
    );
  if (compounds.isError)
    return (
      <QueryErrorState
        size="inline"
        error={compounds.error}
        subject={`activities against ${target}`}
        onRetry={() => void compounds.refetch()}
      />
    );
  const body = compounds.data.data;
  const record = body.compounds.find(
    (entry) =>
      entry.id === compoundId || (chemblId && entry.chembl_id === chemblId),
  );
  const measured = record?.measured_affinity;
  const chemblDown = sourceDown(compounds.data.sources, "chembl");
  if (!measured && chemblDown)
    return (
      <SourceUnavailable
        source={chemblDown.name ?? "ChEMBL"}
        message={chemblDown.message}
        onRetry={() => void compounds.refetch()}
      />
    );
  if (!measured)
    return (
      <EmptyState
        size="inline"
        title={
          advanced
            ? `No measured affinity against ${target} in the retrieved set`
            : OPTIONS_WORDS.none
        }
        description={
          !advanced
            ? undefined
            : record
              ? "The compound is recorded for this target without a qualifying activity row."
              : `${body.selection_rule} This compound is not in that set.`
        }
        searched={["ChEMBL"]}
      />
    );
  const evidence = toEvidenceItem(
    record.evidence.find((entry) => entry.predicate === "measured_activity"),
  );
  const rule = (
    <div className="border-t border-border-subtle px-3 py-2">
      <p className="max-w-[78ch] text-xs text-muted-foreground">
        <span className="text-foreground">Best-measured rule.</span>{" "}
        {body.affinity_rule}
      </p>
    </div>
  );
  if (!advanced)
    return (
      <>
        <div className="flex flex-col gap-1 px-3 py-3">
          <span className="text-xs text-muted-foreground">
            {OPTIONS_WORDS.strength}
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span
              className="tabular font-mono text-2xl leading-8 font-medium text-foreground"
              title={`${measuredValue(measured)} (${plainConcentration(measured.representative.units)})`}
            >
              {measuredAmount(measured)}
            </span>
            {evidence ? <EvidencePopover evidence={evidence} /> : null}
          </span>
          <span className="text-xs text-muted-foreground">
            {plainLabTests(measured.assay_count)}. {OPTIONS_WORDS.lowerStronger}
          </span>
        </div>
        <Fold title="Details" tone="quiet" className="border-t border-border-subtle">
          <DefinitionList termWidth="9rem">
            <DefinitionRow term="Basis">{measuredBasis(measured)}</DefinitionRow>
            <DefinitionRow term="pChEMBL range" mono>
              {measured.min_pchembl.toFixed(2)} to{" "}
              {measured.max_pchembl.toFixed(2)}
            </DefinitionRow>
            <DefinitionRow term="Rows by type" mono>
              {Object.entries(measured.standard_types)
                .map(([type, count]) => `${type} ${count}`)
                .join(", ")}
            </DefinitionRow>
            <DefinitionRow term="Assay format">
              {measured.assay_format}
            </DefinitionRow>
            <DefinitionRow term="Printed row">
              {measured.representative.url ? (
                <ExternalLink href={measured.representative.url}>
                  {measured.representative.assay_chembl_id ?? "ChEMBL assay"}
                </ExternalLink>
              ) : (
                measured.representative.assay_chembl_id
              )}
            </DefinitionRow>
          </DefinitionList>
          {rule}
        </Fold>
      </>
    );
  return (
    <>
      <DefinitionList termWidth="9rem">
        <DefinitionRow term="Printed value">
          <span className="tabular mr-2 font-mono">
            {measuredValue(measured)}
          </span>
          {evidence ? <EvidencePopover evidence={evidence} /> : null}
        </DefinitionRow>
        <DefinitionRow term="Basis">{measuredBasis(measured)}</DefinitionRow>
        <DefinitionRow term="pChEMBL range" mono>
          {measured.min_pchembl.toFixed(2)} to {measured.max_pchembl.toFixed(2)}
        </DefinitionRow>
        <DefinitionRow term="Rows by type" mono>
          {Object.entries(measured.standard_types)
            .map(([type, count]) => `${type} ${count}`)
            .join(", ")}
        </DefinitionRow>
        <DefinitionRow term="Assay format">
          {measured.assay_format}
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
              className="line-clamp-3 max-w-[78ch] text-muted-foreground"
              title={measured.representative.assay_description}
            >
              {measured.representative.assay_description}
            </span>
          ) : null}
        </DefinitionRow>
      </DefinitionList>
      {rule}
    </>
  );
}

export function CompoundPage({ compoundId }: { compoundId: string }) {
  const searchParams = useSearchParams();
  const compound = useCompound(compoundId);
  const advanced = useAdvancedMode();
  const [allIndications, setAllIndications] = useState(false);
  const [allXrefs, setAllXrefs] = useState(false);

  const detail = compound.data?.data ?? null;
  const core = detail?.compound ?? null;
  const analogs = useCompoundAnalogs(
    core?.modality === "small_molecule" ? core.id : null,
  );
  const [allAnalogs, setAllAnalogs] = useState(false);
  const analogsDown = sourceDown(analogs.data?.sources, "chembl"
  );

  if (compound.isPending)
    return (
      <Page>
        <PageHeader
          kind="Compound"
          title="Compound"
          id={<MonoId value={compoundId} />}
        />
        <PageBody className="py-5">
          <RowsSkeleton rows={8} />
        </PageBody>
      </Page>
    );
  if (compound.isError || !detail || !core)
    return (
      <Page>
        <PageHeader
          kind="Compound"
          title="Compound"
          id={<MonoId value={compoundId} />}
        />
        <PageBody className="py-5">
          <Plate className="h-56">
            <QueryErrorState
              error={compound.error}
              subject={`compound ${compoundId}`}
              onRetry={() => void compound.refetch()}
            />
          </Plate>
        </PageBody>
      </Page>
    );

  const name = compoundName(core);
  const status = phaseLabel(core.max_phase, core.first_approval);
  const targetAccessions = [
    ...new Set(
      detail.targets.flatMap((target) =>
        target.protein_refs.map((ref) => ref.id),
      ),
    ),
  ];
  const requested = searchParams.get("target")?.toUpperCase() ?? null;
  const target =
    requested && isUniProtAccession(requested)
      ? requested
      : targetAccessions.length === 1
        ? targetAccessions[0]
        : null;
  const indications = [...detail.indications].sort(
    (left, right) =>
      (right.max_phase_for_indication ?? -1) -
      (left.max_phase_for_indication ?? -1),
  );
  const shownIndications = allIndications
    ? indications
    : indications.slice(0, 10);
  const priority = [
    "chembl",
    "pubchem",
    "pdb",
    "drugcentral",
    "chebi",
    "bindingdb",
    "drugbank",
    "fdasrs",
    "unii",
  ];
  const xrefs = [...detail.cross_references].sort((left, right) => {
    const a = priority.indexOf(left.database);
    const b = priority.indexOf(right.database);
    return (a === -1 ? 99 : a) - (b === -1 ? 99 : b);
  });
  const shownXrefs = allXrefs ? xrefs : xrefs.slice(0, 16);
  const analogRows = analogs.data?.data.analogs ?? [];

  return (
    <Page>
      <PageHeader
        kind={advanced ? "Compound" : OPTIONS_WORDS.molecule}
        title={name}
        id={
          advanced ? <MonoId value={core.inchikey ?? core.id} /> : undefined
        }
        description={
          advanced
            ? [
                modalityLabel(core),
                status
                  ? `${status}${core.max_phase && core.max_phase >= 4 ? ", any indication" : ""}`
                  : "No clinical phase in ChEMBL",
              ].join(" · ")
            : [
                plainDrugKind(modalityLabel(core)),
                plainDrugStage(core.max_phase, core.first_approval) ??
                  OPTIONS_WORDS.noStage,
              ].join(" · ")
        }
        meta={
          advanced && core.chembl_id ? (
            <SourceChip
              source="ChEMBL"
              id={core.chembl_id}
              href={`https://www.ebi.ac.uk/chembl/explore/compound/${core.chembl_id}`}
            />
          ) : null
        }
        actions={
          <>
            {target ? (
              <ButtonLink
                variant={advanced ? "outline" : "default"}
                href={`${routes.interventions(target)}?compound=${encodeURIComponent(core.id)}`}
              >
                {advanced ? `Open with ${target}` : OPTIONS_WORDS.withProtein}
              </ButtonLink>
            ) : null}
            <AddToProjectButton
              item={{
                kind: "compound",
                ref: core.inchikey ?? core.id,
                label: name,
                origin: { route: routes.compound(core.id) },
                evidence: detail.evidence,
                data: {
                  chembl_id: core.chembl_id,
                  modality: core.modality,
                  max_phase: core.max_phase,
                },
              }}
            />
          </>
        }
      />
      <PageBody>
        {advanced ? (
          <>
        <PageSection title="Identity">
          <div className="flex flex-col gap-4 md:flex-row">
            <Plate className="flex h-60 w-full shrink-0 items-center justify-center p-2 md:w-80">
              <CompoundDepiction
                depictionUrl={core.depiction_url}
                name={name}
                absentLabel={
                  core.modality === "small_molecule"
                    ? "No 2D structure stored"
                    : `${modalityLabel(core)}: no small-molecule structure`
                }
                className="size-full"
              />
            </Plate>
            <Plate className="min-w-0 flex-1">
              <DefinitionList termWidth="8.5rem">
                <DefinitionRow term="Name">{core.name}</DefinitionRow>
                <DefinitionRow term="InChIKey">
                  {core.inchikey ? <MonoId value={core.inchikey} /> : null}
                </DefinitionRow>
                <DefinitionRow term="ChEMBL ID" mono>
                  {core.chembl_id}
                  {detail.parent_chembl_id &&
                  detail.parent_chembl_id !== core.chembl_id
                    ? ` (parent ${detail.parent_chembl_id})`
                    : ""}
                </DefinitionRow>
                <DefinitionRow term="Modality">
                  {modalityLabel(core)}
                  <span className="block text-muted-foreground">
                    {core.modality_basis}
                  </span>
                </DefinitionRow>
                <DefinitionRow term="Formula" mono>
                  {core.molecular_formula}
                </DefinitionRow>
                <DefinitionRow term="Molecular weight" mono>
                  {core.molecular_weight
                    ? `${core.molecular_weight.toFixed(2)} Da`
                    : null}
                </DefinitionRow>
                <DefinitionRow term="Clinical phase">
                  {status
                    ? `${status} (ChEMBL max_phase ${core.max_phase}, any indication)`
                    : null}
                </DefinitionRow>
                <DefinitionRow term="SMILES" mono>
                  {core.smiles ? (
                    <MonoId value={core.smiles} className="break-all" />
                  ) : null}
                </DefinitionRow>
                <DefinitionRow term="Binding prediction">
                  {core.binding_prediction.reason}
                </DefinitionRow>
              </DefinitionList>
            </Plate>
          </div>
        </PageSection>
        <PageSection
          title="Mechanisms"
          count={detail.mechanisms.length}
          description="Mechanisms of action curated by ChEMBL, each with its reference."
        >
          {detail.mechanisms.length > 0 ? (
            <Plate>
              {detail.mechanisms.map((mechanism) => {
                const evidence = toEvidenceItem(
                  detail.evidence.find(
                    (entry) =>
                      entry.source?.record_id ===
                      `mechanism:${mechanism.mechanism_id}`,
                  ),
                );
                return (
                  <div
                    key={mechanism.mechanism_id}
                    className={`${ROW} grid-cols-[auto_minmax(0,1fr)] md:grid-cols-[auto_minmax(0,2fr)_minmax(0,2fr)_auto]`}
                  >
                    <span>
                      {evidence ? (
                        <EvidencePopover evidence={evidence} size="compact" />
                      ) : null}
                    </span>
                    <span>
                      {mechanism.mechanism_of_action}
                      <span className="block text-muted-foreground">
                        {[
                          mechanism.action_type?.toLowerCase(),
                          mechanism.target_name,
                          mechanism.target_type?.toLowerCase(),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <span className="col-start-2 text-muted-foreground md:col-start-auto">
                      {[
                        mechanism.mechanism_comment,
                        mechanism.binding_site_comment,
                        mechanism.selectivity_comment,
                      ]
                        .filter(Boolean)
                        .join(" ") || null}
                    </span>
                    <span className="col-start-2 flex flex-wrap gap-x-2 md:col-start-auto">
                      {mechanism.references.slice(0, 3).map((reference) =>
                        reference.url ? (
                          <ExternalLink
                            key={`${reference.type}${reference.id}`}
                            href={reference.url}
                          >
                            {reference.type}
                          </ExternalLink>
                        ) : null,
                      )}
                    </span>
                  </div>
                );
              })}
            </Plate>
          ) : (
            <EmptyState
              size="inline"
              title="No mechanism of action recorded"
              searched={["ChEMBL"]}
            />
          )}
        </PageSection>
        <PageSection title="Targets" count={detail.targets.length}>
          {detail.targets.length > 0 ? (
            <Plate>
              {detail.targets.map((entry) => (
                <div
                  key={entry.chembl_id}
                  className={`${ROW} grid-cols-[minmax(0,1fr)_auto]`}
                >
                  <span>
                    {entry.name ?? entry.chembl_id}
                    <span className="block text-muted-foreground">
                      {[
                        entry.target_type?.toLowerCase(),
                        entry.organism,
                        entry.action_types.join(", ").toLowerCase(),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                    {entry.protein_refs.map((ref) => (
                      <TextLink
                        key={ref.id}
                        href={`${routes.interventions(ref.id)}?compound=${encodeURIComponent(core.id)}`}
                        className="font-mono"
                      >
                        {ref.id}
                      </TextLink>
                    ))}
                    <SourceChip
                      source="ChEMBL"
                      id={entry.chembl_id}
                      href={entry.url}
                    />
                  </span>
                </div>
              ))}
            </Plate>
          ) : (
            <EmptyState
              size="inline"
              title="No target recorded"
              description="ChEMBL lists no mechanism target for this compound."
              searched={["ChEMBL"]}
            />
          )}
        </PageSection>
        <PageSection
          title={
            <>
              Measured <LearnTerm term="binding-affinity">affinity</LearnTerm>
              {target ? ` against ${target}` : ""}
            </>
          }
          actions={
            targetAccessions.length > 1 ? (
              <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                Target
                {targetAccessions.slice(0, 8).map((accession) => (
                  <Link
                    key={accession}
                    href={`${routes.compound(compoundId)}?target=${accession}`}
                    scroll={false}
                    className={
                      accession === target
                        ? "rounded-xs border border-foreground px-1 font-mono text-foreground"
                        : "rounded-xs border border-border px-1 font-mono hover:border-border-strong hover:text-foreground"
                    }
                  >
                    {accession}
                  </Link>
                ))}
              </span>
            ) : null
          }
        >
          <Plate>
            {target ? (
              <MeasuredForTarget
                compoundId={core.id}
                chemblId={core.chembl_id ?? null}
                target={target}
                advanced
              />
            ) : (
              <EmptyState
                size="inline"
                title="No target chosen"
                description={
                  targetAccessions.length > 0
                    ? "Choose one of the recorded targets to read the measured activities against it."
                    : "Open this compound from a protein's intervention stage to read its measured activities against that protein."
                }
              />
            )}
          </Plate>
        </PageSection>
        <PageSection
          title="Indications"
          count={indications.length}
          description={detail.indications_note}
          actions={
            <ShowAll
              total={indications.length}
              initial={10}
              expanded={allIndications}
              onToggle={() => setAllIndications((value) => !value)}
            />
          }
        >
          {indications.length > 0 ? (
            <Plate>
              {shownIndications.map((indication) => (
                <div
                  key={indication.indication_id}
                  className={`${ROW} grid-cols-[minmax(0,1fr)_auto_auto]`}
                >
                  <span>
                    {indication.efo_term ?? indication.mesh_heading}
                    <span className="ml-2 font-mono text-2xs text-muted-foreground">
                      {indication.efo_id ?? indication.mesh_id}
                    </span>
                  </span>
                  <span className="text-muted-foreground">
                    {phaseLabel(indication.max_phase_for_indication) ??
                      "Phase unknown"}
                  </span>
                  <span className="flex gap-x-2">
                    {indication.references.slice(0, 2).map((reference) =>
                      reference.url ? (
                        <ExternalLink
                          key={`${reference.type}${reference.id}`}
                          href={reference.url}
                        >
                          {reference.type}
                        </ExternalLink>
                      ) : null,
                    )}
                  </span>
                </div>
              ))}
            </Plate>
          ) : (
            <EmptyState
              size="inline"
              title="No indication recorded"
              searched={["ChEMBL"]}
            />
          )}
        </PageSection>
        <PageSection
          title="Analogs"
          count={analogs.data && !analogsDown ? analogRows.length : null}
          actions={
            <ShowAll
              total={analogRows.length}
              initial={8}
              expanded={allAnalogs}
              onToggle={() => setAllAnalogs((value) => !value)}
            />
          }
          description={
            analogs.data
              ? `ChEMBL similarity search at ${analogs.data.data.threshold}% or above. Similar structure is not evidence of similar activity.`
              : undefined
          }
        >
          {core.modality !== "small_molecule" ? (
            <EmptyState
              size="inline"
              title="Not applicable"
              description="Structural similarity search applies to small molecules with a stored structure."
            />
          ) : analogs.isPending ? (
            <RowsSkeleton rows={4} />
          ) : analogs.isError ? (
            <QueryErrorState
              size="inline"
              error={analogs.error}
              subject="analogs"
              onRetry={() => void analogs.refetch()}
            />
          ) : analogRows.length === 0 && analogsDown ? (
            <SourceUnavailable
              source={analogsDown.name ?? "ChEMBL"}
              message={analogsDown.message}
              onRetry={() => void analogs.refetch()}
              retrying={analogs.isFetching}
            />
          ) : analogRows.length === 0 ? (
            <EmptyState
              size="inline"
              title="No analog at this threshold"
              description={analogs.data.data.message ?? undefined}
              searched={["ChEMBL"]}
            />
          ) : (
            <Plate>
              {(allAnalogs ? analogRows : analogRows.slice(0, 8)).map((analog) => (
                <Link
                  key={analog.id}
                  href={routes.compound(analog.id)}
                  className={`${ROW} grid-cols-[76px_minmax(0,1fr)_auto] items-center hover:bg-accent`}
                >
                  <CompoundDepiction
                    depictionUrl={analog.depiction_url}
                    name={compoundName(analog)}
                    className="h-12 w-[76px]"
                  />
                  <span className="min-w-0">
                    <span className="block truncate">
                      {compoundName(analog)}
                    </span>
                    <span className="block truncate font-mono text-2xs text-muted-foreground">
                      {analog.inchikey ?? analog.chembl_id}
                      {phaseLabel(analog.max_phase, analog.first_approval)
                        ? ` · ${phaseLabel(analog.max_phase, analog.first_approval)}`
                        : ""}
                    </span>
                  </span>
                  <span className="tabular font-mono text-foreground">
                    {analog.similarity.toFixed(1)} %
                  </span>
                </Link>
              ))}
            </Plate>
          )}
        </PageSection>
        <PageSection
          title="Cross-references"
          count={xrefs.length}
          description="Identifiers of the same structure in other databases, resolved by UniChem from the InChIKey."
          actions={
            <ShowAll
              total={xrefs.length}
              initial={16}
              expanded={allXrefs}
              onToggle={() => setAllXrefs((value) => !value)}
            />
          }
        >
          {xrefs.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {shownXrefs.map((xref) => (
                <SourceChip
                  key={`${xref.database}:${xref.id}`}
                  source={xref.database_name ?? xref.database}
                  id={xref.id}
                  href={xref.url}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              size="inline"
              title="No cross-reference"
              searched={["UniChem"]}
            />
          )}
        </PageSection>
        <PageSection title="Sources">
          <SourceStatusList sources={compound.data.sources} />
        </PageSection>
          </>
        ) : (
          <>
        <section className="border-b border-border-subtle py-5">
          <div className="flex flex-col gap-5 md:flex-row">
            <Plate className="flex h-60 w-full shrink-0 items-center justify-center p-2 md:w-80">
              <CompoundDepiction
                depictionUrl={core.depiction_url}
                name={name}
                absentLabel={
                  core.modality === "small_molecule"
                    ? OPTIONS_WORDS.noDrawing
                    : plainDrugKind(modalityLabel(core))
                }
                className="size-full"
              />
            </Plate>
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              {targetAccessions.length > 1 ? (
                <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  Target
                  {targetAccessions.slice(0, 8).map((accession) => (
                    <Link
                      key={accession}
                      href={`${routes.compound(compoundId)}?target=${accession}`}
                      scroll={false}
                      className={
                        accession === target
                          ? "rounded-xs border border-foreground px-1 font-mono text-foreground"
                          : "rounded-xs border border-border px-1 font-mono hover:border-border-strong hover:text-foreground"
                      }
                    >
                      {accession}
                    </Link>
                  ))}
                </span>
              ) : null}
              {target ? (
                <Plate>
                  <MeasuredForTarget
                    compoundId={core.id}
                    chemblId={core.chembl_id ?? null}
                    target={target}
                    advanced={false}
                  />
                </Plate>
              ) : null}
              <Plate>
                <DefinitionList termWidth="8.5rem">
                  <DefinitionRow term={OPTIONS_WORDS.stage}>
                    {plainDrugStage(core.max_phase, core.first_approval)}
                  </DefinitionRow>
                  <DefinitionRow term={OPTIONS_WORDS.kindRow}>
                    {plainDrugKind(modalityLabel(core))}
                  </DefinitionRow>
                  <DefinitionRow term={OPTIONS_WORDS.weight} mono>
                    {core.molecular_weight ? (
                      <span title="daltons">
                        {core.molecular_weight.toFixed(0)} Da
                      </span>
                    ) : null}
                  </DefinitionRow>
                  <DefinitionRow term={OPTIONS_WORDS.formula} mono>
                    {core.molecular_formula}
                  </DefinitionRow>
                </DefinitionList>
                <Fold
                  title={OPTIONS_WORDS.codes}
                  tone="quiet"
                  className="border-t border-border-subtle"
                >
                  <DefinitionList termWidth="8.5rem">
                    <DefinitionRow term="InChIKey">
                      {core.inchikey ? <MonoId value={core.inchikey} /> : null}
                    </DefinitionRow>
                    <DefinitionRow term="ChEMBL ID">
                      {core.chembl_id ? (
                        <SourceChip
                          source="ChEMBL"
                          id={core.chembl_id}
                          href={`https://www.ebi.ac.uk/chembl/explore/compound/${core.chembl_id}`}
                        />
                      ) : null}
                    </DefinitionRow>
                    <DefinitionRow term="SMILES" mono>
                      {core.smiles ? (
                        <MonoId value={core.smiles} className="break-all" />
                      ) : null}
                    </DefinitionRow>
                    <DefinitionRow term="Modality basis">
                      {core.modality_basis}
                    </DefinitionRow>
                    <DefinitionRow term="Binding prediction">
                      {core.binding_prediction.reason}
                    </DefinitionRow>
                  </DefinitionList>
                </Fold>
              </Plate>
            </div>
          </div>
        </section>

        <PageSection
          title={OPTIONS_WORDS.howItWorks}
          count={detail.mechanisms.length}
        >
          {detail.mechanisms.length > 0 ? (
            <Plate>
              {detail.mechanisms.map((mechanism) => {
                const evidence = toEvidenceItem(
                  detail.evidence.find(
                    (entry) =>
                      entry.source?.record_id ===
                      `mechanism:${mechanism.mechanism_id}`,
                  ),
                );
                return (
                  <div
                    key={mechanism.mechanism_id}
                    className={`${ROW} grid-cols-[auto_minmax(0,1fr)] md:grid-cols-[auto_minmax(0,2fr)_minmax(0,2fr)_auto]`}
                  >
                    <span>
                      {evidence ? (
                        <EvidencePopover evidence={evidence} size="compact" />
                      ) : null}
                    </span>
                    <span>
                      {mechanism.mechanism_of_action}
                      <span className="block text-muted-foreground">
                        {[
                          mechanism.action_type?.toLowerCase(),
                          mechanism.target_name,
                          mechanism.target_type?.toLowerCase(),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <span className="col-start-2 text-muted-foreground md:col-start-auto">
                      {[
                        mechanism.mechanism_comment,
                        mechanism.binding_site_comment,
                        mechanism.selectivity_comment,
                      ]
                        .filter(Boolean)
                        .join(" ") || null}
                    </span>
                    <span className="col-start-2 flex flex-wrap gap-x-2 md:col-start-auto">
                      {mechanism.references.slice(0, 3).map((reference) =>
                        reference.url ? (
                          <ExternalLink
                            key={`${reference.type}${reference.id}`}
                            href={reference.url}
                          >
                            {reference.type}
                          </ExternalLink>
                        ) : null,
                      )}
                    </span>
                  </div>
                );
              })}
            </Plate>
          ) : (
            <EmptyState
              size="inline"
              title="No mechanism of action recorded"
              searched={["ChEMBL"]}
            />
          )}
        </PageSection>

        <PageSection
          title={OPTIONS_WORDS.actsOn}
          count={detail.targets.length}
        >
          {detail.targets.length > 0 ? (
            <Plate>
              {detail.targets.map((entry) => (
                <div
                  key={entry.chembl_id}
                  className={`${ROW} grid-cols-[minmax(0,1fr)_auto]`}
                >
                  <span>
                    {entry.name ?? entry.chembl_id}
                    <span className="block text-muted-foreground">
                      {[
                        entry.target_type?.toLowerCase(),
                        entry.organism,
                        entry.action_types.join(", ").toLowerCase(),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                    {entry.protein_refs.map((ref) => (
                      <TextLink
                        key={ref.id}
                        href={`${routes.interventions(ref.id)}?compound=${encodeURIComponent(core.id)}`}
                        className="font-mono"
                      >
                        {ref.id}
                      </TextLink>
                    ))}
                    <SourceChip
                      source="ChEMBL"
                      id={entry.chembl_id}
                      href={entry.url}
                    />
                  </span>
                </div>
              ))}
            </Plate>
          ) : (
            <EmptyState
              size="inline"
              title="No target recorded"
              description="ChEMBL lists no mechanism target for this compound."
              searched={["ChEMBL"]}
            />
          )}
        </PageSection>

        <PageFold title={OPTIONS_WORDS.usedFor} count={indications.length}>
          <div className="mb-2 flex justify-end">
            <ShowAll
              total={indications.length}
              initial={10}
              expanded={allIndications}
              onToggle={() => setAllIndications((value) => !value)}
            />
          </div>
          {indications.length > 0 ? (
            <Plate>
              {shownIndications.map((indication) => (
                <div
                  key={indication.indication_id}
                  className={`${ROW} grid-cols-[minmax(0,1fr)_auto_auto]`}
                >
                  <span>
                    {indication.efo_term ?? indication.mesh_heading}
                    <span className="ml-2 font-mono text-2xs text-muted-foreground">
                      {indication.efo_id ?? indication.mesh_id}
                    </span>
                  </span>
                  <span className="text-muted-foreground">
                    {plainDrugStage(indication.max_phase_for_indication) ??
                      OPTIONS_WORDS.noStage}
                  </span>
                  <span className="flex gap-x-2">
                    {indication.references.slice(0, 2).map((reference) =>
                      reference.url ? (
                        <ExternalLink
                          key={`${reference.type}${reference.id}`}
                          href={reference.url}
                        >
                          {reference.type}
                        </ExternalLink>
                      ) : null,
                    )}
                  </span>
                </div>
              ))}
            </Plate>
          ) : (
            <EmptyState
              size="inline"
              title="No indication recorded"
              searched={["ChEMBL"]}
            />
          )}
        </PageFold>

        <PageFold
          title={OPTIONS_WORDS.similar}
          count={analogs.data && !analogsDown ? analogRows.length : null}
        >
          <div className="mb-2 flex justify-end">
            <ShowAll
              total={analogRows.length}
              initial={8}
              expanded={allAnalogs}
              onToggle={() => setAllAnalogs((value) => !value)}
            />
          </div>
          {core.modality !== "small_molecule" ? (
            <EmptyState
              size="inline"
              title="Not applicable"
              description="Structural similarity search applies to small molecules with a stored structure."
            />
          ) : analogs.isPending ? (
            <RowsSkeleton rows={4} />
          ) : analogs.isError ? (
            <QueryErrorState
              size="inline"
              error={analogs.error}
              subject="analogs"
              onRetry={() => void analogs.refetch()}
            />
          ) : analogRows.length === 0 && analogsDown ? (
            <SourceUnavailable
              source={analogsDown.name ?? "ChEMBL"}
              message={analogsDown.message}
              onRetry={() => void analogs.refetch()}
              retrying={analogs.isFetching}
            />
          ) : analogRows.length === 0 ? (
            <EmptyState
              size="inline"
              title="No analog at this threshold"
              description={analogs.data.data.message ?? undefined}
              searched={["ChEMBL"]}
            />
          ) : (
            <Plate>
              {(allAnalogs ? analogRows : analogRows.slice(0, 8)).map((analog) => (
                <Link
                  key={analog.id}
                  href={routes.compound(analog.id)}
                  className={`${ROW} grid-cols-[76px_minmax(0,1fr)_auto] items-center hover:bg-accent`}
                >
                  <CompoundDepiction
                    depictionUrl={analog.depiction_url}
                    name={compoundName(analog)}
                    className="h-12 w-[76px]"
                  />
                  <span className="min-w-0">
                    <span className="block truncate">
                      {compoundName(analog)}
                    </span>
                    <span className="block truncate font-mono text-2xs text-muted-foreground">
                      {analog.inchikey ?? analog.chembl_id}
                      {phaseLabel(analog.max_phase, analog.first_approval)
                        ? ` · ${phaseLabel(analog.max_phase, analog.first_approval)}`
                        : ""}
                    </span>
                  </span>
                  <span className="tabular font-mono text-foreground">
                    {analog.similarity.toFixed(1)} %
                  </span>
                </Link>
              ))}
            </Plate>
          )}
        </PageFold>

        <PageFold
          title={OPTIONS_WORDS.otherDatabases}
          count={xrefs.length}
        >
          <div className="mb-2 flex justify-end">
            <ShowAll
              total={xrefs.length}
              initial={16}
              expanded={allXrefs}
              onToggle={() => setAllXrefs((value) => !value)}
            />
          </div>
          {xrefs.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {shownXrefs.map((xref) => (
                <SourceChip
                  key={`${xref.database}:${xref.id}`}
                  source={xref.database_name ?? xref.database}
                  id={xref.id}
                  href={xref.url}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              size="inline"
              title="No cross-reference"
              searched={["UniChem"]}
            />
          )}
        </PageFold>

        <PageFold title="Sources" count={compound.data.sources.length}>
          <SourceStatusList sources={compound.data.sources} />
        </PageFold>
          </>
        )}
      </PageBody>
    </Page>
  );
}
