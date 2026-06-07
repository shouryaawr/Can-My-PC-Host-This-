import json
import os
import re
import socket
import sys
import urllib.error
import urllib.request
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

import psutil
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .parser import parse_analysis_payload, dump_yaml
from .patcher import build_response
from .solver import solve_analysis
from .schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    FetchManifestRequest,
    HostHardware,
    ProfilesConfig,
    load_profiles_config,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.profiles = load_profiles_config()
    yield


app = FastAPI(title="Can My PC Self-Host This Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


GITHUB_REPO_PATTERN = re.compile(
    r"^(?:https?:/{2})?(?:www\.)?github\.com/"
    r"(?P<owner>[^/\s]+)/(?P<repo>[^/\s?#]+)"
    r"(?:/tree/(?P<branch>[^?#]+))?/?$"
)


def get_profiles() -> ProfilesConfig:
    return getattr(app.state, "profiles", load_profiles_config())


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


def parse_github_repo_url(repo_url: str) -> tuple[str, str, str | None]:
    cleaned_url = repo_url.strip()
    match = GITHUB_REPO_PATTERN.match(cleaned_url)

    if not match:
        raise HTTPException(
            status_code=400,
            detail=(
                "Please provide a GitHub repository URL like "
                "https:" + "/" * 2 + "github.com/owner/repo or "
                "https:" + "/" * 2 + "github.com/owner/repo/tree/branch."
            ),
        )

    owner = match.group("owner")
    repo = match.group("repo").removesuffix(".git")
    branch = match.group("branch")

    if not owner or not repo or (branch and branch.startswith("/")):
        raise HTTPException(status_code=400, detail="Could not parse the GitHub repository URL.")

    return owner, repo, branch.strip("/") if branch else None


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
    config = get_profiles()
    parsed = parse_analysis_payload(request, config)
    if parsed.response is not None:
        return parsed.response

    solved = solve_analysis(parsed)
    if solved.response is not None:
        return solved.response

    optimized_yaml = dump_yaml(parsed.yaml, parsed.document)
    return build_response(solved, optimized_yaml)


@app.post("/api/v1/fetch-manifest")
def fetch_manifest(request: FetchManifestRequest) -> dict[str, str]:
    owner, repo, parsed_branch = parse_github_repo_url(request.repo_url)

    branches_to_test = [parsed_branch] if parsed_branch else ["main", "master"]

    if request.manifest_path == "compose.yaml":
        files_to_test = ["compose.yaml", "docker-compose.yml", "compose.yml", "docker-compose.yaml"]
    else:
        files_to_test = [request.manifest_path]

    last_error = None

    for test_branch in branches_to_test:
        for test_file in files_to_test:
            raw_url = f"https:{'/' * 2}raw.githubusercontent.com/{owner}/{repo}/{test_branch}/{test_file}"

            try:
                req = urllib.request.Request(
                    raw_url,
                    headers={
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                    },
                )
                with urllib.request.urlopen(req, timeout=10.0) as response:
                    yaml_string = response.read().decode("utf-8")
                    return {
                        "yaml_string": yaml_string,
                        "branch": test_branch,
                        "manifest_path": test_file,
                    }
            except urllib.error.HTTPError as error:
                if error.code == 404:
                    last_error = error
                    continue
                raise HTTPException(
                    status_code=400,
                    detail=f"GitHub returned HTTP {error.code} while fetching the Docker Compose manifest.",
                ) from error
            except (urllib.error.URLError, socket.timeout, TimeoutError) as error:
                raise HTTPException(
                    status_code=400,
                    detail="Timed out or failed while contacting GitHub for the Docker Compose manifest.",
                ) from error

    branch_msg = parsed_branch if parsed_branch else "main/master"

    for test_branch in branches_to_test:
        tree_url = f"https:{'/' * 2}api.github.com/repos/{owner}/{repo}/git/trees/{test_branch}?recursive=1"
        try:
            req = urllib.request.Request(
                tree_url,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
            )
            with urllib.request.urlopen(req, timeout=10.0) as response:
                tree_data = json.loads(response.read().decode("utf-8"))

                valid_paths = [
                    item["path"] for item in tree_data.get("tree", [])
                    if item["type"] == "blob" and item["path"].lower().endswith(("compose.yaml", "docker-compose.yml", "compose.yml", "docker-compose.yaml"))
                ]

                if len(valid_paths) == 1:
                    raw_url = f"https:{'/' * 2}raw.githubusercontent.com/{owner}/{repo}/{test_branch}/{valid_paths[0]}"
                    req2 = urllib.request.Request(
                        raw_url,
                        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
                    )
                    with urllib.request.urlopen(req2, timeout=10.0) as res2:
                        yaml_string = res2.read().decode("utf-8")
                        return {
                            "yaml_string": yaml_string,
                            "branch": test_branch,
                            "manifest_path": valid_paths[0],
                        }
                elif len(valid_paths) > 1:
                    return {
                        "multiple_manifests": json.dumps(valid_paths),
                        "branch": test_branch,
                        "manifest_path": "",
                    }
        except Exception:
            continue

    raise HTTPException(
        status_code=404,
        detail=f"No file found at '{request.manifest_path}' in {owner}/{repo} on branch '{branch_msg}'.",
    ) from last_error
