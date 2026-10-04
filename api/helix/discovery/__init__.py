"""The discovery engine: what could we aim a drug at, and is there already a molecule that does it?

The workflow it serves is disease -> gene -> mutation -> mechanism -> candidate targets and molecules
-> what to test next. Read the modules in this order:

| module       | what it holds                                                                   |
| ------------ | ------------------------------------------------------------------------------- |
| `rules.py`   | the required-action rule table and the direction-of-effect filter, as pure functions |
| `subject.py` | a gene, disease slug or variant becomes a subject with a mechanism and a direction  |
| `targets.py` | the lean ChEMBL path: what is recorded about acting on one protein              |
| `build.py`   | a mechanism record becomes a candidate, with the direction filter applied       |
| `bridges/`   | the five bridge kinds, one module each                                          |
| `direct.py`  | the disease-to-molecule edges and the held-out mode                             |
| `engine.py`  | running the bridges, the order of the candidates, the assembled response        |

Every candidate is a hypothesis Helix generated. Nothing here is a recommendation, nothing is
invented, and a claim without a source record is not published.
"""
