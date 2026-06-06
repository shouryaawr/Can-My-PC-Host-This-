from app.engine import run_optimization_engine
from app.schemas import AnalyzeRequest, HostHardware

def test_engine_rejects_empty():
    request = AnalyzeRequest(
        yaml_string="invalid yaml",
        host_hardware=HostHardware(total_ram_mb=16000, free_ram_mb=8000, cpu_cores=4, storage_type="SSD"),
        selected_profile="background_dev"
    )
    response = run_optimization_engine(request)
    assert response.status == "INVALID_MANIFEST"
