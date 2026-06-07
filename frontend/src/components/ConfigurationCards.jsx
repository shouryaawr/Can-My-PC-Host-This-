import HostHardwareCard from "./HostHardwareCard.jsx";
import OperationalProfileCard from "./OperationalProfileCard.jsx";

export default function ConfigurationCards({
  hardwareData,
  hardwareSource,
  ramUnit,
  setRamUnit,
  updateField,
  onRedetectHardware,
  activeProfile,
  setActiveProfile,
  customConfig,
  setCustomConfig,
}) {
  return (
    <div className="grid gap-4 transition-all duration-300 ease-out xl:grid-cols-2">
      <HostHardwareCard
        hardwareData={hardwareData}
        hardwareSource={hardwareSource}
        ramUnit={ramUnit}
        setRamUnit={setRamUnit}
        updateField={updateField}
        onRedetectHardware={onRedetectHardware}
      />
      <OperationalProfileCard
        activeProfile={activeProfile}
        setActiveProfile={setActiveProfile}
        customConfig={customConfig}
        setCustomConfig={setCustomConfig}
      />
    </div>
  );
}
