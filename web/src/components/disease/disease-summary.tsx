"use client";

import {
  DefinitionList,
  DefinitionRow,
  Unknown,
} from "@/components/data/definition-list";
import { SectionHeader } from "@/components/data/section-header";
import { TextLink } from "@/components/data/text-link";
import { EvidencePopover } from "@/components/evidence/evidence-popover";
import { Disclosure } from "@/components/protein/disclosure";
import { Button } from "@/components/ui/button";
import type { Schema } from "@/lib/api/types";
import type { EvidenceItem } from "@/lib/evidence";
import { formatCount } from "@/lib/format";
import { routes } from "@/lib/ids";
import {
  DETAILS_LABEL,
  DISEASE_WORDS,
  plainDiseaseLine,
  plainFrequency,
  plainInheritance,
  plainLength,
  plainMechanismDirection,
  plainSource,
} from "@/lib/plain-language";
import type { DiseaseResponse } from "@/lib/workspace-data";
import { cn } from "cn";

import {
  apiEvidence as fullApiEvidence,
  recordEvidence as fullRecordEvidence,
} from "./evidence";

type Phenotype = Schema<"DiseasePhenotype">;

/** The same record with the database under the name people say. */
function shortSource<T extends EvidenceItem | null>(item: T): T {
  if (!item?.source) return item;
  return {
    ...item,
    source: { ...item.source, database: plainSource(item.source.database) },
  };
}

const recordEvidence = (...args: Parameters<typeof fullRecordEvidence>) =>
  shortSource(fullRecordEvidence(...args));
const apiEvidence = (...args: Parameters<typeof fullApiEvidence>) =>
  shortSource(fullApiEvidence(...args));

/** The counts a first reading needs, under labels short enough for one row. */
const KEY_COUNTS: Array<[key: string, label: string]> = [
  ["clinvar_pathogenic_count", DISEASE_WORDS.harmful],
  ["experimental_structure_count", DISEASE_WORDS.labStructures],
];

const PHENOTYPES_SHOWN = 6;

export interface DiseaseSummaryProps {
  disease: DiseaseResponse;
  /** every phenotype, most frequent first */
  phenotypes: Phenotype[];
  selectedPhenotypeId: string | null;
  onSelectPhenotype: (phenotype: Phenotype) => void;
  stageHref: (path: string) => string;
  /** opens the full record: every phenotype, relationships, treatment records */
  onOpenRecord: () => void;
}

/** Simple mode: the disease in one column. Name, one plain line, gene, inheritance, a few symptoms. */
export function DiseaseSummary({
  disease,
  phenotypes,
  selectedPhenotypeId,
  onSelectPhenotype,
  stageHref,
  onOpenRecord,
}: DiseaseSummaryProps) {
  const { gene, protein, inheritance, definition } = disease;
  const definitionEvidence = definition
    ? recordEvidence(definition.source, definition.one_line)
    : null;
  const inheritanceEvidence = recordEvidence(inheritance.source);
  // the direction of the fault, which is what the Candidates stage turns into a required action
  const mechanisms = (disease.mechanism ?? []).filter(
    (mechanism): mechanism is string => typeof mechanism === "string",
  );
  const causedBy = disease.graph.edges.find((edge) => edge.type === "caused_by")
    ?.evidence[0];
  const counts = KEY_COUNTS.flatMap(([key, label]) => {
    const item = disease.research_status.find((entry) => entry.key === key);
    return item && item.value !== null ? [{ item, label }] : [];
  });

  return (
    <div className="flex flex-col">
      <header className="flex flex-col gap-2 px-3 pt-4 pb-4">
        <h1 className="text-xl font-medium text-foreground">{disease.name}</h1>
        <p className="text-sm text-muted-foreground">
          {plainDiseaseLine({
            gene: gene?.symbol,
            inherited: inheritance.codes.length > 0,
            immune: Boolean(disease.category),
          })}
        </p>
      </header>

      {definition ? (
        <Disclosure label={DISEASE_WORDS.medical}>
          <p className="px-3 pb-3 text-xs text-muted-foreground">
            {definition.one_line}
            {definitionEvidence ? (
              <EvidencePopover
                size="compact"
                evidence={definitionEvidence}
                className="ml-2"
              />
            ) : null}
          </p>
        </Disclosure>
      ) : null}

      <DefinitionList
        termWidth="6rem"
        className="border-t border-border-subtle"
      >
        <DefinitionRow term={DISEASE_WORDS.gene}>
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
            <Unknown reason={DISEASE_WORDS.noGene} />
          )}
        </DefinitionRow>
        <DefinitionRow term={DISEASE_WORDS.protein}>
          {protein ? (
            <span className="flex flex-col gap-0.5">
              <TextLink
                href={stageHref(routes.protein(protein.accession))}
                title={protein.accession}
              >
                {protein.name ?? `${gene?.symbol ?? ""} protein`.trim()}
              </TextLink>
              {protein.length ? (
                <span className="text-muted-foreground">
                  {plainLength(protein.length)}
                </span>
              ) : null}
            </span>
          ) : (
            <Unknown reason={DISEASE_WORDS.noProtein} />
          )}
        </DefinitionRow>
        <DefinitionRow term={DISEASE_WORDS.fault}>
          {mechanisms.length > 0 ? (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {mechanisms.map((mechanism) => (
                <span key={mechanism}>
                  {plainMechanismDirection(mechanism)}
                </span>
              ))}
            </span>
          ) : (
            <Unknown reason={DISEASE_WORDS.faultUnknown} />
          )}
        </DefinitionRow>
        <DefinitionRow term={DISEASE_WORDS.inheritance}>
          {inheritance.terms.length > 0 || inheritance.raw ? (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {inheritance.terms.length > 0
                ? inheritance.terms.map((term, index) => {
                    const label = term.label ?? term.id;
                    return (
                      <span key={term.id} title={label}>
                        {plainInheritance(inheritance.codes[index]) ?? label}
                      </span>
                    );
                  })
                : (plainInheritance(inheritance.raw) ?? inheritance.raw)}
              {inheritanceEvidence ? (
                <EvidencePopover
                  size="compact"
                  evidence={inheritanceEvidence}
                />
              ) : null}
            </span>
          ) : (
            <Unknown reason={DISEASE_WORDS.inheritanceUnknown} />
          )}
        </DefinitionRow>
      </DefinitionList>

      {counts.length > 0 ? (
        <>
          <ul className="border-t border-border-subtle">
            {counts.map(({ item, label }) => {
              const evidence = item.evidence
                ? apiEvidence(item.evidence, { sources: disease.sources })
                : recordEvidence(item.source, `${item.label}: ${item.value}`);
              return (
                <li
                  key={item.key}
                  title={item.label}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-border-subtle px-3 py-2 last:border-b-0"
                >
                  <span className="w-full text-xs text-muted-foreground">
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
        title={DISEASE_WORDS.symptoms}
        count={phenotypes.length}
        className="border-t"
      />
      {phenotypes.length === 0 ? (
        <p className="px-3 py-2 text-xs text-subtle-foreground">
          {DISEASE_WORDS.noSymptoms}
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
                <span
                  className="shrink-0 text-muted-foreground"
                  title={phenotype.frequency ?? undefined}
                >
                  {plainFrequency(phenotype.frequency)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="border-t border-border-subtle px-3 py-3">
        <Button variant="ghost" size="sm" onClick={onOpenRecord}>
          {DETAILS_LABEL}
        </Button>
      </div>
    </div>
  );
}
