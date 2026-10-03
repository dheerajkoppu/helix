import type { Metadata } from "next";

import { MonoId } from "@/components/data/mono-id";
import { Page, PageBody, PageHeader, Plate } from "@/components/shell/page";
import { SearchTrigger } from "@/components/shell/search-trigger";
import { EmptyState } from "@/components/states/empty-state";
import { decodeParam } from "@/lib/ids";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Compound ${decodeParam((await params).id)}` };
}

export default async function CompoundPage({ params }: Props) {
  const compoundId = decodeParam((await params).id);
  return (
    <Page>
      <PageHeader
        kind="Compound"
        title="Compound"
        id={<MonoId value={compoundId} />}
        description="Identified by InChIKey. A ChEMBL identifier in the address is resolved to the same record."
      />
      <PageBody className="py-5">
        <Plate className="h-72">
          <EmptyState
            title="Compound not loaded"
            description="Structure, identifiers, known targets, experimental activity and any predicted interactions appear here, each with its source. This page is not connected to the data service in this build."
            actions={
              <div className="w-72">
                <SearchTrigger />
              </div>
            }
          />
        </Plate>
      </PageBody>
    </Page>
  );
}
