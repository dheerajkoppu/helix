"use client";

import {
  DefinitionList,
  DefinitionRow,
} from "@/components/data/definition-list";
import { SectionHeader } from "@/components/data/section-header";
import { StructureViewport } from "@/components/viewer";
import { WorkspaceFrame, WorkspaceZones, Zone } from "@/components/workspace";
import { useReportSources } from "@/lib/state/shell";
import {
  useGene,
  useProteinAxis,
  useProteinColorings,
  useSubjectBundle,
  useViewportStructure,
} from "@/lib/workspace-data";

function Reference({
  accession,
  structureId,
}: {
  accession: string;
  structureId: string | null;
}) {
  const axis = useProteinAxis(accession);
  const gene = useGene(axis.protein?.gene?.id);
  const shownId = structureId ?? axis.ledger?.recommended?.structure_id;
  const shown = useViewportStructure(shownId, accession);
  const { colorings, domains } = useProteinColorings(accession);

  useSubjectBundle({
    gene: gene.data?.data,
    protein: axis.protein ?? accession,
    structure: shown.descriptor ?? undefined,
  });
  useReportSources("dev-data", axis.sources);

  const tracks = axis.data?.tracks ?? [];
  const variants = axis.data?.variants ?? [];
  const count = (group: "clinical" | "population") =>
    variants.filter((variant) => variant.group === group).length;

  return (
    <WorkspaceZones
      layoutId="dev-data"
      instrument={
        <Zone
          zone="instrument"
          title="3D"
          detail={<span className="font-mono">{shownId ?? "resolving"}</span>}
          scroll={false}
        >
          {shown.structure ? (
            <StructureViewport
              ariaLabel={`${accession} structure`}
              accession={accession}
              structures={[shown.structure]}
              colorings={colorings}
              domains={domains}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              {shown.error
                ? shown.error.message
                : `Resolving a structure for ${accession}`}
            </div>
          )}
        </Zone>
      }
      inspector={
        <Zone zone="inspector" title="Data layer">
          <SectionHeader title="Sequence axis" />
          <DefinitionList>
            <DefinitionRow term="Sequence" mono>
              {axis.data ? `${axis.data.sequence.length} residues` : null}
            </DefinitionRow>
            <DefinitionRow term="Requests">
              {axis.isComplete ? "All settled" : "Loading"}
            </DefinitionRow>
            {tracks.map((track) => (
              <DefinitionRow key={track.id} term={track.label} mono>
                {track.status
                  ? `${track.status.state}${track.status.message ? `: ${track.status.message}` : ""}`
                  : track.values
                    ? `${track.values.filter((value) => value !== null).length} values`
                    : `${track.features?.length ?? 0} features`}
              </DefinitionRow>
            ))}
            <DefinitionRow term="Clinical variants" mono>
              {count("clinical")}
            </DefinitionRow>
            <DefinitionRow term="Population variants" mono>
              {count("population")}
            </DefinitionRow>
            <DefinitionRow term="gnomAD rows not drawn" mono>
              {axis.populationMismatched}
            </DefinitionRow>
          </DefinitionList>
          <SectionHeader title="Structure" />
          <DefinitionList>
            <DefinitionRow term="Origin" mono>
              {shown.structure?.origin ?? null}
            </DefinitionRow>
            <DefinitionRow term="Detail">
              {shown.structure?.detail ?? null}
            </DefinitionRow>
            <DefinitionRow term="Chain" mono>
              {shown.structure?.chain ?? "first polymer chain"}
            </DefinitionRow>
            <DefinitionRow term="Numbering" mono>
              {shown.structure?.residueMap
                ? `${shown.structure.residueMap.numbering}, ${shown.structure.residueMap.segments?.length ?? 0} segments`
                : "label, identity"}
            </DefinitionRow>
            <DefinitionRow term="Colourings" mono>
              {Object.keys(colorings).join(", ") || null}
            </DefinitionRow>
          </DefinitionList>
        </Zone>
      }
    />
  );
}

/** Reference for page builders: a workspace stage fed only through `@/lib/workspace-data`. */
export function DataDemo(props: {
  accession: string;
  structureId: string | null;
}) {
  return (
    <WorkspaceFrame stage="protein">
      <Reference {...props} />
    </WorkspaceFrame>
  );
}
