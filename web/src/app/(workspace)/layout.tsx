import { WorkspaceFrame } from "@/components/workspace";

/** Disease, gene, protein, variant and compare routes share one persistent workspace frame. */
export default function WorkspaceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <WorkspaceFrame>{children}</WorkspaceFrame>;
}
