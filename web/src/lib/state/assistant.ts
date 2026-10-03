import { create } from "zustand";

/** What the reader was looking at when they asked. Every field is optional. */
export interface AssistantContext {
  /** pathname and query of the view the question was asked from */
  route?: string;
  disease?: string;
  gene?: string;
  /** UniProt accession */
  accession?: string;
  variant?: string;
  /** "pdb:1BF5" | "afdb:AF-P42224-F1" | "of:<job_id>" */
  structure?: string;
  /** UniProt canonical numbering */
  residue?: number;
  [key: string]: unknown;
}

/** A question handed to the assistant panel, which sends it and then clears it. */
export interface AssistantRequest {
  id: string;
  prompt: string;
  context: AssistantContext | null;
  askedAt: number;
}

/** Depth of explanation. It changes vocabulary, never the facts or their labels. */
export const AUDIENCE_LEVELS = [
  "high_school",
  "undergraduate",
  "researcher",
  "structural_biologist",
] as const;
export type AudienceLevel = (typeof AUDIENCE_LEVELS)[number];

const AUDIENCE_STORAGE_KEY = "orphafold.assistant.audience";

function storedAudience(): AudienceLevel | null {
  try {
    const value = window.localStorage.getItem(AUDIENCE_STORAGE_KEY);
    return (AUDIENCE_LEVELS as readonly string[]).includes(value ?? "")
      ? (value as AudienceLevel)
      : null;
  } catch {
    return null;
  }
}

interface AssistantState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  /** the question waiting for the panel to pick it up; null when there is none */
  pending: AssistantRequest | null;
  /** Opens the panel and queues one question for it. */
  ask: (prompt: string, context?: AssistantContext) => void;
  /** The panel calls this once it has taken the pending question. */
  clearPending: () => void;
  audience: AudienceLevel;
  setAudience: (audience: AudienceLevel) => void;
  /** Reads the saved audience after mount, so server and first client render agree. */
  restoreAudience: () => void;
}

let requestCount = 0;

export const useAssistant = create<AssistantState>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
  pending: null,
  ask: (prompt, context) => {
    requestCount += 1;
    set({
      open: true,
      pending: {
        id: `ask-${requestCount}`,
        prompt: prompt.trim(),
        context: context ?? null,
        askedAt: Date.now(),
      },
    });
  },
  clearPending: () => set({ pending: null }),
  audience: "researcher",
  setAudience: (audience) => {
    try {
      window.localStorage.setItem(AUDIENCE_STORAGE_KEY, audience);
    } catch {
      // the choice still holds for this session
    }
    set({ audience });
  },
  restoreAudience: () => {
    const audience = storedAudience();
    if (audience) set({ audience });
  },
}));

/** Ask from any event handler, outside React included. */
export function askOrpha(prompt: string, context?: AssistantContext): void {
  useAssistant.getState().ask(prompt, context);
}
