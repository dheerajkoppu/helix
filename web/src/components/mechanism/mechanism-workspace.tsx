"use client";

import { ChevronDownIcon, ListTreeIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { KeyHint } from "@/components/data/key-hint";
import { CandidatesLink } from "@/components/discovery/candidates-link";
import { AddToProjectButton } from "@/components/project/add-to-project";
import { StructureOriginTag } from "@/components/evidence/structure-origin-tag";
import { ModelResultStrip } from "@/components/science/model-result-strip";
import { EmptyState } from "@/components/states/empty-state";
import { QueryErrorState, RowsSkeleton } from "@/components/states/query-state";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  StructureViewport,
  type ViewportLigand,
  type ViewportResidueSet,
} from "@/components/viewer";
import {
  SubjectBarActions,
  WorkspaceZones,
  Zone,
  useWorkspaceSubject,
} from "@/components/workspace";
import { routes, toThreeLetter } from "@/lib/ids";
import { CAUSE_WORDS, plainCause } from "@/lib/plain-language";
import { useAdvancedMode } from "@/lib/state/preferences";
import { useWorkspaceSelection } from "@/lib/state/selection";
import { useReportSources } from "@/lib/state/shell";
import { variantSubjectsFromUrl } from "@/lib/subject-refs";
import {
  canonicalModel,
  mergeSources,
  structureSubject,
  subjectChain,
  useProteinAxis,
  useProteinColorings,
  useResidueEffects,
  useVariant,
  useViewportStructure,
  type StructureLedger,
} from "@/lib/workspace-data";

import { CandidateInspector } from "./candidate-inspector";
import { CandidateLedger } from "./candidate-ledger";
import {
  plural,
  raises,
  useVariantMechanisms,
  type MechanismCandidate,
  type MechanismsResponse,
} from "./data";

const MAX_SET_POSITIONS = 80;
const CANDIDATE_PARAM = "m";

type Experimental = StructureLedger["experimental"][number];

const structureName = (id: string): string =>
  id.startsWith("afdb:") ? "AlphaFold model" : id.slice(id.indexOf(":") + 1);

const covers = (entry: Experimental, position: number): boolean =>
  entry.chains.some((chain) =>
    chain.observed_regions.length
      ? chain.observed_regions.some(
          (region) => region.start <= position && position <= region.end,
        )
      : chain.unp_start <= position && position <= chain.unp_end,
  );

/** Structures offered for one candidate: those its records name, then one that shows the residue. */
function structureChoices(
  candidate: MechanismCandidate | null,
  ledger: StructureLedger | null,
  position: number | null,
): string[] {
  const named = (candidate?.observations ?? [])
    .filter(raises)
    .map((observation) => observation.structure_id)
    .filter((id): id is string => Boolean(id));
  const experimental =
    ledger && position
      ? ledger.experimental.find((entry) => covers(entry, position))
      : undefined;
  const model = canonicalModel(ledger);
  return [
    ...new Set([
      ...named,
      ...(experimental ? [experimental.structure.id] : []),
      ...(model ? [model.id] : []),
    ]),
  ].slice(0, 6);
}

function RuleSet({ data }: { data: MechanismsResponse }) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Show the rule set">
            <ListTreeIcon />
          </Button>
        }
      />
      <PopoverContent align="start" className="w-96 gap-0 p-0 text-xs">
        <p className="border-b border-border-subtle px-3 py-2 text-muted-foreground">
          {data.method} A sequence neighbour is within {data.neighbour_window}{" "}
          residues; a domain boundary within {data.domain_boundary_window}.
        </p>
        <ul className="scroll-thin max-h-80 overflow-y-auto">
          {data.rules.map((rule) => (
            <li
              key={`${rule.id}-${rule.category}`}
              className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-2 border-b border-border-subtle px-3 py-1.5 last:border-b-0"
            >
              <span className="font-mono text-subtle-foreground">
                {rule.id}
              </span>
              <span>
                <span className="text-foreground">{rule.description}</span>
                <span className="block text-2xs text-subtle-foreground">
                  {rule.data}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export function MechanismWorkspace({ variantId }: { variantId: string }) {
  const mechanisms = useVariantMechanisms(variantId);
  const data = mechanisms.data?.data ?? null;
  const accession = data?.protein?.id ?? null;
  const position = data?.position ?? null;

  const variant = useVariant(variantId);
  const axis = useProteinAxis(accession, { gene: data?.gene.id });
  const effects = useResidueEffects(accession, position, {
    alt: data?.alternate ?? undefined,
    ref: data?.reference ?? undefined,
  });
  const { colorings, domains } = useProteinColorings(accession);

  const [selectedId, setSelectedId] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get(CANDIDATE_PARAM),
  );
  const [structureChoice, setStructureChoice] = useState<string | null>(null);
  const advanced = useAdvancedMode();
  // Simple view: the evidence opens when a candidate is picked, not before
  const [inspectorOpen, setInspectorOpen] = useState(() => selectedId !== null);

  const activeId =
    selectedId &&
    (data?.candidates.some((candidate) => candidate.id === selectedId) ||
      data?.unsupported.some((entry) => entry.category === selectedId))
      ? selectedId
      : (data?.candidates[0]?.id ?? data?.unsupported[0]?.category ?? null);
  const candidate =
    data?.candidates.find((entry) => entry.id === activeId) ?? null;
  const unsupported =
    data?.unsupported.find((entry) => entry.category === activeId) ?? null;

  const select = useCallback((id: string) => {
    setSelectedId(id);
    setStructureChoice(null);
    setInspectorOpen(true);
    const url = new URL(window.location.href);
    url.searchParams.set(CANDIDATE_PARAM, id);
    window.history.replaceState(null, "", url);
  }, []);

  const choices = useMemo(
    () => structureChoices(candidate, axis.ledger, position),
    [candidate, axis.ledger, position],
  );
  const shownId =
    structureChoice && choices.includes(structureChoice)
      ? structureChoice
      : (choices[0] ?? axis.ledger?.recommended?.structure_id ?? null);
  const shown = useViewportStructure(shownId, accession);

  const selectVariant = useWorkspaceSelection((state) => state.selectVariant);
  const reference = data?.reference ?? null;
  const alternate = data?.alternate ?? null;
  useEffect(() => {
    if (!accession || !position || !reference || !alternate) return;
    const current = useWorkspaceSelection.getState();
    if (current.accession !== accession) return;
    if (current.variant?.position === position) return;
    selectVariant({ reference, position, alternate, sourceId: null });
  }, [
    accession,
    position,
    reference,
    alternate,
    selectVariant,
    shown.structure,
  ]);

  const variantRecord = variant.data?.data;
  const chain = useMemo(
    () => ({
      ...(variantRecord
        ? subjectChain({ variant: variantRecord })
        : variantSubjectsFromUrl(variantId)),
      ...(accession ? subjectChain({ protein: accession }) : {}),
      ...(shown.descriptor
        ? { structure: structureSubject(shown.descriptor) }
        : {}),
    }),
    [variantRecord, variantId, accession, shown.descriptor],
  );
  useWorkspaceSubject(chain);

  const sources = useMemo(
    () =>
      mergeSources(
        mechanisms.data?.sources,
        axis.sources,
        variant.data?.sources,
        shown.sources,
      ),
    [
      mechanisms.data?.sources,
      axis.sources,
      variant.data?.sources,
      shown.sources,
    ],
  );
  useReportSources("mechanism-page", sources);

  const residueLabel =
    reference && position
      ? `${toThreeLetter(reference) ?? reference}${position}`
      : "";
  const changeLabel = data?.protein_change ?? variantId;

  const ligand = useMemo<ViewportLigand | null>(() => {
    const bound = candidate?.highlight.ligands.find(
      (entry) => entry.structure_id === shownId,
    );
    return bound && shownId
      ? {
          structureId: shownId,
          compId: bound.comp_id,
          authAsymId: bound.chain_id ?? undefined,
          authSeqId: bound.author_seq_id ?? undefined,
        }
      : null;
  }, [candidate, shownId]);

  const residueSets = useMemo<ViewportResidueSet[]>(() => {
    if (!candidate || ligand) return [];
    const positions = candidate.highlight.positions.filter(
      (entry) => entry !== position,
    );
    return positions.length && positions.length <= MAX_SET_POSITIONS
      ? [{ id: candidate.id, label: candidate.label, positions }]
      : [];
  }, [candidate, ligand, position]);

  const marked = ligand
    ? `${ligand.compId} and the residues within 5 Å`
    : residueSets.length
      ? `${plural(residueSets[0].positions.length, "residue")} named by the records`
      : null;

  const model = canonicalModel(axis.ledger);
  const plddt = effects.data?.data.residue.plddt;
  const showInspector = advanced || (inspectorOpen && data?.applicable);

  const projectItem = useMemo(
    () => ({
      kind: "variant" as const,
      ref: data?.variant_id ?? variantId,
      label: data ? `${data.gene.id} ${changeLabel}` : variantId,
      origin: {
        route: routes.mechanism(variantId),
        note: "Mechanism workspace",
      },
      evidence: (candidate?.observations ?? [])
        .filter(raises)
        .map((observation) => observation.evidence),
      data: candidate ? { mechanism_candidate: candidate.category } : {},
    }),
    [data, variantId, changeLabel, candidate],
  );

  return (
    <>
      <SubjectBarActions>
        {data?.gene.id ? (
          <CandidatesLink
            gene={data.gene.id}
            variantId={data.variant_id ?? variantId}
          />
        ) : null}
        <AddToProjectButton item={projectItem} size="sm" variant="ghost" />
      </SubjectBarActions>
      <WorkspaceZones
        layoutId="mechanism"
        ledgerLabel="Candidates"
        ledger={
          <Zone
            zone="ledger"
            title={advanced ? "Candidate mechanisms" : CAUSE_WORDS.heading}
            count={advanced && data?.applicable ? data.candidates.length : null}
            actions={data && advanced ? <RuleSet data={data} /> : null}
            footer={
              advanced ? (
                <span>
                  Ranked by record kind, then proximity. No combined score.
                </span>
              ) : undefined
            }
          >
            {advanced ? null : (
              <p className="border-b border-border-subtle px-3 py-3 text-sm font-medium text-foreground">
                {CAUSE_WORDS.title}
              </p>
            )}
            {mechanisms.isPending ? (
              <RowsSkeleton rows={8} />
            ) : mechanisms.isError ? (
              <QueryErrorState
                error={mechanisms.error}
                subject={`mechanisms for ${variantId}`}
                onRetry={() => void mechanisms.refetch()}
              />
            ) : !data?.applicable ? (
              <EmptyState
                title={
                  advanced
                    ? "No candidate mechanisms derived"
                    : CAUSE_WORDS.noCause
                }
                description={advanced ? data?.message : undefined}
                actions={
                  <Button
                    size="sm"
                    variant="outline"
                    render={<Link href={routes.variant(variantId)} />}
                  >
                    {advanced
                      ? "Open the variant record"
                      : CAUSE_WORDS.openMutation}
                  </Button>
                }
              />
            ) : (
              <>
                {data.candidates.length === 0 ? (
                  <EmptyState
                    size="inline"
                    title={
                      advanced ? "No supported candidate" : CAUSE_WORDS.none
                    }
                    description={
                      advanced
                        ? "Every category below was checked. An absence here does not rule a mechanism out."
                        : undefined
                    }
                  />
                ) : null}
                <CandidateLedger
                  data={data}
                  selectedId={activeId}
                  onSelect={select}
                />
                {advanced && data.warnings.length ? (
                  <ul className="flex flex-col gap-1 px-3 py-2 text-2xs text-subtle-foreground">
                    {data.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </Zone>
        }
        instrument={
          <Zone
            zone="instrument"
            title={
              advanced
                ? "What might this mutation disrupt?"
                : candidate
                  ? plainCause(candidate.category)
                  : unsupported
                    ? plainCause(unsupported.category)
                    : CAUSE_WORDS.structure
            }
            scroll={false}
            actions={
              !advanced && choices.length > 1 && shownId ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={`Structure shown: ${structureName(shownId)}`}
                    className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground aria-expanded:bg-active aria-expanded:text-foreground"
                  >
                    {CAUSE_WORDS.structure}
                    <ChevronDownIcon className="size-3" aria-hidden />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuRadioGroup
                      value={shownId}
                      onValueChange={(value) =>
                        setStructureChoice(String(value))
                      }
                    >
                      {choices.map((id) => (
                        <DropdownMenuRadioItem key={id} value={id} closeOnClick>
                          {id.startsWith("afdb:")
                            ? structureName(id)
                            : `${CAUSE_WORDS.labStructure} ${structureName(id)}`}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : undefined
            }
            detail={
              shown.structure ? (
                <StructureOriginTag
                  origin={shown.structure.origin}
                  detail={advanced ? shown.structure.id : undefined}
                  size="compact"
                  caption={advanced}
                />
              ) : null
            }
            toolbar={
              advanced && choices.length > 1 ? (
                <>
                  <span className="text-2xs text-muted-foreground">
                    Structure
                  </span>
                  <ToggleGroup
                    size="sm"
                    variant="outline"
                    spacing={0}
                    value={shownId ? [shownId] : []}
                    onValueChange={(value) =>
                      value.length ? setStructureChoice(value[0]) : null
                    }
                  >
                    {choices.map((id) => (
                      <ToggleGroupItem
                        key={id}
                        value={id}
                        className="font-mono"
                      >
                        {id.startsWith("afdb:") ? "AFDB model" : id.slice(4)}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </>
              ) : undefined
            }
            footer={
              !advanced ? (
                residueLabel ? (
                  <span>
                    {candidate && marked
                      ? CAUSE_WORDS.shown
                      : CAUSE_WORDS.spotShown}
                  </span>
                ) : undefined
              ) : candidate && marked ? (
                <span>
                  {`${candidate.label}: `}
                  {residueLabel} with {marked}.
                </span>
              ) : residueLabel ? (
                <span>{residueLabel} is drawn as sticks.</span>
              ) : advanced ? (
                <KeyHint keys="esc" label="Clear the selection" />
              ) : undefined
            }
          >
            {shown.structure ? (
              <div className="flex size-full min-h-0 flex-col">
                <div className="relative min-h-0 flex-1">
                  <StructureViewport
                    ariaLabel={`${data?.gene.id ?? ""} ${changeLabel} on ${shown.structure.id}`}
                    accession={accession}
                    structures={[shown.structure]}
                    colorings={colorings}
                    domains={domains}
                    variant={
                      position ? { position, label: changeLabel } : undefined
                    }
                    residueSets={residueSets}
                    ligand={ligand}
                  />
                </div>
                {!advanced && model && residueLabel ? (
                  <ModelResultStrip
                    className="shrink-0"
                    model={
                      model.provider_name ?? model.model_name ?? "AlphaFold DB"
                    }
                    version={model.model_version}
                    origin={model.origin}
                    metrics={[
                      {
                        label: `pLDDT at ${residueLabel}`,
                        value: plddt,
                        explainer: "plddt",
                        missingReason: effects.isPending
                          ? "Loading"
                          : "No value",
                      },
                    ]}
                  />
                ) : null}
              </div>
            ) : shown.error ? (
              <QueryErrorState
                error={shown.error}
                subject={`structure ${shownId ?? ""}`}
              />
            ) : mechanisms.isPending || axis.isPending || shown.isPending ? (
              <RowsSkeleton rows={6} />
            ) : (
              <EmptyState
                title="No structure to show"
                description={
                  !advanced
                    ? CAUSE_WORDS.noStructure
                    : data?.applicable === false
                      ? data.message
                      : "No experimental entry or AlphaFold DB model found."
                }
                searched={["RCSB PDB", "AlphaFold DB"]}
              />
            )}
          </Zone>
        }
        inspectorLabel="Evidence"
        inspector={
          !showInspector ? undefined : (
            <Zone
              zone="inspector"
              title={
                advanced
                  ? (candidate?.label ?? unsupported?.label ?? "Evidence")
                  : candidate
                    ? plainCause(candidate.category)
                    : unsupported
                      ? plainCause(unsupported.category)
                      : CAUSE_WORDS.evidence
              }
              detail={
                candidate && advanced ? (
                  <span className="text-2xs text-muted-foreground">
                    rank {candidate.rank} of {data?.candidates.length}
                  </span>
                ) : null
              }
              actions={
                advanced ? undefined : (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Close"
                    onClick={() => setInspectorOpen(false)}
                  >
                    <XIcon aria-hidden />
                  </Button>
                )
              }
            >
              {mechanisms.isPending ? (
                <RowsSkeleton rows={6} />
              ) : data?.applicable ? (
                <CandidateInspector
                  data={data}
                  candidate={candidate}
                  unsupported={unsupported}
                  shownStructureId={shownId}
                  onShowStructure={setStructureChoice}
                  plddt={plddt}
                />
              ) : (
                <EmptyState
                  title="No claim selected"
                  description="The evidence behind a candidate appears here."
                />
              )}
            </Zone>
          )
        }
      />
    </>
  );
}
