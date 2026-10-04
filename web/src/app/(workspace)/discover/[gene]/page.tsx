import type { Metadata } from "next";

import { DiscoveryStage } from "@/components/discovery";
import { decodeParam } from "@/lib/ids";
import { DISCOVERY_WORDS } from "@/lib/plain-language";

type Props = {
  params: Promise<{ gene: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const first = (value: string | string[] | undefined): string | null => {
  const text = Array.isArray(value) ? value[0] : value;
  return text && text.trim() !== "" ? text : null;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const gene = decodeParam((await params).gene).toUpperCase();
  return { title: `${gene} · ${DISCOVERY_WORDS.title}` };
}

export default async function DiscoverPage({ params, searchParams }: Props) {
  const gene = decodeParam((await params).gene).toUpperCase();
  const query = await searchParams;
  const heldOut = first(query.held_out);
  return (
    <DiscoveryStage
      key={gene}
      gene={gene}
      disease={first(query.disease)}
      variant={first(query.variant)}
      heldOut={heldOut === "1" || heldOut === "true"}
    />
  );
}
