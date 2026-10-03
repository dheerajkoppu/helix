"use client";

import { ArrowRightIcon } from "lucide-react";
import { useState } from "react";

import { ButtonLink } from "@/components/data/button-link";
import {
  DefinitionList,
  DefinitionRow,
  Unknown,
} from "@/components/data/definition-list";
import { ExternalLink } from "@/components/data/external-link";
import { SectionHeader } from "@/components/data/section-header";
import { TextLink } from "@/components/data/text-link";
import { EvidencePopover } from "@/components/evidence/evidence-popover";
import { SourceChip } from "@/components/evidence/source-chip";
import { LearnTerm } from "@/components/science/learn-term";
import { EmptyState } from "@/components/states/empty-state";
import { SourceUnavailable } from "@/components/states/source-unavailable";
import { Button } from "@/components/ui/button";
import type { Schema } from "@/lib/api/types";
import type { GlossaryTermId } from "@/lib/glossary";
import { routes } from "@/lib/ids";
import { findSource, type DiseaseResponse } from "@/lib/workspace-data";

import { apiEvidence, recordEvidence } from "./evidence";
import { RelationshipDiagram } from "./relationship-diagram";

type Treatment = Schema<"Treatment">;

const INHERITANCE_TERMS: Record<string, GlossaryTermId> = {
  XL: "x-linked",
  XLR: "x-linked",
  XLD: "x-linked",
  AR: "autosomal-recessive",
  AD: "autosomal-dominant",
};

const MECHANISMS: Record<string, { label: string; term: GlossaryTermId }> = {
  gain_of_function: { label: "Gain of function", term: "gain-of-function" },
  loss_of_function: { label: "Loss of function", term: "loss-of-function" },
  dominant_negative: { label: "Dominant negative", term: "dominant-negative" },
  haploinsufficiency: {
    label: "Haploinsufficiency",
    term: "haploinsufficiency",
  },
};

const ALIAS_LIMIT = 3;
const TARGET_DRUG_LIMIT = 6;

function Aliases({ aliases }: { aliases: string[] }) {
  const [expanded, setExpanded] = useState(false);
  if (aliases.length === 0) return null;
  const shown = expanded ? aliases : aliases.slice(0, ALIAS_LIMIT);
  return (
    <p className="max-w-3xl text-xs text-muted-foreground">
      <span className="text-subtle-foreground">Also known as </span>
      {shown.join("; ")}
      {aliases.length > ALIAS_LIMIT ? (
        <>
          {" "}
          <button
            type="button"
            className="cursor-pointer rounded-xs text-foreground underline decoration-border-strong decoration-1 underline-offset-[3px] hover:decoration-foreground"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded
              ? "show fewer"
              : `${aliases.length - ALIAS_LIMIT} more names`}
          </button>
        </>
      ) : null}
    </p>
  );
}

function Explanation({ disease }: { disease: DiseaseResponse }) {
  const [full, setFull] = useState(false);
  const { definition } = disease;
  if (!definition) {
    return (
      <EmptyState
        size="inline"
        className="px-0"
        title="No sourced definition"
        description="No definition is attached to this catalog entry. Helix does not write one in its place."
      />
    );
  }
  const evidence = recordEvidence(definition.source, definition.one_line);
  const hasMore = definition.text.trim() !== definition.one_line.trim();
  return (
    <div className="flex max-w-3xl flex-col gap-1.5">
      <p className="text-base text-foreground">
        {full ? definition.text : definition.one_line}
      </p>
      <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
        {evidence ? <EvidencePopover evidence={evidence} /> : null}
        <span>
          Definition as written by{" "}
          {definition.source?.name ?? "an unnamed source"}
        </span>
        {hasMore ? (
          <Button
            variant="ghost"
            size="xs"
            aria-expanded={full}
            onClick={() => setFull((value) => !value)}
          >
            {full ? "First sentence only" : "Full definition"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function StageCell({ treatment }: { treatment: Treatment }) {
  return treatment.clinical_stage_label ? (
    <span className="whitespace-nowrap">{treatment.clinical_stage_label}</span>
  ) : (
    <Unknown reason="Not stated" />
  );
}

function DrugName({ treatment }: { treatment: Treatment }) {
  const name = treatment.name ?? treatment.drug_id;
  return treatment.drug.href ? (
    <TextLink href={routes.compound(treatment.drug.id)}>{name}</TextLink>
  ) : (
    <ExternalLink href={treatment.source_url}>{name}</ExternalLink>
  );
}

function TreatmentRow({
  treatment,
  disease,
  children,
}: {
  treatment: Treatment;
  disease: DiseaseResponse;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1.3fr)_5rem_minmax(0,2fr)_auto] items-baseline gap-x-3 border-b border-border-subtle px-4 py-1.5 text-xs last:border-b-0">
      <div className="min-w-0">
        <div className="truncate font-medium">
          <DrugName treatment={treatment} />
        </div>
        <div className="truncate text-2xs text-muted-foreground">
          {treatment.modality && treatment.modality !== "Unknown" ? (
            treatment.modality
          ) : (
            <Unknown reason="Modality not stated" />
          )}
          <span className="font-mono"> · {treatment.drug_id}</span>
        </div>
      </div>
      <StageCell treatment={treatment} />
      <div className="min-w-0 text-muted-foreground">{children}</div>
      {treatment.evidence ? (
        <EvidencePopover
          size="compact"
          align="end"
          evidence={apiEvidence(treatment.evidence, {
            sources: disease.sources,
            statement:
              treatment.scope === "disease_indication"
                ? `${treatment.name ?? treatment.drug_id} is recorded with this disease as an indication.`
                : `${treatment.name ?? treatment.drug_id} is recorded as acting on the gene product.`,
          })}
        />
      ) : (
        <span />
      )}
    </div>
  );
}

function TreatmentHeader({ third }: { third: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1.3fr)_5rem_minmax(0,2fr)_auto] gap-x-3 border-b border-border-subtle bg-muted px-4 py-1 text-2xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
      <span>Drug</span>
      <span>Stage</span>
      <span>{third}</span>
      <span className="w-8 text-right">Src</span>
    </div>
  );
}

function Treatments({ disease }: { disease: DiseaseResponse }) {
  const openTargets = findSource(disease.sources, "open_targets");
  const failed =
    openTargets && !["ok", "empty", "partial"].includes(openTargets.state);
  const { treatments, treatment_total: total } = disease;

  return (
    <>
      <SectionHeader
        title="Treatment records"
        count={total}
        description="Drugs that Open Targets records with this disease as an indication. Clinical stage is the stage of that record, as the source states it."
      />
      {failed ? (
        <SourceUnavailable
          source={openTargets.name ?? "Open Targets Platform"}
          message={openTargets.message}
        />
      ) : total === null ? (
        <EmptyState
          size="inline"
          title="Treatment records were not looked up"
          description="Open Targets is queried by the mapped Mondo identifier, and this disease has none."
        />
      ) : treatments.length === 0 ? (
        <EmptyState
          size="inline"
          title="No drug is recorded with this disease as an indication"
          searched={["Open Targets Platform"]}
        />
      ) : (
        <div>
          <TreatmentHeader third="Clinical reports" />
          {treatments.map((treatment) => (
            <TreatmentRow
              key={treatment.drug_id}
              treatment={treatment}
              disease={disease}
            >
              {treatment.reports.length === 0 ? (
                <Unknown reason="No report listed" />
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {treatment.reports.slice(0, 3).map((report, index) => (
                    <li
                      key={report.id ?? index}
                      className="flex min-w-0 items-baseline gap-1.5"
                    >
                      {report.url ? (
                        <ExternalLink
                          href={report.url}
                          className="shrink-0 font-mono text-2xs uppercase"
                        >
                          {report.id?.startsWith("nct")
                            ? report.id
                            : (report.source ?? "Report")}
                        </ExternalLink>
                      ) : (
                        <span className="shrink-0 font-mono text-2xs uppercase">
                          {report.id ?? report.source}
                        </span>
                      )}
                      <span
                        className="truncate"
                        title={report.title ?? undefined}
                      >
                        {report.title}
                      </span>
                    </li>
                  ))}
                  {treatment.report_total > 3 ? (
                    <li className="text-2xs text-subtle-foreground">
                      {treatment.report_total - 3} more at the source
                    </li>
                  ) : null}
                </ul>
              )}
            </TreatmentRow>
          ))}
        </div>
      )}
    </>
  );
}

function TargetDrugs({ disease }: { disease: DiseaseResponse }) {
  const {
    protein,
    gene,
    target_drugs: drugs,
    target_drug_total: total,
  } = disease;
  if (!gene) return null;
  const subject = protein?.name ?? gene.symbol;
  return (
    <>
      <SectionHeader
        title={`Drugs acting on ${gene.symbol}`}
        count={total}
        description={`Recorded against ${subject} for any indication. A row here is a record about the protein, not about this disease.`}
        actions={
          protein ? (
            <ButtonLink
              href={routes.interventions(protein.accession)}
              variant="ghost"
              size="sm"
            >
              Intervention stage
              <ArrowRightIcon data-icon="inline-end" />
            </ButtonLink>
          ) : null
        }
      />
      {total === null ? (
        <EmptyState
          size="inline"
          title="Target drugs were not looked up"
          description="Open Targets did not return drug records for this gene."
        />
      ) : drugs.length === 0 ? (
        <EmptyState
          size="inline"
          title={`No drug is recorded as acting on ${subject}`}
          searched={["Open Targets Platform"]}
        />
      ) : (
        <div>
          <TreatmentHeader third="Mechanism · recorded indications" />
          {drugs.slice(0, TARGET_DRUG_LIMIT).map((treatment) => {
            const mechanism = (
              treatment.mechanisms.find(
                (entry) => protein && entry.target_name === protein.name,
              ) ?? treatment.mechanisms[0]
            )?.mechanism;
            const indications = treatment.indications
              .map((entry) => entry.name ?? entry.from_source)
              .filter(Boolean);
            return (
              <TreatmentRow
                key={treatment.drug_id}
                treatment={treatment}
                disease={disease}
              >
                <div className="truncate text-foreground">
                  {mechanism ?? <Unknown reason="Mechanism not stated" />}
                </div>
                <div
                  className="truncate text-2xs"
                  title={indications.join("; ")}
                >
                  {indications.length > 0
                    ? `${indications.slice(0, 2).join("; ")}${indications.length > 2 ? `; ${indications.length - 2} more` : ""}`
                    : "No indication listed"}
                </div>
              </TreatmentRow>
            );
          })}
          {total > TARGET_DRUG_LIMIT && protein ? (
            <div className="border-t border-border-subtle px-4 py-2 text-xs text-muted-foreground">
              {TARGET_DRUG_LIMIT} of {total} shown.{" "}
              <TextLink href={routes.interventions(protein.accession)}>
                All {total} on the intervention stage
              </TextLink>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}

export interface DiseaseRecordProps {
  disease: DiseaseResponse;
  stageHref: (path: string) => string;
}

/** The instrument of the disease stage: what the disease is, where it sits, what is recorded for it. */
export function DiseaseRecord({ disease, stageHref }: DiseaseRecordProps) {
  const { gene, protein, inheritance, category, graph } = disease;
  const iuis = recordEvidence(inheritance.source);
  const causedBy = graph.edges.find((edge) => edge.type === "caused_by");

  return (
    <div className="flex flex-col">
      <header className="flex flex-col gap-3 border-b border-border px-4 py-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-medium text-balance text-foreground">
            {disease.name}
          </h1>
          <Aliases aliases={disease.aliases} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {disease.xrefs.length > 0 ? (
            disease.xrefs.map((xref) => (
              <SourceChip
                key={xref.id}
                source={xref.database}
                id={xref.id.replace(/^[A-Za-z]+:/, "")}
                href={xref.url}
              />
            ))
          ) : (
            <span className="text-xs text-subtle-foreground">
              No mapped identifier in Mondo, Orphanet or OMIM
            </span>
          )}
        </div>
        <Explanation disease={disease} />
      </header>

      <DefinitionList termWidth="8.5rem" className="border-b border-border">
        <DefinitionRow term="Affected gene" className="px-4">
          {gene ? (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <TextLink
                href={stageHref(routes.gene(gene.symbol))}
                className="font-medium"
                translate="no"
              >
                {gene.symbol}
              </TextLink>
              <span className="text-muted-foreground">
                {[gene.name, gene.chromosome ? `chr ${gene.chromosome}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              {causedBy?.evidence.map((evidence) => (
                <EvidencePopover
                  key={evidence.id}
                  size="compact"
                  evidence={apiEvidence(evidence, {
                    sources: disease.sources,
                    statement: `${disease.name} is caused by variants in ${gene.symbol}.`,
                  })}
                />
              ))}
              {gene.other_disease_count > 0 ? (
                <span className="text-2xs text-subtle-foreground">
                  {gene.other_disease_count} other catalog{" "}
                  {gene.other_disease_count === 1 ? "disease" : "diseases"} for
                  this gene
                </span>
              ) : null}
            </span>
          ) : (
            <Unknown reason="No gene named in the catalog entry (IUIS 2024)" />
          )}
        </DefinitionRow>
        <DefinitionRow term="Protein" className="px-4">
          {protein ? (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <TextLink
                href={stageHref(routes.protein(protein.accession))}
                className="font-mono"
                translate="no"
              >
                {protein.accession}
              </TextLink>
              <span className="text-muted-foreground">
                {[
                  protein.name,
                  protein.length ? `${protein.length} aa` : null,
                  protein.family,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              {recordEvidence(protein.source) ? (
                <EvidencePopover
                  size="compact"
                  evidence={recordEvidence(protein.source)!}
                />
              ) : null}
            </span>
          ) : (
            <Unknown reason={gene ? "No UniProt entry mapped" : "No gene"} />
          )}
        </DefinitionRow>
        <DefinitionRow term="Inheritance" className="px-4">
          {inheritance.codes.length > 0 || inheritance.raw ? (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {inheritance.terms.length > 0
                ? inheritance.terms.map((term, index) => {
                    const glossary =
                      INHERITANCE_TERMS[inheritance.codes[index] ?? ""];
                    const label = term.label ?? term.id;
                    return (
                      <span key={term.id}>
                        {glossary ? (
                          <LearnTerm term={glossary}>{label}</LearnTerm>
                        ) : (
                          label
                        )}
                      </span>
                    );
                  })
                : null}
              {inheritance.raw &&
              !inheritance.terms.some(
                (term) => term.label === inheritance.raw,
              ) ? (
                <span className="font-mono text-2xs text-muted-foreground">
                  {inheritance.raw}
                </span>
              ) : null}
              {iuis ? <EvidencePopover size="compact" evidence={iuis} /> : null}
            </span>
          ) : (
            <Unknown reason="Not stated in the IUIS classification" />
          )}
        </DefinitionRow>
        <DefinitionRow term="Mechanism" className="px-4">
          {disease.mechanism.length > 0 ? (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {disease.mechanism.map((code) => {
                const known = MECHANISMS[code];
                return (
                  <span key={code}>
                    {known ? (
                      <LearnTerm term={known.term}>{known.label}</LearnTerm>
                    ) : (
                      code.replace(/_/g, " ")
                    )}
                  </span>
                );
              })}
              {iuis ? <EvidencePopover size="compact" evidence={iuis} /> : null}
            </span>
          ) : (
            <Unknown reason="None recorded in the catalog entry (IUIS 2024)" />
          )}
        </DefinitionRow>
        <DefinitionRow term="IUIS category" className="px-4">
          {category ? (
            <span className="flex flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-x-2">
                {category.table !== null ? (
                  <span className="font-mono text-2xs text-muted-foreground">
                    Table {category.table}
                  </span>
                ) : null}
                <span>{category.name ?? category.id}</span>
                {iuis ? (
                  <EvidencePopover size="compact" evidence={iuis} />
                ) : null}
              </span>
              {category.subcategory_name ? (
                <span className="text-muted-foreground">
                  {category.subcategory_name}
                </span>
              ) : null}
            </span>
          ) : (
            <Unknown reason="Not classified" />
          )}
        </DefinitionRow>
        {disease.is_phenocopy ? (
          <DefinitionRow term="Phenocopy" className="px-4">
            <span className="flex flex-wrap items-center gap-x-2">
              Listed by IUIS as a phenocopy of an inborn error of immunity
              {iuis ? <EvidencePopover size="compact" evidence={iuis} /> : null}
            </span>
          </DefinitionRow>
        ) : null}
      </DefinitionList>

      <SectionHeader
        title="Relationships"
        description="Where the disease sits biologically. Each line is one source record; open its badge to read it."
        actions={
          gene ? (
            <ButtonLink
              href={stageHref(routes.gene(gene.symbol))}
              variant="ghost"
              size="sm"
            >
              {gene.symbol} variants
              <ArrowRightIcon data-icon="inline-end" />
            </ButtonLink>
          ) : null
        }
      />
      <div className="border-b border-border px-4 py-4">
        <RelationshipDiagram
          graph={graph}
          gene={gene}
          protein={protein}
          sources={disease.sources}
          stageHref={stageHref}
        />
      </div>

      <Treatments disease={disease} />
      <div className="border-t border-border">
        <TargetDrugs disease={disease} />
      </div>
    </div>
  );
}
