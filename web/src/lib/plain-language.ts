/**
 * The one dictionary of everyday wording for simple mode. Screens never print codes, IDs or
 * agent-written sentences as headlines: they look the wording up here. Advanced mode keeps the
 * technical terms. See docs/DESIGN_SYSTEM.md section 0, "Plain language".
 */

export const LOOP_STEPS = [
  "Question",
  "Evidence",
  "Hypothesis",
  "Experiment",
  "Result",
  "Decision",
  "Candidates",
] as const;

export type LoopStep = (typeof LOOP_STEPS)[number];

function sentenceCase(text: string): string {
  const spaced = text.replace(/[_-]+/g, " ").trim();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : "Unknown";
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

const CAUSES: Record<string, { short: string; sentence: string }> = {
  ligand_binding: {
    short: "Can't grab its signal molecule",
    sentence:
      "The mutation stops the protein from grabbing its signal molecule.",
  },
  protein_interaction: {
    short: "Can't connect to partner proteins",
    sentence: "The mutation stops the protein from connecting to its partners.",
  },
  stability_folding: {
    short: "The protein becomes unstable",
    sentence: "The mutation makes the protein unstable, so it falls apart.",
  },
  stability: {
    short: "The protein becomes unstable",
    sentence: "The mutation makes the protein unstable, so it falls apart.",
  },
  folding: {
    short: "The protein folds wrong",
    sentence: "The mutation stops the protein from folding into its shape.",
  },
  catalytic_site: {
    short: "Its active site stops working",
    sentence: "The mutation breaks the spot where the protein does its job.",
  },
  localisation: {
    short: "Ends up in the wrong place",
    sentence: "The mutation sends the protein to the wrong place in the cell.",
  },
  signalling: {
    short: "The signal can't pass through",
    sentence: "The mutation blocks the signal the protein should pass on.",
  },
  domain_interface: {
    short: "Its parts stop fitting together",
    sentence:
      "The mutation stops two parts of the protein from fitting together.",
  },
  nucleic_acid_binding: {
    short: "Can't grab DNA or RNA",
    sentence: "The mutation stops the protein from grabbing DNA or RNA.",
  },
};

/** A possible cause in a few everyday words: "Can't grab its signal molecule". */
export function plainCause(mechanismClass: string | null | undefined): string {
  if (!mechanismClass) return "No cause chosen";
  return CAUSES[mechanismClass]?.short ?? sentenceCase(mechanismClass);
}

/** The same cause as one full sentence. */
export function plainCauseSentence(
  mechanismClass: string | null | undefined,
): string {
  if (!mechanismClass) return "No cause chosen.";
  return CAUSES[mechanismClass]?.sentence ?? `${sentenceCase(mechanismClass)}.`;
}

const TESTS: Record<string, { name: string; question: string }> = {
  ligand_contact: {
    name: "Contact check",
    question: "Does the mutated spot touch the molecule it binds?",
  },
  structural_context: {
    name: "Pocket check",
    question: "Is the mutated spot in a pocket or on a contact surface?",
  },
  stability_effect: {
    name: "Stability check",
    question: "Does the mutation make the protein less stable?",
  },
  structure_comparison: {
    name: "Shape check",
    question: "Does the predicted shape change?",
  },
};

/** A test's short name: "Contact check". */
export function plainTestName(testKind: string | null | undefined): string {
  if (!testKind) return "Test";
  return TESTS[testKind]?.name ?? sentenceCase(testKind);
}

/** The question a test answers: "Does the mutated spot touch the molecule it binds?" */
export function plainTestQuestion(testKind: string | null | undefined): string {
  if (!testKind) return "No test chosen";
  return TESTS[testKind]?.question ?? sentenceCase(testKind);
}

export type Level = "High" | "Medium" | "Low";

/** Expected learning on 0 to 1 as a word. */
export function plainLearning(
  score: number | null | undefined,
): Level | "Unknown" {
  if (score == null || !Number.isFinite(score)) return "Unknown";
  if (score >= 0.5) return "High";
  return score >= 0.25 ? "Medium" : "Low";
}

/** Feasibility on 0 to 1 as the effort it takes: easy to run means low effort. */
export function plainEffort(
  feasibility: number | null | undefined,
): Level | "Unknown" {
  if (feasibility == null || !Number.isFinite(feasibility)) return "Unknown";
  if (feasibility >= 0.8) return "Low";
  return feasibility >= 0.5 ? "Medium" : "High";
}

/** Compute time in everyday words: "Instant", "2 min". */
export function plainDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "Unknown";
  if (seconds < 1) return "Instant";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

const VERDICTS: Record<string, string> = {
  supported: "More likely",
  weakened: "Less likely",
  refuted: "Ruled out",
  unchanged: "No change",
};

/** What a test did to a possible cause: "More likely". */
export function plainVerdict(verdict: string | null | undefined): string {
  if (!verdict) return "Not tested";
  return VERDICTS[verdict] ?? sentenceCase(verdict);
}

const AGENTS: Record<string, { name: string; role: string }> = {
  orchestrator: { name: "Lead", role: "Runs the loop" },
  literature: { name: "Literature", role: "Reads the papers" },
  knowledge_graph: { name: "Knowledge graph", role: "Pulls database facts" },
  insight: { name: "Insight", role: "Proposes causes" },
  planner: { name: "Planner", role: "Chooses the test" },
  safety: { name: "Safety", role: "Checks the plan" },
  runner: { name: "Runner", role: "Runs the test" },
  analysis: { name: "Analysis", role: "Updates the answer" },
  translator: { name: "Translator", role: "Finds what to aim at" },
  human: { name: "You", role: "Approves the test" },
  generalist: { name: "Single agent", role: "Does every step" },
};

export function plainAgentName(agent: string): string {
  return AGENTS[agent]?.name ?? sentenceCase(agent);
}

export function plainAgentRole(agent: string): string {
  return AGENTS[agent]?.role ?? "";
}

export interface AgentCounts {
  papers?: number;
  facts?: number;
  causes?: number;
  tests?: number;
  approvals?: number;
  /** tests that have finished */
  results?: number;
  changed?: boolean | null;
  candidates?: number;
  ruledOut?: number;
}

/** What an agent did, from counts, never from the agent's own text: "Read 5 papers". */
export function plainAgentLine(
  agent: string,
  counts: AgentCounts = {},
): string {
  switch (agent) {
    case "literature":
      return counts.papers
        ? `Read ${plural(counts.papers, "paper")}`
        : "Read the papers";
    case "knowledge_graph":
      return counts.facts
        ? `Pulled ${plural(counts.facts, "database fact")}`
        : "Pulled database facts";
    case "insight":
      return counts.causes
        ? `Proposed ${plural(counts.causes, "cause")}`
        : "Proposed causes";
    case "planner":
      return counts.tests
        ? `Chose 1 of ${plural(counts.tests, "test")}`
        : "Chose the test";
    case "safety":
      return counts.approvals ? "Asked for approval" : "Checked the plan";
    case "runner":
      return counts.results && counts.results > 1
        ? `Ran ${plural(counts.results, "test")}`
        : "Ran the test";
    case "analysis":
      if (counts.changed === false) return "Kept the answer";
      return counts.changed ? "Changed the answer" : "Updated the answer";
    case "translator":
      return counts.candidates
        ? `Found ${plural(counts.candidates, "candidate")}`
        : "Looked for candidates";
    case "orchestrator":
      return "Ran the loop";
    case "generalist":
      return "Did every step";
    case "human":
      return "Approved the test";
    default:
      return plainAgentRole(agent);
  }
}

export interface StepCounts {
  facts?: number;
  sources?: number;
  causes?: number;
  tests?: number;
  finished?: boolean;
  changed?: boolean | null;
  candidates?: number;
  ruledOut?: number;
}

/** The caption under a loop step. */
export function plainStepCaption(
  step: LoopStep,
  counts: StepCounts = {},
): string {
  switch (step) {
    case "Question":
      return "Why is this mutation harmful?";
    case "Evidence":
      return counts.facts && counts.sources
        ? `${plural(counts.facts, "fact")} from ${plural(counts.sources, "source")}`
        : "Gathering facts";
    case "Hypothesis":
      return counts.causes
        ? `${plural(counts.causes, "possible cause")}`
        : "Proposing causes";
    case "Experiment":
      return counts.tests
        ? `Chose 1 of ${plural(counts.tests, "test")}`
        : "Choosing a test";
    case "Result":
      return counts.finished ? "Test finished" : "Running the test";
    case "Decision":
      if (counts.changed == null) return "Deciding";
      return counts.changed ? "Answer changed" : "Answer held";
    case "Candidates":
      if (!counts.candidates)
        return counts.ruledOut
          ? `None kept, ${counts.ruledOut} ruled out`
          : "Looking for candidates";
      return counts.ruledOut
        ? `${plural(counts.candidates, "candidate")}, ${counts.ruledOut} ruled out`
        : plural(counts.candidates, "candidate");
  }
}

/** "Lab test" or "Computer test". */
export function plainNextKind(kind: string | null | undefined): string {
  if (kind === "laboratory") return "Lab test";
  if (kind === "computational") return "Computer test";
  return "Next test";
}

const ORIGINS: Record<string, string> = {
  experimental: "Experimental",
  predicted_external: "Predicted",
  predicted_internal: "Generated here",
};

/** Where a structure came from, in a word. */
export function plainOrigin(origin: string | null | undefined): string {
  if (!origin) return "Unknown origin";
  return ORIGINS[origin] ?? sentenceCase(origin);
}

/** A ClinVar class without abbreviations. Unrecognised text is printed as given. */
export function plainClinicalClass(
  significance: string | null | undefined,
): string {
  if (!significance) return "Not classified";
  const text = significance.toLowerCase();
  if (text.includes("conflict")) return "Conflicting";
  if (text.includes("likely pathogenic") && text.includes("pathogenic/"))
    return "Pathogenic";
  if (text.includes("likely pathogenic")) return "Likely pathogenic";
  if (text.includes("pathogenic")) return "Pathogenic";
  if (text.includes("likely benign")) return "Likely benign";
  if (text.includes("benign")) return "Benign";
  if (text.includes("uncertain")) return "Uncertain";
  return sentenceCase(significance);
}

/** A pLDDT value on 0 to 100 as words: "Very high confidence". */
export function plainConfidence(plddt: number | null | undefined): string {
  if (plddt == null || !Number.isFinite(plddt)) return "Confidence unknown";
  if (plddt >= 90) return "Very high confidence";
  if (plddt >= 70) return "High confidence";
  if (plddt >= 50) return "Low confidence";
  return "Very low confidence";
}

export const PREDICTION_CAVEAT = "Computer prediction. Not lab-tested.";
export const HYPOTHESIS_CAVEAT = "Proposed by the agents. Not proven.";
export const CANDIDATE_CAVEAT = "A Helix idea. Not a treatment.";

/** Candidates: how a molecule was reached, and whether it pushes the protein the right way. */

const BRIDGES: Record<string, string> = {
  same_target: "Acts on this same protein",
  pathway_node: "Acts on a step in the pathway",
  interaction_partner: "Acts on a partner protein",
  structural_analogue: "Fits a look-alike pocket",
  mechanism_class: "Same kind of fault elsewhere",
};

/** How the molecule was reached, in a few words. */
export function plainBridge(kind: string | null | undefined): string {
  if (!kind) return "Link not stated";
  return BRIDGES[kind] ?? sentenceCase(kind);
}

const DIRECTIONS: Record<string, string> = {
  matches: "Pushes the right way",
  opposes: "Pushes the wrong way",
  unknown: "Direction unknown",
};

/** Whether the molecule pushes the protein the way the fault needs. */
export function plainDirection(verdict: string | null | undefined): string {
  if (!verdict) return DIRECTIONS.unknown;
  return DIRECTIONS[verdict] ?? sentenceCase(verdict);
}

const ACTIONS: Record<string, string> = {
  inhibit: "Turn it down",
  block: "Turn it down",
  antagonise: "Turn it down",
  reduce: "Turn it down",
  restore: "Turn it back on",
  activate: "Turn it up",
  stabilise: "Help it hold its shape",
  chaperone: "Help it fold",
  replace: "Replace it",
  bypass: "Go around it",
  block_upstream: "Block the step before it",
  inhibit_upstream: "Block the step before it",
  release_brake: "Release the brake on the pathway",
  disinhibit: "Release the brake on the pathway",
  read_through: "Read past the early stop",
  degrade: "Clear it away",
};

/** What a molecule would have to do to the protein: "Turn it down". */
export function plainRequiredAction(action: string | null | undefined): string {
  if (!action) return "Action unknown";
  return ACTIONS[action.toLowerCase()] ?? sentenceCase(action);
}

const MECHANISM_DIRECTIONS: Record<string, string> = {
  gain_of_function: "The protein does too much",
  loss_of_function: "The protein does too little",
  dominant_negative: "The broken copy blocks the good one",
  haploinsufficiency: "One working copy is not enough",
  neomorph: "The protein does something new",
  too_much: "The protein does too much",
  too_little: "The protein does too little",
  increased_activity: "The protein does too much",
  decreased_activity: "The protein does too little",
  increased_function: "The protein does too much",
  decreased_function: "The protein does too little",
  no_function: "The protein does nothing at all",
  altered_function: "The protein works differently",
  unknown: "Direction unknown",
};

/** The direction of the fault itself: "The protein does too much". */
export function plainMechanismDirection(
  direction: string | null | undefined,
): string {
  if (!direction) return "Direction unknown";
  return (
    MECHANISM_DIRECTIONS[direction.toLowerCase()] ?? sentenceCase(direction)
  );
}

/** The candidates panel of a lab run. */
export const CANDIDATE_WORDS = {
  title: "Candidates",
  whatToAimAt: "What to aim at",
  molecule: "Molecule",
  target: "Protein",
  howWeGotHere: "How we got here",
  direction: "Direction",
  ruledOut: "Ruled out",
  ruledOutLine: "Pushed the protein the wrong way.",
  onlyIf: "Only if",
  noCandidates: "No candidate passed the direction check.",
  notReached: "The agents did not reach this step.",
  seeAll: "See the full view",
  phase: "Studied up to",
  noMolecule: "No molecule found yet",
  rejectedBySafety: "Rejected in review",
} as const;

/** "Studied up to phase 4" from a ChEMBL max phase. */
export function plainPhase(phase: number | null | undefined): string | null {
  if (phase == null || !Number.isFinite(phase)) return null;
  if (phase >= 4) return "In use for another disease";
  if (phase >= 1) return `Studied up to phase ${phase}`;
  return "Not studied in people";
}

/** Lab screens: everything below is wording for /lab and a lab run. */

export const LAB_TAGLINE = "AI agents work out why a mutation is harmful.";

const RUN_STATES: Record<string, string> = {
  running: "Running",
  awaiting_approval: "Needs your approval",
  succeeded: "Finished",
  failed: "Failed",
  cancelled: "Stopped",
};

/** A run's state in a word or two: "Finished". */
export function plainRunState(status: string | null | undefined): string {
  if (!status) return "Unknown";
  return RUN_STATES[status] ?? sentenceCase(status);
}

const SOURCES: Record<string, string> = {
  "IUIS classification of human inborn errors of immunity, 2024 update":
    "IUIS 2024",
  "IUIS 2024 classification": "IUIS 2024",
  "ClinVar (NCBI E-utilities)": "ClinVar",
  "PDBe SIFTS best structures": "PDBe",
  "AlphaFold Protein Structure Database": "AlphaFold DB",
  "Orphadata: rare diseases and cross-references (product 1)": "Orphanet",
  "Orphadata: phenotypes associated with rare disorders (product 4)":
    "Orphanet",
  "Human Phenotype Ontology annotations (phenotype.hpoa)": "HPO",
  "Human Phenotype Ontology (hp.obo)": "HPO",
  "HGNC complete gene set": "HGNC",
  "Open Targets Platform": "Open Targets",
  "Gene Curation Coalition (GenCC) submissions": "GenCC",
  "Mondo Disease Ontology": "Mondo",
  UniProtKB: "UniProt",
  "RCSB PDB": "Protein Data Bank",
  "EBI ProtVar": "ProtVar",
  "Ensembl VEP": "Ensembl",
  "PDBe SIFTS": "PDBe",
};

/** A database by the name people say: "UniProt". */
export function plainSource(database: string): string {
  return SOURCES[database] ?? database;
}

/** "3 facts", "1 open question". */
export function plainCount(
  count: number,
  thing: "fact" | "open question" | "test" | "mutation" | "run" | "structure",
): string {
  return plural(count, thing);
}

/** What a test measured, reduced to yes or no by the screen that read the values. */
export interface TestFinding {
  /** contact check: the spot touches a bound molecule */
  touches?: boolean | null;
  /** pocket check: tools that put the spot in a pocket, and tools that looked */
  pocketTools?: number | null;
  toolsRun?: number | null;
  onSurface?: boolean | null;
  lessStable?: boolean | null;
  shapeChanged?: boolean | null;
}

/** One sentence for what a finished test found. One fixed wording per kind of test. */
export function plainResult(
  testKind: string | null | undefined,
  finding: TestFinding = {},
): string {
  switch (testKind) {
    case "ligand_contact":
      if (finding.touches == null) return "No bound molecule to check.";
      return finding.touches
        ? "The mutated spot touches the bound molecule."
        : "The mutated spot does not touch a bound molecule.";
    case "structural_context": {
      const found = finding.pocketTools ?? 0;
      if (finding.onSurface)
        return found > 0
          ? "The mutated spot is in a pocket and on a contact surface."
          : "The mutated spot is on a contact surface.";
      if (found === 0)
        return "The mutated spot is not inside a predicted pocket.";
      if (finding.toolsRun && found < finding.toolsRun)
        return `${found} of ${finding.toolsRun} tools put the mutated spot in a pocket.`;
      return "The mutated spot is inside a predicted pocket.";
    }
    case "stability_effect":
      if (finding.lessStable == null)
        return "No stability prediction for this mutation.";
      return finding.lessStable
        ? "The mutation is predicted to make the protein less stable."
        : "The mutation is not predicted to make the protein less stable.";
    case "structure_comparison":
      if (finding.shapeChanged == null)
        return "The two predicted shapes were compared.";
      return finding.shapeChanged
        ? "The predicted shape changes near the mutation."
        : "The predicted shape stays the same.";
    default:
      return "The test finished.";
  }
}

/** Labels and class words for the numbers a test reports. */
export const RESULT_WORDS = {
  test: "Test",
  touchesIn: "Touches the molecule in",
  structures: "structures",
  closestGap: "Closest gap",
  touching: "Close enough to touch",
  notTouching: "Too far to touch",
  inPocket: "In a pocket",
  tools: "tools",
  onSurface: "On a contact surface",
  yes: "Yes",
  no: "No",
  notChecked: "Not checked",
  pocketConfidence: "Pocket confidence",
  stabilityChange: "Stability change",
  lessStable: "Less stable",
  sameStability: "About the same",
  spotConfidence: "Confidence at this spot",
  shiftNear: "Shift near the mutation",
  shiftOverall: "Shift overall",
  outOf100: "of 100",
  causesAfter: "What it means for each cause",
  testsRun: "Tests run",
} as const;

/** The right column of a run. */
export const METER_WORDS = {
  time: "Time",
  steps: "Steps taken",
  sources: "Sources",
  compute: "Compute used",
  atTheEnd: "Counted at the end",
  none: "None",
} as const;

/** The six step panels of a run. */
export const STEP_WORDS = {
  details: "Details",
  waiting: "Waiting",
  notReached: "Not reached in this run.",
  mutation: "Mutation",
  gene: "Gene",
  change: "Change",
  topCause: "Top cause",
  learn: "Learn",
  effort: "Effort",
  time: "Time",
  chosen: "Chosen",
  alreadyRun: "Already run",
  needsApproval: "Needs your approval",
  approve: "Approve",
  reject: "Reject",
  approved: "Approved",
  rejected: "Not approved",
  safetyOk: "Safety check passed",
  safetyBlocked: "Safety check blocked it",
  before: "Before",
  after: "After",
  answerChanged: "Answer changed",
  answerHeld: "Answer held",
  nextLine: "Suggested by the agents. Not run yet.",
  failed: "The run failed.",
  noAnswer: "The agents did not reach an answer.",
  openQuestions: "Still unknown",
  fullRecord: "Full record",
  noSource: "No source",
  notSaved: "That did not save. Try again.",
  review: "Review",
  replay: "Replay",
  allRuns: "All runs",
} as const;

/** The honest line under a test result: what kind of check it was. */
export function plainTestCaveat(testKind: string | null | undefined): string {
  return testKind === "ligand_contact"
    ? "Computer check on lab-solved structures. Not a lab test."
    : PREDICTION_CAVEAT;
}

/** "Arginine becomes histidine at position 28". Names come from the caller's amino-acid table. */
export function plainChange(
  from: string | null | undefined,
  to: string | null | undefined,
  position: number | null | undefined,
): string | null {
  if (!from || !to || position == null) return null;
  return `${sentenceCase(from.toLowerCase())} becomes ${to.toLowerCase()} at position ${position}`;
}

/** "Next: Lab test". */
export function plainNext(kind: string | null | undefined): string {
  return `Next: ${plainNextKind(kind)}`;
}

/** The front page of the lab. */
export const LAB_WORDS = {
  title: "Discovery lab",
  pickGene: "Pick a gene",
  pickMutation: "Pick a mutation",
  run: "Run",
  starting: "Starting",
  options: "Options",
  recentRuns: "Recent runs",
  allRuns: "All runs",
  recentOnly: "Recent only",
  inProgress: "Working on it",
  noAnswer: "No answer",
  noRuns: "No runs yet.",
  comparison: "Team of agents vs one agent",
  team: "Team of agents",
  oneAgent: "One agent",
  timePerMutation: "Time per mutation",
  sourcesChecked: "Sources checked",
  factsGathered: "Facts gathered",
  changedAnswer: "Changed its answer",
  matchedKnown: "Matched the known answer",
  notMeasured: "Not measured yet.",
  agents: "The agents",
  loadingGenes: "Loading genes",
  noGenes: "No genes to pick",
  loadingMutations: "Loading mutations",
  otherMutation: "Other mutation",
  question: "Question",
  whoRuns: "Who runs it",
  limits: "Limits",
  steps: "Steps",
  computeSeconds: "Compute seconds",
  labChecking: "Checking the lab.",
  labSilent: "The lab is not answering.",
  labMissing: "The lab is not available here.",
  notStarted: "The run did not start.",
  details: "Details",
  hideDetails: "Hide details",
  typicalTime: "The middle value across runs",
  average: "The average across runs",
  featured: "A finished investigation",
  watchIt: "Watch it work",
  firstAnswer: "First answer",
  finalAnswer: "Final answer",
  tookTime: "Took",
} as const;

/** Who ran it: "Team of agents" or "One agent". */
export function plainRunMode(mode: string | null | undefined): string {
  return mode === "single_agent_baseline" ? LAB_WORDS.oneAgent : LAB_WORDS.team;
}

/** "No mutation for BTK yet." */
export function plainNoMutations(gene: string): string {
  return `No mutation for ${gene} yet.`;
}

/** "No mutation matches R28H." */
export function plainNoMatch(text: string): string {
  return `No mutation matches ${text}.`;
}

/** "3 of 5 runs". */
export function plainShare(part: number, whole: number): string {
  return `${part} of ${plural(whole, "run")}`;
}

/** "11 of 26 runs done so far." */
export function plainProgress(done: number, planned: number): string {
  return `${done} of ${plural(planned, "run")} done so far.`;
}

const EVIDENCE_KINDS: Record<string, { name: string; meaning: string }> = {
  experimental: {
    name: "Lab experiment",
    meaning: "Measured in a lab experiment.",
  },
  clinical_database: {
    name: "Medical database",
    meaning: "Listed in a medical database of mutations.",
  },
  literature: {
    name: "Published paper",
    meaning: "Reported in a published paper.",
  },
  curated_database: {
    name: "Database",
    meaning: "Listed in a database checked by experts.",
  },
  computational_prediction: {
    name: "Computer prediction",
    meaning: PREDICTION_CAVEAT,
  },
  helix_hypothesis: {
    name: "Helix idea",
    meaning: HYPOTHESIS_CAVEAT,
  },
};

/** The kind of evidence in everyday words: "Medical database". */
export function plainEvidenceKind(evidenceClass: string): string {
  return EVIDENCE_KINDS[evidenceClass]?.name ?? sentenceCase(evidenceClass);
}

/** One short sentence on what that kind of evidence is. */
export function plainEvidenceMeaning(evidenceClass: string): string {
  return EVIDENCE_KINDS[evidenceClass]?.meaning ?? "";
}

/** What an evidence badge prints: the database name, with predictions still called predictions. */
export function plainEvidenceSource(
  evidenceClass: string,
  database: string | null | undefined,
): string {
  const name = plainDatabase(database);
  if (evidenceClass === "helix_hypothesis") return "Helix idea";
  if (evidenceClass === "computational_prediction")
    return name ? `${name} prediction` : "Computer prediction";
  return name || plainEvidenceKind(evidenceClass);
}

const ORIGIN_LINES: Record<string, { structure: string; caveat: string }> = {
  experimental: {
    structure: "Experimental structure",
    caveat: "Measured in a lab.",
  },
  predicted_external: {
    structure: "Predicted structure",
    caveat: PREDICTION_CAVEAT,
  },
  predicted_internal: {
    structure: "Structure generated here",
    caveat: PREDICTION_CAVEAT,
  },
};

/** The corner tag of the 3D view: "Predicted structure · AlphaFold DB". */
export function plainStructureLine(
  origin: string,
  source?: string | null,
): string {
  const line = ORIGIN_LINES[origin]?.structure ?? "Structure";
  // the method and resolution ("X-ray 2.25 Å") stay in Advanced
  if (origin === "experimental") return `${line} · Measured in a lab`;
  // "AlphaFold DB v6" reads as "AlphaFold DB"
  const name = source?.replace(/\s+v\d[\w.]*$/i, "").trim();
  return name ? `${line} · ${name}` : line;
}

/** Whether a structure was measured or predicted, as one short sentence. */
export function plainOriginCaveat(origin: string): string {
  return ORIGIN_LINES[origin]?.caveat ?? "";
}

/** A confidence band on its own: "Very high". */
export function plainConfidenceBand(plddt: number | null | undefined): string {
  return plainConfidence(plddt).replace(/ confidence$/, "");
}

export const CONFIDENCE_LABEL = "Confidence";

const AMINO_ACIDS: Record<string, string> = {
  A: "Ala",
  R: "Arg",
  N: "Asn",
  D: "Asp",
  C: "Cys",
  Q: "Gln",
  E: "Glu",
  G: "Gly",
  H: "His",
  I: "Ile",
  L: "Leu",
  K: "Lys",
  M: "Met",
  F: "Phe",
  P: "Pro",
  S: "Ser",
  T: "Thr",
  W: "Trp",
  Y: "Tyr",
  V: "Val",
};

/** One spot in the protein: "Arg28", or "Position 28" when the letter is unknown. */
export function plainResidue(
  letter: string | null | undefined,
  position: number,
): string {
  const name = letter ? AMINO_ACIDS[letter.toUpperCase()] : undefined;
  return name ? `${name}${position}` : `Position ${position}`;
}

/** The current selection on the sequence: "Arg28", "Positions 3 to 133", "2 regions". */
export function plainSelection(
  ranges: ReadonlyArray<{ start: number; end: number }>,
  sequence?: string | null,
): string | null {
  if (ranges.length === 0) return null;
  if (ranges.length > 1) return `${ranges.length} regions`;
  const [{ start, end }] = ranges;
  if (start === end) return plainResidue(sequence?.[start - 1], start);
  return `Positions ${start} to ${end}`;
}

/** A mutation as a swap: "p.Arg28His" and "R28H" read "Arg28 → His". Other text is kept. */
export function plainMutation(change: string | null | undefined): string {
  if (!change) return "Mutation";
  const text = change.replace(/^.*p\./, "").trim();
  const long = /^([A-Z][a-z]{2})(\d+)([A-Z][a-z]{2})$/.exec(text);
  if (long) {
    const [, from, position, to] = long;
    return to === "Ter"
      ? `${from}${position} → stop`
      : `${from}${position} → ${to}`;
  }
  const short = /^([A-Z])(\d+)([A-Z*])$/.exec(text);
  if (short) {
    const [, from, position, to] = short;
    const target = to === "*" ? "stop" : (AMINO_ACIDS[to] ?? to);
    return `${AMINO_ACIDS[from] ?? from}${position} → ${target}`;
  }
  return text;
}

export const SEQUENCE_LABEL = "Protein sequence";

/** "659 amino acids" */
export function plainLength(count: number): string {
  return plural(count, "amino acid");
}

/** "207 harmful mutation sites" */
export function plainHarmfulSites(count: number): string {
  return `${count.toLocaleString("en-US")} harmful mutation ${count === 1 ? "site" : "sites"}`;
}

const STAGES: Record<string, { name: string; needs: string }> = {
  disease: { name: "Disease", needs: "Search for a disease first." },
  gene: { name: "Gene", needs: "Pick a gene first." },
  protein: { name: "Protein", needs: "Pick a gene first." },
  compare: { name: "Compare", needs: "Pick a mutation first." },
  mechanism: { name: "Cause", needs: "Pick a mutation first." },
  intervention: { name: "Options", needs: "Pick a mutation first." },
  candidates: { name: "Candidates", needs: "Pick a gene first." },
};

/** Each stage in a word: Disease, Gene, Protein, Compare, Cause, Options, Candidates. */
export function plainStage(stage: string): string {
  return STAGES[stage]?.name ?? sentenceCase(stage);
}

/** Why a stage can't open yet. */
export function plainStageNeeds(stage: string): string {
  return STAGES[stage]?.needs ?? "Not ready yet.";
}

/** Simple mode shows three questions instead of seven stages. */
const STAGE_GROUPS: Record<string, { name: string; needs: string }> = {
  mutation: { name: "The mutation", needs: "Pick a gene first." },
  breaks: { name: "What it breaks", needs: "Pick a mutation first." },
  help: { name: "What could help", needs: "Pick a gene first." },
};

/** A group in a few words: "The mutation", "What it breaks", "What could help". */
export function plainStageGroup(group: string): string {
  return STAGE_GROUPS[group]?.name ?? sentenceCase(group);
}

/** Why a group can't open yet. */
export function plainStageGroupNeeds(group: string): string {
  return STAGE_GROUPS[group]?.needs ?? "Not ready yet.";
}

/** Links that reach a page inside a group, from the page it sits with. */
export const GROUP_LINKS = {
  compare: "Compare normal and mutated",
  pickMutation: "Pick a mutation first",
  options: "Known drugs",
  candidates: "Candidates",
} as const;

const SHAPES: Record<string, string> = {
  cartoon: "Cartoon",
  surface: "Surface",
  "ball-and-stick": "Atoms",
};

/** How the 3D structure is drawn: Cartoon, Surface, Atoms. */
export function plainShape(representation: string): string {
  return SHAPES[representation] ?? sentenceCase(representation);
}

const COLOURINGS: Record<string, { name: string; missing: string }> = {
  confidence: {
    name: "Confidence",
    missing: "Only for predicted structures",
  },
  chain: { name: "Chain", missing: "" },
  domain: { name: "Region", missing: "No regions known" },
  "secondary-structure": { name: "Fold type", missing: "" },
  alphamissense: { name: "Mutation impact", missing: "No scores loaded" },
  "reference-variant": {
    name: "Mutation site",
    missing: "Pick a mutation first",
  },
  structure: { name: "Structure", missing: "" },
};

export const COLOUR_BY = "Colour by";

/** What the 3D structure is coloured by: Confidence, Chain, Region, Mutation impact. */
export function plainColouring(mode: string): string {
  return COLOURINGS[mode]?.name ?? sentenceCase(mode);
}

/** Why a colouring can't be used right now. */
export function plainColouringMissing(mode: string): string {
  return COLOURINGS[mode]?.missing || "Not available";
}

const IMPACTS: Record<string, string> = {
  likely_pathogenic: "Likely harmful",
  pathogenic: "Likely harmful",
  ambiguous: "Unclear",
  uncertain: "Unclear",
  likely_benign: "Likely harmless",
  benign: "Likely harmless",
};

/** A predicted impact class in everyday words: "Likely harmful". */
export function plainImpact(impactClass: string | null | undefined): string {
  if (!impactClass) return "No score";
  const key = impactClass
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return IMPACTS[key] ?? sentenceCase(impactClass);
}

export const VIEWER_WORDS = {
  resetView: "Reset view",
  saveImage: "Save image",
  saveImageWhite: "Save image, white background",
  more: "More",
  selectRegion: "Select a region",
  zoomToSelection: "Zoom to selection",
  fullScreen: "Full screen",
  exitFullScreen: "Exit full screen",
  download: "Download 3D file",
  lineUpBy: "Line up by",
  lineUpSequence: "Sequence",
  lineUpShape: "Shape",
  normal: "Normal",
  mutationSite: "Mutation site",
  noRegion: "No region",
  noScore: "No score",
  loading: "Loading the structure",
  starting: "Starting the 3D view",
  empty: "No structure to show",
} as const;

/** "This structure doesn't cover position 28." */
export function plainNotCovered(position: number): string {
  return `This structure doesn't cover position ${position}.`;
}

export const CHAIN_COLOUR_NOTE = "Lab-measured structure. Coloured by chain.";

interface PlainMetric {
  label: string;
  /** printed after the number */
  unit?: string;
  /** two plain sentences at most */
  meaning: string;
  /** the technical term inside a caller's label that the plain label replaces */
  jargon: RegExp;
  word?: (value: number) => string;
  /** the word says it all and the number moves to hover */
  wordOnly?: boolean;
}

const PLAIN_METRICS: Record<string, PlainMetric> = {
  plddt: {
    label: "Confidence",
    unit: "of 100",
    meaning:
      "How sure the computer is about this part of the shape. Higher is better.",
    jargon: /pLDDT/,
    word: (value) => plainConfidenceBand(value),
  },
  pae: {
    label: "Position error",
    meaning:
      "How unsure the computer is about where two parts sit. Lower is better.",
    jargon: /PAE/,
  },
  ptm: {
    label: "Shape score",
    unit: "of 1",
    meaning:
      "How sure the computer is about the whole shape. Higher is better.",
    jargon: /pTM/,
    word: (value) => (value > 0.5 ? "Plausible" : "Unsure"),
  },
  iptm: {
    label: "Contact score",
    unit: "of 1",
    meaning:
      "How sure the computer is about where two chains touch. Higher is better.",
    jargon: /ipTM/,
    word: (value) =>
      value > 0.8 ? "Confident" : value >= 0.6 ? "Unsure" : "Poor",
  },
  alphamissense: {
    label: "Harm prediction",
    unit: "of 1",
    meaning:
      "A computer's guess at how harmful this mutation is. Closer to 1 means more likely harmful.",
    jargon: /AlphaMissense|Pathogenicity/i,
    word: (value) =>
      value > 0.564
        ? "Likely harmful"
        : value < 0.34
          ? "Likely harmless"
          : "Unclear",
  },
  ddg: {
    label: "Stability change",
    meaning:
      "A computer's guess at whether the mutation makes the protein less stable.",
    jargon: /(Predicted\s+)?ΔΔG/i,
    word: (value) => (value >= 2 ? "Less stable" : "Little change"),
    wordOnly: true,
  },
  affinity: {
    label: "Binding strength",
    meaning:
      "A computer's guess at how tightly the molecule sticks. Lower is tighter.",
    jargon: /(Predicted\s+)?affinity/i,
  },
  binder_probability: {
    label: "Chance it binds",
    unit: "of 1",
    meaning:
      "A computer's guess at whether the molecule sticks to the protein.",
    jargon: /Binder probability/i,
  },
};

/** A metric's everyday label. A caller's label keeps its own words around the term: "Confidence at Arg28". */
export function plainMetricLabel(
  metric: string,
  callerLabel?: string | null,
): string {
  const entry = PLAIN_METRICS[metric];
  if (!entry) return callerLabel ?? sentenceCase(metric);
  if (!callerLabel) return entry.label;
  if (!entry.jargon.test(callerLabel)) return callerLabel;
  const text = callerLabel
    .replace(entry.jargon, entry.label.toLowerCase())
    .replace(/\bmean\b/i, "average")
    .replace(/\s+/g, " ")
    .trim();
  return text[0].toUpperCase() + text.slice(1);
}

/** What a metric's value means, as a word: "High", "Likely harmful". Null when there is none. */
export function plainMetricWord(metric: string, value: number): string | null {
  return PLAIN_METRICS[metric]?.word?.(value) ?? null;
}

/** The unit printed after a metric's number: "of 100". */
export function plainMetricUnit(metric: string): string | null {
  return PLAIN_METRICS[metric]?.unit ?? null;
}

/** True when the word replaces the number on screen. */
export function plainMetricWordOnly(metric: string): boolean {
  return PLAIN_METRICS[metric]?.wordOnly ?? false;
}

/** A metric explained in two plain sentences at most. */
export function plainMetricMeaning(metric: string): string | null {
  return PLAIN_METRICS[metric]?.meaning ?? null;
}

const PLAIN_UNITS: Record<string, string> = {
  aa: "amino acids",
  residues: "amino acids",
};

/** A unit in everyday words: "aa" reads "amino acids". Others are printed as given. */
export function plainUnit(unit: string): string {
  return PLAIN_UNITS[unit.trim().toLowerCase()] ?? unit;
}

const PLAIN_LABELS: Record<string, string> = {
  residues: "Length",
  "run time": "Time taken",
};

/** A readout's heading in everyday words: "Residues" reads "Length". */
export function plainReadoutLabel(label: string): string {
  return PLAIN_LABELS[label.trim().toLowerCase()] ?? label;
}

export const MORE_LABEL = "More";
export const DETAILS_LABEL = "Details";
export const OPEN_SOURCE_LABEL = "Open the source";

export const HOME_LINE = "See how a mutation breaks a protein.";
export const SEARCH_HINT = "Search a disease, gene or mutation";
export const EXAMPLES_LABEL = "Try a gene";
export const OPEN_LAB_LABEL = "Open the Lab";

export const STATUS_WORDS = {
  checking: "Checking the connection",
  connected: "Connected",
  offline: "Can't reach the server",
  sourceDown: "Some sources are not answering",
} as const;

export const SEARCH_WORDS = {
  goTo: "Go to",
  nothing: "Nothing found.",
  tryThis: "Try a gene name like BTK.",
  browse: "Browse all genes",
  searching: "Searching",
  outside: "Not in our gene list",
  offline: "Can't reach the server.",
  retry: "Try again",
} as const;

export const MENU_WORDS = {
  ask: "Ask a question",
  shortcuts: "Keyboard shortcuts",
  advanced: "Advanced",
  learn: "Explain terms",
  theme: "Theme",
  source: "Source code",
} as const;

const ROLES: Record<string, string> = {
  reference: "Normal protein",
  variant: "Mutated protein",
  mutant: "Mutated protein",
};

/** Which protein a structure shows when two are compared: "Normal protein", "Mutated protein". */
export function plainRole(role: string): string {
  return ROLES[role.trim().toLowerCase()] ?? role;
}

const LEGEND_WORDS: Record<string, string> = {
  domain: "Region",
  "secondary structure": "Fold type",
  "not annotated": VIEWER_WORDS.noRegion,
  reference: VIEWER_WORDS.normal,
  variant: VIEWER_WORDS.mutationSite,
  "variant site": VIEWER_WORDS.mutationSite,
  "alpha helix": "Helix",
  "3-10 helix": "Tight helix",
  "pi helix": "Wide helix",
  strand: "Sheet",
  coil: "Loop",
};

/** A legend title or entry in everyday words: "Domain" reads "Region". Others are printed as given. */
export function plainLegendWord(text: string): string {
  return LEGEND_WORDS[text.trim().toLowerCase()] ?? text;
}

/** Journey pages: disease, gene, mutation, protein, compare, cause and options. */

const AMINO_ACID_NAMES: Record<string, string> = {
  Ala: "alanine",
  Arg: "arginine",
  Asn: "asparagine",
  Asp: "aspartate",
  Cys: "cysteine",
  Gln: "glutamine",
  Glu: "glutamate",
  Gly: "glycine",
  His: "histidine",
  Ile: "isoleucine",
  Leu: "leucine",
  Lys: "lysine",
  Met: "methionine",
  Phe: "phenylalanine",
  Pro: "proline",
  Ser: "serine",
  Thr: "threonine",
  Trp: "tryptophan",
  Tyr: "tyrosine",
  Val: "valine",
  Sec: "selenocysteine",
};

/** An amino acid by its full name, from a one- or three-letter code: "arginine". */
export function plainAminoAcid(code: string | null | undefined): string | null {
  if (!code) return null;
  const three =
    code.length === 1
      ? AMINO_ACIDS[code.toUpperCase()]
      : code[0].toUpperCase() + code.slice(1).toLowerCase();
  return (three && AMINO_ACID_NAMES[three]) ?? null;
}

/** One spot in the protein, spelled out: "Arginine 28". */
export function plainSpot(
  code: string | null | undefined,
  position: number,
): string {
  const name = plainAminoAcid(code);
  return name ? `${sentenceCase(name)} ${position}` : `Position ${position}`;
}

/** Any protein change as a short row: "Arg28 → His", "Scrambled from Gln15", "Lys60 removed". */
export function plainMutationRow(change: string | null | undefined): string {
  if (!change) return "Mutation";
  const text = change.replace(/^.*p\./, "").trim();
  const shift = /^([A-Z][a-z]{2}\d+)(?:[A-Z][a-z]{2})?fs/.exec(text);
  if (shift) return `Scrambled from ${shift[1]}`;
  const range =
    /^([A-Z][a-z]{2}\d+)(?:_([A-Z][a-z]{2}\d+))?(delins|del|dup|ins)/.exec(
      text,
    );
  if (range) {
    const spot = range[2] ? `${range[1]} to ${range[2]}` : range[1];
    if (range[3] === "del") return `${spot} removed`;
    if (range[3] === "dup") return `${spot} repeated`;
    if (range[3] === "ins") return `Added after ${range[1]}`;
    return `${spot} replaced`;
  }
  const silent = /^([A-Z][a-z]{2}\d+)=$/.exec(text);
  if (silent) return `${silent[1]} unchanged`;
  const lost = /^([A-Z][a-z]{2}\d+)\?$/.exec(text);
  if (lost) return `${lost[1]} lost`;
  if (/ext/.test(text)) return "Protein made longer";
  return plainMutation(change);
}

const CHANGE_KINDS: Record<string, string> = {
  missense: "One amino acid swapped",
  stop_gained: "Protein cut short",
  nonsense: "Protein cut short",
  frameshift: "Scrambled from this point on",
  inframe_deletion: "Amino acids removed",
  inframe_insertion: "Amino acids added",
  synonymous: "No amino acid changed",
  start_lost: "Start signal lost",
  stop_lost: "Protein made longer",
  splice_donor: "Gene pieces joined wrongly",
  splice_acceptor: "Gene pieces joined wrongly",
  splice_region: "Gene pieces joined wrongly",
};

/** What kind of change a mutation is, from its consequence term: "One amino acid swapped". */
export function plainChangeKind(
  consequence: string | null | undefined,
): string {
  if (!consequence) return "Mutation";
  const key = consequence.toLowerCase().replace(/_variant$/, "");
  return CHANGE_KINDS[key] ?? sentenceCase(key);
}

const INHERITANCE: Record<string, string> = {
  XL: "Passed on the X chromosome",
  XLR: "Passed on the X chromosome",
  XLD: "Passed on the X chromosome",
  AR: "Needs a faulty copy from each parent",
  AD: "One faulty copy is enough",
  MT: "Passed on from the mother",
  YL: "Passed on the Y chromosome",
};

/** How a disease is inherited, in words. Null when the code is not one we know. */
export function plainInheritance(
  code: string | null | undefined,
): string | null {
  if (!code) return null;
  return INHERITANCE[code.trim().toUpperCase()] ?? null;
}

/** The disease in one line built from its record: "An inherited immune disease caused by mutations in the BTK gene." */
export function plainDiseaseLine(facts: {
  gene?: string | null;
  inherited?: boolean;
  immune?: boolean;
}): string {
  const kind = facts.immune ? "immune disease" : "disease";
  const lead = facts.inherited
    ? `An inherited ${kind}`
    : `A${facts.immune ? "n" : ""} ${kind}`;
  return facts.gene
    ? `${lead} caused by mutations in the ${facts.gene} gene.`
    : `${lead}. No gene named yet.`;
}

/** How often a symptom shows up, from the source's band or patient count: "Very common", "13 of 19 patients". */
export function plainFrequency(frequency: string | null | undefined): string {
  if (!frequency) return "";
  const count = /^(\d+)\s*\/\s*(\d+)$/.exec(frequency.trim());
  if (count) return `${count[1]} of ${count[2]} patients`;
  const text = frequency.toLowerCase();
  if (text.includes("obligate")) return "Always";
  if (text.includes("very frequent")) return "Very common";
  if (text.includes("frequent")) return "Common";
  if (text.includes("occasional")) return "Sometimes";
  if (text.includes("very rare")) return "Very rare";
  if (text.includes("excluded")) return "Never";
  return frequency;
}

/** "548 harmful mutations found in BTK" */
export function plainHarmfulCount(count: number, gene: string): string {
  return `${count.toLocaleString("en-US")} harmful ${count === 1 ? "mutation" : "mutations"} found in ${gene}`;
}

/** "Classified pathogenic by ClinVar" */
export function plainClassifiedBy(
  significance: string | null | undefined,
  source = "ClinVar",
): string {
  if (!significance) return `Not classified by ${source}`;
  return `Classified ${plainClinicalClass(significance).toLowerCase()} by ${source}`;
}

/** How many expert groups agree, from ClinVar's 0 to 4 review stars. */
export function plainReview(stars: number | null | undefined): string {
  if (stars == null) return "";
  if (stars >= 3) return "Reviewed by an expert panel";
  if (stars === 2) return "Several labs agree";
  if (stars === 1) return "Reported by one lab";
  return "Not reviewed";
}

/** Whether healthy-population data has the mutation: "Seen once in population data". */
export function plainPopulation(
  status: string | null | undefined,
  count?: number | null,
): string {
  if (status === "observed") {
    if (count == null) return "Seen in population data";
    return count === 1
      ? "Seen once in population data"
      : `Seen ${count.toLocaleString("en-US")} times in population data`;
  }
  if (status === "not_observed" || status === "absent")
    return "Not seen in population data";
  return "No population data";
}

/** One prediction as a statement with its model named: "AlphaMissense: likely harmful". */
export function plainPrediction(model: string, reading: string): string {
  return `${model}: ${reading[0].toLowerCase()}${reading.slice(1)}`;
}

/** A stability prediction as a statement: "Stability: little change predicted". */
export function plainStabilityLine(ddg: number): string {
  return `Stability: ${ddg >= 2 ? "less stable" : "little change"} predicted`;
}

/** "659 building blocks (amino acids)" */
export function plainBuildingBlocks(count: number): string {
  return `${count.toLocaleString("en-US")} building blocks (amino acids)`;
}

/** How much of the protein a structure shows: "Whole protein", "Positions 1 to 143". */
export function plainCoverage(
  start: number | null | undefined,
  end: number | null | undefined,
  length: number | null | undefined,
): string {
  if (start == null || end == null) return "Part of the protein";
  if (length != null && start <= 1 && end >= length) return "Whole protein";
  return `Positions ${start} to ${end}`;
}

const SUPPORT: Record<string, { word: string; why: string }> = {
  experimental_annotation: {
    word: "Strong support",
    why: "Backed by lab experiments.",
  },
  curated_annotation: {
    word: "Some support",
    why: "Listed in a database checked by experts.",
  },
  computational_prediction: {
    word: "Weak support",
    why: "Computer prediction only.",
  },
};

/** How strong the support for a possible cause is: "Strong support". */
export function plainSupport(kind: string | null | undefined): string {
  if (!kind) return "No support found";
  return SUPPORT[kind]?.word ?? sentenceCase(kind);
}

/** Why the support counts as strong, some or weak. */
export function plainSupportWhy(kind: string | null | undefined): string {
  return (kind && SUPPORT[kind]?.why) || "";
}

const DRUG_KINDS: Record<string, string> = {
  "small molecule": "Small molecule",
  small_molecule: "Small molecule",
  antibody: "Antibody",
  protein: "Protein drug",
  biologic: "Biological drug",
  oligonucleotide: "Gene-targeting drug",
  cell_or_gene_therapy: "Cell or gene therapy",
  "cell or gene therapy": "Cell or gene therapy",
  procedure: "Procedure",
  unknown: "Type not stated",
  "unknown modality": "Type not stated",
};

/** What a drug or molecule is: "Small molecule". */
export function plainDrugKind(modality: string | null | undefined): string {
  if (!modality) return "Type not stated";
  return DRUG_KINDS[modality.trim().toLowerCase()] ?? sentenceCase(modality);
}

/** How far a drug has got, from its trial phase and approval year: "Approved in 2013", "Late trials". */
export function plainDrugStage(
  maxPhase: number | null | undefined,
  firstApproval?: number | null,
): string | null {
  if (maxPhase == null) return null;
  if (maxPhase >= 4)
    return firstApproval ? `Approved in ${firstApproval}` : "Approved";
  if (maxPhase >= 3) return "Late trials";
  if (maxPhase >= 2) return "Mid trials";
  if (maxPhase > 0) return "Early trials";
  return "Not in trials yet";
}

const CONCENTRATIONS: Record<string, string> = {
  nM: "nanomolar",
  uM: "micromolar",
  µM: "micromolar",
  μM: "micromolar",
  mM: "millimolar",
  pM: "picomolar",
};

/** A concentration unit spelled out for a tooltip: "nM" reads "nanomolar". */
export function plainConcentration(unit: string): string {
  return CONCENTRATIONS[unit.trim()] ?? unit;
}

/** "76 lab tests" */
export function plainLabTests(count: number): string {
  return `${count.toLocaleString("en-US")} lab ${count === 1 ? "test" : "tests"}`;
}

/** "Seen in 2 lab structures" */
export function plainSeenIn3d(count: number): string {
  return count === 1 ? "1 lab structure" : `${count} lab structures`;
}

export const DISEASE_WORDS = {
  title: "Disease",
  gene: "Gene",
  protein: "Protein",
  inheritance: "Inherited",
  inheritanceUnknown: "Not stated",
  /** the direction of the fault, which decides what a drug would have to do */
  fault: "What goes wrong",
  faultUnknown: "Not stated in the catalog",
  harmful: "Harmful mutations found",
  labStructures: "Structures solved in the lab",
  symptoms: "Symptoms",
  noSymptoms: "No symptoms listed",
  medical: "Medical definition",
  noGene: "No gene named",
  noProtein: "No protein found",
  noStructure: "No structure to show",
  seeMutations: "See the mutations",
  symptom: "Symptom",
  howOften: "How often",
  source: "Source",
  openRecord: "Open the full record",
  summary: "Summary",
  clear: "Close",
} as const;

export const GENE_WORDS = {
  mutation: "Mutation",
  classification: "Classification",
  classifiedBy: "Classified by ClinVar. Pick one to see more.",
  filter: "Filter",
  filtered: "Filtered list",
  search: "Search mutations",
  noMatch: "No mutation matches",
  reset: "Show all harmful mutations",
  notClassified: "Not classified",
  previous: "Previous page",
  next: "Next page",
  noProtein: "No protein found for this gene",
} as const;

export const MUTATION_WORDS = {
  title: "Mutation",
  classification: "Medical classification",
  disease: "Disease",
  noDisease: "No disease named",
  population: "General population",
  predictions: "Computer predictions",
  noPredictions: "No predictions for this kind of mutation",
  highlighted: "highlighted",
  compare: "Compare normal and mutated",
  cause: "Possible causes",
  harmScore: "Harm score",
  confidenceHere: "Confidence here",
  stability: "Stability change",
  noProtein: "No protein found for this mutation",
  close: "Close the details",
} as const;

export const PROTEIN_WORDS = {
  structure: "Structure",
  from: "Where it came from",
  change: "Change",
  parts: "Regions",
  confidence: "Model confidence",
  length: "Length",
  shown: "Shown",
  download: "Download sequence",
  position: "Position",
  mutationsHere: "Mutations here",
  noMutationsHere: "No mutation recorded here",
  loadingMutations: "Loading mutations",
  showIn3d: "Show in 3D",
  shownIn3d: "Shown",
} as const;

export const COMPARE_WORDS = {
  title: "Normal and mutated",
  normal: "Normal",
  mutated: "Mutated",
  sideBySide: "Side by side",
  overlaid: "Overlaid",
  difference: "Difference",
  moved: "How much the shape moved",
  movedMost: "Where the shape moved most",
  partModelled: "Part modelled",
  angstrom: "Å is one ten-millionth of a millimetre",
  small: "Small moves can be noise.",
  sources: "Why",
  spotMoved: "How far this spot moved",
  sameInBoth: "Same in both",
  unsure: "Too unsure to compare here",
  notModelled: "Outside the part that was modelled.",
  touchesGained: "New neighbours",
  touchesLost: "Lost neighbours",
  touchesKept: "Kept neighbours",
  none: "No comparison yet",
  running: "Working on it. The result shows here.",
  cannotRun: "No model can run this right now.",
  run: "Run comparison",
  loadSaved: "Load saved result",
  needsBothShapes:
    "A comparison needs a predicted shape for the normal protein and for the mutated one.",
  serviceDown:
    "No prediction service can run right now: the public ESMFold endpoint is returning errors.",
  savedOnes: "These mutations have a saved comparison:",
  aboutMutation: "About this mutation",
} as const;

/** Mutations with a stored comparison, offered when none can be computed. */
export const COMPARE_EXAMPLES = [
  { gene: "BTK", change: "p.Arg28His", label: "BTK Arg28 → His" },
  { gene: "BTK", change: "p.Arg525Gln", label: "BTK Arg525 → Gln" },
  { gene: "WAS", change: "p.Thr45Met", label: "WAS Thr45 → Met" },
] as const;

const PROXIMITY: Record<string, string> = {
  at_residue: "At the mutated spot",
  structure_contact: "Touches the mutated spot in a lab structure",
  covering_region: "In a region that covers the spot",
  sequence_neighbour: "Right next to the mutated spot",
  protein_level: "About the whole protein",
};

/** Where a piece of evidence sits relative to the mutation: "At the mutated spot". */
export function plainProximity(proximity: string | null | undefined): string {
  if (!proximity) return "Related record";
  return PROXIMITY[proximity] ?? sentenceCase(proximity);
}

export const CAUSE_WORDS = {
  title: "What might this mutation break?",
  heading: "Possible causes",
  none: "No evidence found",
  noCause: "No possible cause found",
  toTest: "An idea to test. Not proven.",
  notRuledOut: "This does not rule it out.",
  shown: "Shown: the mutated spot and what it touches.",
  spotShown: "The mutated spot is highlighted.",
  evidence: "Evidence",
  read: "What we read",
  nothingHere: "Nothing recorded at this spot",
  save: "Save this idea",
  openMutation: "Open the mutation",
  structure: "Structure",
  labStructure: "Lab structure",
  noStructure: "No lab or predicted structure found.",
} as const;

const OPTION_GROUPS: Record<string, string> = {
  Drugs: "Drugs",
  "Disease drugs": "Drugs for this disease",
  "Measured ligands": "Tested in the lab",
  "Bound in structures": "Seen bound in 3D",
  "Predicted pockets": "Possible binding spots",
  Partners: "Partner proteins",
  Associations: "Linked proteins",
  Mechanisms: "How the drugs work",
};

/** A group in the Options side list, in everyday words: "Predicted pockets" reads "Possible binding spots". */
export function plainOptionGroup(group: string): string {
  return OPTION_GROUPS[group] ?? group;
}

/** "Spot 3": a predicted binding pocket by its rank. */
export function plainBindingSpot(rank: number): string {
  return `Spot ${rank}`;
}

/** A 0 to 1 probability as a chance: "83% chance". */
export function plainChance(probability: number | null | undefined): string {
  if (probability == null || !Number.isFinite(probability)) return "";
  return `${Math.round(probability * 100)}% chance`;
}

/** "3 drugs" */
export function plainDrugCount(count: number): string {
  return plural(count, "drug");
}

export const OPTIONS_WORDS = {
  title: "Drugs and molecules known to bind this protein",
  name: "Name",
  kind: "What it is",
  stage: "Stage",
  strength: "Measured strength",
  seenIn3d: "Seen bound in 3D",
  predicted: "Predicted strength",
  predictedNote: "Computer prediction",
  source: "Source",
  none: "None found",
  no: "No",
  noValue: "No value",
  noStage: "Not stated",
  noDrawing: "No drawing",
  sourceDown: "Source not answering",
  empty: "No drugs or molecules found for this protein",
  loading: "Loading from drug databases. Can take 45 seconds.",
  footer: "Strength is measured in lab tests. Lower means stronger.",
  more: "More about this protein",
  predictionOnly: "prediction only",
  findingStructure: "Finding a structure",
  fullPage: "Full page",
  labStructures: "Lab structures",
  bindsAt: "Where it binds",
  notSeenIn3d: "Not seen bound in a lab structure",
  howItWorks: "How it works",
  inPatients: "Use in patients",
  forDisease: "for this disease",
  kindRow: "Type",
  usedFor: "Used for",
  reports: "Reports",
  predictedBinding: "Predicted binding",
  notOffered: "No prediction for this one",
  notAvailable: "not available right now",
  showIn3d: "Show in 3D",
  lowerStronger: "Lower means stronger.",
  molecule: "Molecule",
  withProtein: "See it with the protein",
  weight: "Weight",
  formula: "Formula",
  codes: "Codes",
  actsOn: "Proteins it acts on",
  similar: "Similar molecules",
  otherDatabases: "Other databases",
} as const;

/** A trial stage label from a source, in everyday words: "Phase 3" reads "Late trials". */
export function plainStageLabel(
  label: string | null | undefined,
): string | null {
  if (!label) return null;
  const phase = /phase\s*(\d)/i.exec(label);
  if (phase) return plainDrugStage(Number(phase[1]));
  return label;
}

export const PANEL_WORDS = { list: "List", details: DETAILS_LABEL } as const;

const PANELS: Record<string, string> = {
  ledger: "List",
  variants: "Mutations",
  variant: "Mutation",
  candidates: "Possible causes",
  phenotypes: "Symptoms",
  evidence: "More",
  structures: "Structures",
  selection: DETAILS_LABEL,
  inspector: DETAILS_LABEL,
  residue: DETAILS_LABEL,
  detail: DETAILS_LABEL,
  record: DETAILS_LABEL,
};

/** A phone panel button in everyday words: "Variants" reads "Mutations". */
export function plainPanel(label: string): string {
  return PANELS[label.trim().toLowerCase()] ?? label;
}

const SOURCE_STATES: Record<string, string> = {
  ok: "Working",
  empty: "Nothing found",
  unavailable: "Not answering",
  disabled_by_license: "Switched off",
  not_configured: "Not set up",
};

/** How a data source is doing, in a word or two: "Working", "Not answering". */
export function plainSourceState(state: string): string {
  return SOURCE_STATES[state] ?? sentenceCase(state);
}

/** "5 of 6 sources answered" */
export function plainSourceSummary(answered: number, total: number): string {
  if (total === 0) return "No sources used yet";
  return answered === total
    ? `All ${plural(total, "source")} answered`
    : `${answered} of ${plural(total, "source")} answered`;
}

export const HARMFUL_SITES_HINT =
  "Places where a medical database lists a harmful mutation";
export const STEPS_LABEL = "Steps";
export const CHOOSE_STEP_LABEL = "Choose a step";

const DATABASES: Record<string, string> = {
  uniprot: "UniProt",
  uniprotkb: "UniProt",
  clinvar: "ClinVar",
  gnomad: "gnomAD",
  pdb: "Protein Data Bank",
  rcsb: "Protein Data Bank",
  "rcsb pdb": "Protein Data Bank",
  pdbe: "Protein Data Bank",
  afdb: "AlphaFold DB",
  alphafold: "AlphaFold DB",
  "alphafold db": "AlphaFold DB",
  alphamissense: "AlphaMissense",
  interpro: "InterPro",
  pubmed: "PubMed",
  europepmc: "Europe PMC",
  "europe pmc": "Europe PMC",
  orphanet: "Orphanet",
  hgnc: "HGNC",
  omim: "OMIM",
  chembl: "ChEMBL",
  foldx: "FoldX",
  p2rank: "P2Rank",
  prankweb: "PrankWeb",
  foldseek: "Foldseek",
  unichem: "UniChem",
  reactome: "Reactome",
  intact: "IntAct",
  string: "STRING",
  "string db": "STRING",
  opentargets: "Open Targets",
  "open targets": "Open Targets",
  "open targets platform": "Open Targets",
  ensembl: "Ensembl",
  mondo: "MONDO",
  iuis: "IUIS",
  helix: "Helix",
};

/** A database's name as it writes itself: "uniprot" reads "UniProt". */
export function plainDatabase(name: string | null | undefined): string | null {
  const text = name?.trim();
  if (!text) return null;
  return DATABASES[text.toLowerCase().replace(/[_-]+/g, " ")] ?? text;
}

const COMMANDS: Record<string, string> = {
  compare: "Compare with the normal protein",
  predict: "Predict the structure",
  pockets: "Find pockets a drug could fit",
  "add-to-project": "Save to a project",
  "export-structure": VIEWER_WORDS.download,
  "ask-orpha": MENU_WORDS.ask,
  learn: MENU_WORDS.learn,
  advanced: MENU_WORDS.advanced,
  "theme-toggle": "Switch light or dark",
  "theme-system": "Theme: match my device",
  shortcuts: MENU_WORDS.shortcuts,
};

/** A search-box command in everyday words. Null keeps the command's own label. */
export function plainCommand(id: string): string | null {
  return COMMANDS[id] ?? null;
}

const COMMAND_GROUPS: Record<string, string> = {
  actions: "Do",
  stages: STEPS_LABEL,
  preferences: "Settings",
  assistant: "Ask",
  compounds: "Molecules",
  variants: "Mutations",
  "parsed input": SEARCH_WORDS.goTo,
};

/** A heading in the search box: "Preferences" reads "Settings". */
export function plainCommandGroup(heading: string): string {
  return COMMAND_GROUPS[heading.trim().toLowerCase()] ?? heading;
}

export const PALETTE_WORDS = {
  title: "Search",
  noCommand: "Nothing matches.",
  jumpTo: "Jump to",
} as const;

const SEQUENCE_ROWS: Record<string, string> = {
  clinical: "Mutations",
  residue: "Position",
  population: "How common",
  domains: "Main regions",
  domain: "Main regions",
  regions: "Other regions",
  sites: "Key spots",
  "sec. structure": "Fold type",
  structures: "3D structures",
  exp: "Lab-measured",
  prd: "Predicted",
  of: "Generated here",
  "am (predicted)": "Mutation impact",
  conservation: "Kept across species",
  plddt: CONFIDENCE_LABEL,
  confidence: CONFIDENCE_LABEL,
  alphamissense: "Mutation impact",
  pathogenicity: "Mutation impact",
  "secondary structure": "Fold type",
  coverage: "3D structures",
  "structure coverage": "3D structures",
  "binding sites": "Contact spots",
  "binding site": "Contact spots",
  "active sites": "Working spots",
  "active site": "Working spots",
};

/** A row of the expanded sequence view in everyday words: "Clinical" reads "Mutations". */
export function plainSequenceRow(label: string): string {
  return SEQUENCE_ROWS[label.trim().toLowerCase()] ?? label;
}

const MUTATION_KINDS: Record<string, string> = {
  loss_of_function: "Cuts the protein short",
  missense: "Swaps an amino acid",
  inframe: "Adds or removes amino acids",
  splice: "Changes how the gene is read",
  synonymous: "No change to the protein",
  other: "Other",
};

/** What kind of change a mutation makes, in a few words: "Swaps an amino acid". */
export function plainMutationKind(consequence: string): string {
  return MUTATION_KINDS[consequence] ?? sentenceCase(consequence);
}

const CLASS_GROUPS: Record<string, string> = {
  pathogenic: "Harmful",
  uncertain: "Unclear",
  benign: "Harmless",
  other: "Not classified",
};

/** A group of medical database classes in a word: "Harmful", "Unclear", "Harmless". */
export function plainClassGroup(group: string): string {
  return CLASS_GROUPS[group] ?? sentenceCase(group);
}

export const SEQUENCE_WORDS = {
  rows: "Rows",
  mutations: "Mutations",
  find: "Go to a position, like 28",
  shape: "Shape",
  colour: "Colour",
  striped: "Striped: likely",
} as const;

/** "Showing 1 to 659" */
export function plainWindow(start: number, end: number): string {
  return `Showing ${start} to ${end}`;
}

/** Projects: saving what you find and coming back to it. */

const SAVED_KINDS: Record<string, string> = {
  disease: "Disease",
  gene: "Gene",
  variant: "Mutation",
  protein: "Protein",
  structure: "3D structure",
  residue: "Spot in the protein",
  compound: "Molecule",
  paper: "Paper",
  job: "Computer run",
  note: "Note",
  hypothesis: "Idea",
  screenshot: "Picture",
};

/** What kind of thing was saved: "Mutation". */
export function plainSavedKind(kind: string): string {
  return SAVED_KINDS[kind] ?? sentenceCase(kind);
}

/** A name with its mutation code spelled out: "BTK p.Arg28His" reads "BTK Arg28 → His". */
export function plainMutationLabel(label: string): string {
  return label.replace(/\bp\.[A-Za-z0-9_=*?]+/g, (code) =>
    plainMutationRow(code),
  );
}

/** A saved item's name without codes. */
export function plainSavedLabel(label: string): string {
  return plainMutationLabel(label);
}

/** "1 saved item", "3 saved items" */
export function plainSavedCount(count: number): string {
  return plural(count, "saved item");
}

/** "Saved to BTK notes" */
export function plainSavedTo(project: string): string {
  return `Saved to ${project}`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** A day the way people write it: "3 Oct 2026". Null when the date can't be read. */
export function plainDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

const PROJECT_ACCESS: Record<string, string> = {
  private: "Only you",
  unlisted: "Anyone with the link",
  public: "Everyone",
};

/** Who can see a project: "Only you". */
export function plainAccess(visibility: string): string {
  return PROJECT_ACCESS[visibility] ?? sentenceCase(visibility);
}

const IDEA_STATES: Record<string, string> = {
  draft: "Draft",
  open: "Untested",
  supported: "Looks right",
  contradicted: "Looks wrong",
  retired: "Dropped",
};

/** Where an idea stands: "Untested", "Looks right". */
export function plainIdeaState(status: string): string {
  return IDEA_STATES[status] ?? sentenceCase(status);
}

export const PROJECT_WORDS = {
  add: "Add to project",
  save: "Save to a project",
  project: "Project",
  newProject: "New project",
  projectName: "Project name",
  note: "Note (optional)",
  noteHint: "Why it matters",
  cancel: "Cancel",
  saveButton: "Save",
  saving: "Saving",
  notSaved: "That did not save. Try again.",
  openProject: "Open project",
  loading: "Loading your projects",
  listLine: "Save what you find. Come back later.",
  yours: "Your projects",
  shared: "Shared by others",
  saved: "Saved",
  whoSees: "Who can see it",
  changed: "Last changed",
  none: "No projects yet",
  noneShared: "Nothing shared yet",
  noneHint: "Use Add to project on any page.",
  savedItems: "Saved items",
  nothingSaved: "Nothing saved yet",
  pickItem: "Pick a saved item",
  open: "Open",
  remove: "Remove",
  continueHere: "Continue from here",
  comesAfter: "Comes after",
  leadsTo: "Leads to",
  backs: "Backs the idea",
  sources: "Sources",
  noSources: "No sources saved with it.",
  notes: "Notes",
  writeNote: "Write a note",
  saveNote: "Save note",
  addNote: "Add note",
  ideas: "Ideas",
  newIdea: "New idea",
  saveIdea: "Save idea",
  noIdeas: "None yet.",
  ideaHint: "Write your idea in a sentence or two",
  ideaCaveat: "Your own idea. Not proven.",
  ideaRestsOn: "Based on",
  ideaNeedsItem: "Tick at least one saved item it is based on.",
  ideaNothingSaved: "Save a gene, mutation or structure first.",
  showSaved: "Show in saved items",
  edit: "Edit",
  share: "Share",
  shareTitle: "Share this project",
  shareLine: "Makes a copy anyone with the link can read.",
  shareNote: "What this copy shows",
  getLink: "Get a link",
  copyLink: "Copy link",
  linkReady: "Link ready",
  sharedCopies: "Shared copies",
  download: "Download",
  report: "Report",
  dataFile: "Data file",
  everything: "Everything",
  settings: "Project settings",
  name: "Name",
  about: "About",
  aboutHint: "What you want to find out",
  readOnly: "View only",
  makeCopy: "Make my own copy",
  removed: "Removed",
  ideaSaved: "Idea saved",
  continuing: "New items go after this one",
} as const;

/** Explore: the list of genes. */
export const EXPLORE_WORDS = {
  title: "Immune disease genes",
  line: "Pick a gene to see its mutations.",
  search: "Search a gene or disease",
  gene: "Gene",
  protein: "Protein",
  disease: "Disease",
  labStructures: "Lab structures",
  predicted: "Predicted structure",
  harmful: "Harmful mutations",
  openGene: "Open this gene",
} as const;

/**
 * The Candidates screen. It builds on the candidate wording already above — `plainBridge`,
 * `plainDirection`, `plainRequiredAction`, `plainMechanismDirection`, `plainPhase` and
 * `CANDIDATE_WORDS` — and adds only what a full screen needs on top of the lab's panel.
 */

const normalizeKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

const BRIDGE_MEANINGS: Record<string, string> = {
  same_target: "A molecule that already acts on this very protein.",
  pathway_node: "A protein just before or after this one in the same pathway.",
  interaction_partner: "A protein this one physically holds on to.",
  structural_analogue:
    "Another protein with a pocket of a similar shape, and a molecule that fits it.",
  mechanism_class:
    "Another disease where the protein breaks the same way, with a drug class already in use.",
};

/** Why that kind of link counts as a link, in one sentence. */
export function plainBridgeMeaning(kind: string | null | undefined): string {
  if (!kind) return "";
  return BRIDGE_MEANINGS[normalizeKey(kind)] ?? "";
}

const lowerFirst = (text: string) =>
  text.charAt(0).toLowerCase() + text.slice(1);

/** Every required action as one phrase, mid-sentence: "turn it down, or go around it". */
export function plainRequiredActions(
  actions: readonly string[] | null | undefined,
): string | null {
  // two action keys can share one plain phrase ("inhibit" and "antagonise" both turn it down)
  const phrases = [
    ...new Set(
      (actions ?? [])
        .map((action) => plainRequiredAction(action))
        .filter((phrase) => phrase !== "Action unknown")
        .map(lowerFirst),
    ),
  ];
  if (phrases.length === 0) return null;
  if (phrases.length === 1) return phrases[0];
  return `${phrases.slice(0, -1).join(", ")}, or ${phrases[phrases.length - 1]}`;
}

/**
 * The one line the Candidates screen opens on: "The protein does too much, so a drug would need to
 * turn it down." Says the direction is unknown rather than guessing one.
 */
export function plainDirectionLine(facts: {
  mechanismClass?: string | null;
  direction?: string | null;
  actions?: readonly string[] | null;
}): string {
  const fault = facts.mechanismClass ?? facts.direction;
  const stated = fault ? plainMechanismDirection(fault) : null;
  const known = stated !== null && stated !== "Direction unknown";
  const action = plainRequiredActions(facts.actions);
  if (!known)
    return action
      ? `What goes wrong here is not recorded, so Helix only looked for molecules that would ${action}.`
      : "What goes wrong here is not recorded, so Helix cannot say what a drug would need to do.";
  if (!action)
    return `${stated}. What a drug would need to do is not recorded.`;
  return `${stated}, so a drug would need to ${action}.`;
}

const MOLECULE_ACTIONS: Record<string, string> = {
  inhibitor: "slows it down",
  antagonist: "blocks its signal",
  agonist: "switches it on",
  partial_agonist: "switches it on a little",
  inverse_agonist: "turns it below normal",
  positive_allosteric_modulator: "boosts it",
  negative_allosteric_modulator: "damps it down",
  allosteric_antagonist: "blocks it from the side",
  blocker: "blocks it",
  opener: "opens it",
  activator: "switches it on",
  degrader: "clears it away",
  modulator: "changes how it works",
  stabiliser: "holds it together",
  stabilizer: "holds it together",
  disrupting_agent: "breaks it apart",
  substrate: "is used up by it",
  binding_agent: "binds it",
  other: "acts on it",
};

const MOLECULE_ACTIONS_ON: Record<string, string> = {
  inhibitor: "slows TARGET down",
  antagonist: "blocks TARGET's signal",
  agonist: "switches TARGET on",
  partial_agonist: "switches TARGET on a little",
  inverse_agonist: "turns TARGET below normal",
  positive_allosteric_modulator: "boosts TARGET",
  negative_allosteric_modulator: "damps TARGET down",
  allosteric_antagonist: "blocks TARGET from the side",
  blocker: "blocks TARGET",
  opener: "opens TARGET",
  activator: "switches TARGET on",
  degrader: "clears TARGET away",
  modulator: "changes how TARGET works",
  stabiliser: "holds TARGET together",
  stabilizer: "holds TARGET together",
  disrupting_agent: "breaks TARGET apart",
  substrate: "is used up by TARGET",
  binding_agent: "binds TARGET",
  other: "acts on TARGET",
};

/**
 * Disease names as a source writes them, in everyday words. A candidate row says which other
 * disease a molecule came from, and a drug database writes that in clinical terms. The term the
 * source used stays on the chain step beside its record; this is only the wording of the row.
 */
const INDICATIONS: Record<string, string> = {
  neoplasm: "a tumour",
  "lymphoid neoplasm": "a tumour of immune cells",
  "neoplasm of mature b-cells": "a tumour of B cells",
  "hematologic neoplasm": "a blood cancer",
  "haematologic neoplasm": "a blood cancer",
  "head and neck squamous cell carcinoma": "a head and neck cancer",
  "chronic obstructive pulmonary disease": "a long-term lung disease",
  "inborn error of immunity": "an inherited immune disease",
  "chronic lymphocytic leukemia": "a slow-growing blood cancer",
  "chronic lymphocytic leukaemia": "a slow-growing blood cancer",
  "acute lymphoblastic leukemia": "a fast-growing blood cancer",
  "rheumatoid arthritis": "a joint disease where the immune system attacks",
  "whim (warts, hypogammaglobulinemia, infections, myelokathexis) syndrome":
    "WHIM syndrome, an inherited immune disease",
  "graft versus host disease": "an immune reaction after a transplant",
  "atopic dermatitis": "a long-term skin rash",
};

/**
 * A disease name fit to print as a title. The catalog shortens the direction of the fault to a
 * code ("STAT1 GOF"), and a code is never visible text, so it is written out.
 */
export function plainDiseaseName(
  name: string | null | undefined,
): string | null {
  const text = name?.trim();
  if (!text) return null;
  return text
    .replace(/\bGOF\b/g, "gain of function")
    .replace(/\bLOF\b/g, "loss of function");
}

/** "neoplasm" reads "a tumour"; a name already in everyday words is left alone. */
export function plainIndication(
  name: string | null | undefined,
): string | null {
  const text = name?.trim();
  if (!text) return null;
  const mapped = INDICATIONS[text.toLowerCase()];
  if (mapped) return mapped;
  // a gain-of-function disease is written as a gene plus a code; the product has words for that
  const gainOfFunction = /^([A-Z0-9]{2,8})\s+GOF$/.exec(text);
  if (gainOfFunction)
    return `a disease where ${gainOfFunction[1]} does too much`;
  const lossOfFunction = /^([A-Z0-9]{2,8})\s+LOF$/.exec(text);
  if (lossOfFunction)
    return `a disease where ${lossOfFunction[1]} does too little`;
  if (/\bneoplasms?\b/i.test(text))
    return text.replace(/\bneoplasms?\b/gi, "tumours");
  if (/\bcarcinoma\b/i.test(text))
    return text.replace(/\bcarcinoma\b/gi, "cancer");
  return plainDiseaseName(text);
}

/**
 * A sentence an agent wrote, fit for simple mode. The record cross-references its own hypotheses
 * and tests by code ("(H1)", "T2"), and a code is never visible text; Advanced keeps the sentence
 * whole. Nothing else about the sentence is changed.
 */
export function plainRunSentence(
  text: string | null | undefined,
  advanced: boolean,
): string | null {
  const sentence = text?.trim();
  if (!sentence) return null;
  if (advanced) return sentence;
  return sentence
    .replace(/\s*[([][HTE]\d+(?:\s*,\s*[HTE]\d+)*[)\]]/g, "")
    .replace(/\s+([.,;])/g, "$1")
    .trim();
}

/** The same action naming the protein: "slows BTK down". */
export function plainMoleculeActionOn(
  actionType: string | null | undefined,
  target: string,
): string {
  const template =
    (actionType ? MOLECULE_ACTIONS_ON[normalizeKey(actionType)] : null) ??
    "acts on TARGET";
  return template.replace("TARGET", target);
}

/** What a recorded action type does, in everyday words: "slows it down". */
export function plainMoleculeAction(
  actionType: string | null | undefined,
): string {
  if (!actionType) return "acts on it";
  return (
    MOLECULE_ACTIONS[normalizeKey(actionType)] ??
    normalizeKey(actionType).replace(/_/g, " ")
  );
}

/**
 * Why a molecule was ruled out: what it does, what this disease needs, and the conclusion. The
 * conclusion is the part a first-time reader cannot be left to infer, so it is always written out:
 * "Ibrutinib slows BTK down. In this disease the protein already does too little, so this would
 * push it further the wrong way."
 */
export function plainRuledOutReason(facts: {
  molecule?: string | null;
  target?: string | null;
  actionType?: string | null;
  fault?: string | null;
}): string {
  const molecule = facts.molecule ?? "This molecule";
  const does = facts.target
    ? plainMoleculeActionOn(facts.actionType, facts.target)
    : plainMoleculeAction(facts.actionType);
  const fault = facts.fault ? plainMechanismDirection(facts.fault) : null;
  const here =
    fault && fault !== "Direction unknown"
      ? `In this disease ${lowerFirst(fault)} already, so this would push it further the wrong way.`
      : "That is the opposite of what this disease needs, so it is ruled out.";
  return `${molecule} ${does}. ${here}`;
}

const SIMILARITY_METRICS: Record<string, string> = {
  foldseek_tm_score: "Fold match",
  tm_score: "Fold match",
  pocket_rmsd: "Pocket shape difference",
  pocket_similarity: "Pocket similarity",
  shared_ligands: "Molecules both pockets bind",
  shared_residues: "Amino acids in common",
  sequence_identity: "Sequence in common",
  e_value: "Chance of a coincidence",
};

/** A similarity measure by name: "foldseek_tm_score" reads "Fold match". */
export function plainSimilarityMetric(name: string): string {
  return SIMILARITY_METRICS[normalizeKey(name)] ?? sentenceCase(name);
}

/** "3 candidates" */
export function plainCandidateCount(count: number): string {
  return plural(count, "candidate");
}

/** "1 ruled out" */
export function plainRuledOutCount(count: number): string {
  return `${count} ruled out`;
}

/** A measured binding strength with its unit: "IC50 11 nM, from 7 lab tests". */
export function plainAffinity(affinity: {
  type?: string | null;
  value?: number | string | null;
  units?: string | null;
  median_pchembl?: number | null;
  standard_types?: string[] | null;
  assay_count?: number | null;
  activity_count?: number | null;
}): string | null {
  const count = affinity.assay_count ?? affinity.activity_count ?? null;
  const tests = count ? plainLabTests(count) : null;
  const head =
    affinity.value !== null && affinity.value !== undefined
      ? [affinity.type, affinity.value, affinity.units]
          .filter((part) => part !== null && part !== undefined && part !== "")
          .join(" ")
      : null;
  if (head) return tests ? `${head}, from ${tests}` : head;
  // pChEMBL is a log scale, so the plain reading is the count of measurements
  if (tests) return `Measured in ${tests}`;
  return null;
}

/** The same measurement with its numbers, for Advanced: "pChEMBL 8.6, IC50, 5 lab tests". */
export function plainAffinityDetail(affinity: {
  median_pchembl?: number | null;
  standard_types?: string[] | null;
  assay_count?: number | null;
  activity_count?: number | null;
}): string | null {
  const parts: string[] = [];
  if (affinity.median_pchembl != null)
    parts.push(`pChEMBL ${affinity.median_pchembl}`);
  if (affinity.standard_types?.length)
    parts.push(affinity.standard_types.join(", "));
  const count = affinity.assay_count ?? affinity.activity_count ?? null;
  if (count) parts.push(plainLabTests(count));
  return parts.length ? parts.join(" · ") : null;
}

/** The Candidates screen, on top of CANDIDATE_WORDS. */
export const DISCOVERY_WORDS = {
  title: CANDIDATE_WORDS.title,
  rule: "The rule behind this",
  list: CANDIDATE_WORDS.title,
  aimsAt: "Aims at",
  noMolecule: CANDIDATE_WORDS.noMolecule,
  targetOnly: "No molecule has been recorded for it yet.",
  chain: CANDIDATE_WORDS.howWeGotHere,
  check: CANDIDATE_WORDS.direction,
  needed: "Needed",
  molecule: "This molecule",
  caveats: "Why this might be wrong",
  pockets: "The two pockets",
  sharedResidues: "Shared amino acids",
  pocketResidues: "Amino acids lining it",
  ruledOut: CANDIDATE_WORDS.ruledOut,
  ruledOutLine: CANDIDATE_WORDS.ruledOutLine,
  hypothesisLine: CANDIDATE_CAVEAT,
  testLine:
    "To test one: check the molecule binds this protein, then check it corrects the fault in cells.",
  heldOut: "Held-out test",
  heldOutLine:
    "The known link for this disease was hidden, so anything found here came another way.",
  withheld: "Links hidden for this run",
  sources: "Sources",
  limits: "Limits",
  notReady: "Candidates are not available yet",
  notReadyWhy:
    "The candidate search is not answering. Nothing is shown rather than a guess.",
  empty: CANDIDATE_WORDS.noCandidates,
  emptyWhy: "Nothing passed the direction check for this protein.",
  identifiers: "Codes",
  strength: "Measured strength",
  close: "Close",
  loading: "Looking for candidate targets and molecules. Can take a minute.",
  evidenceList: "Every record behind this",
  pocket: "The pocket",
  pocketNote: "About this pocket",
  ranking: "How the order was decided",
  showAll: "Show every candidate",
  showAllRuledOut: "Show every ruled-out molecule",
  whyWrong: "The full reason",
  showFewer: "Show the top ones only",
  unknownDirection: "Direction unknown",
  unknownDirectionWhy:
    "Ranked below the ones that match, because it is not clear which way this pushes.",
} as const;
