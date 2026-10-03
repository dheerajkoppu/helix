# Parser fixture

`boltz_results_parser_fixture/` is a hand-written copy of the directory layout that `boltz predict`
writes, small enough to read by eye. It exists so that the output parser can be checked against the
documented filenames and JSON keys on a machine that cannot run Boltz.

It is **not model output**:

- The numbers in the two JSON files are the example values printed in the Boltz documentation.
- The mmCIF holds six CA atoms on a straight line and a three-atom ligand.
- The two `.npz` files are written by `make_npz.py` from values typed into that script.

Guards that keep it out of every result:

- Both JSON files carry the key `_helix_parser_fixture`. `helix.boltz.parser.parse_results`
  refuses any file with that key unless called with `allow_fixture=True`, and only
  `python -m helix.boltz.selfcheck` does that.
- The directory is outside the `helix` package and no provider, job handler or route reads it.
- The worker service serves files only from its own job directories.

Run the check from `api/`:

```bash
.venv/bin/python -m helix.boltz.selfcheck
```
