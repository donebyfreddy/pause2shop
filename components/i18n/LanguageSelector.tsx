"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Globe, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/ui/cn";
import { LOCALES, LOCALE_META, type Locale } from "@/i18n/locales";
import { useLocaleSwitch } from "./LocaleProvider";

/**
 * Selector de idioma: globo + código en la cabecera, popover con búsqueda al
 * pulsar. Implementado a mano (sin Radix), siguiendo el mismo patrón que
 * `components/ui/Overlay.tsx` (Escape, click fuera, foco inicial) para no
 * introducir una dependencia nueva de UI.
 */

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function LanguageSelector({ align = "end" }: { align?: "start" | "end" }) {
  const t = useTranslations("languageSelector");
  const { locale, setLocale } = useLocaleSwitch();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const reduce = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const activeMeta = LOCALE_META[locale];

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return LOCALES;
    return LOCALES.filter((code) => {
      const meta = LOCALE_META[code];
      return (
        normalize(meta.nativeName).includes(q) ||
        normalize(meta.englishName).includes(q) ||
        normalize(code).includes(q) ||
        normalize(meta.shortCode).includes(q)
      );
    });
  }, [query]);

  /**
   * El resaltado vuelve al primero cuando cambia el filtro o se reabre el menú.
   *
   * Se ajusta DURANTE el render y no en un efecto: es estado derivado de
   * `query`/`open`, y hacerlo en un efecto provocaba un render intermedio con
   * el índice viejo apuntando a una lista ya filtrada — un instante con el
   * resaltado en el idioma equivocado. Es el patrón que documenta React para
   * "ajustar estado cuando cambian las props".
   */
  const [lastReset, setLastReset] = useState({ query, open });
  if (lastReset.query !== query || lastReset.open !== open) {
    setLastReset({ query, open });
    setActiveIndex(0);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        rootRef.current?.querySelector<HTMLButtonElement>("[data-selector-trigger]")?.focus();
      }
    };
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClickOutside);
    const raf = requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClickOutside);
      cancelAnimationFrame(raf);
    };
  }, [open]);

  async function selectLocale(code: Locale) {
    setOpen(false);
    setQuery("");
    if (code !== locale) await setLocale(code);
  }

  function onListKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const code = filtered[activeIndex];
      if (code) void selectLocale(code);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        data-selector-trigger
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("trigger", { language: activeMeta.nativeName })}
        className={cn(
          "flex h-9 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[13px] font-medium text-ink-muted transition-colors hover:text-ink"
        )}
      >
        <Globe className="size-4" aria-hidden />
        <span className="tabular-nums">{activeMeta.shortCode}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -4 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            className={cn(
              "fixed inset-x-3 bottom-3 z-50 rounded-2xl border border-line bg-canvas-raised shadow-panel",
              "sm:absolute sm:inset-x-auto sm:bottom-auto sm:top-full sm:mt-2 sm:w-72",
              align === "end" ? "sm:right-0" : "sm:left-0"
            )}
          >
            <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
              <Search className="size-4 shrink-0 text-ink-subtle" aria-hidden />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onListKeyDown}
                placeholder={t("searchPlaceholder")}
                aria-controls={listboxId}
                aria-autocomplete="list"
                className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-subtle"
              />
            </div>
            <ul
              id={listboxId}
              role="listbox"
              aria-label={t("listLabel")}
              className="max-h-72 overflow-y-auto p-1.5"
            >
              {filtered.length === 0 && (
                <li className="px-3 py-6 text-center text-[13px] text-ink-subtle">
                  {t("noMatches")}
                </li>
              )}
              {filtered.map((code, index) => {
                const meta = LOCALE_META[code];
                const selected = code === locale;
                return (
                  <li key={code} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => void selectLocale(code)}
                      onMouseEnter={() => setActiveIndex(index)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors",
                        index === activeIndex ? "bg-white/[0.06]" : "hover:bg-white/[0.04]",
                        selected ? "text-ink" : "text-ink-muted"
                      )}
                    >
                      {meta.flag && (
                        <span className="text-base" aria-hidden>
                          {meta.flag}
                        </span>
                      )}
                      <span className="flex-1 truncate">{meta.nativeName}</span>
                      <span className="text-[11px] uppercase text-ink-subtle">{meta.shortCode}</span>
                      {selected && <Check className="size-4 text-brand-bright" aria-hidden />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
