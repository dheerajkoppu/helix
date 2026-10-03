"use client";

import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { useState } from "react";

import { ExternalLink } from "@/components/data/external-link";
import { TextLink } from "@/components/data/text-link";
import { LearnTerm } from "@/components/science/learn-term";
import { Button } from "@/components/ui/button";
import {
  EvidenceMark,
  provenanceEvidence,
  recordSourceEvidence,
} from "@/components/variant/evidence";
import type { GlossaryTermId } from "@/lib/glossary";
import { useIsDesktop } from "@/hooks/use-media-query";
import { routes } from "@/lib/ids";
import type { GeneResponse } from "@/lib/workspace-data";

const INHERITANCE_TERM: Record<string, GlossaryTermId> = {
  XL: "x-linked",
  AR: "autosomal-recessive",
  AD: "autosomal-dominant",
};

function Row({
  term,
  children,
}: {
  term: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="col-span-2 grid grid-cols-subgrid items-baseline py-[3px]">
      <dt className="text-2xs tracking-[0.02em] text-subtle-foreground uppercase">
        {term}
      </dt>
      <dd className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-foreground">
        {children}
      </dd>
    </div>
  );
}

const missing = <span className="text-subtle-foreground">Unknown</span>;

/** The gene record in five lines above the structure: identifiers, transcript, diseases, protein. */
export function GeneHeader({ gene }: { gene: GeneResponse }) {
  const isDesktop = useIsDesktop();
  // Phones start collapsed so the structure keeps most of the zone.
  const [chosen, setOpen] = useState<boolean | null>(null);
  const open = chosen ?? isDesktop;
  const { location, protein } = gene;
  const transcript = gene.transcripts.mane_select;
  const hgncSource = gene.record_sources.find((source) =>
    source.source_id.toLowerCase().includes("hgnc"),
  );
  const functionText = protein?.function[0];

  return (
    <div className="shrink-0 border-b border-border bg-background px-3 py-1.5 text-xs">
      <div className="flex items-baseline gap-2">
        <h1 className="font-mono text-sm font-semibold text-foreground">
          {gene.symbol}
        </h1>
        <span className="min-w-0 truncate text-muted-foreground">
          {gene.name ?? "Name unknown"}
        </span>
        {gene.locus_type ? (
          <span className="hidden shrink-0 text-2xs text-subtle-foreground sm:inline">
            {gene.locus_type}
          </span>
        ) : null}
        <Button
          variant="ghost"
          size="icon-xs"
          className="ml-auto self-center"
          aria-label={open ? "Collapse gene record" : "Expand gene record"}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronUpIcon /> : <ChevronDownIcon />}
        </Button>
      </div>
      {open ? (
        <dl className="mt-0.5 grid grid-cols-[4.75rem_minmax(0,1fr)]">
          <Row term="IDs">
            {gene.hgnc_id ? (
              <span className="inline-flex items-baseline gap-1">
                {hgncSource ? (
                  <EvidenceMark
                    evidence={recordSourceEvidence(
                      hgncSource,
                      "curated_database",
                      `${gene.symbol} is the approved symbol of ${gene.hgnc_id}.`,
                    )}
                    className="self-center"
                  />
                ) : null}
                <ExternalLink
                  href={`https://www.genenames.org/data/gene-symbol-report/#!/hgnc_id/${gene.hgnc_id}`}
                  className="font-mono"
                >
                  {gene.hgnc_id}
                </ExternalLink>
              </span>
            ) : null}
            {gene.ensembl_gene_id ? (
              <ExternalLink
                href={`https://www.ensembl.org/Homo_sapiens/Gene/Summary?g=${gene.ensembl_gene_id}`}
                className="font-mono"
              >
                {gene.ensembl_gene_id}
                {gene.ensembl_gene_version
                  ? `.${gene.ensembl_gene_version}`
                  : ""}
              </ExternalLink>
            ) : null}
            {gene.ncbi_gene_id ? (
              <ExternalLink
                href={`https://www.ncbi.nlm.nih.gov/gene/${gene.ncbi_gene_id}`}
                className="font-mono"
              >
                NCBI:{gene.ncbi_gene_id}
              </ExternalLink>
            ) : null}
            {gene.uniprot_accession ? (
              <TextLink
                href={routes.protein(gene.uniprot_accession)}
                className="font-mono"
              >
                {gene.uniprot_accession}
              </TextLink>
            ) : null}
          </Row>
          <Row term="Transcript">
            {transcript ? (
              <>
                <EvidenceMark
                  evidence={transcript.evidence}
                  className="self-center"
                />
                <span className="text-muted-foreground">MANE Select</span>
                {transcript.refseq_transcript ? (
                  <span className="font-mono">
                    {transcript.refseq_transcript}
                  </span>
                ) : null}
                {transcript.url ? (
                  <ExternalLink href={transcript.url} className="font-mono">
                    {transcript.id}
                    {transcript.version ? `.${transcript.version}` : ""}
                  </ExternalLink>
                ) : (
                  <span className="font-mono">{transcript.id}</span>
                )}
                <span className="tabular font-mono text-muted-foreground">
                  {[
                    transcript.exon_count
                      ? `${transcript.exon_count} exons`
                      : null,
                    transcript.protein_length
                      ? `${transcript.protein_length} aa`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </span>
              </>
            ) : (
              <span className="text-subtle-foreground">
                No MANE Select transcript found
                {gene.transcripts.total
                  ? ` (${gene.transcripts.total} transcripts in Ensembl)`
                  : ""}
              </span>
            )}
            {location?.chromosome && location.start && location.end ? (
              <span className="tabular font-mono text-muted-foreground">
                chr{location.chromosome}:
                {location.start.toLocaleString("en-US")}-
                {location.end.toLocaleString("en-US")}
                {location.strand
                  ? ` (${location.strand > 0 ? "+" : "-"})`
                  : ""}{" "}
                {location.assembly}
              </span>
            ) : null}
          </Row>
          <Row term="Diseases">
            {gene.diseases.length > 0 ? (
              gene.diseases.slice(0, 4).map((disease) => (
                <span
                  key={disease.id}
                  className="inline-flex min-w-0 items-baseline gap-1.5"
                >
                  {disease.sources[0] ? (
                    <EvidenceMark
                      evidence={recordSourceEvidence(
                        disease.sources[0],
                        "curated_database",
                        `${disease.name}${disease.inheritance_raw ? `, inheritance ${disease.inheritance_raw}` : ""}`,
                      )}
                      className="self-center"
                    />
                  ) : null}
                  <TextLink href={routes.disease(disease.id)}>
                    {disease.name}
                  </TextLink>
                  {disease.inheritance_codes.map((code) => (
                    <span
                      key={code}
                      className="font-mono text-2xs text-muted-foreground"
                    >
                      {INHERITANCE_TERM[code] ? (
                        <LearnTerm term={INHERITANCE_TERM[code]}>
                          {code}
                        </LearnTerm>
                      ) : (
                        code
                      )}
                    </span>
                  ))}
                </span>
              ))
            ) : (
              <span className="text-subtle-foreground">
                No disease in the seeded catalog
              </span>
            )}
            {gene.diseases.length > 4 ? (
              <span className="text-2xs text-muted-foreground">
                and {gene.diseases.length - 4} more
              </span>
            ) : null}
          </Row>
          <Row term="Protein">
            {protein ? (
              <>
                {protein.provenance ? (
                  <EvidenceMark
                    evidence={provenanceEvidence(
                      protein.provenance,
                      "curated_database",
                      `${protein.name ?? protein.accession}, ${protein.length ?? "unknown"} residues`,
                    )}
                    className="self-center"
                  />
                ) : null}
                <span>{protein.name ?? protein.accession}</span>
                <span className="tabular font-mono text-muted-foreground">
                  {[
                    protein.length ? `${protein.length} aa` : null,
                    protein.mass_da
                      ? `${(protein.mass_da / 1000).toFixed(1)} kDa`
                      : null,
                    protein.isoform_count
                      ? `${protein.isoform_count} isoform${protein.isoform_count === 1 ? "" : "s"}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </span>
                {protein.reviewed === true ? (
                  <span className="text-2xs text-muted-foreground">
                    Swiss-Prot reviewed
                  </span>
                ) : null}
              </>
            ) : (
              missing
            )}
          </Row>
          {functionText ? (
            <Row term="Function">
              <span className="inline-flex items-baseline gap-1.5">
                <EvidenceMark
                  evidence={functionText.evidence[0]}
                  className="shrink-0 self-start"
                />
                <span
                  className="line-clamp-1 text-muted-foreground"
                  title={functionText.text}
                >
                  {functionText.text}
                </span>
              </span>
            </Row>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}
