"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ExternalLink } from "@/components/data/external-link";
import { TextLink } from "@/components/data/text-link";
import { EvidenceBadge } from "@/components/evidence/evidence-badge";
import { SourceLinks } from "@/components/lab/entity-links";
import { VerdictTag, formatSeconds, humanise } from "@/components/lab/format";
import type { InterpretationEntry, ResultEntry } from "@/components/lab/record";
import { useEntryProps, useRun } from "@/components/lab/run-context";
import {
  ByLine,
  IdLink,
  LoopSection,
  NotRecorded,
  Subhead,
} from "@/components/lab/section";
import { ValuesView } from "@/components/lab/values-view";
import { Plate } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { API_BASE_URL } from "@/lib/api/client";
import { routes } from "@/lib/ids";

/** An API path becomes an absolute link; anything that is not a URL is printed, not linked. */
function manifestHref(value: string): string | null {
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return `${API_BASE_URL}${value}`;
  return null;
}

function Command({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      toast("Copied the command");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copy failed. Select the text and copy it manually.");
    }
  }
  const Icon = copied ? CheckIcon : CopyIcon;
  return (
    <div className="flex items-start gap-2 border border-border-subtle bg-sunken">
      <pre className="scroll-thin min-w-0 flex-1 overflow-x-auto px-2.5 py-2 font-mono text-xs whitespace-pre-wrap text-foreground">
        {command}
      </pre>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Copy the command"
        onClick={copy}
        className="m-1 shrink-0"
      >
        <Icon />
      </Button>
    </div>
  );
}

function Notes({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-1 text-xs">
      <p className="text-muted-foreground">{title}</p>
      <ul className="flex flex-col gap-1 text-foreground">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span
              aria-hidden
              className="mt-2 h-px w-2 shrink-0 bg-border-strong"
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResultBlock({ result }: { result: ResultEntry }) {
  const props = useEntryProps(
    result.event.seq,
    "border-b border-border-subtle px-3 py-3 last:border-b-0",
  );
  const { run } = useRun();
  const manifest = result.manifest_url
    ? manifestHref(result.manifest_url)
    : null;
  const stored = result.result_url ? manifestHref(result.result_url) : null;
  return (
    <li {...props}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
        {result.test_id ? (
          <span className="text-muted-foreground">
            Result of <IdLink id={result.test_id} />
            {result.test_kind ? (
              <span className="text-foreground">
                {" "}
                {humanise(result.test_kind)}
              </span>
            ) : null}
          </span>
        ) : null}
        <EvidenceBadge
          evidenceClass="computational_prediction"
          detail="computational test"
        />
        <ByLine event={result.event} className="ml-auto" />
      </div>
      <p className="mt-2 max-w-[72ch] text-base text-foreground">
        {result.summary ?? (
          <span className="text-subtle-foreground">No summary recorded</span>
        )}
      </p>

      <div className="mt-3 flex flex-col gap-1.5 text-xs">
        <p className="text-muted-foreground">
          Values as recorded
          {result.elapsed_seconds !== null ? (
            <>
              {" "}
              (test ran for{" "}
              <span className="tabular font-mono text-foreground">
                {formatSeconds(result.elapsed_seconds)}
              </span>
              )
            </>
          ) : null}
        </p>
        {Object.keys(result.values).length ? (
          <ValuesView values={result.values} />
        ) : (
          <p className="text-subtle-foreground">
            No values recorded with this result.
          </p>
        )}
      </div>

      <Notes title="Controls" items={result.controls} />
      <Notes title="Limitations" items={result.limitations} />

      {result.event.sources.length ? (
        <div className="mt-3 flex flex-col gap-1.5 text-xs">
          <p className="text-muted-foreground">
            Source records the test read{" "}
            <span className="tabular font-mono text-foreground">
              {result.event.sources.length}
            </span>
          </p>
          <SourceLinks sources={result.event.sources} subject={run.subject} />
        </div>
      ) : null}

      <div className="mt-3 flex flex-col gap-1.5 text-xs">
        <p className="text-muted-foreground">
          Command that reproduces the test
        </p>
        {result.reproducible_command ? (
          <Command command={result.reproducible_command} />
        ) : (
          <p className="text-subtle-foreground">No command recorded.</p>
        )}
      </div>

      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="text-muted-foreground">Run record</span>
        {result.job_id ? (
          <TextLink href={routes.job(result.job_id)}>
            Job <span className="font-mono">{result.job_id}</span>
          </TextLink>
        ) : null}
        {result.manifest_url ? (
          manifest ? (
            <ExternalLink href={manifest}>Manifest</ExternalLink>
          ) : (
            <span className="font-mono text-foreground">
              {result.manifest_url}
            </span>
          )
        ) : null}
        {stored ? (
          <ExternalLink href={stored}>Stored result</ExternalLink>
        ) : null}
        {!result.job_id && !result.manifest_url && !stored ? (
          <span className="text-subtle-foreground">
            No job or manifest attached to this result
          </span>
        ) : null}
      </p>
    </li>
  );
}

function InterpretationBlock({
  interpretation,
}: {
  interpretation: InterpretationEntry;
}) {
  const props = useEntryProps(interpretation.event.seq);
  return (
    <div {...props}>
      <Subhead
        title={
          interpretation.test_id
            ? `Interpretation of ${interpretation.test_id}`
            : "Interpretation"
        }
        detail={<ByLine event={interpretation.event} />}
        className="border-t border-t-border"
      />
      {interpretation.per_hypothesis.length ? (
        <Table>
          <TableHeader className="static">
            <TableRow className="hover:bg-transparent">
              <TableHead>Hypothesis</TableHead>
              <TableHead>Effect of the test</TableHead>
              <TableHead>Why</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {interpretation.per_hypothesis.map((entry) => (
              <TableRow key={entry.id} className="h-auto">
                <TableCell className="py-1.5 align-top">
                  <IdLink id={entry.id} />
                </TableCell>
                <TableCell className="py-1.5 align-top">
                  <VerdictTag verdict={entry.verdict} />
                </TableCell>
                <TableCell className="py-1.5 align-top whitespace-normal text-foreground">
                  {entry.why ?? (
                    <span className="text-subtle-foreground">Not stated</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="px-3 py-2 text-xs text-subtle-foreground">
          No hypothesis was given a verdict.
        </p>
      )}
      <p className="border-t border-border-subtle px-3 py-2 text-xs">
        <span className="text-muted-foreground">Uncertainty: </span>
        <span className="text-foreground">
          {interpretation.uncertainty ?? (
            <span className="text-subtle-foreground">Not stated</span>
          )}
        </span>
      </p>
    </div>
  );
}

/** What the test returned, how to run it again, and what it did to each hypothesis. */
export function ExperimentResult() {
  const { view } = useRun();
  return (
    <LoopSection
      stage="result"
      title="Result"
      count={view.results.length}
      detail="A computational test. Its result is a prediction, not an experimental observation."
    >
      <Plate>
        {view.results.length ? (
          <ul>
            {view.results.map((result) => (
              <ResultBlock key={result.event.seq} result={result} />
            ))}
          </ul>
        ) : (
          <NotRecorded what="experiment results" />
        )}
        {view.interpretations.length ? (
          view.interpretations.map((interpretation) => (
            <InterpretationBlock
              key={interpretation.event.seq}
              interpretation={interpretation}
            />
          ))
        ) : (
          <>
            <Subhead
              title="Interpretation"
              className="border-t border-t-border"
            />
            <NotRecorded what="interpretation" />
          </>
        )}
      </Plate>
    </LoopSection>
  );
}
