"use client";

import { Fragment } from "react";

import { useEntryProps, useRun } from "@/components/lab/run-context";
import { ByLine, IdLink, LoopSection } from "@/components/lab/section";
import type { ReportEntry } from "@/components/lab/record";
import { Plate } from "@/components/shell/page";

const CITATION = /(\[[A-Z]\d+(?:\s*,\s*[A-Z]\d+)*\]|\*\*[^*]+\*\*)/g;

/** Inline text with record citations such as [E3] or [H1, T2] linked to the rows they name. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(CITATION).map((part, index) => {
        if (/^\[[A-Z]\d+/.test(part)) {
          const ids = part.slice(1, -1).split(/\s*,\s*/);
          return (
            <span key={index} className="whitespace-nowrap">
              [
              {ids.map((id, position) => (
                <Fragment key={id}>
                  {position > 0 ? ", " : null}
                  <IdLink id={id} />
                </Fragment>
              ))}
              ]
            </span>
          );
        }
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={index} className="font-medium">
              {part.slice(2, -2)}
            </strong>
          );
        }
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </>
  );
}

/** The report as its author wrote it, line by line: headings, list items and paragraphs. */
function ReportLines({ text }: { text: string }) {
  return (
    <div className="flex max-w-[80ch] flex-col gap-1.5 text-sm text-foreground">
      {text.split("\n").map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return null;
        const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
        if (heading) {
          return (
            <p key={index} className="pt-2 text-base font-medium first:pt-0">
              <Inline text={heading[2]} />
            </p>
          );
        }
        const item = /^(?:[-*]|\d+\.)\s+(.*)$/.exec(trimmed);
        if (item) {
          return (
            <p key={index} className="flex gap-2">
              <span
                aria-hidden
                className="mt-2.5 h-px w-2 shrink-0 bg-border-strong"
              />
              <span>
                <Inline text={item[1]} />
              </span>
            </p>
          );
        }
        return (
          <p key={index}>
            <Inline text={trimmed} />
          </p>
        );
      })}
    </div>
  );
}

function RecordedReport({ entry }: { entry: ReportEntry }) {
  const props = useEntryProps(entry.event.seq, "px-3 py-3");
  return (
    <div {...props}>
      {entry.text ? (
        <ReportLines text={entry.text} />
      ) : (
        <p className="text-xs text-subtle-foreground">
          The report line carries no text.
        </p>
      )}
    </div>
  );
}

/** The report the run closed the loop with. Every citation links to its record row. */
export function Report() {
  const { view, replaying, reportText } = useRun();
  const recorded = view.report;
  const served = !recorded && !replaying ? reportText : null;
  if (!recorded && !served) return null;
  return (
    <LoopSection
      id="report"
      title="Report"
      detail={
        <>
          Written by an agent from the record
          {recorded?.file ? (
            <>
              {" "}
              and saved as <span className="font-mono">{recorded.file}</span>
            </>
          ) : null}
          . {recorded ? <ByLine event={recorded.event} /> : null}
        </>
      }
    >
      <Plate>
        {recorded ? (
          <RecordedReport entry={recorded} />
        ) : served ? (
          <div className="px-3 py-3">
            <ReportLines text={served} />
          </div>
        ) : null}
      </Plate>
    </LoopSection>
  );
}
