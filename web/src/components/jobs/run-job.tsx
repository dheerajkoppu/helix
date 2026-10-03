"use client";

import { PlayIcon } from "lucide-react";
import { cn } from "cn";
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, apiRequest, isApiError } from "@/lib/api/client";
import { useAdvancedMode } from "@/lib/state/preferences";
import {
  navigateTo,
  startJobWatcher,
  trackJob,
  useJobs,
  type JobKind,
  type JobOut,
  type ModelsOut,
  type ProviderInfo,
  type RunJobRequest,
} from "@/lib/state/jobs";

const HOST_ID = "orphafold-jobs-host";

/** The dialog and the job watcher mount themselves on first use, so no layout has to render a host. */
function ensureHost(): void {
  if (typeof document === "undefined") return;
  startJobWatcher();
  if (document.getElementById(HOST_ID)) return;
  const container = document.createElement("div");
  container.id = HOST_ID;
  document.body.appendChild(container);
  createRoot(container).render(<RunJobDialog />);
}

/** Opens the run dialog, prefilled. Callable from any event handler. */
export function openRunJob(request: RunJobRequest = {}): void {
  ensureHost();
  useJobs.getState().openDialog(request);
}

/** Starts the global job watcher. Render once in the app shell; it draws nothing. */
export function JobWatcher(): null {
  useEffect(() => ensureHost(), []);
  return null;
}

export interface RunJobButtonProps {
  kind: string;
  params?: Record<string, unknown>;
  label?: string;
  variant?: "outline" | "ghost" | "default";
  size?: "default" | "sm" | "xs";
  className?: string;
}

/** Opens the run dialog for one job kind with parameters taken from the current context. */
export function RunJobButton({
  kind,
  params,
  label = "Run job",
  variant = "outline",
  size = "default",
  className,
}: RunJobButtonProps) {
  useEffect(() => ensureHost(), []);
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={() => openRunJob({ kind, params })}
    >
      <PlayIcon data-icon="inline-start" />
      {label}
    </Button>
  );
}

type FieldType = "string" | "integer" | "number" | "boolean" | "enum" | "list";

interface FieldSpec {
  name: string;
  title: string;
  description: string | null;
  type: FieldType;
  itemType: "string" | "integer" | "number";
  options: string[];
  defaultValue: unknown;
  required: boolean;
}

const PRIMARY_FIELDS = [
  "uniprot_accession",
  "sequence",
  "gene_symbol",
  "variant_id",
  "substitution",
  "residue_start",
  "residue_end",
  "ligand_smiles",
  "ligand_ccd",
  "ligand_label",
];

function toFieldSpec(
  name: string,
  raw: Record<string, unknown>,
  required: boolean,
): FieldSpec {
  const variants = Array.isArray(raw.anyOf)
    ? (raw.anyOf as Record<string, unknown>[])
    : [raw];
  const schema = variants.find((variant) => variant.type !== "null") ?? raw;
  const items = (schema.items ?? {}) as Record<string, unknown>;
  let type: FieldType = "string";
  if (Array.isArray(schema.enum)) type = "enum";
  else if (schema.type === "integer") type = "integer";
  else if (schema.type === "number") type = "number";
  else if (schema.type === "boolean") type = "boolean";
  else if (schema.type === "array") type = "list";
  return {
    name,
    title: typeof raw.title === "string" ? raw.title : name,
    description: typeof raw.description === "string" ? raw.description : null,
    type,
    itemType:
      items.type === "integer" || items.type === "number"
        ? items.type
        : "string",
    options: Array.isArray(schema.enum) ? schema.enum.map(String) : [],
    defaultValue: raw.default ?? null,
    required,
  };
}

type FormValue = string | boolean;

function toFormValue(field: FieldSpec, value: unknown): FormValue {
  if (field.type === "boolean") return value === true || value === "true";
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/** Typed params from the form. Empty fields are left out so the API applies its own defaults. */
function toParams(
  fields: FieldSpec[],
  values: Record<string, FormValue>,
): { params: Record<string, unknown>; problem: string | null } {
  const params: Record<string, unknown> = {};
  const toNumber = (text: string, integer: boolean) => {
    const parsed = Number(text);
    return Number.isFinite(parsed) && (!integer || Number.isInteger(parsed))
      ? parsed
      : null;
  };
  for (const field of fields) {
    const value = values[field.name];
    if (typeof value === "boolean") {
      params[field.name] = value;
      continue;
    }
    const text = (value ?? "").trim();
    if (text === "") {
      if (field.required)
        return { params, problem: `${field.title} is required.` };
      continue;
    }
    if (field.type === "integer" || field.type === "number") {
      const parsed = toNumber(text, field.type === "integer");
      if (parsed === null)
        return { params, problem: `${field.title} must be a number.` };
      params[field.name] = parsed;
    } else if (field.type === "list") {
      const parts = text.split(/[\s,]+/).filter((part) => part.length > 0);
      if (field.itemType === "string") params[field.name] = parts;
      else {
        const numbers = parts.map((part) =>
          toNumber(part, field.itemType === "integer"),
        );
        if (numbers.includes(null))
          return {
            params,
            problem: `${field.title} must be a list of numbers.`,
          };
        params[field.name] = numbers;
      }
    } else params[field.name] = text;
  }
  return { params, problem: null };
}

const FIELD_LABEL =
  "text-2xs font-medium tracking-[0.04em] text-muted-foreground uppercase";

function ChoiceRow({
  selected,
  onSelect,
  title,
  detail,
  note,
}: {
  selected: boolean;
  onSelect: () => void;
  title: React.ReactNode;
  detail?: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col gap-0.5 border-l-2 px-2 py-1.5 text-left text-xs outline-none hover:bg-muted focus-visible:bg-muted",
        selected ? "border-foreground bg-active" : "border-transparent",
      )}
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="font-medium text-foreground">{title}</span>
        {detail ? (
          <span className="shrink-0 font-mono text-2xs text-muted-foreground">
            {detail}
          </span>
        ) : null}
      </span>
      {note ? <span className="text-muted-foreground">{note}</span> : null}
    </button>
  );
}

function ParamField({
  field,
  value,
  onChange,
}: {
  field: FieldSpec;
  value: FormValue;
  onChange: (value: FormValue) => void;
}) {
  const advanced = useAdvancedMode();
  const inputId = `run-job-${field.name}`;
  const hint =
    field.defaultValue !== null && field.type !== "boolean"
      ? `default ${String(field.defaultValue)}`
      : null;
  if (field.type === "boolean")
    return (
      <label
        className="flex items-start gap-2 text-xs"
        title={field.description ?? undefined}
      >
        <input
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-0.5 accent-foreground"
        />
        <span>
          <span className="text-foreground">{field.title}</span>
          {advanced && field.description ? (
            <span className="block text-muted-foreground">
              {field.description}
            </span>
          ) : null}
        </span>
      </label>
    );
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={inputId}
        className={FIELD_LABEL}
        title={field.description ?? undefined}
      >
        {field.title}
        {field.required ? " (required)" : ""}
      </label>
      {field.type === "enum" ? (
        <div role="radiogroup" className="flex flex-wrap gap-1">
          {field.options.map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              role="radio"
              aria-checked={value === option}
              variant={value === option ? "secondary" : "outline"}
              onClick={() => onChange(option)}
              className="font-mono"
            >
              {option}
            </Button>
          ))}
        </div>
      ) : field.name === "sequence" || field.name.endsWith("_content") ? (
        <Textarea
          id={inputId}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-14 font-mono text-xs"
          spellCheck={false}
        />
      ) : (
        <Input
          id={inputId}
          value={String(value)}
          inputMode={
            field.type === "integer" || field.type === "number"
              ? "decimal"
              : undefined
          }
          placeholder={hint ?? undefined}
          onChange={(event) => onChange(event.target.value)}
          className="font-mono"
          spellCheck={false}
          autoComplete="off"
        />
      )}
      {advanced && field.description ? (
        <p className="text-2xs text-muted-foreground">{field.description}</p>
      ) : null}
    </div>
  );
}

function ProviderFacts({ provider }: { provider: ProviderInfo }) {
  const advanced = useAdvancedMode();
  const commercial =
    provider.commercial_use === null
      ? "Unknown"
      : provider.commercial_use
        ? "permitted"
        : "not permitted";
  return (
    <div className="border-t border-border-subtle pt-2 text-xs">
      <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-0.5">
        <dt className="text-muted-foreground">Model</dt>
        <dd className="font-mono">
          {provider.model_name ?? "Unknown"}{" "}
          <span className="text-muted-foreground">
            {provider.model_version ?? "version unknown"}
          </span>
        </dd>
        <dt className="text-muted-foreground">Runs as</dt>
        <dd className="font-mono">
          {provider.execution_mode}
          {provider.performs_inference ? "" : " (lookup, no inference)"}
        </dd>
        <dt className="text-muted-foreground">License</dt>
        <dd>
          <span className="font-mono">{provider.license ?? "Unknown"}</span>
          <span className="text-muted-foreground">
            {" "}
            · commercial use {commercial}
          </span>
        </dd>
        {provider.max_residues !== null ? (
          <>
            <dt className="text-muted-foreground">Length limit</dt>
            <dd className="font-mono">{provider.max_residues} residues</dd>
          </>
        ) : null}
      </dl>
      {provider.limitations.length > 0 ? (
        <details open={advanced} className="mt-2">
          <summary className={cn(FIELD_LABEL, "cursor-pointer")}>
            Limits ({provider.limitations.length})
          </summary>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-4 text-muted-foreground">
            {provider.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

interface Catalog {
  kinds: JobKind[];
  providers: ProviderInfo[];
}

function fieldsOf(kind: JobKind): FieldSpec[] {
  const required = kind.params_schema.required ?? [];
  return Object.entries(kind.params_schema.properties ?? {})
    .filter(([name]) => name !== "provider")
    .map(([name, raw]) => toFieldSpec(name, raw, required.includes(name)));
}

/** The request's params over the schema defaults. */
function initialValues(
  fields: FieldSpec[],
  prefilled: Record<string, unknown>,
): Record<string, FormValue> {
  const values: Record<string, FormValue> = {};
  for (const field of fields) {
    values[field.name] = toFormValue(
      field,
      field.name in prefilled
        ? prefilled[field.name]
        : field.type === "boolean" || field.type === "enum"
          ? field.defaultValue
          : null,
    );
  }
  return values;
}

function initialProvider(
  kind: JobKind,
  prefilled: Record<string, unknown>,
): string | null {
  const schemaDefault = kind.params_schema.properties?.provider?.default;
  const wanted =
    typeof prefilled.provider === "string"
      ? prefilled.provider
      : typeof schemaDefault === "string"
        ? schemaDefault
        : null;
  return wanted && kind.providers.includes(wanted)
    ? wanted
    : (kind.providers[0] ?? null);
}

function RunJobForm({
  kind,
  providers,
  prefilled,
  onClose,
}: {
  kind: JobKind;
  providers: ProviderInfo[];
  prefilled: Record<string, unknown>;
  onClose: () => void;
}) {
  const advanced = useAdvancedMode();
  const fields = useMemo(() => fieldsOf(kind), [kind]);
  const [values, setValues] = useState(() => initialValues(fields, prefilled));
  const [providerId, setProviderId] = useState(() =>
    initialProvider(kind, prefilled),
  );
  const [showAll, setShowAll] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const provider = providers.find((entry) => entry.id === providerId) ?? null;
  const primary = fields.filter(
    (field) =>
      field.required ||
      PRIMARY_FIELDS.includes(field.name) ||
      field.name in prefilled,
  );
  const secondary = fields.filter((field) => !primary.includes(field));
  const blocked = provider ? !provider.availability.available : false;
  const setValue = (name: string, value: FormValue) =>
    setValues((current) => ({ ...current, [name]: value }));

  async function submit() {
    const built = toParams(fields, values);
    if (built.problem) {
      setProblem(built.problem);
      return;
    }
    setSubmitting(true);
    setProblem(null);
    try {
      const response = await apiRequest<JobOut>("/jobs", {
        method: "POST",
        body: {
          kind: kind.kind,
          params: providerId
            ? { ...built.params, provider: providerId }
            : built.params,
        },
      });
      const job = response.data;
      trackJob(job);
      toast(
        response.status === 200
          ? "An identical job is already in progress"
          : "Job queued",
        {
          description: job.title ?? job.id,
          action: {
            label: "Open",
            onClick: () => navigateTo(`/jobs/${job.id}`),
          },
        },
      );
      onClose();
    } catch (error) {
      setProblem(
        isApiError(error) ? error.message : "The job could not be submitted.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <fieldset className="flex flex-col gap-1">
        <legend className={FIELD_LABEL}>Model provider</legend>
        <div role="radiogroup" className="mt-1 border border-border">
          {kind.providers.map((id) => {
            const entry = providers.find((candidate) => candidate.id === id);
            return entry ? (
              <ChoiceRow
                key={id}
                selected={id === providerId}
                onSelect={() => setProviderId(id)}
                title={entry.name}
                detail={
                  entry.availability.available ? "available" : "unavailable"
                }
                note={
                  advanced || id === providerId
                    ? (entry.availability.reason ??
                      (entry.availability.available
                        ? null
                        : "No reason reported."))
                    : null
                }
              />
            ) : (
              <ChoiceRow
                key={id}
                selected={id === providerId}
                onSelect={() => setProviderId(id)}
                title={id}
                note="Availability unknown: the models endpoint did not list this provider."
              />
            );
          })}
        </div>
        {provider ? <ProviderFacts provider={provider} /> : null}
      </fieldset>

      <div className="flex flex-col gap-2.5">
        <p className={FIELD_LABEL}>Inputs</p>
        {primary.map((field) => (
          <ParamField
            key={field.name}
            field={field}
            value={values[field.name] ?? ""}
            onChange={(value) => setValue(field.name, value)}
          />
        ))}
        {secondary.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            aria-expanded={showAll}
            onClick={() => setShowAll((current) => !current)}
          >
            {showAll
              ? "Hide other parameters"
              : `Other parameters (${secondary.length})`}
          </Button>
        ) : null}
        {showAll
          ? secondary.map((field) => (
              <ParamField
                key={field.name}
                field={field}
                value={values[field.name] ?? ""}
                onChange={(value) => setValue(field.name, value)}
              />
            ))
          : null}
      </div>

      {problem ? (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      ) : null}
      {blocked ? (
        <p className="text-xs text-muted-foreground">
          {provider?.name} cannot run on this installation, so this job cannot
          be started with it.
        </p>
      ) : null}

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={blocked || submitting} onClick={() => void submit()}>
          {submitting ? "Submitting" : "Run job"}
        </Button>
      </DialogFooter>
    </>
  );
}

function RunJobDialog() {
  const request = useJobs((state) => state.dialog);
  const serial = useJobs((state) => state.dialogSerial);
  const closeDialog = useJobs((state) => state.closeDialog);
  const open = request !== null;

  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<{ serial: number; kind: string } | null>(
    null,
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([
      apiFetch<JobKind[]>("/job-kinds"),
      apiFetch<ModelsOut>("/models"),
    ])
      .then(([kinds, models]) => {
        if (cancelled) return;
        setCatalog({ kinds, providers: models.providers });
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(
          isApiError(error)
            ? error.message
            : "Job kinds and models could not be loaded.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [open, serial]);

  const kinds = catalog?.kinds ?? null;
  // Open on a kind that can run here, so the first thing shown is not an unavailable model
  const firstRunnable = kinds?.find((entry) =>
    entry.providers.some(
      (providerId) =>
        catalog?.providers.find((provider) => provider.id === providerId)
          ?.availability.available,
    ),
  );
  const requested = request?.kind ?? null;
  const requestedKnown =
    requested !== null && (kinds?.some((entry) => entry.kind === requested) ?? false);
  const kindId =
    chosen?.serial === serial
      ? chosen.kind
      : requestedKnown
        ? requested
        : requested
          ? null
          : (firstRunnable?.kind ?? kinds?.[0]?.kind ?? null);
  const kind = kinds?.find((entry) => entry.kind === kindId) ?? null;
  const unknownKind = requested && kinds && !requestedKnown ? requested : null;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : closeDialog())}>
      <DialogContent className="max-h-[88dvh] gap-3 overflow-y-auto rounded-lg sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{kind ? kind.title : "Run a job"}</DialogTitle>
          <DialogDescription>
            {kind?.description ??
              "Runs in the background and records its inputs and model."}
          </DialogDescription>
        </DialogHeader>

        {loadError && !catalog ? (
          <p className="text-xs text-destructive">{loadError}</p>
        ) : null}
        {unknownKind ? (
          <p className="text-xs text-muted-foreground">
            This deployment has no job kind named{" "}
            <span className="font-mono">{unknownKind}</span>. Choose one of the
            kinds it can run.
          </p>
        ) : null}
        {!catalog && !loadError ? (
          <p className="text-xs text-muted-foreground">
            Loading job kinds and models
          </p>
        ) : null}

        {kinds && (!requested || unknownKind) ? (
          <fieldset className="flex flex-col gap-1">
            <legend className={FIELD_LABEL}>Job kind</legend>
            <div role="radiogroup" className="mt-1 border border-border">
              {kinds.map((entry) => (
                <ChoiceRow
                  key={entry.kind}
                  selected={entry.kind === kindId}
                  onSelect={() => setChosen({ serial, kind: entry.kind })}
                  title={entry.title}
                  detail={entry.kind}
                />
              ))}
            </div>
          </fieldset>
        ) : null}

        {kind && catalog ? (
          <RunJobForm
            key={`${serial}:${kind.kind}`}
            kind={kind}
            providers={catalog.providers}
            prefilled={request?.params ?? {}}
            onClose={closeDialog}
          />
        ) : (
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Close
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
