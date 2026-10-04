"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { CandidatesLink } from "@/components/discovery/candidates-link";
import { AddToProjectButton } from "@/components/project/add-to-project";
import { EmptyState } from "@/components/states/empty-state";
import { QueryErrorState, RowsSkeleton } from "@/components/states/query-state";
import {
  StructureInstrument,
  StructureResultStrip,
  useShownStructure,
} from "@/components/variant/structure-pane";
import { useStagePath } from "@/components/variant/shared";
import {
  SubjectBarActions,
  WorkspaceZones,
  Zone,
  useWorkspaceSubject,
} from "@/components/workspace";
import type { Schema } from "@/lib/api/types";
import {
  formatProteinChange,
  formatVariantId,
  routes,
  toThreeLetter,
} from "@/lib/ids";
import { setWorkspaceHover } from "@/lib/state/hover";
import { GENE_WORDS } from "@/lib/plain-language";
import { useAdvancedMode } from "@/lib/state/preferences";
import { useWorkspaceSelection } from "@/lib/state/selection";
import { useReportSources } from "@/lib/state/shell";
import { useWorkspaceSubjectStore, type SubjectRef } from "@/lib/state/subject";
import {
  mergeSources,
  subjectChain,
  useGene,
  useProteinAxis,
} from "@/lib/workspace-data";

import { GeneHeader } from "./gene-header";
import {
  SelectionInspector,
  type ActiveSelection,
} from "./selection-inspector";
import {
  VariantLedger,
  useVariantLedger,
  type VariantRow,
} from "./variant-ledger";

type AxisClinicalVariant = Schema<"AxisClinicalVariant">;

const isSubstitution = (row: {
  change_kind: string | null;
  position: number | null;
  reference_residue: string | null;
  alternate_residue: string | null;
}) =>
  row.change_kind === "substitution" &&
  row.position !== null &&
  row.reference_residue?.length === 1 &&
  row.alternate_residue?.length === 1 &&
  toThreeLetter(row.alternate_residue) !== null;

const rowLabel = (row: VariantRow) =>
  row.protein_change ?? row.hgvs.c?.split(":").pop() ?? row.name ?? row.id;

/** Stage 2: the variants of one gene on its protein, with one selection shared by table, axis and structure. */
export function GeneWorkspace({ symbol }: { symbol: string }) {
  const router = useRouter();
  const stagePath = useStagePath();
  const advanced = useAdvancedMode();
  const gene = useGene(symbol);
  const geneData = gene.data?.data ?? null;
  const accession = geneData?.uniprot_accession ?? null;
  const axis = useProteinAxis(accession, { gene: symbol });
  const ledger = useVariantLedger(symbol);
  const structure = useShownStructure(accession, axis.ledger);

  const ranges = useWorkspaceSelection((state) => state.ranges);
  const storeVariant = useWorkspaceSelection((state) => state.variant);
  const selectVariant = useWorkspaceSelection((state) => state.selectVariant);
  const selectResidue = useWorkspaceSelection((state) => state.selectResidue);
  const clearResidues = useWorkspaceSelection((state) => state.clearResidues);
  const clearSelection = useWorkspaceSelection((state) => state.clear);
  // The last table row chosen: it carries the full record, and is the only handle on a variant without a protein position.
  const [picked, setPicked] = useState<VariantRow | null>(null);

  const position =
    ranges.length === 1 && ranges[0].start === ranges[0].end
      ? ranges[0].start
      : null;
  const sequence = axis.data?.sequence ?? null;
  const clinical = axis.variants?.clinical;

  const active = useMemo<ActiveSelection>(() => {
    if (storeVariant && storeVariant.position === position) {
      const matches = (candidate: {
        vcv: string | null;
        uniprot_feature_id: string | null;
        position: number | null;
        reference_residue: string | null;
        alternate_residue: string | null;
      }) =>
        (storeVariant.sourceId !== null &&
          (candidate.vcv === storeVariant.sourceId ||
            candidate.uniprot_feature_id === storeVariant.sourceId)) ||
        (candidate.position === storeVariant.position &&
          candidate.reference_residue === storeVariant.reference &&
          candidate.alternate_residue === storeVariant.alternate);
      const row =
        (picked && matches(picked) ? picked : null) ??
        ledger.rows.find(matches) ??
        null;
      const slim = row ? null : (clinical?.find(matches) ?? null);
      const change = {
        reference: storeVariant.reference,
        position: storeVariant.position,
        alternate: storeVariant.alternate,
      };
      return {
        kind: "variant",
        id: row?.id ?? slim?.id ?? formatVariantId(symbol, change),
        label:
          row?.protein_change ??
          slim?.protein_change ??
          formatProteinChange(change),
        position: storeVariant.position,
        reference: storeVariant.reference,
        alternate: storeVariant.alternate,
        row,
        slim,
      };
    }
    if (
      picked &&
      !isSubstitution(picked) &&
      (picked.position === null
        ? ranges.length === 0
        : picked.position === position)
    )
      return {
        kind: "variant",
        id: picked.id,
        label: rowLabel(picked),
        position: picked.position,
        reference: null,
        alternate: null,
        row: picked,
        slim: null,
      };
    return position === null ? null : { kind: "residue", position };
  }, [storeVariant, position, picked, ledger.rows, clinical, symbol, ranges]);

  const activeVariant = active?.kind === "variant" ? active : null;
  const variantRef = useMemo<SubjectRef | null>(() => {
    if (!activeVariant) return null;
    const vcv = activeVariant.row?.vcv ?? activeVariant.slim?.vcv ?? null;
    const featureId =
      activeVariant.row?.uniprot_feature_id ??
      activeVariant.slim?.uniprot_feature_id ??
      null;
    return {
      id: activeVariant.id,
      label: activeVariant.label,
      sourceId: vcv ?? featureId,
      source: vcv ? "ClinVar" : featureId ? "UniProt" : null,
      href: vcv
        ? `https://www.ncbi.nlm.nih.gov/clinvar/variation/${vcv}/`
        : null,
      evidenceClass: vcv
        ? "clinical_database"
        : featureId
          ? "curated_database"
          : null,
    };
  }, [activeVariant]);

  // A gene opened from search still knows its disease, so the Disease step is not a dead end.
  const knownDiseaseId = useWorkspaceSubjectStore(
    (state) => state.chain.disease?.id ?? null,
  );
  const ownDiseases = geneData?.diseases;
  const ownDisease = ownDiseases?.some(
    (disease) => disease.id === knownDiseaseId,
  )
    ? null
    : ownDiseases?.[0];

  useWorkspaceSubject({
    ...subjectChain({
      gene: geneData ?? undefined,
      protein: axis.protein ?? accession ?? undefined,
      structure: structure.shown.descriptor ?? undefined,
    }),
    ...(geneData ? {} : { gene: { id: symbol, label: symbol } }),
    ...(ownDisease
      ? { disease: { id: ownDisease.id, label: ownDisease.name } }
      : {}),
    variant: variantRef,
  });

  const sources = useMemo(
    () =>
      mergeSources(
        gene.data?.sources,
        axis.sources,
        ledger.query.data?.sources,
      ),
    [gene.data, axis.sources, ledger.query.data],
  );
  useReportSources("gene-stage", sources);

  function selectRow(row: VariantRow) {
    setPicked(row);
    if (
      isSubstitution(row) &&
      row.position !== null &&
      row.reference_residue &&
      row.alternate_residue
    ) {
      selectVariant({
        reference: row.reference_residue,
        position: row.position,
        alternate: row.alternate_residue,
        sourceId: row.vcv ?? row.uniprot_feature_id,
      });
      return;
    }
    selectVariant(null);
    if (row.position !== null) selectResidue(row.position);
    else clearResidues();
  }

  function selectAxisVariant(variant: AxisClinicalVariant) {
    if (!variant.reference_residue || !variant.alternate_residue) {
      selectResidue(variant.position);
      return;
    }
    selectVariant({
      reference: variant.reference_residue,
      position: variant.position,
      alternate: variant.alternate_residue,
      sourceId: variant.vcv ?? variant.uniprot_feature_id,
    });
  }

  const residueLetter = position !== null ? sequence?.[position - 1] : null;

  if (gene.isError)
    return (
      <WorkspaceZones
        layoutId="gene"
        instrument={
          <Zone zone="instrument" title="Gene">
            <QueryErrorState
              error={gene.error}
              subject={`gene ${symbol}`}
              onRetry={() => void gene.refetch()}
              retrying={gene.isFetching}
            />
          </Zone>
        }
      />
    );

  return (
    <>
      <SubjectBarActions>
        <CandidatesLink
          gene={symbol}
          diseaseId={knownDiseaseId ?? ownDisease?.id ?? null}
          variantId={variantRef?.id ?? null}
        />
        <AddToProjectButton
          size="sm"
          variant="ghost"
          item={{
            kind: "gene",
            ref: symbol,
            label: geneData?.name ? `${symbol}, ${geneData.name}` : symbol,
            origin: { route: routes.gene(symbol) },
            data: {
              hgnc_id: geneData?.hgnc_id ?? null,
              uniprot_accession: accession,
              diseases: geneData?.diseases.map((disease) => disease.id) ?? [],
            },
          }}
        />
      </SubjectBarActions>
      <WorkspaceZones
        layoutId="gene"
        ledgerLabel="Variants"
        inspectorLabel="Selection"
        ledger={
          <VariantLedger
            state={ledger}
            selectedRowKey={activeVariant?.row?.row_key ?? null}
            onSelect={selectRow}
            onActivate={(row) => router.push(stagePath(routes.variant(row.id)))}
            onHover={(row) =>
              setWorkspaceHover(
                row?.position && accession
                  ? { accession, position: row.position, origin: "ledger" }
                  : null,
              )
            }
          />
        }
        instrument={
          geneData && !accession ? (
            <Zone zone="instrument" title="3D">
              <GeneHeader gene={geneData} />
              <EmptyState
                title={
                  advanced
                    ? `No UniProt protein for ${symbol}`
                    : GENE_WORDS.noProtein
                }
                description={
                  advanced
                    ? "The gene record names no canonical UniProt accession, so there is no sequence axis and no structure to show. The variant table is unaffected."
                    : undefined
                }
                searched={["UniProt"]}
              />
            </Zone>
          ) : (
            <StructureInstrument
              accession={accession}
              subject={symbol}
              ledger={axis.ledger}
              ledgerSettled={axis.isComplete}
              structure={structure}
              position={position}
              residueLabel={
                residueLetter && position !== null
                  ? `${toThreeLetter(residueLetter) ?? residueLetter}${position}`
                  : null
              }
              variant={
                activeVariant?.position
                  ? {
                      position: activeVariant.position,
                      label: activeVariant.label,
                    }
                  : null
              }
              title={advanced ? "3D" : symbol}
              caption={
                geneData?.name ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {geneData.name}
                  </span>
                ) : null
              }
              top={
                !advanced ? null : geneData ? (
                  <GeneHeader gene={geneData} />
                ) : (
                  <RowsSkeleton rows={3} className="shrink-0" />
                )
              }
              bottom={
                advanced ? null : (
                  <StructureResultStrip
                    descriptor={structure.shown.descriptor}
                    className="shrink-0"
                  />
                )
              }
            />
          )
        }
        inspector={
          advanced || active ? (
            <SelectionInspector
              symbol={symbol}
              accession={accession}
              sequence={sequence}
              active={active}
              axisVariants={axis.variants}
              onSelectVariant={selectAxisVariant}
              onClose={() => {
                setPicked(null);
                clearSelection();
              }}
            />
          ) : undefined
        }
      />
    </>
  );
}
