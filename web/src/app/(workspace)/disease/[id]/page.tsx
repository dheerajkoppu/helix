import type { Metadata } from "next";

import { StagePlaceholder } from "@/components/workspace/stage-placeholder";
import { decodeParam } from "@/lib/ids";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `${decodeParam((await params).id)} · Disease` };
}

export default async function DiseasePage({ params }: Props) {
  const slug = decodeParam((await params).id);
  return (
    <StagePlaceholder
      stage="disease"
      subject={{ disease: { id: slug, label: slug } }}
      ledger={{
        title: "Genes",
        empty: "No genes loaded",
        holds:
          "Genes associated with this disease, with one evidence column per source.",
      }}
      instrument={{
        title: "Disease",
        empty: `No disease record loaded for ${slug}`,
        holds:
          "Name, definition, inheritance, phenotypes, current treatment summary and a diagram of where the disease sits biologically.",
      }}
      inspector={{
        title: "Sources",
        empty: "No source records",
        holds:
          "Ontology identifiers and the source record behind each statement.",
      }}
    />
  );
}
