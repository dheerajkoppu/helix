"""Resolved Boltz command-line parameters.

Every value is passed explicitly and recorded, including the ones the user did not set, so a run
never depends on a default that changes between Boltz releases. The seed is always passed.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from helix.boltz.spec import MsaMode

# Defaults of the boltz 2.2.1 command line, for the record
UPSTREAM_DEFAULTS: dict[str, Any] = {
    "model": "boltz2",
    "recycling_steps": 3,
    "sampling_steps": 200,
    "diffusion_samples": 1,
    "max_parallel_samples": 5,
    "step_scale": 1.5,
    "max_msa_seqs": 8192,
    "subsample_msa": False,
    "num_subsampled_msa": 1024,
    "msa_pairing_strategy": "greedy",
    "use_potentials": False,
    "write_full_pae": False,
    "write_full_pde": False,
    "output_format": "mmcif",
    "sampling_steps_affinity": 200,
    "diffusion_samples_affinity": 5,
    "affinity_mw_correction": False,
    "seed": None,
}

DEFAULT_SEED = 42


class BoltzParameters(BaseModel):
    """Adapter defaults equal the upstream defaults except use_potentials and write_full_pae,
    which the adapter turns on."""

    model_config = ConfigDict(extra="forbid")

    model: Literal["boltz2"] = "boltz2"
    recycling_steps: int = Field(default=3, ge=1, le=25)
    sampling_steps: int = Field(default=200, ge=1, le=1000)
    diffusion_samples: int = Field(default=1, ge=1, le=25)
    max_parallel_samples: int = Field(default=5, ge=1, le=25)
    step_scale: float = Field(default=1.5, gt=0, le=5)
    max_msa_seqs: int = Field(default=8192, ge=1)
    subsample_msa: bool = False
    num_subsampled_msa: int = Field(default=1024, ge=1)
    msa_pairing_strategy: Literal["greedy", "complete"] = "greedy"
    use_potentials: bool = True
    write_full_pae: bool = True
    write_full_pde: bool = False
    output_format: Literal["mmcif"] = "mmcif"
    sampling_steps_affinity: int = Field(default=200, ge=1, le=1000)
    diffusion_samples_affinity: int = Field(default=5, ge=1, le=25)
    affinity_mw_correction: bool = False

    @classmethod
    def from_request(cls, parameters: dict[str, Any]) -> BoltzParameters:
        """Take the Boltz options out of a request's parameters; None means the adapter default."""
        return cls(**{key: parameters[key] for key in cls.model_fields if parameters.get(key) is not None})


def cli_options(
    parameters: BoltzParameters,
    *,
    seed: int,
    msa_mode: MsaMode,
    msa_server_url: str,
    affinity: bool,
) -> list[str]:
    """Options after `boltz predict <input> --out_dir <dir>`. The backend adds the options that
    belong to its machine: --cache, --accelerator, --devices, --no_kernels."""
    options = [
        "--model", parameters.model,
        "--recycling_steps", str(parameters.recycling_steps),
        "--sampling_steps", str(parameters.sampling_steps),
        "--diffusion_samples", str(parameters.diffusion_samples),
        "--max_parallel_samples", str(parameters.max_parallel_samples),
        "--step_scale", f"{parameters.step_scale:g}",
        "--max_msa_seqs", str(parameters.max_msa_seqs),
        "--output_format", parameters.output_format,
    ]  # fmt: skip
    if parameters.subsample_msa:
        options += ["--subsample_msa", "--num_subsampled_msa", str(parameters.num_subsampled_msa)]
    if msa_mode == "server":
        options += [
            "--use_msa_server",
            "--msa_server_url", msa_server_url,
            "--msa_pairing_strategy", parameters.msa_pairing_strategy,
        ]  # fmt: skip
    if parameters.use_potentials:
        options.append("--use_potentials")
    if parameters.write_full_pae:
        options.append("--write_full_pae")
    if parameters.write_full_pde:
        options.append("--write_full_pde")
    if affinity:
        options += [
            "--sampling_steps_affinity", str(parameters.sampling_steps_affinity),
            "--diffusion_samples_affinity", str(parameters.diffusion_samples_affinity),
        ]  # fmt: skip
        if parameters.affinity_mw_correction:
            options.append("--affinity_mw_correction")
    options += ["--seed", str(seed), "--override"]
    return options
