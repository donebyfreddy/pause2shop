"use client";

import { useEffect, useState } from "react";
import type { MatchingCapabilities } from "@/lib/matching/capabilities";

/**
 * Lee UNA vez por sesión qué fuentes de coincidencias están realmente
 * configuradas. Se comparte entre superficies con una promesa memoizada a
 * nivel de módulo: el selector aparece en estudio y demo, y no tiene sentido
 * pedir lo mismo en cada montaje.
 */

let cached: Promise<MatchingCapabilities | null> | null = null;

function fetchCapabilities(): Promise<MatchingCapabilities | null> {
  cached ??= fetch("/api/matching/capabilities", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((body) => (body?.ok ? (body as MatchingCapabilities) : null))
    .catch(() => null);
  return cached;
}

export function useMatchingCapabilities(): MatchingCapabilities | null {
  const [caps, setCaps] = useState<MatchingCapabilities | null>(null);

  useEffect(() => {
    let alive = true;
    fetchCapabilities().then((c) => {
      if (alive) setCaps(c);
    });
    return () => {
      alive = false;
    };
  }, []);

  return caps;
}
