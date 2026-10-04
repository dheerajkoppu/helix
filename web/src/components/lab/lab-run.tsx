"use client";

import { PlayIcon } from "lucide-react";
import { cn } from "cn";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ButtonLink } from "@/components/data/button-link";
import { TextLink } from "@/components/data/text-link";
import { AgentColumn } from "@/components/lab/agent-column";
import { useRunRecord } from "@/components/lab/api";
import { Candidates } from "@/components/lab/candidates-panel";
import { UpdatedDecision } from "@/components/lab/decision";
import { SubjectLinks } from "@/components/lab/entity-links";
import { EvidenceLedger } from "@/components/lab/evidence-ledger";
import { ExperimentResult } from "@/components/lab/experiment-result";
import {
  RunStatusTag,
  eventTypeLabel,
  humanise,
  modeLabel,
  variantLabel,
} from "@/components/lab/format";
import { HandoffTimeline } from "@/components/lab/handoff-timeline";
import { Hypotheses } from "@/components/lab/hypotheses";
import {
  agentStatuses,
  dwellOf,
  loopPosition,
  secondsBetween,
} from "@/components/lab/loop";
import { LoopRail } from "@/components/lab/loop-rail";
import { LoopStepper } from "@/components/lab/loop-stepper";
import { stepCounts } from "@/components/lab/plain";
import {
  buildRecordView,
  overallOutcome,
  summariseEvent,
  type LoopStageId,
  type RecordView,
} from "@/components/lab/record";
import {
  REPLAY_SPEEDS,
  ReplayBar,
  type ReplaySpeed,
} from "@/components/lab/replay-bar";
import { Report } from "@/components/lab/report";
import { ResultWarmup } from "@/components/lab/result-figure";
import {
  RunProvider,
  entryAnchor,
  useAgentLabel,
} from "@/components/lab/run-context";
import { RunMeter } from "@/components/lab/run-meter";
import { Question, RunProvenance } from "@/components/lab/run-summary";
import { StepPanel } from "@/components/lab/step-panels";
import { TestPlan } from "@/components/lab/test-plan";
import {
  isActiveStatus,
  isFinishedStatus,
  readText,
  type LabEvent,
  type LabRun as LabRunData,
} from "@/components/lab/types";
import { Page, PageBody, PageHeader, Plate } from "@/components/shell/page";
import { QueryErrorState, RowsSkeleton } from "@/components/states/query-state";
import { Button } from "@/components/ui/button";
import { formatTimestamp } from "@/lib/format";
import {
  LOOP_STEPS,
  STEP_WORDS,
  plainCount,
  plainMutationLabel,
  plainStepCaption,
} from "@/lib/plain-language";
import { useAdvancedMode } from "@/lib/state/preferences";

const STEP_PARAM = "step";
const TAB_PARAM = "tab";
const PLAY_PARAM = "play";

type RunTab = "loop" | "record";

const WIDE = "mx-auto w-full max-w-[96rem]";

/** Seconds since the run started, ticking once a second while it is active. */
function useElapsedSeconds(run: LabRunData): number | null {
  const active = isActiveStatus(run.status);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [active]);
  if (!run.started_at) return null;
  const start = Date.parse(run.started_at);
  if (Number.isNaN(start)) return null;
  if (!active) {
    if (run.metrics.wall_seconds !== null) return run.metrics.wall_seconds;
    const end = run.finished_at ? Date.parse(run.finished_at) : Number.NaN;
    return Number.isNaN(end) ? null : Math.max(0, (end - start) / 1000);
  }
  return Math.max(0, Math.round((now - start) / 1000));
}

/** The newest record line of an active run. */
function LatestLine({ event }: { event: LabEvent }) {
  const agentLabel = useAgentLabel();
  const summary = summariseEvent(event);
  return (
    <div className="border-b border-border bg-sunken" aria-live="polite">
      <p
        className={cn(WIDE, "flex h-7 items-center gap-2 px-4 text-xs md:px-6")}
      >
        <span
          aria-hidden
          className="size-1.5 shrink-0 animate-pulse rounded-full bg-foreground"
        />
        <span className="shrink-0 text-2xs font-medium tracking-[0.04em] uppercase">
          Latest
        </span>
        <span className="tabular shrink-0 font-mono text-2xs text-subtle-foreground">
          line {event.seq}
        </span>
        <span className="shrink-0 font-medium text-foreground">
          {agentLabel(event.agent)}
        </span>
        <span className="shrink-0 text-2xs tracking-[0.04em] text-muted-foreground uppercase">
          {eventTypeLabel(event.type, readText(event.payload.kind))}
        </span>
        {summary ? (
          <span className="truncate text-muted-foreground">{summary}</span>
        ) : null}
      </p>
    </div>
  );
}

/** One to three words under each step of the stepper. */
function stepNotes(
  run: LabRunData,
  view: RecordView,
  pendingApproval: boolean,
): Record<LoopStageId, string | null> {
  const plan = view.plans.at(-1);
  const outcome = overallOutcome(view);
  const moved = view.interpretations
    .at(-1)
    ?.per_hypothesis.find(
      (entry) => entry.verdict && entry.verdict !== "unchanged",
    );
  return {
    question: view.objective
      ? run.subject.variant_id
        ? variantLabel(run.subject.variant_id)
        : "Set"
      : null,
    evidence: view.evidence.length ? `${view.evidence.length} items` : null,
    hypothesis: view.hypotheses.length
      ? `${view.hypotheses.length} ranked${view.reopened.hypothesis > 0 ? ", reopened" : ""}`
      : null,
    experiment: pendingApproval
      ? "Needs approval"
      : plan?.chosen_test_id
        ? `${plan.chosen_test_id} chosen`
        : view.tests.length
          ? `${view.tests.length} tests`
          : null,
    result: view.results.length
      ? moved?.verdict
        ? `${moved.id} ${humanise(moved.verdict)}`
        : "Recorded"
      : null,
    decision: outcome ? (outcome.changed ? "Changed" : "Unchanged") : null,
    candidates: view.candidates.length
      ? `${view.candidates.length} kept, ${view.ruledOut.length} ruled out`
      : view.ruledOut.length
        ? `${view.ruledOut.length} ruled out`
        : null,
  };
}

/** The same captions in everyday words, built from counts in the record. */
function plainStepNotes(
  run: LabRunData,
  view: RecordView,
  pendingApproval: boolean,
): Record<LoopStageId, string | null> {
  const counts = stepCounts(view, run.metrics.ruled_out_by_direction);
  return {
    question: view.objective ? plainStepCaption(LOOP_STEPS[0]) : null,
    evidence: counts.facts ? plainStepCaption(LOOP_STEPS[1], counts) : null,
    hypothesis: counts.causes ? plainStepCaption(LOOP_STEPS[2], counts) : null,
    experiment: pendingApproval
      ? STEP_WORDS.needsApproval
      : counts.tests
        ? plainStepCaption(LOOP_STEPS[3], counts)
        : view.tests.length
          ? plainCount(view.tests.length, "test")
          : null,
    result: counts.finished ? plainStepCaption(LOOP_STEPS[4], counts) : null,
    decision:
      counts.changed == null ? null : plainStepCaption(LOOP_STEPS[5], counts),
    candidates:
      counts.candidates || counts.ruledOut
        ? plainStepCaption(LOOP_STEPS[6], counts)
        : null,
  };
}

function RunView({
  run,
  events,
  reportText,
}: {
  run: LabRunData;
  events: LabEvent[];
  reportText: string | null;
}) {
  const advanced = useAdvancedMode();
  const searchParams = useSearchParams();

  const active = isActiveStatus(run.status);
  const finished = isFinishedStatus(run.status);

  // a link can open the run with the replay already running: /lab/<id>?play=1
  const autoPlay = searchParams.get(PLAY_PARAM) === "1" && events.length > 0;

  // the replay position is local and mirrored to the URL, so a step never waits on the router
  const [position, setPosition] = useState<number | null>(() => {
    const raw = searchParams.get(STEP_PARAM);
    const requested = raw === null ? Number.NaN : Number(raw);
    if (!Number.isFinite(requested)) return autoPlay ? 0 : null;
    return Math.max(
      0,
      events.findLastIndex((event) => event.seq <= requested),
    );
  });
  const [playing, setPlaying] = useState(autoPlay);
  const [speed, setSpeed] = useState<ReplaySpeed>(1);
  const [tab, setTab] = useState<RunTab>(() =>
    searchParams.get(TAB_PARAM) === "record" ? "record" : "loop",
  );
  const [pinned, setPinned] = useState<LoopStageId | null>(null);
  const anchor = useRef<string | null>(null);

  const replaying = finished && events.length > 0 && position !== null;
  const last = events.length - 1;
  const index = replaying ? Math.min(Math.max(position, 0), last) : last;
  const currentSeq = replaying ? events[index].seq : null;
  const atEnd = !replaying || index >= last;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (currentSeq === null) params.delete(STEP_PARAM);
    else params.set(STEP_PARAM, String(currentSeq));
    if (tab === "record") params.set(TAB_PARAM, "record");
    else params.delete(TAB_PARAM);
    params.delete(PLAY_PARAM);
    const query = params.toString();
    const next = `${window.location.pathname}${query ? `?${query}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`)
      window.history.replaceState(null, "", next);
  }, [currentSeq, tab]);

  useEffect(() => {
    if (!replaying || !playing) return;
    const interval =
      REPLAY_SPEEDS.find((option) => option.id === speed)?.intervalMs ?? 900;
    const timer = window.setTimeout(
      () => {
        if (index >= last) setPlaying(false);
        else setPosition(index + 1);
      },
      interval * dwellOf(events[index]),
    );
    return () => window.clearTimeout(timer);
  }, [replaying, playing, speed, index, last, events]);

  useEffect(() => {
    if (tab !== "record" || !replaying || currentSeq === null) return;
    document
      .getElementById(entryAnchor(currentSeq))
      ?.scrollIntoView({ block: "nearest" });
  }, [tab, replaying, currentSeq]);

  useEffect(() => {
    if (tab !== "record" || !anchor.current) return;
    document.getElementById(anchor.current)?.scrollIntoView({ block: "start" });
    anchor.current = null;
  }, [tab]);

  const visible = useMemo(
    () => (replaying ? events.slice(0, index + 1) : events),
    [replaying, events, index],
  );
  const view = useMemo(() => buildRecordView(visible), [visible]);
  const reached = useMemo(() => loopPosition(visible), [visible]);
  // a replay knows the result ahead of the step that shows it
  const upcomingResult = useMemo(
    () => (replaying ? buildRecordView(events) : view).results.at(-1),
    [replaying, events, view],
  );
  const complete = finished && atEnd;
  const agents = useMemo(
    () =>
      agentStatuses(visible, {
        specialistLab: run.mode !== "single_agent_baseline",
        complete,
      }),
    [visible, run.mode, complete],
  );

  const liveElapsed = useElapsedSeconds(run);
  const elapsed = replaying
    ? secondsBetween(run.started_at ?? events[0]?.at, events[index]?.at)
    : liveElapsed;
  const pending = view.approvals.filter((approval) => !approval.decision);
  const pendingNow = pending.length > 0 && active && !replaying;
  const lastEvent = events.at(-1);
  const selected = pinned ?? reached ?? "question";
  const subjectLabel = run.subject.variant_id
    ? variantLabel(run.subject.variant_id)
    : "Lab run";
  const notes = useMemo(
    () =>
      advanced
        ? stepNotes(run, view, pendingNow)
        : plainStepNotes(run, view, pendingNow),
    [advanced, run, view, pendingNow],
  );

  const startReplay = useCallback(() => {
    setPinned(null);
    setTab("loop");
    setPosition(0);
    setPlaying(true);
  }, []);

  const openRecord = useCallback((stage: LoopStageId) => {
    anchor.current = stage;
    setTab("record");
  }, []);

  const selectStep = useCallback(
    (stage: LoopStageId) => {
      if (tab === "record") {
        document.getElementById(stage)?.scrollIntoView({ block: "start" });
        return;
      }
      setPinned(stage);
    },
    [tab],
  );

  return (
    <RunProvider
      run={run}
      view={view}
      replaying={replaying}
      currentSeq={currentSeq}
      reportText={reportText}
    >
      <Page className="[--lab-top:0px] lg:h-full lg:min-h-0">
        <header className="border-b border-border">
          <div
            className={cn(
              WIDE,
              "flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 md:px-6",
            )}
          >
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1
                className="text-2xl font-semibold tracking-[-0.015em] text-foreground"
                translate="no"
              >
                {advanced ? subjectLabel : plainMutationLabel(subjectLabel)}
              </h1>
              {advanced ? (
                <span className="font-mono text-sm text-muted-foreground">
                  {run.run_id}
                </span>
              ) : null}
              <RunStatusTag
                status={run.status}
                plain={!advanced}
                className={advanced ? undefined : "text-sm"}
              />
              {advanced ? (
                <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {modeLabel(run.mode) ? (
                    <span>{modeLabel(run.mode)}</span>
                  ) : null}
                  <span>
                    Started{" "}
                    <span className="tabular font-mono text-foreground">
                      {formatTimestamp(run.started_at) ?? "Unknown"}
                    </span>
                  </span>
                  <SubjectLinks subject={run.subject} />
                </span>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <div
                role="tablist"
                aria-label="Run views"
                className="flex items-center rounded-md border border-border p-0.5"
              >
                {(["loop", "record"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="tab"
                    aria-selected={tab === option}
                    onClick={() => setTab(option)}
                    className={cn(
                      "h-6 rounded-sm px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                      tab === option
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {option === "loop" ? "Loop" : "Record"}
                  </button>
                ))}
              </div>
              <ButtonLink href="/lab" variant="ghost" size="lg">
                {STEP_WORDS.allRuns}
              </ButtonLink>
              {finished && events.length > 0 && !replaying ? (
                <Button size="lg" onClick={startReplay}>
                  <PlayIcon data-icon="inline-start" />
                  {STEP_WORDS.replay}
                </Button>
              ) : null}
            </div>
          </div>
        </header>

        {upcomingResult && selected !== "result" ? (
          <ResultWarmup result={upcomingResult} subject={run.subject} />
        ) : null}
        <LoopStepper
          reached={reached}
          selected={selected}
          live={active || (replaying && playing)}
          complete={complete && run.status === "succeeded"}
          notes={notes}
          onSelect={selectStep}
        />
        {advanced && active && lastEvent ? (
          <LatestLine event={lastEvent} />
        ) : null}
        {replaying ? (
          <ReplayBar
            events={events}
            index={index}
            playing={playing}
            speed={speed}
            recordedAt={run.started_at}
            onIndex={(next) => {
              setPlaying(false);
              setPosition(Math.min(Math.max(next, 0), last));
            }}
            onPlaying={(next) => {
              if (next) setPinned(null);
              setPlaying(next);
            }}
            onSpeed={setSpeed}
            onExit={() => {
              setPlaying(false);
              setPosition(null);
            }}
          />
        ) : null}

        {tab === "loop" ? (
          <div
            className={cn(
              WIDE,
              "grid flex-1 lg:min-h-0 lg:grid-cols-[16rem_minmax(0,1fr)_14rem]",
            )}
          >
            <AgentColumn
              agents={agents}
              className="scroll-thin order-3 border-t border-border lg:order-1 lg:overflow-y-auto lg:border-t-0 lg:border-r"
            />
            <div
              data-col="step"
              className="scroll-thin order-1 flex min-w-0 flex-col lg:order-2 lg:overflow-y-auto"
            >
              <div className="mx-auto flex w-full max-w-[72rem] flex-1 flex-col justify-center px-4 py-5 md:px-8">
                {pendingNow && selected !== "experiment" ? (
                  <p className="mb-4 flex flex-wrap items-baseline gap-x-3 text-base">
                    <span className="font-medium text-foreground">
                      {advanced ? "Approval needed." : STEP_WORDS.needsApproval}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPinned("experiment")}
                      className="rounded-xs text-foreground underline decoration-border-strong underline-offset-[3px] hover:decoration-foreground"
                    >
                      {STEP_WORDS.review}
                    </button>
                  </p>
                ) : null}
                {run.status === "failed" && !replaying ? (
                  <p className="mb-4 text-base">
                    <span className="font-medium text-destructive">
                      {STEP_WORDS.failed}
                    </span>{" "}
                    {advanced ? (
                      <span className="text-muted-foreground">
                        {run.error ??
                          (lastEvent
                            ? `No error text was recorded. The record ends at line ${lastEvent.seq}.`
                            : "It wrote nothing to its record.")}
                      </span>
                    ) : (
                      <span
                        className="text-muted-foreground"
                        title={run.error ?? undefined}
                      >
                        {STEP_WORDS.noAnswer}
                      </span>
                    )}
                  </p>
                ) : null}
                <StepPanel stage={selected} onDetails={openRecord} />
                {advanced ? (
                  <div className="mt-8 border-t border-border">
                    {selected === "question" ? <Question /> : null}
                    {selected === "evidence" ? <EvidenceLedger /> : null}
                    {selected === "hypothesis" ? <Hypotheses /> : null}
                    {selected === "experiment" ? <TestPlan /> : null}
                    {selected === "result" ? <ExperimentResult /> : null}
                    {selected === "decision" ? <UpdatedDecision /> : null}
                  </div>
                ) : null}
              </div>
            </div>
            <RunMeter
              elapsedSeconds={elapsed}
              toolCalls={finished ? run.metrics.tool_calls : null}
              maxToolCalls={run.budget.max_tool_calls}
              computeSeconds={finished ? run.metrics.compute_seconds : null}
              maxComputeSeconds={run.budget.max_compute_seconds}
              databases={view.databases}
              plain={!advanced}
              active={active}
              totalsOnly={replaying && !atEnd}
              className="scroll-thin order-2 border-t border-border lg:order-3 lg:overflow-y-auto lg:border-t-0 lg:border-l"
            />
          </div>
        ) : (
          <div
            className={cn(
              WIDE,
              "grid flex-1 lg:min-h-0 lg:grid-cols-[22rem_minmax(0,1fr)]",
            )}
          >
            <aside
              aria-label="Research record"
              className="h-72 border-b border-border lg:h-auto lg:min-h-0 lg:border-r lg:border-b-0"
            >
              <HandoffTimeline
                events={events}
                live={active}
                replaying={replaying}
                currentSeq={currentSeq}
                onStep={(seq) => {
                  setPlaying(false);
                  setPosition(events.findIndex((event) => event.seq === seq));
                }}
                className="h-full"
              />
            </aside>
            <div className="scroll-thin min-w-0 px-4 md:px-6 lg:overflow-y-auto">
              {advanced ? (
                <LoopRail
                  run={run}
                  view={view}
                  live={active}
                  replaying={replaying}
                  className="-mx-4 md:-mx-6"
                />
              ) : null}
              <Question />
              <EvidenceLedger />
              <Hypotheses />
              <TestPlan />
              <ExperimentResult />
              <UpdatedDecision />
              <Candidates />
              <Report />
              <RunProvenance />
            </div>
          </div>
        )}
      </Page>
    </RunProvider>
  );
}

function Frame({
  runId,
  children,
}: {
  runId: string;
  children: React.ReactNode;
}) {
  const advanced = useAdvancedMode();
  return (
    <Page>
      <PageHeader
        title="Lab run"
        id={advanced ? runId : undefined}
        actions={
          <ButtonLink href="/lab" variant="ghost">
            All runs
          </ButtonLink>
        }
      />
      <PageBody className="py-5">
        <Plate className="min-h-48">{children}</Plate>
      </PageBody>
    </Page>
  );
}

/** One run of the lab: the loop step by step, the agents, and the full record behind a tab. */
export function LabRun({ runId }: { runId: string }) {
  const record = useRunRecord(runId);

  if (record.isPending) {
    return (
      <Frame runId={runId}>
        <RowsSkeleton rows={6} />
      </Frame>
    );
  }
  if (record.isError) {
    return (
      <Frame runId={runId}>
        <QueryErrorState
          error={record.error}
          subject={`lab run ${runId}`}
          onRetry={() => void record.refetch()}
          retrying={record.isFetching}
        />
        <p className="border-t border-border-subtle px-3 py-2 text-xs text-muted-foreground">
          <TextLink href="/lab">See the recorded runs</TextLink>
        </p>
      </Frame>
    );
  }
  return (
    <RunView
      run={record.data.run}
      events={record.data.events}
      reportText={record.data.report}
    />
  );
}
