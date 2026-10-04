"use client";

import {
  createSortedRowModel,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { cn } from "cn";

import { RowsSkeleton } from "@/components/states/query-state";
import { usePreferences } from "@/lib/state/preferences";

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns,
});

export const DATA_TABLE_ROW_HEIGHT = 36;

export interface DataTableColumn<Row> {
  id: string;
  header: React.ReactNode;
  /** plain value used for sorting and as the default cell text */
  accessor?: (row: Row) => string | number | null | undefined;
  /** custom cell; falls back to the accessor value, and to "Unknown" when that is empty */
  cell?: (row: Row) => React.ReactNode;
  /** numeric columns are right-aligned and monospace */
  align?: "left" | "right";
  mono?: boolean;
  /** pixels, or any CSS grid track such as "minmax(8rem,1fr)"; default "minmax(0,1fr)" */
  width?: number | string;
  /** default: true when an accessor is given */
  sortable?: boolean;
}

export interface DataTableProps<Row> {
  columns: DataTableColumn<Row>[];
  data: Row[];
  getRowId: (row: Row) => string;
  /** accessible name: "Variants of BTK" */
  label: string;
  /** controlled selection; the selected row gets the active surface and an ink bar */
  selectedRowId?: string | null;
  /** click, or Enter on the keyboard cursor */
  onRowSelect?: (row: Row) => void;
  /** double click, or Enter on an already selected row: open, drill in */
  onRowActivate?: (row: Row) => void;
  /** pointer enters or leaves a row, and the keyboard cursor moves; drives the shared hover channel */
  onRowHover?: (row: Row | null) => void;
  defaultSort?: { id: string; desc?: boolean };
  /** rows are kept together by this key; sorting applies inside each group */
  groupBy?: (row: Row) => string;
  /** group keys in display order; groups not listed follow in first-seen order */
  groupOrder?: string[];
  groupLabel?: (group: string, count: number) => React.ReactNode;
  loading?: boolean;
  /** rendered in place of the body when there are no rows; pass an EmptyState */
  empty?: React.ReactNode;
  className?: string;
}

type Item<Row> =
  | { kind: "group"; key: string; group: string; count: number }
  | { kind: "row"; key: string; row: Row };

const trackFor = (width: number | string | undefined) =>
  width === undefined
    ? "minmax(0,1fr)"
    : typeof width === "number"
      ? `${width}px`
      : width;

/**
 * The table for every list in the product: 28px rows, sticky header, sortable columns, virtualised
 * body, full keyboard navigation. It fills its parent, which must have a bounded height.
 *
 * Keys while the table is focused: Up/Down or k/j move, Home/End jump, PageUp/PageDown page, Enter selects,
 * Enter again opens.
 */
export function DataTable<Row extends RowData>({
  columns,
  data,
  getRowId,
  label,
  selectedRowId,
  onRowSelect,
  onRowActivate,
  onRowHover,
  defaultSort,
  groupBy,
  groupOrder,
  groupLabel,
  loading = false,
  empty,
  className,
}: DataTableProps<Row>) {
  const tableId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [cursorId, setCursorId] = useState<string | null>(null);
  const singleKeys = usePreferences((state) => state.singleKeyShortcuts);

  const columnDefs = useMemo<Array<ColumnDef<typeof features, Row>>>(
    () =>
      columns.map((column) => ({
        id: column.id,
        accessorFn: (row: Row) => column.accessor?.(row) ?? null,
        enableSorting: column.sortable ?? Boolean(column.accessor),
        sortUndefined: "last" as const,
      })),
    [columns],
  );

  const table = useTable({
    features,
    columns: columnDefs,
    data,
    getRowId,
    initialState: {
      sorting: defaultSort
        ? [{ id: defaultSort.id, desc: defaultSort.desc ?? false }]
        : [],
    },
  });

  const sortedRows = table.getRowModel().rows;

  const items = useMemo<Item<Row>[]>(() => {
    if (!groupBy)
      return sortedRows.map((row) => ({
        kind: "row",
        key: row.id,
        row: row.original,
      }));
    const groups = new Map<string, Row[]>();
    for (const group of groupOrder ?? []) groups.set(group, []);
    for (const row of sortedRows) {
      const group = groupBy(row.original);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)?.push(row.original);
    }
    const flattened: Item<Row>[] = [];
    for (const [group, rows] of groups) {
      if (rows.length === 0) continue;
      flattened.push({
        kind: "group",
        key: `group:${group}`,
        group,
        count: rows.length,
      });
      for (const row of rows)
        flattened.push({ kind: "row", key: getRowId(row), row });
    }
    return flattened;
  }, [sortedRows, groupBy, groupOrder, getRowId]);

  const rowIndexes = useMemo(
    () => items.flatMap((item, index) => (item.kind === "row" ? [index] : [])),
    [items],
  );

  // TanStack Virtual returns functions that cannot be memoised safely; this component is not compiled.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => DATA_TABLE_ROW_HEIGHT,
    overscan: 12,
  });

  const gridTemplateColumns = columns
    .map((column) => trackFor(column.width))
    .join(" ");
  const domId = (key: string) =>
    `${tableId}-${key.replace(/[^A-Za-z0-9_-]/g, "_")}`;

  const moveCursor = useCallback(
    (step: number | "first" | "last") => {
      if (rowIndexes.length === 0) return;
      const currentPosition = rowIndexes.findIndex(
        (index) => items[index].key === (cursorId ?? selectedRowId),
      );
      let nextPosition: number;
      if (step === "first") nextPosition = 0;
      else if (step === "last") nextPosition = rowIndexes.length - 1;
      else if (currentPosition === -1)
        nextPosition = step > 0 ? 0 : rowIndexes.length - 1;
      else
        nextPosition = Math.min(
          rowIndexes.length - 1,
          Math.max(0, currentPosition + step),
        );
      const itemIndex = rowIndexes[nextPosition];
      const item = items[itemIndex];
      if (item.kind !== "row") return;
      setCursorId(item.key);
      onRowHover?.(item.row);
      virtualizer.scrollToIndex(itemIndex, { align: "auto" });
    },
    [rowIndexes, items, cursorId, selectedRowId, onRowHover, virtualizer],
  );

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // Keys pressed on a header button belong to that button.
    if (event.target !== event.currentTarget) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const page = Math.max(
      1,
      Math.floor(
        (scrollRef.current?.clientHeight ?? 280) / DATA_TABLE_ROW_HEIGHT,
      ) - 1,
    );
    const key = event.key;
    if (key === "ArrowDown" || (singleKeys && key === "j")) moveCursor(1);
    else if (key === "ArrowUp" || (singleKeys && key === "k")) moveCursor(-1);
    else if (key === "PageDown") moveCursor(page);
    else if (key === "PageUp") moveCursor(-page);
    else if (key === "Home") moveCursor("first");
    else if (key === "End") moveCursor("last");
    else if (key === "Enter") {
      const item = items.find(
        (candidate) =>
          candidate.kind === "row" &&
          candidate.key === (cursorId ?? selectedRowId),
      );
      if (!item || item.kind !== "row") return;
      if (item.key === selectedRowId) onRowActivate?.(item.row);
      else onRowSelect?.(item.row);
    } else return;
    event.preventDefault();
  }

  const headers = table.getHeaderGroups()[0]?.headers ?? [];
  const activeDescendant = cursorId ?? selectedRowId ?? undefined;

  return (
    <div
      data-slot="data-table"
      role="grid"
      aria-label={label}
      aria-rowcount={rowIndexes.length}
      aria-activedescendant={activeDescendant ? domId(activeDescendant) : undefined}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cn(
        "flex h-full min-h-0 flex-col text-xs outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--ring)]",
        className,
      )}
    >
      <div
        role="row"
        className="grid h-9 shrink-0 items-center border-b border-border bg-muted"
        style={{ gridTemplateColumns }}
      >
        {columns.map((column, index) => {
          const header = headers[index];
          const sorted = header?.column.getIsSorted() ?? false;
          const canSort = header?.column.getCanSort() ?? false;
          const SortIcon = sorted === "desc" ? ArrowDownIcon : ArrowUpIcon;
          const content = (
            <>
              <span className="truncate">{column.header}</span>
              {canSort ? (
                <SortIcon
                  aria-hidden
                  className={cn(
                    "size-3 shrink-0",
                    sorted
                      ? "text-foreground"
                      : "text-transparent group-hover/th:text-subtle-foreground",
                  )}
                />
              ) : null}
            </>
          );
          return (
            <div
              key={column.id}
              role="columnheader"
              aria-sort={
                sorted === "asc"
                  ? "ascending"
                  : sorted === "desc"
                    ? "descending"
                    : undefined
              }
              className={cn(
                "flex h-full min-w-0 items-center px-3 text-2xs font-medium tracking-[0.02em] text-muted-foreground uppercase",
                column.align === "right" && "justify-end",
              )}
            >
              {canSort ? (
                <button
                  type="button"
                  onClick={header?.column.getToggleSortingHandler()}
                  className={cn(
                    "group/th -mx-1 inline-flex h-6 min-w-0 cursor-pointer items-center gap-1 rounded-xs px-1 uppercase hover:text-foreground",
                    sorted && "text-foreground",
                    column.align === "right" && "flex-row-reverse",
                  )}
                >
                  {content}
                </button>
              ) : (
                content
              )}
            </div>
          );
        })}
      </div>

      {loading ? (
        <RowsSkeleton rows={8} />
      ) : items.length === 0 ? (
        <div className="min-h-0 flex-1">{empty}</div>
      ) : (
        <div
          ref={scrollRef}
          role="rowgroup"
          onMouseLeave={() => onRowHover?.(null)}
          className="scroll-thin relative min-h-0 flex-1 overflow-auto"
        >
          <div
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((virtual) => {
              const item = items[virtual.index];
              const position = {
                height: virtual.size,
                transform: `translateY(${virtual.start}px)`,
              };
              if (item.kind === "group") {
                return (
                  <div
                    key={item.key}
                    role="row"
                    className="absolute inset-x-0 top-0 flex items-center gap-2 border-b border-border-subtle bg-sunken px-3 text-2xs font-medium text-muted-foreground"
                    style={position}
                  >
                    <span role="gridcell" className="flex items-center gap-2">
                      {groupLabel
                        ? groupLabel(item.group, item.count)
                        : item.group}
                      <span className="tabular font-mono font-normal text-subtle-foreground">
                        {item.count}
                      </span>
                    </span>
                  </div>
                );
              }
              const selected = item.key === selectedRowId;
              const cursor = item.key === cursorId;
              return (
                <div
                  key={item.key}
                  id={domId(item.key)}
                  role="row"
                  aria-selected={selected}
                  data-state={selected ? "selected" : undefined}
                  onClick={() => {
                    setCursorId(item.key);
                    onRowSelect?.(item.row);
                  }}
                  onDoubleClick={() => onRowActivate?.(item.row)}
                  onMouseEnter={() => onRowHover?.(item.row)}
                  className={cn(
                    "absolute inset-x-0 top-0 grid items-center border-b border-border-subtle",
                    (onRowSelect || onRowActivate) && "cursor-default",
                    selected
                      ? "bg-active shadow-[inset_2px_0_0_var(--foreground)]"
                      : "hover:bg-accent",
                    cursor && !selected && "bg-accent",
                    cursor &&
                      "outline-1 -outline-offset-1 outline-border-strong",
                  )}
                  style={{ ...position, gridTemplateColumns }}
                >
                  {columns.map((column) => {
                    const value = column.accessor?.(item.row);
                    const rendered = column.cell
                      ? column.cell(item.row)
                      : value;
                    const isEmpty =
                      rendered === null ||
                      rendered === undefined ||
                      rendered === "";
                    return (
                      <div
                        key={column.id}
                        role="gridcell"
                        className={cn(
                          "min-w-0 truncate px-3",
                          column.align === "right" && "text-right",
                          (column.mono || column.align === "right") &&
                            "tabular font-mono",
                        )}
                      >
                        {isEmpty ? (
                          <span className="text-subtle-foreground">
                            Unknown
                          </span>
                        ) : (
                          rendered
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
