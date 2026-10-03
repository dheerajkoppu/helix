import type { Metadata } from "next";

import { ExternalLink } from "@/components/data/external-link";
import { TextLink } from "@/components/data/text-link";
import { EvidenceBadge } from "@/components/evidence/evidence-badge";
import { StructureOriginTag } from "@/components/evidence/structure-origin-tag";
import { Page, PageBody, PageHeader, PageSection, Plate } from "@/components/shell/page";
import { EVIDENCE_DISPLAY_ORDER, EVIDENCE_META } from "@/lib/evidence";
import { site } from "@/lib/site";
import { STRUCTURE_ORIGIN_META, STRUCTURE_ORIGIN_ORDER } from "@/lib/structure-origin";

export const metadata: Metadata = { title: "About" };

const BORDER_MEANING = {
  solid: "Asserted by an external source",
  dashed: "Computed by a model or tool",
  dotted: "Authored inside OrphaFold",
} as const;

const SOURCES = [
  "UniProt",
  "ClinVar",
  "NCBI",
  "RCSB PDB",
  "AlphaFold DB",
  "Orphanet (Orphadata)",
  "Open Targets",
  "Ensembl",
  "PubMed and Europe PMC",
];

const LIMITS = [
  "A predicted structural difference is a computational prediction. It is never presented as experimentally established.",
  "A predicted affinity is a model output for comparing candidate molecules. It is never a clinical recommendation.",
  "pLDDT describes local confidence only. It says nothing about how domains or chains are placed relative to each other.",
  "Low model confidence means disorder or too little information. It does not mean a variant misfolds the protein.",
  "When a source has no record, the page says so. Fields without a source read Unknown or No source found.",
  "Scores from different sources are never combined into one number. Each source keeps its own measure of strength.",
];

export default function AboutPage() {
  return (
    <Page>
      <PageHeader
        kind="About"
        title="What OrphaFold is, and what it is not"
        description="An open research platform for rare genetic disease, starting with inborn errors of immunity. It follows one path: disease, gene, variant, protein, structural change, mechanism, candidate interventions, hypothesis. It is built for research and hypothesis generation. It does not diagnose and it does not recommend treatment."
      />
      <PageBody>
        <PageSection
          id="evidence"
          title="How statements are sourced"
          description="Biological facts come from databases and publications, with identifiers and retrieval dates. A language model is never the source of a fact. Every statement carries one of six evidence classes, each drawn with its own code, shape and border so it can be told apart without colour."
        >
          <Plate>
            <ul>
              {EVIDENCE_DISPLAY_ORDER.map((id) => {
                const meta = EVIDENCE_META[id];
                return (
                  <li
                    key={id}
                    className="grid items-baseline gap-x-4 gap-y-1 border-b border-border-subtle px-3 py-2 text-sm last:border-b-0 sm:grid-cols-[4.5rem_13rem_minmax(0,1fr)_14rem]"
                  >
                    <EvidenceBadge evidenceClass={id} className="justify-self-start" />
                    <span className="font-medium text-foreground">{meta.label}</span>
                    <span className="text-muted-foreground">{meta.description}</span>
                    <span className="text-xs text-subtle-foreground">{BORDER_MEANING[meta.border]}</span>
                  </li>
                );
              })}
            </ul>
          </Plate>
        </PageSection>

        <PageSection
          id="structures"
          title="Three kinds of structure"
          description="A structure measured in a laboratory, a prediction published by someone else and a prediction generated here are different things. They are labelled wherever they appear and are never presented as equivalent."
        >
          <Plate>
            <ul>
              {STRUCTURE_ORIGIN_ORDER.map((id) => {
                const meta = STRUCTURE_ORIGIN_META[id];
                return (
                  <li
                    key={id}
                    className="grid items-baseline gap-x-4 gap-y-1 border-b border-border-subtle px-3 py-2 text-sm last:border-b-0 sm:grid-cols-[4.5rem_17rem_minmax(0,1fr)]"
                  >
                    <StructureOriginTag origin={id} className="justify-self-start" />
                    <span className="font-medium text-foreground">{meta.label}</span>
                    <span className="text-muted-foreground">Shown as: {meta.caption}.</span>
                  </li>
                );
              })}
            </ul>
          </Plate>
          <p className="mt-3 max-w-[68ch] text-sm text-muted-foreground">
            Every prediction shows its confidence, the model and version that produced it, the date, its inputs and its
            known limits. Each computational run produces a downloadable manifest of its inputs, model, version and
            outputs.
          </p>
        </PageSection>

        <PageSection id="limitations" title="Limits that always apply">
          <ul className="max-w-[72ch] text-sm">
            {LIMITS.map((limit) => (
              <li key={limit} className="relative border-b border-border-subtle py-2 pl-4 text-foreground last:border-b-0">
                <span aria-hidden className="absolute top-[0.95rem] left-0 h-px w-2 bg-foreground" />
                {limit}
              </li>
            ))}
          </ul>
        </PageSection>

        <PageSection
          id="sources"
          title="Data sources"
          description="Each source is read through its own adapter, cached, and shown with its release and retrieval date. A page still renders when one source is down and says which one."
        >
          <ul className="flex flex-wrap gap-1.5 text-xs">
            {SOURCES.map((source) => (
              <li key={source} className="rounded-xs border border-border px-1.5 py-0.5 text-foreground">
                {source}
              </li>
            ))}
          </ul>
          <p className="mt-3 max-w-[68ch] text-sm text-muted-foreground">
            Disease and gene membership follows the IUIS classification of inborn errors of immunity (2024 update, Poli
            et al., J Hum Immun 2025,{" "}
            <ExternalLink href="https://doi.org/10.70962/jhi.20250003">doi:10.70962/jhi.20250003</ExternalLink>). Only its
            identifiers, codes and short labels are used. Descriptions and phenotypes come from openly licensed sources.
            Sources restricted to non-commercial use are switched off unless an installation enables them.
          </p>
        </PageSection>

        <PageSection
          id="open-source"
          title="Open source"
          description={`OrphaFold is licensed ${site.license}. Anyone can inspect how a conclusion was produced, reproduce an analysis, download results, run models locally, add a model provider or contribute a data source.`}
        >
          <ul className="flex flex-col gap-1.5 text-sm">
            <li>
              {site.repositoryUrl ? (
                <ExternalLink href={site.repositoryUrl}>Source repository</ExternalLink>
              ) : (
                <span className="text-muted-foreground">
                  This installation does not link a source repository. Set{" "}
                  <span className="font-mono text-foreground">NEXT_PUBLIC_REPOSITORY_URL</span> to add the link.
                </span>
              )}
            </li>
            <li>
              <TextLink href="/models">Model providers</TextLink>
            </li>
            <li>
              <TextLink href="/docs">Documentation</TextLink>
            </li>
          </ul>
        </PageSection>
      </PageBody>
    </Page>
  );
}
