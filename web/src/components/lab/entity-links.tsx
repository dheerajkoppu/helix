import { TextLink } from "@/components/data/text-link";
import { SourceChip } from "@/components/evidence/source-chip";
import { variantLabel } from "@/components/lab/format";
import type { LabRun, LabSource } from "@/components/lab/types";
import { isUniProtAccession, parseVariantId, routes } from "@/lib/ids";

type Subject = LabRun["subject"];

interface WorkspaceTarget {
  href: string;
  /** what opens: "protein", "variant", "structure" */
  kind: string;
}

const PDB_ID = /^[0-9][A-Za-z0-9]{3}$/;
const AFDB_ID = /^AF-[A-Z0-9]+-F\d+/i;

const structureHref = (accession: string, structureId: string) =>
  `${routes.protein(accession)}?s=${encodeURIComponent(structureId).replaceAll("%3A", ":")}`;

/** The workspace page for a cited source record, when the record is an entity the workspace opens. */
export function workspaceTargetForSource(
  source: LabSource,
  subject: Subject,
): WorkspaceTarget | null {
  const recordId = source.record_id?.trim();
  if (!recordId) return null;
  const database = source.database.toLowerCase();
  if (database.includes("uniprot") && isUniProtAccession(recordId))
    return { href: routes.protein(recordId.toUpperCase()), kind: "protein" };
  if (database.includes("clinvar") && /^VCV\d{9}/i.test(recordId))
    return { href: routes.variant(recordId.toUpperCase()), kind: "variant" };
  if (!subject.accession) return null;
  if (
    (database.includes("pdb") || database.includes("rcsb")) &&
    PDB_ID.test(recordId)
  ) {
    return {
      href: structureHref(subject.accession, `pdb:${recordId.toUpperCase()}`),
      kind: "structure",
    };
  }
  if (database.includes("alphafold") && AFDB_ID.test(recordId)) {
    return {
      href: structureHref(subject.accession, `afdb:${recordId}`),
      kind: "structure",
    };
  }
  return null;
}

/** The workspace page a bare reference string names, when it names one. */
export function workspaceTargetForRef(
  reference: string,
  subject: Subject,
): WorkspaceTarget | null {
  const value = reference.trim();
  const parsedVariant = parseVariantId(value);
  if (parsedVariant) return { href: routes.variant(value), kind: "variant" };
  if (/^(pdb|afdb|of):/i.test(value) && subject.accession)
    return { href: structureHref(subject.accession, value), kind: "structure" };
  if (isUniProtAccession(value))
    return { href: routes.protein(value.toUpperCase()), kind: "protein" };
  if (subject.gene && value.toUpperCase() === subject.gene.toUpperCase())
    return { href: routes.gene(subject.gene), kind: "gene" };
  return null;
}

/** Source records as chips that open the source, each followed by its workspace page when one exists. */
export function SourceLinks({
  sources,
  subject,
}: {
  sources: LabSource[];
  subject: Subject;
}) {
  if (sources.length === 0)
    return <span className="text-subtle-foreground">No source attached</span>;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {sources.map((source, index) => {
        const target = workspaceTargetForSource(source, subject);
        return (
          <span
            key={`${source.database}:${source.record_id}:${index}`}
            className="inline-flex items-center gap-1.5"
          >
            <SourceChip
              source={source.database}
              id={source.record_id ?? "no record ID"}
              href={source.url}
            />
            {target ? (
              <TextLink href={target.href} className="text-2xs">
                {target.kind}
              </TextLink>
            ) : null}
          </span>
        );
      })}
    </span>
  );
}

/** The run's subject as links into the workspace stages. */
export function SubjectLinks({ subject }: { subject: Subject }) {
  const parsed = subject.variant_id ? parseVariantId(subject.variant_id) : null;
  const links: Array<{ label: string; href: string; mono?: boolean }> = [];
  if (subject.variant_id) {
    links.push({
      label: `Variant ${variantLabel(subject.variant_id)}`,
      href: routes.variant(subject.variant_id),
    });
    links.push({
      label: "Mechanism stage",
      href: routes.mechanism(subject.variant_id),
    });
  }
  if (parsed?.kind === "substitution") {
    links.push({
      label: "Reference and variant structures",
      href: routes.compare(parsed.gene, parsed.label),
    });
  }
  if (subject.gene)
    links.push({
      label: `Gene ${subject.gene}`,
      href: routes.gene(subject.gene),
    });
  if (subject.accession)
    links.push({
      label: `Protein ${subject.accession}`,
      href: routes.protein(subject.accession),
    });
  if (links.length === 0)
    return <span className="text-subtle-foreground">No subject recorded</span>;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {links.map((link) => (
        <TextLink key={link.href} href={link.href}>
          {link.label}
        </TextLink>
      ))}
    </span>
  );
}
