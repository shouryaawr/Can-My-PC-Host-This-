import { useCallback, useEffect, useState } from "react";
import { DEFAULT_HARDWARE } from "../constants.js";

export function useHardwareProfile() {
  const [hardwareData, setHardwareData] = useState({ ...DEFAULT_HARDWARE });
  const [hardwareSource, setHardwareSource] = useState("system");
  const [ramUnit, setRamUnit] = useState("MB");

  const loadHardware = useCallback(() => {
    const cpuCores = navigator.hardwareConcurrency || DEFAULT_HARDWARE.cpu_cores;
    const totalRamMb = Math.round(
      (navigator.deviceMemory || DEFAULT_HARDWARE.total_ram_mb / 1000) * 1000,
    );
    const freeRamMb = Math.round(totalRamMb * 0.75);
    setHardwareData({
      cpu_cores: cpuCores,
      total_ram_mb: totalRamMb,
      free_ram_mb: freeRamMb,
      storage_type: "SSD",
    });
    setHardwareSource("system");
  }, []);

  useEffect(() => {
    loadHardware();
  }, [loadHardware]);

  const updateField = useCallback((field, value) => {
    setHardwareSource("custom");
    setHardwareData((prev) => ({ ...prev, [field]: value }));
  }, []);

  return {
    hardwareData,
    hardwareSource,
    ramUnit,
    setRamUnit,
    loadHardware,
    updateField,
  };
}
