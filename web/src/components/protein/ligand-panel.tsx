"use client";

import { ExternalLink } from "@/components/data/external-link";
import { SectionHeader } from "@/components/data/section-header";
import { TextLink } from "@/components/data/text-link";
import { EvidencePopover } from "@/components/evidence/evidence-popover";
import { LearnTerm } from "@/components/science/learn-term";
import { EmptyState } from "@/components/states/empty-state";
import { QueryErrorState, RowsSkeleton } from "@/components/states/query-state";
import { Button } from "@/components/ui/button";
import type { ViewportLigand } from "@/components/viewer";
import type { EvidenceItem } from "@/lib/evidence";
import { routes } from "@/lib/ids";
import { setWorkspaceHover } from "@/lib/state/hover";
import { useWorkspaceSelection } from "@/lib/state/selection";
import {
  useStructureLigands,
  type ApiStructureDescriptor,
  type StructureLedger,
} from "@/lib/workspace-data";

const shortId = (id: string) => id.slice(id.indexOf(":") + 1);

export interface LigandPanelProps {
  accession: string;
  active: ApiStructureDescriptor | null;
  ledger: StructureLedger | null;
  ligand: ViewportLigand | null;
  onLigand: (ligand: ViewportLigand | null) => void;
  onStructure: (structureId: string) => void;
}

/** Bound components of an experimental entry; one at a time is drawn with its binding site. */
export function LigandPanel({
  accession,
  active,
  ledger,
  ligand,
  onLigand,
  onStructure,
}: LigandPanelProps) {
  const experimental = active?.origin === "experimental";
  const query = useStructureLigands(active?.id, accession, {
    enabled: experimental,
  });
  const selectResidue = useWorkspaceSelection((state) => state.selectResidue);

  if (!active) return <EmptyState size="inline" title="No structure loaded" />;

  if (!experimental) {
    const withLigand = (ledger?.experimental ?? []).filter((entry) =>
      entry.ligands.some((bound) => !bound.common_additive),
    );
    const first = withLigand[0]?.structure;
    return (
      <EmptyState
        title="No bound component in a predicted model"
        description={
          withLigand.length > 0
            ? `${withLigand.length} experimental ${withLigand.length === 1 ? "entry" : "entries"} of this protein ${withLigand.length === 1 ? "has" : "have"} a bound component other than a common additive.`
            : "No experimental entry of this protein has a bound component."
        }
        searched={withLigand.length > 0 ? undefined : ["RCSB PDB"]}
        actions={
          first ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onStructure(first.id)}
            >
              Load {shortId(first.id)}
            </Button>
          ) : undefined
        }
      />
    );
  }

  if (query.isPending) return <RowsSkeleton rows={5} />;
  if (query.isError || !query.data)
    return (
      <QueryErrorState
        error={query.error}
        subject={`bound components of ${active.id}`}
        onRetry={() => void query.refetch()}
      />
    );

  const { ligands, neighbour_definition: definition } = query.data.data;
  if (ligands.length === 0)
    return (
      <EmptyState
        title={`No bound component in ${shortId(active.id)}`}
        description={query.data.data.message ?? undefined}
        searched={["RCSB PDB"]}
      />
    );

  return (
    <div>
      <SectionHeader
        title={<LearnTerm term="ligand">Bound components</LearnTerm>}
        count={ligands.length}
        description={`In ${shortId(active.id)}, as deposited.`}
      />
      <ul>
        {ligands.map((bound) => {
          const instance = bound.instances[0];
          const shown =
            ligand?.structureId === active.id &&
            ligand.compId === bound.comp_id;
          const evidence: EvidenceItem = {
            evidenceClass: "experimental",
            statement: `${bound.comp_id} is bound in ${active.id}`,
            source: {
              database: "RCSB PDB",
              recordId: `${shortId(active.id)} / ${bound.comp_id}`,
              url: bound.url ?? active.source_url,
              retrievedAt: active.retrieved_at,
              license: active.license,
            },
            method: active.method,
          };
          return (
            <li
              key={bound.comp_id}
              className="border-b border-border-subtle px-3 py-2 text-xs data-[shown=true]:bg-active"
              data-shown={shown}
            >
              <div className="flex items-center gap-2">
                <EvidencePopover
                  evidence={evidence}
                  size="compact"
                  detail={null}
                  className="shrink-0"
                />
                {bound.url ? (
                  <ExternalLink href={bound.url} className="font-mono">
                    {bound.comp_id}
                  </ExternalLink>
                ) : (
                  <span className="font-mono">{bound.comp_id}</span>
                )}
                <span className="tabular font-mono text-2xs text-muted-foreground">
                  {bound.formula_weight
                    ? `${bound.formula_weight.toFixed(1)} Da`
                    : null}
                </span>
                {bound.common_additive ? (
                  <span className="text-2xs text-subtle-foreground">
                    common additive
                  </span>
                ) : null}
                <Button
                  size="xs"
                  variant={shown ? "outline" : "ghost"}
                  aria-pressed={shown}
                  className="ml-auto"
                  disabled={!instance}
                  onClick={() =>
                    onLigand(
                      shown || !instance
                        ? null
                        : {
                            structureId: active.id,
                            compId: bound.comp_id,
                            authAsymId: instance.chain_id ?? undefined,
                            authSeqId: instance.author_seq_id
                              ? Number(instance.author_seq_id)
                              : undefined,
                          },
                    )
                  }
                >
                  {shown ? "Site shown" : "Show site"}
                </Button>
              </div>
              <p
                className="mt-1 truncate text-2xs text-muted-foreground"
                title={bound.name ?? undefined}
              >
                {bound.name ?? "Name not given by the source"}
              </p>
              {bound.inchikey ? (
                <p className="mt-0.5 text-2xs">
                  <TextLink
                    href={routes.compound(bound.inchikey)}
                    className="font-mono"
                  >
                    {bound.inchikey}
                  </TextLink>
                </p>
              ) : null}
              {bound.binding_site_positions.length > 0 ? (
                <div className="mt-2">
                  <p className="text-2xs text-subtle-foreground">
                    <LearnTerm term="binding-site">Binding site</LearnTerm>,{" "}
                    {bound.binding_site_positions.length} residues of{" "}
                    {accession}
                  </p>
                  <ul className="mt-1 flex flex-wrap gap-1">
                    {bound.binding_site_positions.map((position) => {
                      const residue = instance?.residues.find(
                        (entry) => entry.uniprot_position === position,
                      );
                      const name = residue?.residue_name
                        ? residue.residue_name[0] +
                          residue.residue_name.slice(1).toLowerCase()
                        : "";
                      return (
                        <li key={position}>
                          <button
                            type="button"
                            className="tabular cursor-pointer rounded-xs border border-border px-1 font-mono text-2xs text-foreground hover:bg-accent"
                            title={
                              residue?.distance
                                ? `${residue.distance.toFixed(2)} Å from the component`
                                : undefined
                            }
                            onMouseEnter={() =>
                              setWorkspaceHover({
                                accession,
                                position,
                                origin: "ledger",
                              })
                            }
                            onMouseLeave={() => setWorkspaceHover(null)}
                            onClick={() => selectResidue(position)}
                          >
                            {name}
                            {position}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : (
                <p className="mt-2 text-2xs text-subtle-foreground">
                  No residue of {accession} is listed as a neighbour.
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {definition ? (
        <p className="px-3 py-2 text-2xs leading-relaxed text-subtle-foreground">
          {definition}
        </p>
      ) : null}
    </div>
  );
}
