import type { Metadata } from "next";

import { SequenceDemo } from "./sequence-demo";

export const metadata: Metadata = { title: "Sequence axis" };

/** The sequence axis on live UniProt, EBI Proteins, PDBe and AlphaFold DB data. `acc`, `win`, `sel` and `h` set the starting state. */
export default async function SequencePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return typeof value === "string" ? value : null;
  };
  return (
    <SequenceDemo
      initialAccession={one("acc") ?? "Q06187"}
      initialWindow={one("win")}
      initialSelection={one("sel")}
      initialTall={one("h") === "tall"}
    />
  );
}
