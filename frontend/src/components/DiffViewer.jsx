import { FileCode2, Wand2 } from "lucide-react";

function YamlPane({ icon: Icon, title, value, accentClass }) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded border border-slate-800 bg-slate-950">
      <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
        <Icon className={`h-4 w-4 ${accentClass}`} aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100">{title}</h3>
      </div>
      <pre className="min-h-72 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5 text-zinc-300">
        {value?.trim() ? value : "No YAML available."}
      </pre>
    </section>
  );
}

export default function DiffViewer({ originalYaml = "", optimizedYaml = "" }) {
  return (
    <div className="grid min-h-0 gap-4 lg:grid-cols-2">
      <YamlPane
        icon={FileCode2}
        title="Original Manifest"
        value={originalYaml}
        accentClass="text-cyan-300"
      />
      <YamlPane
        icon={Wand2}
        title="Optimized Manifest"
        value={optimizedYaml}
        accentClass="text-emerald-300"
      />
    </div>
  );
}
