import os
import re
import socket
import sys
import urllib.error
import urllib.request
from pathlib import Path

import psutil
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .engine import run_optimization_engine
from .schemas import AnalyzeRequest, AnalyzeResponse, FetchManifestRequest, HostHardware


app = FastAPI(title="Can My PC Self-Host This Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


GITHUB_REPO_PATTERN = re.compile(
    r"^(?:https?://)?(?:www\.)?github\.com/"
    r"(?P<owner>[^/\s]+)/(?P<repo>[^/\s?#]+)"
    r"(?:/tree/(?P<branch>[^?#]+))?/?$"
)


from typing import Literal

def detect_storage_type() -> Literal["SSD", "HDD", "UNKNOWN"]:
    if sys.platform != "linux":
        return "SSD"

    try:
        if not os.path.exists("/sys/block"):
            return "SSD"

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
        return "SSD"

    return "SSD"


def parse_github_repo_url(repo_url: str) -> tuple[str, str, str]:
    cleaned_url = repo_url.strip()
    match = GITHUB_REPO_PATTERN.match(cleaned_url)

    if not match:
        raise HTTPException(
            status_code=400,
            detail=(
                "Please provide a GitHub repository URL like "
                "https://github.com/owner/repo or https://github.com/owner/repo/tree/branch."
            ),
        )

    owner = match.group("owner")
    repo = match.group("repo").removesuffix(".git")
    branch = match.group("branch") or "main"

    if not owner or not repo or branch.startswith("/"):
        raise HTTPException(status_code=400, detail="Could not parse the GitHub repository URL.")

    return owner, repo, branch.strip("/")


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


@app.post("/api/v1/fetch-manifest")
def fetch_manifest(request: FetchManifestRequest) -> dict[str, str]:
    owner, repo, branch = parse_github_repo_url(request.repo_url)

    raw_url = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{request.manifest_path}"

    try:
        with urllib.request.urlopen(raw_url, timeout=3.0) as response:
            yaml_string = response.read().decode("utf-8")
            return {"yaml_string": yaml_string}
    except urllib.error.HTTPError as error:
        if error.code == 404:
            raise HTTPException(
                status_code=404,
                detail=f"No file found at '{request.manifest_path}' in {owner}/{repo} on branch '{branch}'.",
            ) from error
        raise HTTPException(
            status_code=400,
            detail=f"GitHub returned HTTP {error.code} while fetching the Docker Compose manifest.",
        ) from error
    except (urllib.error.URLError, socket.timeout, TimeoutError) as error:
        raise HTTPException(
            status_code=400,
            detail="Timed out or failed while contacting GitHub for the Docker Compose manifest.",
        ) from error
