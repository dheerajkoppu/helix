"use client";

import { ButtonLink } from "@/components/data/button-link";
import { routes } from "@/lib/ids";
import { DISCOVERY_WORDS } from "@/lib/plain-language";

export interface CandidatesLinkProps {
  gene: string;
  diseaseId?: string | null;
  variantId?: string | null;
  /** links into the held-out mode, where the disease's own drug links are withheld */
  heldOut?: boolean;
  size?: "sm" | "default";
  appearance?: "outline" | "ghost" | "secondary";
  /** defaults to hiding the button wherever the stage rail already shows Candidates */
  className?: string;
}

/**
 * The entry point to the Candidates stage. The disease page, the gene page and a finished Lab run
 * all link through this, so the query the stage expects is built in exactly one place.
 *
 * Below `lg` the stage rail collapses to a stepper, so this button is the only way through; from
 * `lg` up the rail already shows Candidates as a stage and a second copy beside it is noise.
 */
export function CandidatesLink({
  gene,
  diseaseId,
  variantId,
  heldOut,
  size = "sm",
  appearance = "ghost",
  className = "lg:hidden",
}: CandidatesLinkProps) {
  return (
    <ButtonLink
      href={candidatesHref(gene, {
        disease: diseaseId,
        variant: variantId,
        heldOut,
      })}
      size={size}
      variant={appearance}
      className={className}
    >
      {DISCOVERY_WORDS.title}
    </ButtonLink>
  );
}

/** The Candidates route for a gene. The Lab run links through this when a run has finished. */
export function candidatesHref(
  gene: string,
  options: {
    disease?: string | null;
    variant?: string | null;
    heldOut?: boolean;
  } = {},
): string {
  return routes.discover(gene, options);
}
