import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas import HostHardware

client = TestClient(app)

def test_get_hardware():
    response = client.get("/api/v1/hardware")
    assert response.status_code == 200
    data = response.json()
    assert "total_ram_mb" in data
    assert "cpu_cores" in data
    assert "storage_type" in data
    assert data["cpu_cores"] >= 1

def test_fetch_manifest_invalid_url():
    response = client.post("/api/v1/fetch-manifest", json={
        "repo_url": "invalid-url",
        "manifest_path": "docker-compose.yml"
    })
    assert response.status_code == 400
