import type { Metadata } from "next";

import { Unknown } from "@/components/data/definition-list";
import { StructureOriginTag } from "@/components/evidence/structure-origin-tag";
import { Page, PageBody, PageHeader, PageSection, Plate } from "@/components/shell/page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { StructureOrigin } from "@/lib/structure-origin";

export const metadata: Metadata = { title: "Models" };

interface Adapter {
  id: string;
  role: string;
  runs: string;
  confidence: string;
  limit: string;
  origin: StructureOrigin;
}

/** The three first-class adapters defined by the architecture. Availability comes from the API. */
const ADAPTERS: Adapter[] = [
  {
    id: "afdb",
    role: "Retrieves existing AlphaFold DB predictions",
    runs: "Remote lookup, no inference",
    confidence: "pLDDT, PAE",
    limit: "Reference sequences",
    origin: "predicted_external",
  },
  {
    id: "esm_atlas",
    role: "Predicts a structure with ESMFold through the ESM Atlas API",
    runs: "Remote inference, no GPU",
    confidence: "pLDDT only",
    limit: "400 residues",
    origin: "predicted_orphafold",
  },
  {
    id: "boltz2",
    role: "Predicts structures, complexes, ligand poses and affinity with Boltz-2",
    runs: "Local CLI or GPU worker",
    confidence: "pLDDT, PAE, pTM, ipTM",
    limit: "Needs local compute",
    origin: "predicted_orphafold",
  },
];

export default function ModelsPage() {
  return (
    <Page>
      <PageHeader
        kind="Models"
        title="Model providers"
        description="Models are replaceable compute providers behind adapters. A provider is never hardcoded into a page, and every result names the provider, the model version and its confidence outputs."
      />
      <PageBody>
        <PageSection
          title="Adapters"
          count={ADAPTERS.length}
          description="Defined by the architecture. Whether each one is configured on this installation is reported by the API."
        >
          <Plate>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Adapter</TableHead>
                  <TableHead>Result class</TableHead>
                  <TableHead>What it does</TableHead>
                  <TableHead>Runs as</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Limit</TableHead>
                  <TableHead>Availability</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ADAPTERS.map((adapter) => (
                  <TableRow key={adapter.id}>
                    <TableCell className="font-mono font-medium">{adapter.id}</TableCell>
                    <TableCell>
                      <StructureOriginTag origin={adapter.origin} size="compact" />
                    </TableCell>
                    <TableCell>{adapter.role}</TableCell>
                    <TableCell className="text-muted-foreground">{adapter.runs}</TableCell>
                    <TableCell className="font-mono text-muted-foreground">{adapter.confidence}</TableCell>
                    <TableCell className="text-muted-foreground">{adapter.limit}</TableCell>
                    <TableCell>
                      <Unknown />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Plate>
          <p className="mt-3 max-w-[68ch] text-xs text-muted-foreground">
            Availability is Unknown because this page is not connected to the API in this build. AlphaFold Server is
            not used. Further adapters that need an API key can be added later through the same interface.
          </p>
        </PageSection>
      </PageBody>
    </Page>
  );
}
