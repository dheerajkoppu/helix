import type { Metadata } from "next";

import { MechanismWorkspace } from "@/components/mechanism/mechanism-workspace";
import { decodeParam } from "@/lib/ids";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `${decodeParam((await params).id)} · Mechanism` };
}

export default async function MechanismPage({ params }: Props) {
  const variantId = decodeParam((await params).id);
  return <MechanismWorkspace key={variantId} variantId={variantId} />;
}
