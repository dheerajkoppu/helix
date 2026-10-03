"use client";

import { cn } from "cn";

import { ExternalLink } from "@/components/data/external-link";
import { MonoId } from "@/components/data/mono-id";
import { EvidenceBadge } from "@/components/evidence/evidence-badge";
import { EvidenceGlyph } from "@/components/evidence/glyphs";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { EVIDENCE_META, type EvidenceItem } from "@/lib/evidence";
import { formatTimestamp } from "@/lib/format";
import {
  OPEN_SOURCE_LABEL,
  plainDatabase,
  plainEvidenceKind,
  plainEvidenceMeaning,
} from "@/lib/plain-language";
import { useAdvancedMode } from "@/lib/state/preferences";

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="col-span-2 grid grid-cols-subgrid items-baseline gap-x-3 py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  );
}

const missing = <span className="text-subtle-foreground">Unknown</span>;

/** The inspectable body: class, statement, source, record ID, release, retrieval date, link. */
export function EvidenceDetail({
  evidence,
  className,
}: {
  evidence: EvidenceItem;
  className?: string;
}) {
  const advanced = useAdvancedMode();
  const meta = EVIDENCE_META[evidence.evidenceClass];
  const { source, strength } = evidence;
  if (!advanced) {
    return (
      <div className={cn("flex flex-col text-xs", className)}>
        <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
          <EvidenceGlyph
            evidenceClass={evidence.evidenceClass}
            className={cn("size-3.5", meta.textClass)}
          />
          <span className="font-medium text-foreground">
            {plainDatabase(source?.database) ??
              plainEvidenceKind(evidence.evidenceClass)}
          </span>
        </div>
        <div className="flex flex-col gap-1 px-3 py-2">
          <p className="text-muted-foreground">
            {plainEvidenceMeaning(evidence.evidenceClass)}
          </p>
          {evidence.statement ? (
            <p className="text-foreground">{evidence.statement}</p>
          ) : null}
        </div>
        {source?.url ? (
          <div className="border-t border-border-subtle px-3 py-2">
            <ExternalLink href={source.url}>{OPEN_SOURCE_LABEL}</ExternalLink>
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div className={cn("flex flex-col text-xs", className)}>
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <EvidenceGlyph
          evidenceClass={evidence.evidenceClass}
          className={cn("size-3.5", meta.textClass)}
        />
        <span
          className={cn(
            "font-mono text-2xs font-semibold tracking-[0.06em]",
            meta.textClass,
          )}
        >
          {meta.code}
        </span>
        <span className="font-medium text-foreground">{meta.label}</span>
        {evidence.modifiers?.map((modifier) => (
          <span
            key={modifier}
            className="rounded-xs border border-border px-1 text-2xs text-muted-foreground"
          >
            {modifier}
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-1 px-3 py-2">
        {evidence.statement ? (
          <p className="text-foreground">{evidence.statement}</p>
        ) : null}
        <p className="text-muted-foreground">{meta.description}</p>
      </div>

      {source ? (
        <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] border-t border-border-subtle px-3 py-1.5">
          <Row label="Source">{source.database}</Row>
          <Row label="Record">
            {source.recordId ? <MonoId value={source.recordId} /> : missing}
          </Row>
          <Row label="Release">
            {source.release ? (
              <span className="font-mono">{source.release}</span>
            ) : (
              missing
            )}
          </Row>
          <Row label="Retrieved">
            {formatTimestamp(source.retrievedAt) ? (
              <span className="tabular font-mono">
                {formatTimestamp(source.retrievedAt)}
              </span>
            ) : (
              missing
            )}
          </Row>
          {evidence.method ? <Row label="Method">{evidence.method}</Row> : null}
          {strength ? (
            <Row label="Strength">
              {strength.value}
              {strength.rank !== null &&
              strength.rank !== undefined &&
              strength.maxRank ? (
                <span className="tabular ml-1.5 font-mono text-muted-foreground">
                  {strength.rank}/{strength.maxRank}
                </span>
              ) : null}
              <span className="block text-2xs text-subtle-foreground">
                {strength.scheme.replace(/_/g, " ")}, as reported by the source
              </span>
            </Row>
          ) : null}
          {source.license ? <Row label="Licence">{source.license}</Row> : null}
        </dl>
      ) : (
        <p className="border-t border-border-subtle px-3 py-2 text-muted-foreground">
          No external source record. This statement was authored in OrphaFold
          from the evidence it cites.
        </p>
      )}

      {source?.url ? (
        <div className="border-t border-border-subtle px-3 py-2">
          <ExternalLink href={source.url}>
            Open at {source.database}
          </ExternalLink>
        </div>
      ) : null}
    </div>
  );
}

export interface EvidencePopoverProps {
  evidence: EvidenceItem;
  /** badge size for the default trigger */
  size?: "compact" | "standard";
  /** short source reference printed on the default trigger; defaults to the record ID */
  detail?: React.ReactNode;
  /** extra content under the source block, e.g. supporting evidence for a hypothesis */
  children?: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  className?: string;
}

/** An evidence badge that opens its source on click. This is the default way to cite anything. */
export function EvidencePopover({
  evidence,
  size = "standard",
  detail,
  children,
  side = "bottom",
  align = "start",
  className,
}: EvidencePopoverProps) {
  const advanced = useAdvancedMode();
  const meta = EVIDENCE_META[evidence.evidenceClass];
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`${advanced ? meta.label : plainEvidenceKind(evidence.evidenceClass)}. Show source.`}
        className={cn(
          "inline-flex cursor-pointer rounded-xs align-middle hover:bg-accent aria-expanded:bg-active",
          className,
        )}
      >
        <EvidenceBadge
          evidenceClass={evidence.evidenceClass}
          size={size}
          source={evidence.source?.database}
          detail={
            detail === undefined && size === "standard"
              ? evidence.source?.recordId
              : detail
          }
        />
      </PopoverTrigger>
      <PopoverContent side={side} align={align} className="w-80 gap-0 p-0">
        <EvidenceDetail evidence={evidence} />
        {children ? (
          <div className="border-t border-border-subtle px-3 py-2">
            {children}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
