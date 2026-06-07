from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


def clean_numeric_value(value: Any) -> Any:
    if isinstance(value, str):
        cleaned = "".join(char for char in value if char.isdigit() or char == ".")
        if cleaned.count(".") > 1:
            whole, *parts = cleaned.split(".")
            cleaned = whole + "." + "".join(parts)
        return cleaned or 0
    return value


class HostHardware(BaseModel):
    total_ram_mb: float
    free_ram_mb: float
    cpu_cores: int
    storage_type: Literal["SSD", "HDD", "UNKNOWN"]

    @field_validator("total_ram_mb", "free_ram_mb", "cpu_cores", mode="before")
    @classmethod
    def sanitize_numeric_fields(cls, value: Any) -> Any:
        return clean_numeric_value(value)


class CustomProfileConfig(BaseModel):
    ram_safety_buffer: float
    cpu_threshold_multiplier: float
    max_iterations: Optional[int] = Field(default=50, ge=1, le=100)
    allow_cgroups: Optional[bool] = True
    floor_strictness: Optional[float] = Field(default=1.0, ge=0.5, le=1.5)


class AnalyzeRequest(BaseModel):
    yaml_string: str
    selected_profile: Literal["silent_running", "max_performance", "background_dev", "custom"]
    host_hardware: HostHardware
    custom_profile_config: Optional[CustomProfileConfig] = None


class FetchManifestRequest(BaseModel):
    repo_url: str
    manifest_path: str = "compose.yaml"


class HostProfileConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cpu_threshold_multiplier: float
    ram_safety_buffer: float


class TierProfileConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    base_ram_mb: float
    base_cpu: float
    ram_scaling_factor: float
    default_max_variables: dict[str, float]
    variable_aliases: dict[str, list[str]] = Field(default_factory=dict)


class FloorProfileConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ram_mb: float
    variables: dict[str, float]


class ProfilesConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    host_profiles: dict[str, HostProfileConfig]
    tiers: dict[str, TierProfileConfig]
    floors: dict[str, FloorProfileConfig]
    image_lookup_table: dict[str, str]


@lru_cache(maxsize=1)
def load_profiles_config() -> ProfilesConfig:
    path = Path(__file__).with_name("profiles.json")
    return ProfilesConfig.model_validate(json.loads(path.read_text(encoding="utf-8")))


def ensure_profiles_config(profiles: ProfilesConfig | dict[str, Any] | None = None) -> ProfilesConfig:
    if profiles is None:
        return load_profiles_config()
    if isinstance(profiles, ProfilesConfig):
        return profiles
    return ProfilesConfig.model_validate(profiles)


class MutatedVariableDetail(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    from_val: float = Field(alias="from")
    to_val: float = Field(alias="to")


@dataclass
class ServiceContext:
    name: str
    node: Any
    tier: str
    replicas: int
    initial_ram_mb: float = 0.0
    final_ram_mb: float = 0.0
    current_ram_mb: float = 0.0
    cpu: float = 0.0
    variables_mutated: dict[str, MutatedVariableDetail] = field(default_factory=dict)
    cgroups_injected: bool = False
    xtuning_ram_floor_mb: float | None = None
    xtuning_never_cgroup: bool = False
    xtuning_target_variable: str | None = None
    xtuning_optimizable: bool = True
    xtuning_hardcoded_ram_mb: float | None = None


class ServiceAnalysisResult(BaseModel):
    name: str
    tier: str
    replicas: int
    initial_ram_mb: float
    final_ram_mb: float
    variables_mutated: Dict[str, MutatedVariableDetail]
    cgroups_injected: bool
    at_floor: bool


class OptimizationMetrics(BaseModel):
    initial_predicted_ram_mb: float
    final_predicted_ram_mb: float
    ram_margin_mb: float
    cpu_saturation_pct: float
    free_ram_mb: float


class DiagnosticsPayload(BaseModel):
    cgroups_active: bool
    oom_risk_flag: bool
    headroom_mb: float
    free_ram_mb: float


class AnalyzeResponse(BaseModel):
    status: Literal["FULLY_SOLVED", "DEGRADED_SAFE", "UNSOLVABLE", "INVALID_MANIFEST", "UNSUPPORTED_ORCHESTRATOR"]
    optimized_yaml_string: str
    optimized_yaml: str
    baseline_yaml_string: str
    metrics: OptimizationMetrics
    services: List[ServiceAnalysisResult]
    topology: List[ServiceAnalysisResult]
    post_allocation_memory: float
    diagnostics: DiagnosticsPayload
    warnings: List[str]
    execution_trace: List[str]
    trace_log: List[str]


@dataclass
class ParsedManifest:
    payload: AnalyzeRequest
    trace: list[str]
    warnings: list[str]
    profiles: ProfilesConfig
    yaml: Any = None
    document: Any = None
    baseline_yaml_string: str = ""
    services: dict[str, Any] = field(default_factory=dict)
    response: AnalyzeResponse | None = None


@dataclass
class SolverResult:
    payload: AnalyzeRequest
    trace: list[str]
    warnings: list[str]
    profiles: ProfilesConfig
    baseline_yaml_string: str
    contexts: list[ServiceContext] = field(default_factory=list)
    effective_free_ram: float = 0.0
    cpu_budget: float = 0.0
    initial_predicted_ram: float = 0.0
    final_predicted_ram: float = 0.0
    final_cpu: float = 0.0
    c_gap: float = 0.0
    floor_strictness: float = 1.0
    status: str = "FULLY_SOLVED"
    floor_flags: dict[str, bool] = field(default_factory=dict)
    response: AnalyzeResponse | None = None
