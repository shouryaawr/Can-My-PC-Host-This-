import sys

path = "backend/app/engine.py"
with open(path, "r", encoding="utf-8") as f:
    code = f.read()

code = code.replace(
    "initial_predicted_ram = sum(service.current_ram_mb for service in contexts)",
    "initial_predicted_ram = sum(service.current_ram_mb * service.replicas for service in contexts)"
)

code = code.replace(
    "m_predicted = sum(service.current_ram_mb for service in contexts)\n    c_predicted = sum(service.cpu for service in contexts)",
    "m_predicted = sum(service.current_ram_mb * service.replicas for service in contexts)\n    c_predicted = sum(service.cpu * service.replicas for service in contexts)"
)
code = code.replace(
    "m_predicted = sum(item.current_ram_mb for item in contexts)\n                c_predicted = sum(item.cpu for item in contexts)",
    "m_predicted = sum(item.current_ram_mb * item.replicas for item in contexts)\n                c_predicted = sum(item.cpu * item.replicas for item in contexts)"
)
code = code.replace(
    "m_predicted = sum(item.current_ram_mb for item in contexts)\n            c_predicted = sum(item.cpu for item in contexts)",
    "m_predicted = sum(item.current_ram_mb * item.replicas for item in contexts)\n            c_predicted = sum(item.cpu * item.replicas for item in contexts)"
)

code = code.replace(
    "if not service.xtuning_optimizable and service.current_ram_mb > payload.host_hardware.free_ram_mb:",
    "if not service.xtuning_optimizable and (service.current_ram_mb * service.replicas) > payload.host_hardware.free_ram_mb:"
)

code = code.replace(
    "final_predicted_ram_mb=sum(s.final_ram_mb for s in contexts),",
    "final_predicted_ram_mb=sum(s.final_ram_mb * s.replicas for s in contexts),"
)
code = code.replace(
    "ram_margin_mb=effective_free_ram - sum(s.final_ram_mb for s in contexts),",
    "ram_margin_mb=effective_free_ram - sum(s.final_ram_mb * s.replicas for s in contexts),"
)
code = code.replace(
    "cpu_saturation_pct=(sum(s.cpu for s in contexts) / cpu_budget * 100)",
    "cpu_saturation_pct=(sum(s.cpu * s.replicas for s in contexts) / cpu_budget * 100)"
)

code = code.replace(
    "final_predicted_ram = sum(service.final_ram_mb for service in contexts)",
    "final_predicted_ram = sum(service.final_ram_mb * service.replicas for service in contexts)"
)
code = code.replace(
    "final_cpu = sum(service.cpu for service in contexts)",
    "final_cpu = sum(service.cpu * service.replicas for service in contexts)"
)

code = code.replace(
    "mem_limit = f\"{int(service.final_ram_mb / service.replicas)}M\"",
    "mem_limit = f\"{int(service.final_ram_mb)}M\""
)
code = code.replace(
    "cpu_limit = round(max(0.05, service.cpu / service.replicas), 2)",
    "cpu_limit = round(max(0.05, service.cpu), 2)"
)

code = code.replace(
    "replicas = service.replicas\n    if service.xtuning_hardcoded_ram_mb is not None:\n        return service.xtuning_hardcoded_ram_mb * replicas",
    "if service.xtuning_hardcoded_ram_mb is not None:\n        return service.xtuning_hardcoded_ram_mb"
)
code = code.replace(
    "return (128.0 + (max_connections * 15.0)) * replicas",
    "return 128.0 + (max_connections * 15.0)"
)
code = code.replace(
    "return (64.0 + (workers * 32.0) + (web_concurrency * 48.0)) * replicas",
    "return 64.0 + (workers * 32.0) + (web_concurrency * 48.0)"
)
code = code.replace(
    "return (16.0 + maxmemory) * replicas",
    "return 16.0 + maxmemory"
)
code = code.replace(
    "return tier_config[\"base_ram_mb\"] * replicas",
    "return tier_config[\"base_ram_mb\"]"
)

code = code.replace(
    "base_cpu = tier_config[\"base_cpu\"] * service.replicas",
    "base_cpu = tier_config[\"base_cpu\"]"
)

code = code.replace(
    "if service.current_ram_mb <= effective_floor_mb * service.replicas:",
    "if service.current_ram_mb <= effective_floor_mb:"
)

code = code.replace(
    "active_footprint = sum(service.current_ram_mb for service in contexts)",
    "active_footprint = sum(service.current_ram_mb * service.replicas for service in contexts)"
)
code = code.replace(
    "eligible_footprint = sum(s.current_ram_mb for s in eligible)",
    "eligible_footprint = sum(s.current_ram_mb * s.replicas for s in eligible)"
)
code = code.replace(
    """                s.current_ram_mb - (
                    s.xtuning_ram_floor_mb
                    if s.xtuning_ram_floor_mb is not None
                    else profiles[\"floors\"][s.tier][\"ram_mb\"]
                ) * s.replicas,""",
    """                (s.current_ram_mb - (
                    s.xtuning_ram_floor_mb
                    if s.xtuning_ram_floor_mb is not None
                    else profiles[\"floors\"][s.tier][\"ram_mb\"]
                )) * s.replicas,"""
)
code = code.replace(
    "overflow * (service.current_ram_mb / eligible_footprint)",
    "overflow * ((service.current_ram_mb * service.replicas) / eligible_footprint)"
)
code = code.replace(
    "budgeted_service_ram = service.current_ram_mb - reduction_share",
    "budgeted_service_ram = (service.current_ram_mb * service.replicas) - reduction_share"
)
code = code.replace(
    "service.final_ram_mb = limit_mb * service.replicas",
    "service.final_ram_mb = limit_mb"
)
code = code.replace(
    "cpu_limit = max(0.05, service.cpu / service.replicas)",
    "cpu_limit = max(0.05, service.cpu)"
)

code = code.replace(
    "initial_predicted_ram_mb=sum(service.initial_ram_mb for service in service_contexts),",
    "initial_predicted_ram_mb=sum(service.initial_ram_mb * service.replicas for service in service_contexts),"
)
code = code.replace(
    "final_predicted_ram_mb=sum(service.final_ram_mb for service in service_contexts),",
    "final_predicted_ram_mb=sum(service.final_ram_mb * service.replicas for service in service_contexts),"
)

with open(path, "w", encoding="utf-8") as f:
    f.write(code)

print("Refactored successfully")
