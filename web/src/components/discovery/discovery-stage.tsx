"use client";

import { XIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { ButtonLink } from "@/components/data/button-link";
import { TextLink } from "@/components/data/text-link";
import { AddToProjectButton } from "@/components/project/add-to-project";
import { EmptyState } from "@/components/states/empty-state";
import { QueryErrorState, RowsSkeleton } from "@/components/states/query-state";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  SubjectBarActions,
  WorkspaceZones,
  Zone,
  useWorkspaceSubject,
} from "@/components/workspace";
import { isApiError } from "@/lib/api/client";
import { routes } from "@/lib/ids";
import {
  DISCOVERY_WORDS,
  GROUP_LINKS,
  plainCandidateCount,
  plainDiseaseName,
  plainRuledOutCount,
} from "@/lib/plain-language";
import { useAdvancedMode } from "@/lib/state/preferences";
import { useReportSources } from "@/lib/state/shell";
import {
  geneSubject,
  mergeSources,
  proteinSubject,
  useDiscoveryCandidates,
  useGene,
  useProteinAxis,
} from "@/lib/workspace-data";

import { CandidateChain } from "./candidate-chain";
import { CandidateList } from "./candidate-list";
import { DirectionLine } from "./direction-line";
import { candidateRows, refName, ruledOutRows, subjectFault } from "./model";
import { PocketPair } from "./pocket-pair";
import { RuledOutSection } from "./ruled-out";
import { RunDetail } from "./run-detail";

export interface DiscoveryStageProps {
  gene: string;
  disease: string | null;
  variant: string | null;
  /** the held-out mode: the disease's own drug links are withheld */
  heldOut: boolean;
}

type View = "list" | "pockets";

/**
 * The Candidates stage: what a drug could aim at for this gene, and whether a molecule already does
 * it. Every row is a hypothesis Helix generated. The endpoint is built alongside this screen, so its
 * absence is a first-class state: a 404 or a 503 says "not available yet" and shows no candidate.
 */
export function DiscoveryStage({
  gene,
  disease,
  variant,
  heldOut,
}: DiscoveryStageProps) {
  const advanced = useAdvancedMode();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>("list");

  const geneQuery = useGene(gene);
  const candidates = useDiscoveryCandidates({
    gene,
    disease,
    variant,
    excludeDirect: heldOut,
  });
  const data = candidates.data?.data ?? null;

  const geneRecord = geneQuery.data?.data ?? null;
  const accession =
    data?.subject?.accession ?? geneRecord?.uniprot_accession ?? null;
  // the subject's disease arrives as a reference, which names itself with `label` rather than `name`
  const diseaseName = plainDiseaseName(refName(data?.subject?.disease));
  // The dock is persistent, so the stage feeds it the protein rather than leaving it empty.
  const axis = useProteinAxis(accession, { variants: false });

  // The rail needs the gene before its record lands, so the symbol stands in for it until then.
  useWorkspaceSubject({
    gene: geneRecord ? geneSubject(geneRecord) : { id: gene, label: gene },
    ...(accession ? { protein: proteinSubject(accession) } : {}),
    ...(disease
      ? { disease: { id: disease, label: diseaseName ?? disease } }
      : {}),
  });

  const sources = useMemo(
    () =>
      mergeSources(
        data?.sources,
        candidates.data?.sources,
        geneQuery.data?.sources,
        axis.sources,
      ),
    [
      data?.sources,
      candidates.data?.sources,
      geneQuery.data?.sources,
      axis.sources,
    ],
  );
  useReportSources("discovery", sources);

  const rows = useMemo(() => candidateRows(data?.candidates ?? []), [data]);
  const fault = useMemo(() => subjectFault(data), [data]);
  const ruledOut = useMemo(
    () => ruledOutRows(data?.ruled_out ?? [], { fault }),
    [data, fault],
  );
  const selected = rows.find((row) => row.id === selectedId) ?? null;

  const select = (id: string) => {
    setSelectedId(id === selectedId ? null : id);
    setView("list");
  };

  // The endpoint not being there yet is an answer, not a failure to retry around.
  /**
   * The endpoint not being there yet is its own state. A 404 that names what is missing
   * (`gene_not_in_catalog`) is a real answer about this subject and goes to the normal error
   * state; a bare 404 or a 503 means the route itself is not answering.
   */
  const notReady =
    candidates.isError &&
    isApiError(candidates.error) &&
    (candidates.error.isUnreachable ||
      candidates.error.status === 503 ||
      (candidates.error.isNotFound &&
        ["not_found", "http_404"].includes(candidates.error.code)));

  const body = candidates.isPending ? (
    <div>
      <p className="px-4 py-3 text-xs text-muted-foreground sm:px-6">
        {DISCOVERY_WORDS.loading}
      </p>
      <RowsSkeleton rows={8} />
    </div>
  ) : notReady ? (
    <EmptyState
      title={DISCOVERY_WORDS.notReady}
      description={DISCOVERY_WORDS.notReadyWhy}
      actions={
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void candidates.refetch()}
          >
            Try again
          </Button>
          <ButtonLink href={routes.gene(gene)} size="sm" variant="ghost">
            Back to {gene}
          </ButtonLink>
        </>
      }
    />
  ) : candidates.isError ? (
    <QueryErrorState
      error={candidates.error}
      subject={`candidates for ${gene}`}
      onRetry={() => void candidates.refetch()}
      retrying={candidates.isFetching}
    />
  ) : !data ? (
    <EmptyState
      title={DISCOVERY_WORDS.empty}
      description={DISCOVERY_WORDS.emptyWhy}
    />
  ) : view === "pockets" && selected && accession ? (
    <PocketPair
      accession={accession}
      structure={selected.candidate.structure}
      subjectLabel={data.subject?.gene_symbol ?? gene}
      analogueLabel={
        selected.candidate.structure?.similar_to?.gene_symbol ?? selected.target
      }
    />
  ) : (
    <div className="flex flex-col">
      <DirectionLine data={data} />
      {heldOut ? (
        <p className="border-b border-border-subtle bg-sunken px-4 py-2 text-xs text-muted-foreground sm:px-6">
          <span className="font-medium text-foreground">
            {DISCOVERY_WORDS.heldOut}
          </span>{" "}
          {DISCOVERY_WORDS.heldOutLine}
        </p>
      ) : null}
      {rows.length > 0 ? (
        <CandidateList rows={rows} selectedId={selectedId} onSelect={select} />
      ) : (
        <EmptyState
          size="inline"
          title={DISCOVERY_WORDS.empty}
          description={DISCOVERY_WORDS.emptyWhy}
          className="border-b border-border-subtle"
        />
      )}
      <RuledOutSection rows={ruledOut} />
      <div className="flex flex-col gap-1 px-4 py-4 text-xs text-muted-foreground sm:px-6">
        <p>{DISCOVERY_WORDS.hypothesisLine}</p>
        <p>{DISCOVERY_WORDS.testLine}</p>
      </div>
    </div>
  );

  const inspector =
    !data || notReady
      ? undefined
      : selected
        ? {
            title: selected.title,
            node: (
              <CandidateChain
                row={selected}
                requiredActions={data.required_action?.actions}
                onShowPockets={
                  selected.structural && accession
                    ? () => setView(view === "pockets" ? "list" : "pockets")
                    : undefined
                }
                pocketsShown={view === "pockets"}
              />
            ),
          }
        : advanced
          ? {
              title: "Run",
              node: <RunDetail data={data} sources={sources} />,
            }
          : undefined;

  return (
    <>
      <SubjectBarActions>
        {data ? (
          <AddToProjectButton
            size="sm"
            variant="ghost"
            item={{
              kind: "hypothesis",
              ref: `${gene}-candidates`,
              label: `${gene} candidate targets`,
              origin: {
                route: routes.discover(gene, { disease, variant, heldOut }),
                note: DISCOVERY_WORDS.title,
              },
              data: {
                candidates: rows.length,
                ruled_out: ruledOut.length,
                held_out: heldOut,
                disease: diseaseName,
              },
            }}
          />
        ) : null}
      </SubjectBarActions>
      <WorkspaceZones
        layoutId="discovery"
        inspectorLabel={DISCOVERY_WORDS.chain}
        instrument={
          <Zone
            zone="instrument"
            title={DISCOVERY_WORDS.title}
            count={data ? rows.length : null}
            scroll={view !== "pockets"}
            detail={
              diseaseName ? (
                <span className="truncate text-2xs text-muted-foreground">
                  {diseaseName}
                </span>
              ) : null
            }
            actions={
              <span className="flex items-center gap-3">
                {selected?.structural && accession ? (
                  <ToggleGroup
                    size="sm"
                    variant="outline"
                    spacing={0}
                    value={[view]}
                    onValueChange={(value) =>
                      value.length ? setView(value[0] as View) : null
                    }
                  >
                    <ToggleGroupItem value="list">List</ToggleGroupItem>
                    <ToggleGroupItem value="pockets">3D</ToggleGroupItem>
                  </ToggleGroup>
                ) : null}
                {/* Options is not a step of its own in simple mode: it is reached from here. */}
                {!advanced && accession ? (
                  <TextLink
                    href={routes.interventions(accession)}
                    className="shrink-0 text-xs text-muted-foreground"
                    data-action="open-options"
                  >
                    {GROUP_LINKS.options}
                  </TextLink>
                ) : null}
              </span>
            }
            footer={
              data ? (
                <span>
                  {plainCandidateCount(rows.length)} ·{" "}
                  {plainRuledOutCount(ruledOut.length)}
                </span>
              ) : null
            }
          >
            {body}
          </Zone>
        }
        inspector={
          inspector ? (
            <Zone
              zone="inspector"
              title={<span className="truncate">{inspector.title}</span>}
              actions={
                selected ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={DISCOVERY_WORDS.close}
                    onClick={() => {
                      setSelectedId(null);
                      setView("list");
                    }}
                  >
                    <XIcon aria-hidden />
                  </Button>
                ) : null
              }
            >
              {inspector.node}
            </Zone>
          ) : undefined
        }
      />
    </>
  );
}
