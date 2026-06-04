from typing import Dict, List, Literal

from pydantic import BaseModel, ConfigDict, Field


class HostHardware(BaseModel):
    total_ram_mb: float
    free_ram_mb: float
    cpu_cores: int
    storage_type: Literal["SSD", "HDD", "UNKNOWN"]


class AnalyzeRequest(BaseModel):
    yaml_string: str
    selected_profile: Literal["silent_running", "max_performance", "background_dev"]
    host_hardware: HostHardware


class FetchManifestRequest(BaseModel):
    repo_url: str


class MutatedVariableDetail(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    from_val: float = Field(alias="from")
    to_val: float = Field(alias="to")


class ServiceAnalysisResult(BaseModel):
    name: str
    tier: str
    replicas: int
    initial_ram_mb: float
    final_ram_mb: float
    variables_mutated: Dict[str, MutatedVariableDetail]
    cgroups_injected: bool


class OptimizationMetrics(BaseModel):
    initial_predicted_ram_mb: float
    final_predicted_ram_mb: float
    ram_margin_mb: float
    cpu_saturation_pct: float


class AnalyzeResponse(BaseModel):
    status: Literal["FULLY_SOLVED", "DEGRADED_SAFE", "UNSOLVABLE", "INVALID_MANIFEST"]
    optimized_yaml_string: str
    optimized_yaml: str
    metrics: OptimizationMetrics
    services: List[ServiceAnalysisResult]
    topology: List[ServiceAnalysisResult]
    warnings: List[str]
    execution_trace: List[str]
    trace_log: List[str]
