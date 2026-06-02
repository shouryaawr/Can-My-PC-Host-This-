import os
from pathlib import Path

import psutil
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .engine import run_optimization_engine
from .schemas import AnalyzeRequest, AnalyzeResponse, HostHardware


app = FastAPI(title="Can My PC Self-Host This Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def detect_storage_type() -> str:
    try:
        if not os.path.exists("/sys/block"):
            return "UNKNOWN"

        rotational_values = []
        for block_device in Path("/sys/block").iterdir():
            rotational_file = block_device / "queue" / "rotational"
            if rotational_file.exists():
                rotational_values.append(rotational_file.read_text().strip())

        if "1" in rotational_values:
            return "HDD"
        if rotational_values and all(value == "0" for value in rotational_values):
            return "SSD"
    except Exception:
        return "UNKNOWN"

    return "UNKNOWN"


@app.get("/api/v1/hardware", response_model=HostHardware)
def get_hardware() -> HostHardware:
    memory = psutil.virtual_memory()
    cpu_cores = psutil.cpu_count(logical=False) or psutil.cpu_count(logical=True) or 1

    return HostHardware(
        total_ram_mb=memory.total / (1024 * 1024),
        free_ram_mb=memory.available / (1024 * 1024),
        cpu_cores=cpu_cores,
        storage_type=detect_storage_type(),
    )


@app.post("/api/v1/analyze", response_model=AnalyzeResponse)
def analyze(request: AnalyzeRequest) -> AnalyzeResponse:
    return run_optimization_engine(request)
