"use client";

import { useState } from "react";
import { parseYouTubeVideoId } from "@/lib/youtube";

type Props = {
  onSubmit: (videoId: string) => void;
  disabled?: boolean;
};

export default function UrlInput({ onSubmit, disabled }: Props) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const id = parseYouTubeVideoId(value);
    if (!id) {
      setError("Esa URL no parece válida. Pega un enlace de YouTube (watch, youtu.be o shorts).");
      return;
    }
    setError(null);
    onSubmit(id);
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500">
            ▶
          </span>
          <input
            type="text"
            inputMode="url"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            placeholder="https://www.youtube.com/watch?v=..."
            disabled={disabled}
            className="w-full rounded-xl border border-white/10 bg-white/5 py-3.5 pl-11 pr-4 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none transition focus:border-indigo-400/60 focus:bg-white/10 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50"
          />
        </div>
        <button
          type="submit"
          disabled={disabled}
          className="rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
        >
          Cargar vídeo
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
    </form>
  );
}
