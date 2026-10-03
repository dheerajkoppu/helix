"use client";

import { useQuery } from "@tanstack/react-query";

import { TextLink } from "@/components/data/text-link";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { apiQuery } from "@/lib/api/query";
import { formatCount } from "@/lib/format";

/** Numbers stated by the classification itself (Poli et al. 2025, abstract and body text). */
const IUIS_2024 = { genes: 508, conditions: 559, phenocopies: 17 };

/** The gene count is the loaded catalog's own; without the API the line makes no numeric claim. */
export function MissionLine({ className }: { className?: string }) {
  const meta = useQuery(apiQuery("/meta"));
  const catalog = meta.data?.data.catalog;
  const genes = catalog?.state === "ready" ? catalog.counts.genes : null;

  return (
    <p className={className}>
      {genes ? (
        <>
          <Tooltip>
            <TooltipTrigger
              render={<span tabIndex={0} />}
              className="tabular cursor-help rounded-xs font-mono text-foreground underline decoration-border-strong decoration-dotted decoration-1 underline-offset-[3px] hover:decoration-foreground"
            >
              {formatCount(genes)}
            </TooltipTrigger>
            <TooltipContent
              side="top"
              align="start"
              className="block max-w-[22rem] py-1.5 leading-4"
            >
              Genes in the loaded catalog: every HGNC gene named in the IUIS
              2024 tables. IUIS itself reports {IUIS_2024.genes} genes,{" "}
              {IUIS_2024.conditions} inborn errors of immunity and{" "}
              {IUIS_2024.phenocopies} phenocopies; the catalog also counts the
              genes IUIS lists only as somatic phenocopies.
            </TooltipContent>
          </Tooltip>{" "}
          immune-disease genes.
        </>
      ) : (
        "Inborn errors of immunity first."
      )}{" "}
      <TextLink href="/explore">Browse all</TextLink>
    </p>
  );
}
