"use client";

import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  DefinitionList,
  DefinitionRow,
} from "@/components/data/definition-list";
import { SectionHeader } from "@/components/data/section-header";
import { EvidencePopover } from "@/components/evidence/evidence-popover";
import { StructureOriginTag } from "@/components/evidence/structure-origin-tag";
import { LearnTerm } from "@/components/science/learn-term";
import { MetricReadout } from "@/components/science/metric-readout";
import { Swatch } from "@/components/science/swatch";
import { EmptyState } from "@/components/states/empty-state";
import { QueryErrorState, RowsSkeleton } from "@/components/states/query-state";
import type { Schema } from "@/lib/api/types";
import { toThreeLetter } from "@/lib/ids";
import { PLDDT_BANDS, type PlddtBand } from "@/lib/science/plddt";
import { setWorkspaceHover } from "@/lib/state/hover";
import { useWorkspaceSelection } from "@/lib/state/selection";
import {
  structureDetail,
  useStructureConfidence,
  type ApiStructureDescriptor,
  type StructureLedger,
} from "@/lib/workspace-data";

import { provenanceEvidence, toEvidenceItem } from "./evidence";

type PaeMatrix = Schema<"PaeMatrix">;

const FRACTION_KEY: Record<PlddtBand, string> = {
  very_high: "very_high",
  high: "confident",
  low: "low",
  very_low: "very_low",
};

const shortId = (id: string) => id.slice(id.indexOf(":") + 1);

function PlddtDistribution({
  fractions,
  total,
}: {
  fractions: Record<string, number>;
  total: number;
}) {
  return (
    <div className="px-3 pb-3">
      <div
        className="flex h-3 w-full overflow-hidden rounded-[1px] ring-1 ring-border-strong/60 ring-inset"
        role="img"
        aria-label={`Share of residues in each pLDDT band: ${PLDDT_BANDS.map(
          (band) =>
            `${band.label} ${Math.round((fractions[FRACTION_KEY[band.id]] ?? 0) * 100)}%`,
        ).join(", ")}`}
      >
        {PLDDT_BANDS.map((band) => (
          <span
            key={band.id}
            className={band.swatchClass}
            style={{
              width: `${(fractions[FRACTION_KEY[band.id]] ?? 0) * 100}%`,
            }}
          />
        ))}
      </div>
      <table className="mt-2 w-full text-2xs">
        <tbody>
          {PLDDT_BANDS.map((band) => {
            const fraction = fractions[FRACTION_KEY[band.id]] ?? 0;
            return (
              <tr key={band.id} title={band.meaning}>
                <td className="w-5 py-0.5">
                  <Swatch
                    swatchClass={band.swatchClass}
                    code={band.code}
                    onFill={band.onFill}
                  />
                </td>
                <td className="py-0.5 text-foreground">{band.label}</td>
                <td className="tabular py-0.5 font-mono text-subtle-foreground">
                  {band.range}
                </td>
                <td className="tabular py-0.5 text-right font-mono text-foreground">
                  {(fraction * 100).toFixed(1)}%
                </td>
                <td className="tabular w-14 py-0.5 text-right font-mono text-muted-foreground">
                  {Math.round(fraction * total)} aa
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const PAE_PIXELS = 280;

/** Ink depth encodes confidence: full ink is low expected error, the canvas ground is the cap. */
function PaeHeatmap({
  pae,
  accession,
  sequence,
  position,
  producedBy,
}: {
  pae: PaeMatrix;
  accession: string;
  sequence: string | null;
  position: number | null;
  producedBy: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inkRef = useRef<HTMLSpanElement>(null);
  const { resolvedTheme } = useTheme();
  const selectResidue = useWorkspaceSelection((state) => state.selectResidue);
  const [hover, setHover] = useState<{
    scored: number;
    aligned: number;
  } | null>(null);
  const size = pae.size;
  const cells = Math.min(size, PAE_PIXELS);
  const cap = pae.max ?? 31.75;

  const binned = useMemo(() => {
    const values = new Float32Array(cells * cells);
    const stride = size / cells;
    for (let row = 0; row < cells; row += 1) {
      const rowStart = Math.floor(row * stride);
      const rowEnd = Math.max(rowStart + 1, Math.floor((row + 1) * stride));
      for (let column = 0; column < cells; column += 1) {
        const columnStart = Math.floor(column * stride);
        const columnEnd = Math.max(
          columnStart + 1,
          Math.floor((column + 1) * stride),
        );
        let sum = 0;
        let count = 0;
        for (let i = rowStart; i < rowEnd; i += 1) {
          const line = pae.matrix[i];
          for (let j = columnStart; j < columnEnd; j += 1) {
            sum += line[j];
            count += 1;
          }
        }
        values[row * cells + column] = sum / count;
      }
    }
    return values;
  }, [pae.matrix, size, cells]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ink = inkRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !ink || !context) return;
    // resolves the ink token to RGB through a 1px probe, whatever colour space the token uses
    const probe = document.createElement("canvas");
    probe.width = probe.height = 1;
    const probeContext = probe.getContext("2d");
    if (!probeContext) return;
    probeContext.fillStyle = getComputedStyle(ink).color;
    probeContext.fillRect(0, 0, 1, 1);
    const [red, green, blue] = probeContext.getImageData(0, 0, 1, 1).data;

    const image = context.createImageData(cells, cells);
    for (let index = 0; index < binned.length; index += 1) {
      const confidence = 1 - Math.min(1, binned[index] / cap);
      image.data[index * 4] = red;
      image.data[index * 4 + 1] = green;
      image.data[index * 4 + 2] = blue;
      image.data[index * 4 + 3] = Math.round(confidence * 255);
    }
    context.clearRect(0, 0, cells, cells);
    context.putImageData(image, 0, 0);
  }, [binned, cells, cap, resolvedTheme]);

  const residueAt = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const clamp = (value: number) => Math.min(size - 1, Math.max(0, value));
    const column = clamp(
      Math.floor(((event.clientX - box.left) / box.width) * size),
    );
    const row = clamp(
      Math.floor(((event.clientY - box.top) / box.height) * size),
    );
    return {
      scored: row + pae.residue_start,
      aligned: column + pae.residue_start,
    };
  };

  const pair =
    hover ??
    (position !== null &&
    position >= pae.residue_start &&
    position < pae.residue_start + size
      ? { scored: position, aligned: position }
      : null);
  const value = hover
    ? pae.matrix[hover.scored - pae.residue_start]?.[
        hover.aligned - pae.residue_start
      ]
    : undefined;
  const name = (residue: number) =>
    `${sequence?.[residue - 1] ? (toThreeLetter(sequence[residue - 1]) ?? "") : ""}${residue}`;
  const marker =
    position !== null
      ? `${((position - pae.residue_start + 0.5) / size) * 100}%`
      : null;

  return (
    <div className="px-3 pb-3">
      <span ref={inkRef} className="hidden text-foreground" />
      <div className="flex items-start gap-2">
        <span
          className="mt-8 text-2xs text-subtle-foreground [writing-mode:vertical-rl] rotate-180"
          aria-hidden
        >
          Scored residue
        </span>
        <div className="min-w-0 flex-1">
          <div className="relative aspect-square w-full max-w-80 border border-border bg-canvas">
            <canvas
              ref={canvasRef}
              width={cells}
              height={cells}
              role="img"
              aria-label={`Predicted aligned error matrix, ${size} by ${size} residues. Filled cells are low expected error.`}
              className="absolute inset-0 size-full cursor-crosshair [image-rendering:pixelated]"
              onMouseMove={(event) => {
                const next = residueAt(event);
                setHover(next);
                setWorkspaceHover({
                  accession,
                  position: next.scored,
                  origin: "heatmap",
                });
              }}
              onMouseLeave={() => {
                setHover(null);
                setWorkspaceHover(null);
              }}
              onClick={(event) => selectResidue(residueAt(event).scored)}
            />
            {marker ? (
              <>
                <span
                  className="pointer-events-none absolute inset-x-0 h-px bg-ring"
                  style={{ top: marker }}
                />
                <span
                  className="pointer-events-none absolute inset-y-0 w-px bg-ring"
                  style={{ left: marker }}
                />
              </>
            ) : null}
          </div>
          <div className="tabular mt-1 flex max-w-80 justify-between font-mono text-2xs text-subtle-foreground">
            <span>{pae.residue_start}</span>
            <span className="font-sans">Aligned residue</span>
            <span>{pae.residue_start + size - 1}</span>
          </div>
          <div className="mt-2 flex max-w-80 items-center gap-2 text-2xs text-muted-foreground">
            <span className="tabular font-mono">0 Å</span>
            <span className="relative h-2 flex-1 border border-border bg-canvas">
              <span className="absolute inset-0 bg-linear-to-r from-foreground to-transparent" />
            </span>
            <span className="tabular font-mono">{cap} Å</span>
          </div>
        </div>
      </div>
      <div className="mt-3">
        <MetricReadout
          metric="pae"
          value={value}
          missingReason="Point at the matrix"
          label={
            <>
              <LearnTerm term="pae">PAE</LearnTerm>
              {hover
                ? ` of ${name(hover.scored)} aligned on ${name(hover.aligned)}`
                : pair
                  ? ` row of ${name(pair.scored)} is marked`
                  : " between two residues"}
            </>
          }
          producedBy={producedBy}
        />
      </div>
    </div>
  );
}

export interface ConfidencePanelProps {
  accession: string;
  sequence: string | null;
  /** the structure in the viewport */
  active: ApiStructureDescriptor | null;
  ledger: StructureLedger | null;
  /** AlphaFold DB model of the canonical sequence, shown when the active entry is experimental */
  canonical: ApiStructureDescriptor | null;
  position: number | null;
}

/** Model confidence for the predicted structure in view, each number with its explanation. */
export function ConfidencePanel({
  accession,
  sequence,
  active,
  ledger,
  canonical,
  position,
}: ConfidencePanelProps) {
  const experimental = active?.origin === "experimental";
  const target = experimental ? canonical : active;
  const summary = useStructureConfidence(target?.id);
  const wantsPae = Boolean(target?.confidence?.pae_available);
  const withPae = useStructureConfidence(target?.id, {
    pae: true,
    enabled: wantsPae,
  });
  const confidence = summary.data?.data ?? null;
  const plddt = confidence?.plddt ?? null;
  const pae = withPae.data?.data.pae ?? null;
  const producedBy = target
    ? `${structureDetail(target)}, ${shortId(target.id)}`
    : "";
  const entry = experimental
    ? ledger?.experimental.find((row) => row.structure.id === active?.id)
    : undefined;
  const index =
    position !== null && plddt ? plddt.residue_numbers.indexOf(position) : -1;
  const residueLabel =
    position !== null
      ? `${sequence?.[position - 1] ? (toThreeLetter(sequence[position - 1]) ?? "") : ""}${position}`
      : null;

  return (
    <div>
      {experimental && active ? (
        <>
          <SectionHeader
            title="Experimental entry"
            actions={
              entry?.evidence ? (
                <EvidencePopover
                  evidence={toEvidenceItem(entry.evidence, active.title)}
                  size="compact"
                />
              ) : null
            }
          />
          <DefinitionList>
            <DefinitionRow term="Method">{active.method}</DefinitionRow>
            <DefinitionRow
              term={<LearnTerm term="resolution">Resolution</LearnTerm>}
              mono
            >
              {active.resolution !== null && active.resolution !== undefined
                ? `${active.resolution.toFixed(2)} Å`
                : null}
            </DefinitionRow>
            <DefinitionRow term="R-free" mono>
              {entry?.r_free?.toFixed(3) ?? null}
            </DefinitionRow>
            <DefinitionRow term="Residues observed" mono>
              {active.coverage?.covered_residues
                ? `${active.coverage.covered_residues} of ${active.coverage.sequence_length}`
                : null}
            </DefinitionRow>
          </DefinitionList>
          <p className="px-3 pb-3 text-2xs leading-relaxed text-muted-foreground">
            Measured coordinates carry no pLDDT or PAE. The numbers below
            describe the predicted model of the same protein, not this entry.
          </p>
        </>
      ) : null}

      {!target ? (
        <EmptyState
          size="inline"
          title="No predicted model"
          description="Model confidence exists only for predicted structures."
          searched={["AlphaFold DB"]}
        />
      ) : (
        <>
          <SectionHeader
            title="Model confidence"
            actions={
              <span className="flex items-center gap-2">
                <StructureOriginTag
                  origin={target.origin}
                  detail={shortId(target.id)}
                  size="compact"
                />
                <EvidencePopover
                  evidence={provenanceEvidence(
                    target.provenance,
                    "computational_prediction",
                    `Per-residue confidence of ${target.id}`,
                    structureDetail(target),
                  )}
                  size="compact"
                  detail={null}
                />
              </span>
            }
          />
          {summary.isPending ? (
            <RowsSkeleton rows={4} />
          ) : summary.isError ? (
            <QueryErrorState
              error={summary.error}
              subject={`confidence of ${target.id}`}
              onRetry={() => void summary.refetch()}
            />
          ) : !plddt ? (
            <EmptyState
              size="inline"
              title="No per-residue confidence"
              description={
                confidence?.message ?? "Not provided for this structure."
              }
            />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 px-3 py-3">
                <MetricReadout
                  metric="plddt"
                  value={plddt.mean}
                  label={
                    <>
                      Mean <LearnTerm term="plddt">pLDDT</LearnTerm>
                    </>
                  }
                  producedBy={producedBy}
                />
                {position !== null ? (
                  <MetricReadout
                    metric="plddt"
                    value={index >= 0 ? plddt.scores[index] : null}
                    missingReason="Residue outside the model"
                    label={`pLDDT at ${residueLabel}`}
                    producedBy={producedBy}
                  />
                ) : null}
              </div>
              <SectionHeader
                title="pLDDT distribution"
                description="Share of residues in each AlphaFold DB confidence band."
              />
              <PlddtDistribution
                fractions={plddt.fractions as Record<string, number>}
                total={plddt.scores.length}
              />
            </>
          )}

          <SectionHeader
            title="Predicted aligned error"
            description="Confidence in the relative placement of two residues. A filled cell is low expected error; an empty cell is at the cap."
          />
          {!wantsPae ? (
            <EmptyState
              size="inline"
              title="No PAE matrix"
              description="Not provided for this structure."
            />
          ) : withPae.isPending ? (
            <RowsSkeleton rows={6} />
          ) : withPae.isError ? (
            <QueryErrorState
              error={withPae.error}
              subject={`PAE of ${target.id}`}
              onRetry={() => void withPae.refetch()}
            />
          ) : pae ? (
            <PaeHeatmap
              pae={pae}
              accession={accession}
              sequence={sequence}
              position={position}
              producedBy={producedBy}
            />
          ) : (
            <EmptyState
              size="inline"
              title="No PAE matrix"
              description={
                withPae.data?.data.message ?? "The source returned none."
              }
            />
          )}

          {confidence && confidence.limitations.length > 0 ? (
            <>
              <SectionHeader title="Limits of these numbers" />
              <ul className="list-disc space-y-1 px-3 pb-4 pl-7 text-2xs leading-relaxed text-muted-foreground">
                {confidence.limitations.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
