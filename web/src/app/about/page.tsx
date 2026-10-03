import { ChevronRightIcon } from "lucide-react";
import type { Metadata } from "next";

import { ExternalLink } from "@/components/data/external-link";
import { TextLink } from "@/components/data/text-link";
import { EvidenceBadge } from "@/components/evidence/evidence-badge";
import { StructureOriginTag } from "@/components/evidence/structure-origin-tag";
import {
  Page,
  PageBody,
  PageHeader,
  PageSection,
  Plate,
} from "@/components/shell/page";
import { EVIDENCE_DISPLAY_ORDER, EVIDENCE_META } from "@/lib/evidence";
import { site } from "@/lib/site";
import {
  STRUCTURE_ORIGIN_META,
  STRUCTURE_ORIGIN_ORDER,
} from "@/lib/structure-origin";

export const metadata: Metadata = { title: "About" };

const BORDER_MEANING = {
  solid: "Asserted by an external source",
  dashed: "Computed by a model or tool",
  dotted: "Authored inside OrphaFold",
} as const;

const STEPS = [
  {
    title: "Understand the mutation.",
    body: "Disease, gene and variants, each with its source.",
  },
  {
    title: "See the structure.",
    body: "Experimental and predicted structures in 3D, with confidence.",
  },
  {
    title: "Explore what might restore function.",
    body: "Compare models, weigh mechanisms and compounds, record a hypothesis.",
  },
];

const METHOD = [
  {
    step: "Retrieve",
    text: "Each source is read through its own adapter with its own timeout. The answer is stored with the source release, request URL, retrieval time, record ID, licence and a hash of the response.",
  },
  {
    step: "Align",
    text: "Genes are HGNC symbols, proteins are UniProt accessions, and every residue is numbered as in the UniProt canonical sequence. Experimental structures are mapped onto that numbering through SIFTS.",
  },
  {
    step: "Classify",
    text: "Every statement receives one of six evidence classes from a fixed table of source and record type. A record the table does not cover is left out.",
  },
  {
    step: "Compute",
    text: "Models run as jobs, apart from page requests. Each job writes a manifest of its inputs, model, version, parameters and the hash of every output file.",
  },
  {
    step: "Record",
    text: "Projects pin evidence, structures, runs and hypotheses. A snapshot is immutable and addressed by the hash of its content, and a fork records the snapshot it started from.",
  },
];

const SOURCE_GROUPS = [
  {
    label: "Classification",
    sources: [
      "IUIS 2024",
      "HGNC",
      "GenCC",
      "ClinGen",
      "Mondo",
      "Orphadata",
      "HPO",
    ],
  },
  { label: "Gene and protein", sources: ["UniProtKB", "Ensembl", "InterPro"] },
  {
    label: "Variants",
    sources: [
      "ClinVar",
      "gnomAD",
      "Ensembl VEP",
      "ProtVar",
      "AlphaMissense",
      "MaveDB",
    ],
  },
  {
    label: "Structures",
    sources: [
      "RCSB PDB",
      "PDBe SIFTS",
      "AlphaFold DB",
      "3D-Beacons",
      "ESM Atlas",
      "PrankWeb",
    ],
  },
  {
    label: "Interactions and pathways",
    sources: ["IntAct", "STRING", "Reactome", "Open Targets", "Monarch"],
  },
  { label: "Compounds", sources: ["ChEMBL", "PubChem", "UniChem"] },
  { label: "Literature", sources: ["Europe PMC"] },
];

const LIMITS = [
  "A predicted structure is a computational prediction. It is never presented as experimentally established.",
  "Structure predictors are not validated for single-residue substitutions. A variant model that matches the reference carries no information about whether the variant is tolerated.",
  "pLDDT describes local confidence only. It says nothing about how domains or chains are placed relative to each other.",
  "Low model confidence means disorder or too little information. It does not mean a variant misfolds the protein.",
  "A predicted affinity is a model output for comparing candidate molecules. It is never a clinical recommendation.",
  "A pathogenicity prediction is not a clinical classification. Classifications come from ClinVar with their review status.",
  "When a source has no record, the page says so. Fields without a source read Unknown or No source found.",
  "Scores from different sources are never combined into one number. Each source keeps its own measure of strength.",
];

/** Detail that stays out of the default view: closed until the reader opens it. */
function Disclosure({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details id={id} className="group border-b border-border-subtle">
      <summary className="flex cursor-pointer list-none items-center gap-2 py-3 text-base font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon
          aria-hidden
          className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90"
        />
        {title}
      </summary>
      <div className="pb-5">{children}</div>
    </details>
  );
}

export default function AboutPage() {
  return (
    <Page>
      <PageHeader
        title="About OrphaFold"
        description="Open research software for rare genetic disease. Not for clinical use."
      />
      <PageBody>
        <PageSection id="mission" title="Mission">
          <p className="max-w-[60ch] text-lg text-foreground">
            Public rare-disease data on one path, every statement traced to its
            source.
          </p>
        </PageSection>

        <PageSection id="journey" title="What you can do">
          <ol className="grid border-t border-border-strong sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li
                key={step.title}
                className="relative border-b border-border-subtle py-4 pr-6 before:absolute before:top-0 before:left-0 before:h-2 before:w-px before:bg-border-strong sm:border-b-0 sm:pl-3"
              >
                <span className="tabular font-mono text-2xs text-subtle-foreground">
                  {index + 1}
                </span>
                <h3 className="mt-1 text-sm font-medium text-foreground">
                  {step.title}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </PageSection>

        <PageSection
          id="evidence"
          title="Six evidence classes"
          actions={<TextLink href="/docs/evidence-classes">Details</TextLink>}
        >
          <Plate>
            <ul>
              {EVIDENCE_DISPLAY_ORDER.map((id) => {
                const meta = EVIDENCE_META[id];
                return (
                  <li
                    key={id}
                    className="grid items-baseline gap-x-4 gap-y-1 border-b border-border-subtle px-3 py-2 text-sm last:border-b-0 sm:grid-cols-[10rem_13rem_minmax(0,1fr)_14rem]"
                  >
                    <EvidenceBadge
                      evidenceClass={id}
                      className="justify-self-start"
                    />
                    <span className="font-medium text-foreground">
                      {meta.label}
                    </span>
                    <span className="text-muted-foreground">
                      {meta.description}
                    </span>
                    <span className="text-xs text-subtle-foreground">
                      {BORDER_MEANING[meta.border]}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Plate>
        </PageSection>

        <PageSection
          id="structures"
          title="Three kinds of structure"
          actions={<TextLink href="/docs/reproducibility">Details</TextLink>}
        >
          <Plate>
            <ul>
              {STRUCTURE_ORIGIN_ORDER.map((id) => {
                const meta = STRUCTURE_ORIGIN_META[id];
                return (
                  <li
                    key={id}
                    className="grid items-baseline gap-x-4 gap-y-1 border-b border-border-subtle px-3 py-2 text-sm last:border-b-0 sm:grid-cols-[10rem_17rem_minmax(0,1fr)]"
                  >
                    <StructureOriginTag
                      origin={id}
                      className="justify-self-start"
                    />
                    <span className="font-medium text-foreground">
                      {meta.label}
                    </span>
                    <span className="text-muted-foreground">
                      Shown as: {meta.caption}.
                    </span>
                  </li>
                );
              })}
            </ul>
          </Plate>
        </PageSection>

        <PageSection title="More">
          <div className="border-t border-border-subtle">
          <Disclosure id="why" title="Why it exists">
          <div className="flex max-w-[72ch] flex-col gap-3 text-base leading-6 text-foreground">
            <p>
              Most rare diseases have a known gene and no therapy. The data
              needed to reason about one of them is public but scattered across
              clinical databases, protein resources, structure archives and
              prediction services, each with its own identifiers, numbering and
              licence.
            </p>
            <p>
              OrphaFold puts those sources on one path and one residue
              numbering: disease, gene, variant, protein, structural change,
              mechanism, candidate interventions, hypothesis. At each step it
              shows where a statement comes from and what kind of statement it
              is, so that a hypothesis can be traced back to the records and
              runs it rests on.
            </p>
            <p>
              A rare disease affects few people, so its proteins get little
              attention, and what is known sits in a dozen public databases.
              Every statement carries its source and evidence class; every
              prediction carries its model, version, inputs and confidence, and
              is labelled as a prediction. Analyses can be reproduced and run
              locally. The code is licensed {site.license}.
            </p>
          </div>
          </Disclosure>
          <Disclosure id="methodology" title="Methodology">
          <p className="mb-3 max-w-[72ch] text-sm text-muted-foreground">
            Biological facts come from databases and publications, with identifiers and retrieval dates. A language model is never the source of a fact.
          </p>
          <ol className="max-w-[80ch] border-t border-border-subtle text-base">
            {METHOD.map((item, index) => (
              <li
                key={item.step}
                className="grid items-baseline gap-x-4 gap-y-0.5 border-b border-border-subtle py-2.5 sm:grid-cols-[1.5rem_6rem_minmax(0,1fr)]"
              >
                <span className="tabular font-mono text-xs text-subtle-foreground">
                  {index + 1}
                </span>
                <span className="font-medium text-foreground">{item.step}</span>
                <span className="leading-6 text-muted-foreground">
                  {item.text}
                </span>
              </li>
            ))}
          </ol>
          </Disclosure>
          <Disclosure id="limitations" title="Limits that always apply">
          <p className="mb-3 max-w-[72ch] text-sm text-muted-foreground">
            <TextLink href="/docs/limitations">Full list with sources</TextLink>
          </p>
          <ul className="max-w-[76ch] text-base">
            {LIMITS.map((limit) => (
              <li
                key={limit}
                className="relative border-b border-border-subtle py-2 pl-4 leading-6 text-foreground last:border-b-0"
              >
                <span
                  aria-hidden
                  className="absolute top-[1.1rem] left-0 h-px w-2 bg-foreground"
                />
                {limit}
              </li>
            ))}
          </ul>
          </Disclosure>

          <Disclosure id="sources" title="Data sources">
          <p className="mb-3 max-w-[72ch] text-sm text-muted-foreground">
            Each source is read through its own adapter, cached, and shown with its release and retrieval date. A page still renders when one source is down and says which one.{" "}<TextLink href="/docs/data-sources">Sources and licences</TextLink>
          </p>
          <dl className="max-w-[80ch] border-t border-border-subtle text-sm">
            {SOURCE_GROUPS.map((group) => (
              <div
                key={group.label}
                className="grid items-baseline gap-x-4 gap-y-1 border-b border-border-subtle py-2 sm:grid-cols-[12rem_minmax(0,1fr)]"
              >
                <dt className="text-muted-foreground">{group.label}</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {group.sources.map((source) => (
                    <span
                      key={source}
                      className="rounded-xs border border-border px-1.5 py-0.5 text-xs text-foreground"
                    >
                      {source}
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 max-w-[72ch] text-sm text-muted-foreground">
            Disease and gene membership follows the IUIS classification of
            inborn errors of immunity (2024 update, Poli et al., J Hum Immun
            2025,{" "}
            <ExternalLink href="https://doi.org/10.70962/jhi.20250003">
              doi:10.70962/jhi.20250003
            </ExternalLink>
            ), published under CC BY-ND 4.0. Only its identifiers, codes and
            short labels are stored; the clinical free-text columns of the
            published tables are never extracted, stored or displayed.
            Descriptions and phenotypes come from Orphadata, Mondo and HPO.
            Sources restricted to non-commercial use are switched off unless an
            installation enables them.
          </p>
          </Disclosure>

          <Disclosure id="open-source" title="Openness">
          <p className="mb-3 max-w-[72ch] text-sm text-muted-foreground">
            {`The source code is licensed ${site.license}. Data keeps the licence of its source, and model outputs keep the terms of the model that produced them.`}
          </p>
          <ul className="max-w-[76ch] border-t border-border-subtle text-base">
            <li className="grid items-baseline gap-x-4 gap-y-0.5 border-b border-border-subtle py-2.5 sm:grid-cols-[12rem_minmax(0,1fr)]">
              <span className="font-medium text-foreground">Inspect</span>
              <span className="text-muted-foreground">
                Every statement opens its source record. Every run has a
                downloadable manifest.
              </span>
            </li>
            <li className="grid items-baseline gap-x-4 gap-y-0.5 border-b border-border-subtle py-2.5 sm:grid-cols-[12rem_minmax(0,1fr)]">
              <span className="font-medium text-foreground">Reproduce</span>
              <span className="text-muted-foreground">
                Projects export as JSON, a Markdown report and an archive with
                the manifests of their runs.
              </span>
            </li>
            <li className="grid items-baseline gap-x-4 gap-y-0.5 border-b border-border-subtle py-2.5 sm:grid-cols-[12rem_minmax(0,1fr)]">
              <span className="font-medium text-foreground">Run locally</span>
              <span className="text-muted-foreground">
                Two commands, no database, queue, GPU or key.{" "}
                <TextLink href="/docs/getting-started">
                  Getting started
                </TextLink>
              </span>
            </li>
            <li className="grid items-baseline gap-x-4 gap-y-0.5 border-b border-border-subtle py-2.5 sm:grid-cols-[12rem_minmax(0,1fr)]">
              <span className="font-medium text-foreground">Extend</span>
              <span className="text-muted-foreground">
                A data source or a model is one new file.{" "}
                <TextLink href="/docs/adding-a-model">Adding a model</TextLink>
                {" · "}
                <TextLink href="/models">Model providers</TextLink>
              </span>
            </li>
            <li className="grid items-baseline gap-x-4 gap-y-0.5 border-b border-border-subtle py-2.5 sm:grid-cols-[12rem_minmax(0,1fr)]">
              <span className="font-medium text-foreground">Source</span>
              <span className="text-muted-foreground">
                {site.repositoryUrl ? (
                  <ExternalLink href={site.repositoryUrl}>
                    Source repository
                  </ExternalLink>
                ) : (
                  <>
                    This installation does not link a source repository. Set{" "}
                    <span className="font-mono text-sm text-foreground">
                      NEXT_PUBLIC_REPOSITORY_URL
                    </span>{" "}
                    to add the link.
                  </>
                )}
              </span>
            </li>
          </ul>
          </Disclosure>
          </div>
        </PageSection>
      </PageBody>
    </Page>
  );
}
