"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  defaultAnalysisConfig,
  parseConfig,
  serializeConfig,
} from "@/lib/analysis/categories";
import type { AnalysisSettings } from "@/lib/types";

/**
 * Configuración de análisis compartida entre TODAS las superficies (estudio de
 * imagen, estudio de vídeo, frame pausado, demo) y persistida en localStorage.
 *
 * Por qué un hook y no estado local por página: la elección de "fuente de
 * coincidencias" tiene que sobrevivir al cambio de imagen a vídeo, a la pausa
 * del vídeo y a navegar entre /studio y /demo. Con estado por página se perdía
 * en cada salto y el usuario volvía a catalog_first sin haberlo pedido.
 */

const STORAGE_KEY = "pause2shop.analysisSettings.v1";

/** Evento propio: sincroniza pestañas Y componentes de la MISMA pestaña. */
const SYNC_EVENT = "pause2shop:analysis-settings";

function readStored(): AnalysisSettings | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    // parseConfig valida y sanea: una entrada corrupta o de una versión vieja
    // cae al default en lugar de propagar basura al backend.
    return parseConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeStored(settings: AnalysisSettings): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(serializeConfig(settings))
    );
    window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: settings }));
  } catch {
    // Modo privado o cuota llena: la sesión sigue, solo no se recuerda.
  }
}

export type UseAnalysisSettings = {
  settings: AnalysisSettings;
  setSettings: (next: AnalysisSettings) => void;
  /** Ref siempre actualizada: para leerla dentro de callbacks/loops. */
  settingsRef: React.RefObject<AnalysisSettings>;
  /** false hasta que se ha leído localStorage (evita parpadeo del selector). */
  hydrated: boolean;
};

export function useAnalysisSettings(): UseAnalysisSettings {
  // Estado inicial SIN tocar localStorage: el HTML del servidor y el del primer
  // render del cliente deben coincidir o React tira un error de hidratación.
  const [settings, setLocal] = useState<AnalysisSettings>(defaultAnalysisConfig);
  const [hydrated, setHydrated] = useState(false);
  const settingsRef = useRef(settings);

  // El ref se sincroniza en un efecto, no durante el render: tocarlo mientras
  // se renderiza rompe la regla de refs de React 19.
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    // Diferido a un macrotask para no encadenar renders síncronos dentro del
    // propio efecto (misma pauta que el resto del estudio).
    const id = setTimeout(() => {
      const stored = readStored();
      if (stored) setLocal(stored);
      setHydrated(true);
    }, 0);
    return () => clearTimeout(id);
  }, []);

  // Otra superficie (u otra pestaña) cambió los ajustes: nos ponemos al día.
  useEffect(() => {
    function onSync(e: Event) {
      const detail = (e as CustomEvent<AnalysisSettings>).detail;
      if (detail) setLocal(detail);
    }
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return;
      const stored = readStored();
      if (stored) setLocal(stored);
    }
    window.addEventListener(SYNC_EVENT, onSync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(SYNC_EVENT, onSync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setSettings = useCallback((next: AnalysisSettings) => {
    setLocal(next);
    settingsRef.current = next;
    writeStored(next);
  }, []);

  return { settings, setSettings, settingsRef, hydrated };
}
