import { useEffect, useRef, useState } from "react";
import { FileUp, Upload, X } from "lucide-react";

export default function ImportModal({ onClose, onLoad }) {
  const fileInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  function loadFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      onLoad(event.target.result || "", file.name);
      onClose();
    };
    reader.readAsText(file);
  }

  function handleFileChange(event) {
    loadFile(event.target.files?.[0]);
  }

  function handleDrop(event) {
    event.preventDefault();
    setIsDragging(false);
    loadFile(event.dataTransfer.files?.[0]);
  }

  function handleDragOver(event) {
    event.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(event) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setIsDragging(false);
    }
  }

  useEffect(() => {
    function handleKey(event) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 p-4 backdrop-blur-sm"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="relative w-full max-w-xl rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-zinc-400" aria-hidden="true" />
            <h2 className="text-base font-semibold text-zinc-100">Import / Load YAML</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div
          className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 transition ${
            isDragging
              ? "border-zinc-500 bg-zinc-800/80"
              : "border-zinc-700 bg-zinc-950/50 hover:border-zinc-600 hover:bg-zinc-950"
          }`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              fileInputRef.current?.click();
            }
          }}
        >
          <FileUp className="h-8 w-8 text-zinc-500" aria-hidden="true" />
          <div className="text-center">
            <p className="text-sm font-medium text-zinc-200">
              {isDragging ? "Drop the file here" : "Click or drag a file to upload"}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              <span className="font-mono">docker-compose.yml</span> or any YAML manifest
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".yml,.yaml,.txt"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      </div>
    </div>
  );
}
