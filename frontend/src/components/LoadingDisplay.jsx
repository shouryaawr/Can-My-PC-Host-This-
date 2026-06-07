import { Loader2 } from "lucide-react";

export default function LoadingDisplay() {
  return (
    <section className="flex min-h-[32rem] items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/50 p-8">
      <div className="text-center">
        <Loader2 className="mx-auto h-10 w-10 animate-spin text-zinc-400" aria-hidden="true" />
        <p className="mt-4 text-sm font-medium text-zinc-300">Running deterministic optimizer...</p>
      </div>
    </section>
  );
}
