import { humanise } from "@/components/lab/format";
import { isRecord, type LooseRecord } from "@/components/lab/types";

const isPrimitive = (value: unknown): value is string | number | boolean =>
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean";

/** A measured value as recorded. Numbers keep every digit the record holds. */
function printPrimitive(value: string | number | boolean): string {
  return typeof value === "boolean" ? (value ? "yes" : "no") : String(value);
}

function printCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (isPrimitive(value)) return printPrimitive(value);
  if (Array.isArray(value) && value.every(isPrimitive))
    return value.map(printPrimitive).join(", ");
  return JSON.stringify(value);
}

/** Rows of records as a table whose columns are the keys the rows carry. */
function RecordTable({ rows }: { rows: LooseRecord[] }) {
  const columns: string[] = [];
  for (const row of rows)
    for (const key of Object.keys(row))
      if (!columns.includes(key)) columns.push(key);
  return (
    <div className="scroll-thin max-h-72 overflow-auto border border-border-subtle">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-muted">
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                className="h-7 border-b border-border px-2 text-left text-2xs font-medium tracking-[0.02em] whitespace-nowrap text-muted-foreground uppercase"
              >
                {humanise(column)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={index}
              className="border-b border-border-subtle last:border-b-0"
            >
              {columns.map((column) => (
                <td
                  key={column}
                  className="tabular max-w-[28rem] px-2 py-1 align-top font-mono break-words text-foreground"
                >
                  {printCell(row[column]) || (
                    <span className="text-subtle-foreground">none</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Value({ value, depth }: { value: unknown; depth: number }) {
  if (value === null || value === undefined)
    return <span className="text-subtle-foreground">none</span>;
  if (isPrimitive(value))
    return (
      <span className="tabular font-mono break-words text-foreground">
        {printPrimitive(value)}
      </span>
    );
  if (Array.isArray(value)) {
    if (value.length === 0)
      return <span className="text-subtle-foreground">none</span>;
    if (value.every(isPrimitive)) {
      return (
        <span className="tabular font-mono break-words text-foreground">
          {value.map(printPrimitive).join(", ")}
        </span>
      );
    }
    if (value.every(isRecord)) return <RecordTable rows={value} />;
  }
  if (isRecord(value) && depth < 2)
    return <ValuesView values={value} depth={depth + 1} />;
  return (
    <pre className="scroll-thin max-h-48 overflow-auto font-mono text-2xs whitespace-pre-wrap text-foreground">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/**
 * The values an experiment recorded, printed as recorded: scalars inline, lists of rows as a table,
 * nested groups as nested rows. Nothing is rounded, summarised or dropped.
 */
export function ValuesView({
  values,
  depth = 0,
  bare = false,
}: {
  values: LooseRecord;
  depth?: number;
  /** no outer rule, for a list that already sits inside a ruled box */
  bare?: boolean;
}) {
  const entries = Object.entries(values);
  if (entries.length === 0)
    return <span className="text-subtle-foreground">none</span>;
  return (
    <dl
      className={
        bare
          ? "text-xs"
          : depth === 0
            ? "border border-border-subtle text-xs"
            : "border-l border-border-subtle text-xs"
      }
    >
      {entries.map(([key, value]) => {
        const block =
          (Array.isArray(value) && !value.every(isPrimitive)) ||
          isRecord(value);
        return (
          <div
            key={key}
            className={
              block
                ? "flex flex-col gap-1.5 border-b border-border-subtle px-2.5 py-1.5 last:border-b-0"
                : "grid gap-x-3 border-b border-border-subtle px-2.5 py-1.5 last:border-b-0 sm:grid-cols-[minmax(8rem,14rem)_minmax(0,1fr)]"
            }
          >
            <dt className="text-muted-foreground">{humanise(key)}</dt>
            <dd className="min-w-0">
              <Value value={value} depth={depth} />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
