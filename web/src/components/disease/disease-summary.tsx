"use client";

import {
  DefinitionList,
  DefinitionRow,
  Unknown,
} from "@/components/data/definition-list";
import { SectionHeader } from "@/components/data/section-header";
import { TextLink } from "@/components/data/text-link";
import { EvidencePopover } from "@/components/evidence/evidence-popover";
import { LearnTerm } from "@/components/science/learn-term";
import { Button } from "@/components/ui/button";
import type { Schema } from "@/lib/api/types";
import { formatCount } from "@/lib/format";
import type { GlossaryTermId } from "@/lib/glossary";
import { routes } from "@/lib/ids";
import type { DiseaseResponse } from "@/lib/workspace-data";
import { cn } from "cn";

import { apiEvidence, recordEvidence } from "./evidence";

type Phenotype = Schema<"DiseasePhenotype">;

const INHERITANCE_TERMS: Record<string, GlossaryTermId> = {
  XL: "x-linked",
  XLR: "x-linked",
  XLD: "x-linked",
  AR: "autosomal-recessive",
  AD: "autosomal-dominant",
};

/** The counts a first reading needs, under labels short enough for one row. */
const KEY_COUNTS: Array<[key: string, label: string]> = [
  ["clinvar_pathogenic_count", "P / LP variants"],
  ["experimental_structure_count", "Experimental structures"],
  ["gene_disease_validity", "Gene validity"],
];

const PHENOTYPES_SHOWN = 6;

export interface DiseaseSummaryProps {
  disease: DiseaseResponse;
  /** every phenotype, most frequent first */
  phenotypes: Phenotype[];
  selectedPhenotypeId: string | null;
  onSelectPhenotype: (phenotype: Phenotype) => void;
  frequencyCell: (phenotype: Phenotype) => React.ReactNode;
  stageHref: (path: string) => string;
  /** opens the full record: every phenotype, relationships, treatment records */
  onOpenRecord: () => void;
}

/** Simple mode: the disease in one column. Name, the sourced sentence, gene, protein, a few counts. */
export function DiseaseSummary({
  disease,
  phenotypes,
  selectedPhenotypeId,
  onSelectPhenotype,
  frequencyCell,
  stageHref,
  onOpenRecord,
}: DiseaseSummaryProps) {
  const { gene, protein, inheritance, definition } = disease;
  const definitionEvidence = definition
    ? recordEvidence(definition.source, definition.one_line)
    : null;
  const inheritanceEvidence = recordEvidence(inheritance.source);
  const causedBy = disease.graph.edges.find((edge) => edge.type === "caused_by")
    ?.evidence[0];
  const counts = KEY_COUNTS.flatMap(([key, label]) => {
    const item = disease.research_status.find((entry) => entry.key === key);
    return item && item.value !== null ? [{ item, label }] : [];
  });

  return (
    <div className="flex flex-col">
      <header className="flex flex-col gap-2 px-3 pt-4 pb-4">
        <h1 className="text-xl font-medium text-foreground">
          {disease.name}
        </h1>
        {definition ? (
          <p className="text-sm text-muted-foreground">
            <span className="line-clamp-6">{definition.one_line}</span>
            {definitionEvidence ? (
              <EvidencePopover
                size="compact"
                evidence={definitionEvidence}
                className="mt-1.5"
              />
            ) : null}
          </p>
        ) : (
          <p className="text-sm text-subtle-foreground">
            No sourced definition
          </p>
        )}
      </header>

      <DefinitionList
        termWidth="6rem"
        className="border-t border-border-subtle"
      >
        <DefinitionRow term="Gene">
          {gene ? (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <TextLink
                href={stageHref(routes.gene(gene.symbol))}
                className="text-sm font-medium"
                translate="no"
              >
                {gene.symbol}
              </TextLink>
              {causedBy ? (
                <EvidencePopover
                  size="compact"
                  evidence={apiEvidence(causedBy, {
                    sources: disease.sources,
                    statement: `${disease.name} is caused by variants in ${gene.symbol}.`,
                  })}
                />
              ) : null}
            </span>
          ) : (
            <Unknown reason="No gene named" />
          )}
        </DefinitionRow>
        <DefinitionRow term="Protein">
          {protein ? (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <TextLink
                href={stageHref(routes.protein(protein.accession))}
                className="font-mono"
                translate="no"
              >
                {protein.accession}
              </TextLink>
              {protein.length ? (
                <span className="tabular font-mono text-muted-foreground">
                  {protein.length} aa
                </span>
              ) : null}
            </span>
          ) : (
            <Unknown reason="No protein mapped" />
          )}
        </DefinitionRow>
        <DefinitionRow term="Inheritance">
          {inheritance.terms.length > 0 || inheritance.raw ? (
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
                : inheritance.raw}
              {inheritanceEvidence ? (
                <EvidencePopover
                  size="compact"
                  evidence={inheritanceEvidence}
                />
              ) : null}
            </span>
          ) : (
            <Unknown reason="Not stated" />
          )}
        </DefinitionRow>
      </DefinitionList>

      {counts.length > 0 ? (
        <>
          <SectionHeader title="Recorded" className="border-t" />
          <ul>
            {counts.map(({ item, label }) => {
              const evidence = item.evidence
                ? apiEvidence(item.evidence, { sources: disease.sources })
                : recordEvidence(item.source, `${item.label}: ${item.value}`);
              return (
                <li
                  key={item.key}
                  title={item.label}
                  className="flex items-baseline gap-2 border-b border-border-subtle px-3 py-2 last:border-b-0"
                >
                  <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                    {label}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-xl leading-6 font-medium text-foreground",
                      typeof item.value === "number" && "tabular font-mono",
                    )}
                  >
                    {typeof item.value === "number"
                      ? formatCount(item.value)
                      : typeof item.value === "boolean"
                        ? item.value
                          ? "Yes"
                          : "No"
                        : item.value}
                  </span>
                  {evidence ? (
                    <EvidencePopover
                      size="compact"
                      align="end"
                      evidence={evidence}
                      className="shrink-0 self-center"
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      <SectionHeader
        title="Phenotypes"
        count={phenotypes.length}
        className="border-t"
      />
      {phenotypes.length === 0 ? (
        <p className="px-3 py-2 text-xs text-subtle-foreground">
          No source found
        </p>
      ) : (
        <ul>
          {phenotypes.slice(0, PHENOTYPES_SHOWN).map((phenotype) => (
            <li
              key={phenotype.hpo_id}
              className="border-b border-border-subtle last:border-b-0"
            >
              <button
                type="button"
                aria-pressed={phenotype.hpo_id === selectedPhenotypeId}
                onClick={() => onSelectPhenotype(phenotype)}
                className={cn(
                  "flex w-full cursor-pointer items-baseline gap-2 px-3 py-1.5 text-left text-xs outline-offset-[-2px] hover:bg-accent",
                  phenotype.hpo_id === selectedPhenotypeId &&
                    "bg-active shadow-[inset_2px_0_0_var(--foreground)]",
                )}
              >
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {phenotype.label ?? phenotype.hpo_id}
                </span>
                <span className="tabular shrink-0 font-mono text-muted-foreground">
                  {frequencyCell(phenotype)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="border-t border-border-subtle px-3 py-3">
        <Button variant="ghost" size="sm" onClick={onOpenRecord}>
          Details
        </Button>
      </div>
    </div>
  );
}
