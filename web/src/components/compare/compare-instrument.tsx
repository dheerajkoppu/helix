"use client";

import { InfoIcon } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import { ExternalLink } from "@/components/data/external-link";
import { EvidencePopover } from "@/components/evidence/evidence-popover";
import { StructureOriginTag } from "@/components/evidence/structure-origin-tag";
import { ReferenceVariantLegend } from "@/components/science/legends";
import { ModelResultStrip } from "@/components/science/model-result-strip";
import { Swatch } from "@/components/science/swatch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  StructureViewport,
  useCameraLink,
  type MolecularViewerHandle,
  type ResidueColoring,
  type ViewerDomain,
} from "@/components/viewer";
import { tokenColor, useViewerPalette } from "@/components/viewer/palette";
import { PLDDT_NO_SCORE } from "@/lib/science/plddt";
import { routes, toThreeLetter } from "@/lib/ids";
import {
  COMPARE_WORDS,
  PREDICTION_CAVEAT,
  plainLength,
} from "@/lib/plain-language";
import {
  useWorkspaceSelection,
  type ColorMode,
  type CompareMode,
} from "@/lib/state/selection";
import {
  toViewportStructure,
  type ApiStructureDescriptor,
  type CompareResultResponse,
} from "@/lib/workspace-data";

import {
  FIXED_SCALE_MAX,
  citationHref,
  constructRange,
  displacementColoring,
  formatAngstrom,
  largestDisplacement,
  modelEvidence,
  type Caveat,
  type DisplacementScale,
  type ShownModels,
} from "./model";

const REFERENCE_OPACITY = 0.55;

function ModelCaption({
  role,
  model,
  result,
}: {
  role: "reference" | "variant";
  model: ApiStructureDescriptor;
  result: CompareResultResponse;
}) {
  const isReference = role === "reference";
  return (
    <div
      data-slot="model-caption"
      className="flex min-w-0 flex-col gap-0.5 px-3 py-1.5"
    >
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <Swatch
          swatchClass={isReference ? "bg-reference" : "bg-variant"}
          code={isReference ? "R" : "V"}
          onFill={isReference ? "ink" : "white"}
        />
        <span className="font-medium text-foreground">
          {isReference ? "Reference" : "Variant"}
        </span>
        <span className="truncate font-mono text-muted-foreground">
          {isReference ? "canonical sequence" : result.variant.hgvs_p}
        </span>
        <StructureOriginTag
          origin={model.origin}
          size="compact"
          detail={model.model_name ?? undefined}
          className="ml-auto shrink-0"
        />
      </div>
      <dl className="flex flex-wrap gap-x-3 text-2xs leading-4 text-muted-foreground">
        {(
          [
            ["Construct", constructRange(result.construct)],
            ["Provider", model.provider_name ?? model.provider],
            ["Version", model.model_version],
            [
              "Run",
              `${model.created_date ?? "date unknown"}${result.origin === "cached_example" ? ", cached" : ""}`,
            ],
            ["Mean pLDDT", model.confidence?.plddt_mean?.toFixed(1)],
          ] as const
        ).map(([term, value]) => (
          <div key={term} className="flex gap-1 whitespace-nowrap">
            <dt>{term}</dt>
            <dd className="tabular text-foreground">
              {value ?? "unknown"}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const STRIP =
  "no-scrollbar flex h-6 shrink-0 items-center gap-3 overflow-x-auto border-b border-border-subtle bg-sunken px-3 text-2xs whitespace-nowrap text-muted-foreground";
const WRAPPING_STRIP =
  "flex shrink-0 flex-wrap items-center gap-x-3 border-b border-border-subtle bg-sunken px-3 py-1 text-2xs leading-4 text-muted-foreground";

const Figure = ({ children }: { children: React.ReactNode }) => (
  <span className="tabular font-mono text-foreground">{children}</span>
);

/** Scope, RMSD, aligned pairs and method of the fit the difference values were computed with. */
function SuperpositionStrip({ result }: { result: CompareResultResponse }) {
  const { superposition, global_difference: global } = result.difference;
  return (
    <div data-slot="difference-fit" className={WRAPPING_STRIP}>
      <EvidencePopover
        size="compact"
        evidence={modelEvidence(
          result,
          `Cα RMSD ${formatAngstrom(superposition.rmsd, 3)} over ${superposition.residues_used} aligned pairs`,
        )}
      />
      <span className="text-foreground">Difference fit</span>
      <span>
        Cα RMSD <Figure>{formatAngstrom(superposition.rmsd, 3)}</Figure>
      </span>
      <span>
        <Figure>{superposition.residues_used}</Figure> aligned pairs
      </span>
      <span>Scope: {superposition.scope}</span>
      <span>Method: {superposition.method}</span>
      <span>
        All {global.residues_all} Cα after this fit{" "}
        <Figure>{formatAngstrom(global.rmsd_ca_all, 2)}</Figure>
      </span>
    </div>
  );
}

export interface CompareInstrumentProps {
  result: CompareResultResponse;
  mode: CompareMode;
  shown: ShownModels;
  scale: DisplacementScale;
  /** UniProt-numbered colourings of the protein, e.g. domains */
  colorings?: Partial<Record<ColorMode, ResidueColoring>>;
  domains?: ViewerDomain[];
  /** the two models and one result strip; captions, fit lines and toolbars stay out */
  simple?: boolean;
}

/**
 * Both models in Split, Overlay or Difference mode. The construct, provider, model version and run
 * date stay printed beside each model in every mode.
 */
export const CompareInstrument = memo(function CompareInstrument({
  result,
  mode,
  shown,
  scale,
  colorings,
  domains,
  simple = false,
}: CompareInstrumentProps) {
  const { variant, difference } = result;
  const accession = variant.uniprot_accession;
  const palette = useViewerPalette();
  const colorMode = useWorkspaceSelection((state) => state.colorMode);
  const representation = useWorkspaceSelection((state) => state.representation);

  const reference = useMemo(() => {
    const structure = toViewportStructure(result.reference_model, {
      accession,
      slot: "R",
    });
    return structure && simple
      ? {
          ...structure,
          slot: undefined,
          label: COMPARE_WORDS.normal,
          detail: undefined,
        }
      : structure;
  }, [result.reference_model, accession, simple]);
  const variantModel = useMemo(() => {
    const structure = toViewportStructure(result.variant_model, {
      accession,
      slot: "V",
    });
    return structure && simple
      ? {
          ...structure,
          slot: undefined,
          label: COMPARE_WORDS.mutated,
          detail: undefined,
        }
      : structure;
  }, [result.variant_model, accession, simple]);

  const first = useRef<MolecularViewerHandle>(null);
  const second = useRef<MolecularViewerHandle>(null);
  const [ready, setReady] = useState({ first: 0, second: 0 });
  useCameraLink(
    first,
    second,
    mode === "split" && ready.first > 0 && ready.second > 0,
  );

  const dataMax = useMemo(() => largestDisplacement(difference), [difference]);
  const displacement = useMemo(() => {
    if (!palette) return undefined;
    const scaleMax = scale === "fixed" ? FIXED_SCALE_MAX : dataMax;
    return displacementColoring(
      difference,
      {
        reference: palette.reference,
        variant: palette.variant,
        masked: tokenColor("--border", PLDDT_NO_SCORE.color),
      },
      scaleMax,
      scale === "fixed",
    );
  }, [palette, difference, scale, dataMax]);

  const viewportColorings = useMemo(
    () =>
      mode === "difference" && displacement
        ? { ...colorings, "reference-variant": displacement }
        : colorings,
    [mode, displacement, colorings],
  );

  // stable objects: a new marker identity makes the viewport repaint its colours
  const site = variant.position;
  const referenceLabel = `${toThreeLetter(variant.reference) ?? variant.reference}${site}`;
  const variantLabel = `${toThreeLetter(variant.alternate) ?? variant.alternate}${site}`;
  const referenceMarker = useMemo(
    () => ({ position: site, label: referenceLabel }),
    [site, referenceLabel],
  );
  const variantMarker = useMemo(
    () => ({ position: site, label: variantLabel }),
    [site, variantLabel],
  );
  const siteSet = useMemo(
    () => [{ id: "variant-site", label: variant.hgvs_p, positions: [site] }],
    [site, variant.hgvs_p],
  );

  // Overlay default: reference and variant tokens, with the reference drawn translucent.
  const roleTint = mode === "overlay" && shown === "both" && colorMode === null;
  const referenceId = reference?.id;
  const variantId = variantModel?.id;
  useEffect(() => {
    const handle = first.current;
    if (!handle || !palette || !referenceId || !variantId) return;
    if (mode !== "overlay" || shown !== "both" || ready.first === 0) return;
    if (roleTint) {
      handle
        .setColorMode(referenceId, {
          kind: "uniform",
          color: palette.reference,
        })
        .catch(() => {});
      handle
        .setColorMode(variantId, { kind: "uniform", color: palette.variant })
        .catch(() => {});
    }
    handle
      .setOpacity(referenceId, roleTint ? REFERENCE_OPACITY : 1)
      .catch(() => {});
  }, [
    roleTint,
    mode,
    shown,
    ready.first,
    palette,
    representation,
    referenceId,
    variantId,
    viewportColorings,
  ]);

  // Difference opens on the whole construct; a later selection focuses as usual.
  useEffect(() => {
    const handle = first.current;
    if (!handle || mode !== "difference" || ready.first === 0) return;
    let cancelled = false;
    void handle
      .settled()
      .then(() => {
        if (!cancelled) handle.resetCamera(0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mode, ready.first]);

  if (!reference || !variantModel)
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
        The result names no coordinate file for{" "}
        {reference ? "the variant model" : "the reference model"}.
      </div>
    );

  const frame = { ...reference, frameOnly: true };
  const side = shown === "variant" ? "variant" : "reference";
  const overlayBoth = mode === "overlay" && shown === "both";

  const siteRow = difference.per_residue.find(
    (entry) => entry.position === site,
  );
  const strip = simple ? (
    <ModelResultStrip
      model={result.provider.model_name ?? result.provider.name}
      origin={result.variant_model.origin}
      metrics={[
        {
          label: COMPARE_WORDS.moved,
          value: difference.superposition.rmsd,
          unit: "Å",
          caption: COMPARE_WORDS.angstrom,
        },
        {
          label: `pLDDT, ${COMPARE_WORDS.normal.toLowerCase()}`,
          value: siteRow?.plddt_reference,
          explainer: "plddt",
          missingReason: "Not modelled",
        },
        {
          label: `pLDDT, ${COMPARE_WORDS.mutated.toLowerCase()}`,
          value: siteRow?.plddt_variant,
          explainer: "plddt",
          missingReason: "Not modelled",
        },
        {
          label: COMPARE_WORDS.partModelled,
          value: `${result.construct.start}–${result.construct.end}`,
          unit: `of ${plainLength(result.construct.protein_length)}`,
        },
      ]}
      href={
        result.origin === "cached_example" ? null : routes.job(result.job_id)
      }
      className="shrink-0"
    />
  ) : (
    <ModelResultStrip
      model={result.provider.model_name ?? result.provider.name}
      version={result.provider.model_version}
      origin={result.variant_model.origin}
      metrics={[
        {
          label: "Construct",
          value: `${result.construct.start}-${result.construct.end}`,
          unit: `of ${result.construct.protein_length} aa`,
        },
        {
          label: `pLDDT at ${referenceLabel}`,
          value: siteRow?.plddt_reference,
          explainer: "plddt",
          missingReason: "Outside construct",
        },
        {
          label: `pLDDT at ${variantLabel}`,
          value: siteRow?.plddt_variant,
          explainer: "plddt",
          missingReason: "Outside construct",
        },
        {
          label: "Cα RMSD",
          value: difference.superposition.rmsd,
          unit: `Å, ${difference.superposition.residues_used} Cα pairs`,
        },
      ]}
      runtime={result.origin === "cached_example" ? "cached" : null}
      href={
        result.origin === "cached_example" ? null : routes.job(result.job_id)
      }
      hrefLabel="Run"
      className="shrink-0"
    />
  );

  if (simple && mode === "split")
    return (
      <div className="flex size-full min-h-0 flex-col">
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-2 divide-y divide-border sm:grid-cols-2 sm:grid-rows-1 sm:divide-x sm:divide-y-0">
          <div className="relative min-h-0 min-w-0">
            <StructureViewport
              ariaLabel={`Reference model of ${variant.gene_symbol}, residues ${constructRange(result.construct)}`}
              accession={accession}
              structures={[reference]}
              colorings={colorings}
              domains={domains}
              variant={referenceMarker}
              toolbar={false}
              linkedCamera
              viewerRef={first}
              onSceneReady={() =>
                setReady((state) => ({ ...state, first: state.first + 1 }))
              }
            />
          </div>
          <div className="relative min-h-0 min-w-0">
            <StructureViewport
              ariaLabel={`Variant model of ${variant.gene_symbol} ${variant.hgvs_p}, superposed on the reference`}
              accession={accession}
              structures={[frame, variantModel]}
              colorings={colorings}
              domains={domains}
              variant={variantMarker}
              toolbar={false}
              legend={false}
              linkedCamera
              viewerRef={second}
              onSceneReady={() =>
                setReady((state) => ({ ...state, second: state.second + 1 }))
              }
            />
          </div>
        </div>
        {strip}
      </div>
    );

  const captions = (
    <div className="grid shrink-0 grid-cols-2 divide-x divide-border border-b border-border">
      <ModelCaption
        role="reference"
        model={result.reference_model}
        result={result}
      />
      <ModelCaption
        role="variant"
        model={result.variant_model}
        result={result}
      />
    </div>
  );

  if (mode === "split")
    return (
      <div className="flex size-full min-h-0 flex-col">
        {captions}
        <SuperpositionStrip result={result} />
        <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-border">
          <div className="flex min-h-0 min-w-0 flex-col">
            <p className={STRIP}>
              <span className="text-foreground">Reference frame</span>
              <span>
                Cameras are linked. Hover and selection mirror in both panes.
              </span>
            </p>
            <div className="relative min-h-0 flex-1">
              <StructureViewport
                ariaLabel={`Reference model of ${variant.gene_symbol}, residues ${constructRange(result.construct)}`}
                accession={accession}
                structures={[reference]}
                colorings={colorings}
                domains={domains}
                variant={referenceMarker}
                toolbar={false}
                linkedCamera
                viewerRef={first}
                onSceneReady={() =>
                  setReady((state) => ({ ...state, first: state.first + 1 }))
                }
              />
            </div>
          </div>
          <div className="flex min-h-0 min-w-0 flex-col">
            <div className="relative min-h-0 flex-1">
              <StructureViewport
                ariaLabel={`Variant model of ${variant.gene_symbol} ${variant.hgvs_p}, superposed on the reference`}
                accession={accession}
                structures={[frame, variantModel]}
                colorings={colorings}
                domains={domains}
                variant={variantMarker}
                toolbar={false}
                linkedCamera
                viewerRef={second}
                onSceneReady={() =>
                  setReady((state) => ({ ...state, second: state.second + 1 }))
                }
              />
            </div>
          </div>
        </div>
      </div>
    );

  const structures =
    mode === "difference"
      ? side === "variant"
        ? [frame, variantModel]
        : [reference]
      : shown === "reference"
        ? [reference]
        : shown === "variant"
          ? [frame, variantModel]
          : [reference, variantModel];

  return (
    <div className="flex size-full min-h-0 flex-col">
      {simple ? null : captions}
      {simple ? null : <SuperpositionStrip result={result} />}
      <div className="relative min-h-0 flex-1">
        <StructureViewport
          ariaLabel={
            mode === "difference"
              ? `${side === "variant" ? "Variant" : "Reference"} model of ${variant.gene_symbol} coloured by Cα displacement between the two models`
              : `Reference and variant models of ${variant.gene_symbol} ${variant.hgvs_p}, superposed`
          }
          accession={accession}
          structures={structures}
          colorings={viewportColorings}
          domains={domains}
          variant={
            overlayBoth
              ? null
              : shown === "variant"
                ? variantMarker
                : referenceMarker
          }
          residueSets={overlayBoth ? siteSet : undefined}
          toolbar={!simple}
          legend={!roleTint}
          viewerRef={first}
          onSceneReady={() =>
            setReady((state) => ({ ...state, first: state.first + 1 }))
          }
        />
        {simple && roleTint ? (
          <div className="pointer-events-none absolute bottom-2 left-2 border border-border-subtle bg-background/85 px-1.5 py-1">
            <ReferenceVariantLegend wrap={false} />
          </div>
        ) : null}
      </div>
      {simple ? strip : null}
      {roleTint && !simple ? (
        <div className="flex h-7 shrink-0 items-center gap-4 border-t border-border-subtle px-3 text-2xs text-muted-foreground">
          <ReferenceVariantLegend wrap={false} />
          <span className="truncate">
            Reference drawn translucent, variant solid. Corner tags R and V name
            each model.
          </span>
        </div>
      ) : null}
      {mode === "difference" && !simple ? (
        <p className="flex h-6 shrink-0 items-center gap-3 border-t border-border-subtle px-3 text-2xs whitespace-nowrap text-muted-foreground">
          <span>
            Scale{" "}
            <Figure>
              0 to{" "}
              {formatAngstrom(scale === "fixed" ? FIXED_SCALE_MAX : dataMax, 2)}
            </Figure>
            {scale === "fixed" ? ", values above are clamped" : ", data range"}
          </span>
          <span>
            Largest compared displacement{" "}
            <Figure>{formatAngstrom(dataMax, 3)}</Figure>
          </span>
          <span className="truncate">{difference.masking.rule}</span>
        </p>
      ) : null}
    </div>
  );
});

/** The fixed caveat about single-substitution predictions: one quiet line, with its sources one click away. */
export function CaveatLine({
  caveats,
  simple = false,
}: {
  caveats: Caveat[];
  /** the fixed plain caveat; the sourced text stays in the popover */
  simple?: boolean;
}) {
  const fixed =
    caveats.find((entry) => entry.id === "not_validated_for_substitutions") ??
    caveats[0];
  if (!fixed) return null;
  const [lead] = fixed.citations;
  const leadHref = lead ? citationHref(lead) : null;
  return (
    <span
      data-slot="comparison-caveat"
      className="flex min-w-0 flex-1 items-center gap-2"
    >
      <span className="truncate" title={simple ? undefined : fixed.text}>
        {simple ? `${PREDICTION_CAVEAT} ${COMPARE_WORDS.small}` : fixed.text}
      </span>
      {lead && leadHref && !simple ? (
        <ExternalLink href={leadHref} className="shrink-0">
          {(lead.text ?? lead.title ?? "Source").split(",")[0]} {lead.year}
        </ExternalLink>
      ) : null}
      <Popover>
        <PopoverTrigger
          aria-label="Caveats and their sources"
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-xs px-1 text-foreground hover:bg-accent aria-expanded:bg-active"
        >
          <InfoIcon className="size-3" />
          {simple ? COMPARE_WORDS.sources : "Sources"}
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          className="max-h-[60dvh] w-[28rem] max-w-[90vw] overflow-y-auto p-0 text-xs"
        >
          <ul>
            {caveats.map((caveat) => (
              <li
                key={caveat.id}
                className="border-b border-border-subtle px-3 py-2 last:border-b-0"
              >
                <p className="leading-5 text-foreground">{caveat.text}</p>
                {caveat.quoted_from ? (
                  <p className="mt-0.5 text-2xs text-subtle-foreground">
                    {caveat.quoted_from}
                  </p>
                ) : null}
                {caveat.citations.length ? (
                  <ul className="mt-1 flex flex-col gap-0.5 text-2xs">
                    {caveat.citations.map((citation) => {
                      const href = citationHref(citation);
                      return (
                        <li key={citation.text ?? citation.doi ?? citation.url}>
                          {href ? (
                            <ExternalLink href={href}>
                              {citation.text}
                            </ExternalLink>
                          ) : (
                            citation.text
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </span>
  );
}
