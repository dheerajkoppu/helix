"""Vocabulary of the lab: mechanism classes, evidence classes and the tests the runner can execute."""

from typing import Any

MECHANISM_CLASSES: dict[str, str] = {
    "stability_folding": "The substitution destabilises the fold or prevents folding of the domain.",
    "ligand_binding": "The substitution removes a contact with a small molecule, lipid head group, nucleotide, cofactor or metal.",
    "catalytic_site": "The substitution disrupts catalysis at the active site.",
    "protein_interaction": "The substitution removes a contact with another protein chain.",
    "nucleic_acid_binding": "The substitution removes a contact with DNA or RNA.",
    "domain_interface": "The substitution disrupts an intramolecular domain interface or autoregulation.",
    "other": "A mechanism outside the classes above, stated explicitly in the hypothesis.",
}

EVIDENCE_CLASSES = (
    "experimental",
    "clinical_database",
    "literature",
    "curated_database",
    "computational_prediction",
)

CONTACT_THRESHOLD_ANGSTROM = 4.5

TESTS: dict[str, dict[str, Any]] = {
    "ligand_contact": {
        "tool": "run_ligand_contact_test",
        "title": "Ligand contact of the residue in experimental structures",
        "measures": (
            "For every experimental structure that covers the residue and holds a non-solvent ligand: whether "
            "the residue is among the ligand's neighbouring residues as listed by RCSB PDB, and the shortest "
            "distance reported."
        ),
        "bears_on": {
            "ligand_binding": "supported by a contact with an organic ligand or metal; weakened when ligand-bound structures cover the residue and none places a ligand next to it",
            "catalytic_site": "supported by a contact with a substrate, nucleotide or cofactor analogue",
            "stability_folding": "not tested: a ligand contact says nothing about fold stability",
        },
        "cost": {"compute_seconds": 0, "tool_calls": 2},
        "requires_approval": False,
        "controls": [
            "Negative control: ligands in the same structures that never list the residue as a neighbour.",
            "Selectivity control: number of distinct residues that neighbour the contacting ligand, so a contact is not an artefact of a large neighbour list.",
            "Site-state control: structures in which the residue itself is mutated are reported separately.",
        ],
        "limitations": [
            "A crystal contact with a soluble analogue is not a measurement of binding by the variant protein.",
            "Absence of a ligand-bound structure is not evidence of absence of binding.",
        ],
    },
    "stability_effect": {
        "tool": "run_stability_test",
        "title": "Predicted stability change of the substitution",
        "measures": (
            "FoldX predicted folding free-energy change of the substitution on the AlphaFold model (through "
            "EBI ProtVar), the local model confidence at the residue, and the same value for other disease "
            "substitutions reported at the same residue."
        ),
        "bears_on": {
            "stability_folding": "supported by a predicted change at or above the destabilising threshold; weakened by a value in the neutral range",
            "ligand_binding": "not tested: a stability prediction says nothing about binding",
        },
        "cost": {"compute_seconds": 0, "tool_calls": 2},
        "requires_approval": False,
        "controls": [
            "Within-site comparison: the same predictor for the other substitutions reported at this residue.",
            "Applicability control: the model confidence (pLDDT) at the residue, because FoldX on a low-confidence region is not interpretable.",
        ],
        "limitations": [
            "FoldX on a predicted model is a computational prediction with errors near 1 kcal/mol.",
            "A neutral stability prediction does not show the variant is tolerated.",
        ],
    },
    "structural_context": {
        "tool": "run_structural_context_test",
        "title": "Predicted pocket and predicted interface membership of the residue",
        "measures": (
            "Whether the residue lines a pocket predicted by P2Rank (PrankWeb) or by ProtVar on the AlphaFold "
            "model, and whether it lies in a predicted protein-protein interface (ProtVar)."
        ),
        "bears_on": {
            "ligand_binding": "weakly supported by membership of a predicted pocket",
            "protein_interaction": "supported by membership of a predicted interface; weakened when no predicted interface contains the residue",
        },
        "cost": {"compute_seconds": 0, "tool_calls": 2},
        "requires_approval": False,
        "controls": [
            "Rank control: the rank and probability of the pocket among all predicted pockets of the model.",
            "Confidence control: mean pLDDT of the pocket residues.",
        ],
        "limitations": [
            "Predicted pockets and interfaces are computational predictions, not measured binding sites.",
        ],
    },
    "structure_comparison": {
        "tool": "run_structure_comparison",
        "title": "Reference versus variant structure prediction",
        "measures": (
            "Starts an OrphaFold variant_comparison job: the reference and the variant sequence of the domain "
            "construct are predicted with the same provider, then local and global C-alpha RMSD, site pLDDT and "
            "contact changes are computed."
        ),
        "bears_on": {
            "stability_folding": "weakly supported by a confident local rearrangement; a matching fold is uninformative",
            "domain_interface": "weakly supported by contact changes at the site",
        },
        "cost": {"compute_seconds": 120, "tool_calls": 3},
        "requires_approval": True,
        "controls": [
            "Same provider, model version and construct for both sequences.",
            "Residues with low confidence in either model are masked before the RMSD is computed.",
        ],
        "limitations": [
            "Structure predictors are not validated for single-residue substitutions.",
            "Each model is predicted once, so run-to-run variation is not estimated.",
        ],
    },
}

EXPERIMENT_TOOLS: dict[str, str] = {definition["tool"]: kind for kind, definition in TESTS.items()}
CONSEQUENTIAL_TOOLS: frozenset[str] = frozenset(
    definition["tool"] for definition in TESTS.values() if definition["requires_approval"]
)
