/**
 * Shared data layer for the journey pages (disease, gene, protein, variant, compare, mechanism,
 * intervention). Pages import from "@/lib/workspace-data" and never call `fetch` or build API
 * paths themselves.
 *
 * Conventions
 * - Every hook is a React Query hook over the OrphaFold API and returns the query as is:
 *   `query.data?.data` is the typed body, `query.data?.sources` the per-source status rows.
 *   Render with `QueryErrorState` / `RowsSkeleton` and publish sources with `useReportSources`.
 * - A hook is idle until its ID is set, so it can be called before the ID is known:
 *   `useProtein(gene.data?.data.uniprot_accession)`.
 * - Two components asking for the same thing share one request and one cache entry.
 * - All residue positions are UniProt canonical. Structure numbering is converted here, once.
 *
 * Entity hooks (queries.ts)
 *   useGene(symbol)                         gene record, IUIS entries, transcripts, protein summary
 *   useProtein(accession)                   sequence, function text, feature tracks, cross-references
 *   useResidue(accession, position)         one residue: amino acid, window, features covering it
 *   useGeneVariants(symbol, filters)        variant table page; key rows on `row_key`, not `id`
 *   useAxisVariants(symbol)                 slim clinical and gnomAD rows of a gene, unpaged
 *   useVariant(variantId)                   ClinVar, UniProt, gnomAD, VEP, reference check, VRS ID
 *   useResidueEffects(acc, pos, { alt })    predictions, assays, annotation and pockets at a residue
 *   useEffectMap(accession, { matrix })     AlphaMissense per residue; matrix adds the 20-row heatmap
 *   useStructureLedger(accession)           experimental, AlphaFold DB and OrphaFold structures
 *   useStructure(structureId, accession?)   one StructureDescriptor
 *   useStructureConfidence(id, { pae })     pLDDT per residue, PAE matrix on request
 *   useStructureResidueMap(id, accession)   SIFTS segments of an experimental entry
 *   useStructureLigands(id, accession)      bound components and their binding-site positions
 *   useDisease(slugOrXref)                  disease bundle with treatments and relationship graph
 *   useInteractions(accession)              IntAct curated partners and the STRING physical layer
 *   usePathways(accession)                  Reactome pathways
 *   useTreatments(symbol)                   Open Targets drugs acting on the gene product
 *   useCompounds(accession)                 ChEMBL and PDB compounds for a protein (slow when cold)
 *   useCompound(inchikeyOrChembl)           one compound
 *   usePockets(accession, { structureId })  P2Rank pockets; polls while the prediction computes
 *   useComparePlan(gene, change)            reference check, construct, providers, existing results
 *   useCompareResult(jobId)                 both models and the difference payload
 *   workspaceQueries.<name>(...)            the same requests as query options, for prefetching
 *
 * Sequence axis (use-protein-axis.ts, axis.ts)
 *   useProteinAxis(accession, options?)     assembles sequence, domain / region / site / secondary
 *                                           structure rows, structure coverage, pLDDT, AlphaMissense
 *                                           and clinical + population variants, and feeds the dock
 *                                           through `useAxisDock`. Call it once per workspace page:
 *                                             const axis = useProteinAxis(accession);
 *                                             useReportSources("protein-page", axis.sources);
 *   featureTracks, coverageTrack, confidenceTrack, pathogenicityTrack, axisVariants
 *                                           the pure builders behind it
 *
 * 3D viewer (structures.ts, colorings.ts)
 *   useViewportStructure(idOrDescriptor, accession, { slot, frameOnly })
 *                                           a structure ready for <StructureViewport structures>,
 *                                           with the API file URL and the SIFTS residue map
 *   toViewportStructure(descriptor, opts)   the same conversion without fetching
 *   toViewerResidueMap(residueMap, opts)    SIFTS segments as the viewer's ResidueMap and chain
 *   structureSource / structureDetail / structureModelVersion / apiFileUrl
 *   ledgerDescriptors, findLedgerStructure, canonicalModel
 *   useProteinColorings(accession)          memoised { colorings, domains } for StructureViewport
 *   proteinColorings(protein, effectMap)    the same without fetching
 *   plddtColoring(plddtTrack)               pLDDT bands as a per-residue colour map
 *   alphaMissenseColoring(effectMap)        AlphaMissense residue mean as a colour map (prediction)
 *   proteinDomains / proteinDomainColoring  domains in axis order with the viewer's domain palette
 *
 * Subject chain (subject.ts)
 *   useSubjectBundle({ disease, gene, protein, variant, structure })
 *                                           declares the page's entities from their API records;
 *                                           replaces a hand-written useWorkspaceSubject call
 *   subjectChain(bundle), diseaseSubject, geneSubject, proteinSubject, variantSubject, structureSubject
 *
 * Source status (sources.ts)
 *   mergeSources(...lists)                  one row per source across responses, worst state wins
 *   findSource(sources, ...ids), failedSource(source, name, error)
 */
export * from "./queries";
export * from "./sources";
export * from "./structures";
export * from "./colorings";
export * from "./axis";
export * from "./subject";
export * from "./use-protein-axis";
