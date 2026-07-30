import { pushLog } from "./logRing";

/**
 * Logs estructurados JSON en stdout. Sin dependencias: un logger propio de
 * 40 líneas es suficiente y evita arrastrar pino/winston a un servicio pequeño.
 *
 * Además de stdout, cada evento se retiene en un buffer circular en memoria
 * (logRing) para que el admin pueda consultarlo por HTTP sin acceso al proceso.
 */

type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function currentLevel(): number {
  const l = (process.env.LOG_LEVEL as Level) || "info";
  return LEVELS[l] ?? 20;
}

function emit(level: Level, msg: string, extra?: Record<string, unknown>): void {
  if (LEVELS[level] < currentLevel()) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...extra,
  });
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
  pushLog(level, msg, extra ?? {});
}

export const logger = {
  debug: (msg: string, extra?: Record<string, unknown>) => emit("debug", msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => emit("info", msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => emit("warn", msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => emit("error", msg, extra),
};
