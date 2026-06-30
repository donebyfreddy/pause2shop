import type { DetectedItem, FrameAnalysis, HistoryEntry, Preferences } from "./types";
import { makeId, styleCategoryBoost, normalizeStyle } from "./utils";

const HISTORY_KEY = "pause2shop:history";
const PREFS_KEY = "pause2shop:prefs";
const MAX_HISTORY = 5;

function safeGet<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function safeSet(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or serialization error — ignore */
  }
}

export function loadHistory(): HistoryEntry[] {
  return safeGet<HistoryEntry[]>(HISTORY_KEY, []);
}

export function pushHistory(entry: {
  videoKey: string;
  timestampSeconds: number;
  analysis: FrameAnalysis;
  frameDataUrl?: string;
}): HistoryEntry[] {
  const list = loadHistory();
  const next: HistoryEntry = {
    id: makeId("h"),
    createdAt: Date.now(),
    ...entry,
  };
  const updated = [next, ...list].slice(0, MAX_HISTORY);
  safeSet(HISTORY_KEY, updated);
  return updated;
}

export function clearHistory(): void {
  safeSet(HISTORY_KEY, []);
}

export function loadPreferences(): Preferences {
  return safeGet<Preferences>(PREFS_KEY, { categoryClicks: {}, styleClicks: {} });
}

/** Record a click on a product to bias future rankings. */
export function recordClick(item: DetectedItem): Preferences {
  const prefs = loadPreferences();
  const cat = item.category.toLowerCase();
  prefs.categoryClicks[cat] = (prefs.categoryClicks[cat] ?? 0) + 1;
  const style = normalizeStyle(item.style);
  if (style) prefs.styleClicks[style] = (prefs.styleClicks[style] ?? 0) + 1;
  safeSet(PREFS_KEY, prefs);
  return prefs;
}

/**
 * Re-rank items: combine the model's score with the frame style vibe boost and
 * the user's historical preferences (category + style clicks).
 */
export function personalizeRanking(
  analysis: FrameAnalysis,
  prefs: Preferences
): DetectedItem[] {
  const vibe = normalizeStyle(analysis.style_vibe);
  const maxCatClicks = Math.max(1, ...Object.values(prefs.categoryClicks));
  const maxStyleClicks = Math.max(1, ...Object.values(prefs.styleClicks));

  return [...analysis.items]
    .map((item) => {
      const base = item.score ?? item.confidence;
      const vibeBoost = styleCategoryBoost(vibe, item.category) / 5; // 0..1
      const catPref = (prefs.categoryClicks[item.category.toLowerCase()] ?? 0) / maxCatClicks;
      const itemStyle = normalizeStyle(item.style);
      const stylePref = itemStyle ? (prefs.styleClicks[itemStyle] ?? 0) / maxStyleClicks : 0;

      const personalized =
        base * 1.0 + vibeBoost * 0.4 + catPref * 0.3 + stylePref * 0.2;
      return { ...item, score: personalized };
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
