"use client";

import { useEffect, useMemo } from "react";

import { formatMeasure, humanise } from "@/components/lab/format";
import type { ResultEntry } from "@/components/lab/record";
import {
  isRecord,
  readList,
  readNumber,
  readText,
  type LabRun,
  type LooseRecord,
} from "@/components/lab/types";
import {
  ModelResultStrip,
  type ModelResultMetric,
} from "@/components/science/model-result-strip";
import { QueryErrorState, RowsSkeleton } from "@/components/states/query-state";
import {
  StructureViewport,
  type ViewportLigand,
  type ViewportResidueSet,
} from "@/components/viewer";
import { parseVariantId, routes } from "@/lib/ids";
import { useAdvancedMode } from "@/lib/state/preferences";
import { useWorkspaceSelection } from "@/lib/state/selection";
import type { StructureOrigin } from "@/lib/structure-origin";
import { useCompareResult, useViewportStructure } from "@/lib/workspace-data";

const STRUCTURE_ID = /^(pdb|afdb|of):.+/i;

interface Tangible {
  /** what produced the numbers, as the record names it */
  model: string;
  version: string | null;
  origin: StructureOrigin | null;
  metrics: ModelResultMetric[];
  structureId: string | null;
  /** SIFTS author chain the measurement was made on */
  chainId: string | null;
  ligand: { compId: string; chainId: string | null } | null;
  href: string | null;
  hrefLabel: string;
  /** residues the result names, drawn on the structure: a predicted pocket */
  residueSet: { label: string; positions: number[] } | null;
  /** comparison job whose variant model is the structure to show */
  compareJobId: string | null;
  /** printed instead of the measured run time: "cached" when no model ran for this request */
  runtime: string | null;
}

const structureIdOf = (value: unknown): string | null => {
  const text = readText(value);
  return text && STRUCTURE_ID.test(text) ? text : null;
};

function ligandContact(values: LooseRecord): Partial<Tangible> {
  const closest = readList(values.closest_contacts).find(isRecord);
  const structure = closest ? readText(closest.structure) : null;
  const withContact = readList(values.structures_with_contact).length;
  const examined = readNumber(values.ligand_bound_structures_examined);
  const compId = closest ? readText(closest.ligand) : null;
  const chainId = closest ? readText(closest.chain) : null;
  return {
    model: "Ligand contact test",
    origin: "experimental",
    structureId: structure ? `pdb:${structure.toUpperCase()}` : null,
    chainId,
    ligand: compId ? { compId, chainId } : null,
    metrics: [
      {
        label: "In contact",
        value: examined !== null ? `${withContact} of ${examined}` : null,
        unit: "structures",
        missingReason: "Not reported",
      },
      {
        label: compId ? `Closest, ${compId}` : "Closest",
        value: closest ? readNumber(closest.distance_angstrom) : null,
        unit: "Å",
        missingReason: "No contact",
      },
      {
        label: "Cutoff",
        value: readNumber(values.contact_threshold_angstrom),
        unit: "Å",
        missingReason: "Not reported",
      },
    ],
  };
}

function stabilityEffect(values: LooseRecord): Partial<Tangible> {
  return {
    model: "FoldX",
    origin: "predicted_external",
    structureId: structureIdOf(values.model),
    metrics: [
      {
        label: "Predicted ΔΔG",
        value: readNumber(values.foldx_ddg_kcal_mol),
        unit: "kcal/mol",
        explainer: "ddg",
        missingReason: "Not covered",
      },
      {
        label: "Threshold",
        value: readNumber(values.destabilising_threshold_kcal_mol),
        unit: "kcal/mol",
        missingReason: "Not reported",
      },
      {
        label: "Site pLDDT",
        value: readNumber(values.residue_plddt),
        explainer: "plddt",
        missingReason: "Not reported",
      },
    ],
  };
}

function structuralContext(values: LooseRecord): Partial<Tangible> {
  const p2rank = readList(values.p2rank_pockets_containing_residue).filter(
    isRecord,
  );
  const protvar = readList(values.protvar_pockets_containing_residue).filter(
    isRecord,
  );
  const total = readNumber(values.p2rank_pockets_total);
  const pocket = p2rank[0] ?? protvar[0];
  const positions = readList(pocket?.residues ?? pocket?.positions).filter(
    (entry): entry is number => typeof entry === "number",
  );
  return {
    model: "P2Rank and ProtVar",
    origin: "predicted_external",
    structureId: structureIdOf(values.p2rank_model),
    residueSet: positions.length
      ? { label: "Predicted pocket", positions }
      : null,
    metrics: [
      {
        label: "In P2Rank pockets",
        value: total !== null ? `${p2rank.length} of ${total}` : p2rank.length,
      },
      {
        label: "In ProtVar pockets",
        value: protvar.length,
      },
      {
        label: "Pocket pLDDT",
        value: pocket ? readNumber(pocket.mean_plddt) : null,
        explainer: "plddt",
        missingReason: "No pocket",
      },
    ],
  };
}

function structureComparison(
  values: LooseRecord,
  subject: LabRun["subject"],
): Partial<Tangible> {
  const provider = isRecord(values.provider) ? values.provider : {};
  const summary = isRecord(values.summary) ? values.summary : {};
  const parsed = subject.variant_id ? parseVariantId(subject.variant_id) : null;
  const siteReference = readNumber(summary.plddt_site_reference);
  const siteVariant = readNumber(summary.plddt_site_variant);
  const stored =
    readText(values.origin) === "cached_example" ||
    provider.performs_inference === false;
  return {
    model:
      readText(provider.model_name) ?? readText(provider.id) ?? "Comparison",
    version: readText(provider.model_version),
    origin: "predicted_orphafold",
    compareJobId: readText(values.job_id),
    runtime: stored ? "cached" : null,
    href:
      parsed?.kind === "substitution"
        ? routes.compare(parsed.gene, parsed.label)
        : null,
    hrefLabel: "Open comparison",
    metrics: [
      {
        label: "Local Cα RMSD",
        value: readNumber(summary.local_rmsd_ca),
        unit: "Å",
        missingReason: "Not reported",
      },
      {
        label: "Confident RMSD",
        value: readNumber(summary.rmsd_ca_confident),
        unit: "Å",
        missingReason: "Not reported",
      },
      {
        label: "Site pLDDT",
        value:
          siteReference !== null && siteVariant !== null
            ? `${formatMeasure(siteReference, 1)} → ${formatMeasure(siteVariant, 1)}`
            : null,
        explainer: "plddt",
        missingReason: "Not reported",
      },
    ],
  };
}

const READERS: Record<
  string,
  (values: LooseRecord, subject: LabRun["subject"]) => Partial<Tangible>
> = {
  ligand_contact: ligandContact,
  stability_effect: stabilityEffect,
  structural_context: structuralContext,
  structure_comparison: structureComparison,
};

function tangibleOf(result: ResultEntry, subject: LabRun["subject"]): Tangible {
  const read = result.test_kind ? READERS[result.test_kind] : undefined;
  const found = read ? read(result.values, subject) : {};
  const structureId = found.structureId ?? null;
  return {
    model:
      found.model ??
      (result.test_kind ? humanise(result.test_kind) : "Computational test"),
    version: found.version ?? null,
    origin: found.origin ?? null,
    metrics: found.metrics ?? [],
    structureId,
    chainId: found.chainId ?? null,
    ligand: found.ligand ?? null,
    href:
      found.href ??
      (structureId && subject.accession
        ? `${routes.protein(subject.accession)}?s=${structureId}`
        : null),
    hrefLabel: found.hrefLabel ?? "Open structure",
    residueSet: found.residueSet ?? null,
    compareJobId: found.compareJobId ?? result.job_id ?? null,
    runtime: found.runtime ?? null,
  };
}

/** The structure the result was measured on: a comparison's variant model, else the named entry. */
function useResultStructure(tangible: Tangible, subject: LabRun["subject"]) {
  const compared = useCompareResult(tangible.compareJobId, {
    enabled: tangible.compareJobId !== null && tangible.structureId === null,
  });
  const variantModel = compared.data?.data.variant_model ?? null;
  const shown = useViewportStructure(
    variantModel ?? tangible.structureId,
    subject.accession,
    { chainId: tangible.chainId },
  );
  const awaitingModel =
    tangible.structureId === null &&
    tangible.compareJobId !== null &&
    compared.isPending;
  return {
    ...shown,
    isPending: shown.isPending || awaitingModel,
    error: shown.error ?? (compared.isError ? compared.error : null),
    hasFigure: tangible.structureId !== null || tangible.compareJobId !== null,
  };
}

/** Loads what the result figure needs before its step is opened, so the structure appears without a wait. */
export function ResultWarmup({
  result,
  subject,
}: {
  result: ResultEntry;
  subject: LabRun["subject"];
}) {
  const tangible = useMemo(
    () => tangibleOf(result, subject),
    [result, subject],
  );
  const shown = useResultStructure(tangible, subject);
  const source = shown.structure?.source;
  const url = source?.kind === "url" ? source.url : null;
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    void fetch(url, { signal: controller.signal }).catch(() => undefined);
    return () => controller.abort();
  }, [url]);
  return null;
}

/**
 * The tangible output of the executed test: the structure it was measured on with the variant
 * residue drawn, then what produced the numbers and the numbers themselves, with units.
 */
export function ResultFigure({
  result,
  subject,
}: {
  result: ResultEntry;
  subject: LabRun["subject"];
}) {
  const advanced = useAdvancedMode();
  const tangible = useMemo(
    () => tangibleOf(result, subject),
    [result, subject],
  );
  const variantId = subject.variant_id;
  const substitution = useMemo(() => {
    const parsed = variantId ? parseVariantId(variantId) : null;
    return parsed?.kind === "substitution" ? parsed : null;
  }, [variantId]);
  const shown = useResultStructure(tangible, subject);
  const ligand = useMemo<ViewportLigand | null>(
    () =>
      tangible.ligand && tangible.structureId
        ? {
            structureId: tangible.structureId,
            compId: tangible.ligand.compId,
            authAsymId: tangible.ligand.chainId ?? undefined,
          }
        : null,
    [tangible],
  );
  const residueSets = useMemo<ViewportResidueSet[]>(
    () =>
      tangible.residueSet
        ? [
            {
              id: "result-set",
              label: tangible.residueSet.label,
              positions: tangible.residueSet.positions.filter(
                (position) => position !== substitution?.change.position,
              ),
            },
          ]
        : [],
    [tangible, substitution],
  );
  // selecting the variant moves the camera to it and carries it into the workspace pages
  const structureReady = shown.structure !== null;
  const accession = subject.accession;
  const withLigand = ligand !== null;
  useEffect(() => {
    if (!structureReady || !accession || !substitution || withLigand) return;
    const selection = useWorkspaceSelection.getState();
    selection.bindAccession(accession);
    if (
      useWorkspaceSelection.getState().variant?.position ===
      substitution.change.position
    )
      return;
    selection.selectVariant({ ...substitution.change, sourceId: null });
  }, [structureReady, accession, substitution, withLigand]);
  const variant = useMemo(
    () =>
      substitution
        ? {
            position: substitution.change.position,
            label: substitution.label,
          }
        : null,
    [substitution],
  );

  return (
    <div className="border border-border">
      {shown.hasFigure ? (
        <div className="relative h-[clamp(16rem,42dvh,26rem)] bg-sunken">
          {shown.structure ? (
            <StructureViewport
              ariaLabel={`${subject.gene ?? "Protein"} residue ${variant?.position ?? ""} on ${shown.structure.id}`}
              accession={subject.accession}
              structures={[shown.structure]}
              variant={variant}
              residueSets={residueSets}
              ligand={ligand}
              toolbar={advanced}
              legend={advanced}
              className="h-full"
            />
          ) : shown.error ? (
            <QueryErrorState
              error={shown.error}
              subject={`structure ${tangible.structureId ?? tangible.compareJobId ?? ""}`}
            />
          ) : (
            <RowsSkeleton rows={5} />
          )}
        </div>
      ) : null}
      <ModelResultStrip
        model={tangible.model}
        version={tangible.version}
        origin={tangible.origin}
        metrics={tangible.metrics}
        runtime={tangible.runtime ?? result.elapsed_seconds}
        href={tangible.href}
        hrefLabel={tangible.hrefLabel}
        frame={shown.hasFigure ? "rule" : "none"}
        className={shown.hasFigure ? undefined : "px-4 py-3"}
      />
    </div>
  );
}
