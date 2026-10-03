import type { Metadata } from "next";

import { VariantWorkspace } from "@/components/variant/variant-workspace";
import { decodeParam } from "@/lib/ids";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `${decodeParam((await params).id)} · Variant` };
}

export default async function VariantPage({ params }: Props) {
  return <VariantWorkspace variantId={decodeParam((await params).id)} />;
}
