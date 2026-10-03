import type { Schema, SourceStatus } from "@/lib/api/types";
import type { AudienceLevel } from "@/lib/state/assistant";

/** Hand-written from api/orphafold/schemas/assistant.py; replace with Schema<"..."> after make types. */

export type ApiEvidence = Schema<"Evidence">;

export const SEGMENT_KINDS = [
  "database_fact",
  "paper_finding",
  "computational_result",
  "reasoning_hypothesis",
] as const;
export type SegmentKind = (typeof SEGMENT_KINDS)[number];

export interface AnswerSegment {
  kind: SegmentKind;
  text: string;
  citations: string[];
  /** the model's own label when the server changed it */
  claimed_kind: SegmentKind | null;
  note: string | null;
  heading: string | null;
}

export interface CitedEvidence {
  key: string;
  tool: string | null;
  evidence: ApiEvidence;
}

export interface Lookup {
  id: string;
  tool: string;
  label: string;
  ok: boolean;
  message: string | null;
  evidence_count: number;
}

export interface AssistantAnswer {
  segments: AnswerSegment[];
  evidence: CitedEvidence[];
  lookups: Lookup[];
  generated_by: "model" | "source_digest";
  model: string | null;
  audience: AudienceLevel | null;
  downgraded: number;
  relabelled: number;
  usage: Record<string, number>;
  sources: SourceStatus[];
}

export interface AssistantStatus {
  configured: boolean;
  setting: string;
  model: string;
  message: string;
  audiences: { id: AudienceLevel; label: string; description: string }[];
  segment_kinds: { id: SegmentKind; label: string; description: string }[];
  tools: string[];
}

/** Sent as the chat context; the backend ignores keys it does not know. */
export interface ChatContext {
  route?: string;
  disease?: string;
  gene?: string;
  accession?: string;
  variant?: string;
  residue?: number;
  structure?: string;
  compound?: string;
  project?: string;
  comparison?: string;
}

export interface DraftSegment {
  kind: SegmentKind | null;
  text: string;
}

export interface TurnError {
  code: string;
  message: string;
}

export interface Turn {
  id: string;
  question: string;
  context: ChatContext;
  audience: AudienceLevel;
  status: "streaming" | "done" | "error" | "stopped";
  /** what the model is doing right now, named */
  step: string | null;
  lookups: (Lookup & { pending?: boolean })[];
  /** text as it streams; labels are the model's own until the answer is validated */
  draft: DraftSegment[];
  answer: AssistantAnswer | null;
  error: TurnError | null;
}
