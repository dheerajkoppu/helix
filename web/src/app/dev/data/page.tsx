import type { Metadata } from "next";

import { DataDemo } from "./data-demo";

export const metadata: Metadata = { title: "Workspace data layer" };

/** One protein through `@/lib/workspace-data` and the Helix API only. `acc` and `s` set the protein and the structure. */
export default async function DataPage({
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
    <DataDemo accession={one("acc") ?? "Q06187"} structureId={one("s")} />
  );
}
