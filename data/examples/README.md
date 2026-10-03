# Cached model outputs

Real outputs of model runs, kept so the development provider can return a legitimate prediction on a
machine that cannot run the model itself. The API reads this directory through
`ORPHAFOLD_EXAMPLES_DIR` (default `data/examples`).

Nothing is stored here yet. Every file added must be the unmodified output of a real run and must sit
beside the run manifest that produced it (model, version, inputs, parameters, date), so that a result
served from here is labelled with its true origin.
