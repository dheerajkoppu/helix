"""Writes the two binary files of the parser fixture from the numbers below.

PARSER FIXTURE: hand-written values, not model output. Token order is six protein residues, then
three ligand atoms. pLDDT is on the 0-1 scale Boltz uses in plddt_<id>_model_<n>.npz.
"""

from pathlib import Path

import numpy as np

PLDDT = [0.95, 0.91, 0.90, 0.72, 0.55, 0.41, 0.60, 0.61, 0.62]

directory = Path(__file__).parent / "boltz_results_parser_fixture" / "predictions" / "parser_fixture"
tokens = len(PLDDT)
# Not symmetric on purpose: entry (i, j) and (j, i) answer different alignments
pae = np.array([[0.0 if row == column else 1.0 + 2.0 * row + 0.5 * column for column in range(tokens)]
                for row in range(tokens)], dtype=np.float32)
np.savez(directory / "plddt_parser_fixture_model_0.npz", plddt=np.array(PLDDT, dtype=np.float32))
np.savez(directory / "pae_parser_fixture_model_0.npz", pae=pae)
