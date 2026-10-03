"use client";

import { useMemo, useState } from "react";

import { ExternalLink } from "@/components/data/external-link";
import { TextLink } from "@/components/data/text-link";
import { EvidencePopover } from "@/components/evidence/evidence-popover";
import { StructureOriginTag } from "@/components/evidence/structure-origin-tag";
import { QueryErrorState, RowsSkeleton } from "@/components/states/query-state";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { routes } from "@/lib/ids";
import { setWorkspaceHover } from "@/lib/state/hover";
import { useWorkspaceSelection } from "@/lib/state/selection";
import {
  structureDetail,
  type ApiStructureDescriptor,
  type ProteinResponse,
  type StructureLedger,
} from "@/lib/workspace-data";

import { provenanceEvidence, toEvidenceItem } from "./evidence";
import { StructureTable, featureRows } from "./structure-ledger";

const shortId = (id: string) => id.slice(id.indexOf(":") + 1);

const LABEL = "text-2xs text-subtle-foreground";

function coverage(descriptor: ApiStructureDescriptor): string | null {
  const ranges = descriptor.coverage?.ranges ?? [];
  if (ranges.length === 0) return null;
  const start = Math.min(...ranges.map((range) => range.start));
  const end = Math.max(...ranges.map((range) => range.end));
  return `${start}-${end}`;
}

export interface ProteinSummaryProps {
  accession: string;
  gene: string | null;
  protein: ProteinResponse | null;
  ledger: StructureLedger | null;
  /** the structure in the 3D view */
  active: ApiStructureDescriptor | null;
  activeId: string | null;
  loadError?: Error | null;
  onStructure: (structureId: string) => void;
}

/** Simple mode: the protein in a few facts, the structure shown with one Change control, and its domains. */
export function ProteinSummary({
  accession,
  gene,
  protein,
  ledger,
  active,
  activeId,
  loadError,
  onStructure,
}: ProteinSummaryProps) {
  const [choosing, setChoosing] = useState(false);
  const ranges = useWorkspaceSelection((state) => state.ranges);
  const selectRange = useWorkspaceSelection((state) => state.selectRange);
  const domains = useMemo(
    () =>
      protein
        ? featureRows(protein).filter((row) => row.id.includes("domains:"))
        : [],
    [protein],
  );
  const total = ledger
    ? ledger.experimental.length +
      ledger.predicted_external.length +
      ledger.predicted_orphafold.length
    : 0;
  const span = active ? coverage(active) : null;

  if (!protein && loadError)
    return (
      <QueryErrorState
        error={loadError}
        subject={`${accession} from UniProt`}
      />
    );
  if (!protein) return <RowsSkeleton rows={8} />;

  const length = protein.sequence.value.length;

  return (
    <div data-slot="protein-summary" className="flex flex-col">
      <div className="flex flex-col gap-3 px-4 py-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm leading-5 font-medium text-foreground">
            {protein.names.recommended}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {protein.gene ? (
              <TextLink
                href={routes.gene(protein.gene.id)}
                className="font-mono"
              >
                {protein.gene.id}
              </TextLink>
            ) : null}
            <ExternalLink
              href={`https://www.uniprot.org/uniprotkb/${accession}`}
              className="font-mono"
            >
              {accession}
            </ExternalLink>
            <EvidencePopover
              evidence={provenanceEvidence(
                protein.provenance,
                "curated_database",
                `UniProtKB entry ${accession}`,
              )}
              size="compact"
            />
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <span className={LABEL}>Length</span>
          <span className="tabular font-mono text-2xl leading-6 font-medium text-foreground">
            {length.toLocaleString("en-US")}
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              aa
            </span>
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-border-subtle px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <span className={LABEL}>Structure</span>
          {ledger && total > 1 ? (
            <Popover open={choosing} onOpenChange={setChoosing}>
              <PopoverTrigger
                render={
                  <Button
                    size="sm"
                    variant="outline"
                    data-action="change-structure"
                  />
                }
              >
                Change
              </PopoverTrigger>
              <PopoverContent
                side="right"
                align="start"
                className="flex h-[min(32rem,70dvh)] w-[26rem] max-w-[calc(100vw-1.5rem)] flex-col gap-0 p-0"
              >
                <p className="flex shrink-0 items-baseline gap-2 border-b border-border-subtle px-3 py-2 text-xs font-medium text-foreground">
                  Structures
                  <span className="tabular font-mono text-2xs font-normal text-subtle-foreground">
                    {total}
                  </span>
                </p>
                <div className="min-h-0 flex-1">
                  <StructureTable
                    accession={accession}
                    gene={gene}
                    ledger={ledger}
                    sequenceLength={length}
                    activeId={activeId}
                    onSelect={(id) => {
                      onStructure(id);
                      setChoosing(false);
                    }}
                  />
                </div>
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
        {active ? (
          <div className="flex flex-col gap-1">
            <StructureOriginTag
              origin={active.origin}
              detail={shortId(active.id)}
              className="text-xs"
            />
            <p className="text-xs text-muted-foreground">
              {[structureDetail(active), span ? `residues ${span}` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        ) : ledger && total === 0 ? (
          <p className="text-xs text-muted-foreground">No structure found.</p>
        ) : (
          <p className="text-xs text-muted-foreground">Resolving structure</p>
        )}
      </div>

      {domains.length > 0 ? (
        <div className="flex flex-col border-t border-border-subtle py-3">
          <span className={`${LABEL} px-4 pb-1`}>Domains</span>
          <ul>
            {domains.map((row) => {
              const selected =
                ranges.length === 1 &&
                ranges[0].start === row.start &&
                ranges[0].end === row.end;
              return (
                <li key={row.id} className="flex items-center">
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      selectRange({ start: row.start, end: row.end })
                    }
                    onMouseEnter={() =>
                      setWorkspaceHover({
                        accession,
                        position: row.start,
                        origin: "ledger",
                      })
                    }
                    onMouseLeave={() => setWorkspaceHover(null)}
                    className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 pr-2 pl-4 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset aria-pressed:bg-active"
                  >
                    <span className="min-w-0 flex-1 truncate text-foreground">
                      {row.label}
                    </span>
                    <span className="tabular shrink-0 font-mono text-xs text-muted-foreground">
                      {row.start}-{row.end}
                    </span>
                  </button>
                  <span className="flex shrink-0 justify-end pr-4 pl-1">
                    {row.feature.evidence[0] ? (
                      <EvidencePopover
                        evidence={toEvidenceItem(
                          row.feature.evidence[0],
                          `${row.feature.type}: ${row.label}`,
                        )}
                        size="compact"
                        detail={null}
                      />
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
