"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { PlugZap, Radar } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
  DataRow,
  Skeleton,
} from "@/components/ui";
import type { MatchingCapabilities } from "@/lib/matching/capabilities";

/** Ajustes efectivos del matching, tal y como los expone /api/matching/metrics. */
type MatchingRuntimeConfig = {
  catalogMaxVisible: number;
  externalSearchEnabled: boolean;
  automaticFallback: boolean;
  cacheEnabled: boolean;
  cacheTtlSeconds: number;
};

/**
 * Estado operativo de la FUENTE DE COINCIDENCIAS: modo por defecto, umbral de
 * cada fuente, proveedor externo y si responde.
 *
 * Es de LECTURA, como el resto de Ajustes: los umbrales viven en el entorno
 * (CATALOG_MATCH_THRESHOLD / EXTERNAL_MATCH_THRESHOLD / HYBRID_MATCH_THRESHOLD)
 * y editarlos en caliente dejaría réplicas con distinta configuración. Lo único
 * accionable es probar la conexión, que sí es una operación de diagnóstico.
 */

type HealthResponse = {
  ok: boolean;
  reverseImageSearch: "available" | "unavailable";
  providers: { primary: string };
  reasons: string[];
};

type TestState =
  | { phase: "idle" }
  | { phase: "testing" }
  | { phase: "done"; ok: boolean; detail: string; at: string };

const MODE_LABEL: Record<string, string> = {
  catalog_only: "Catálogo propio",
  external_only: "Búsqueda externa",
  catalog_first: "Catálogo primero",
  catalog_and_external: "Comparar fuentes",
};

export function MatchingSourceCard() {
  const t = useTranslations("settings.sections.productMatching");
  const [caps, setCaps] = useState<MatchingCapabilities | null>(null);
  const [runtime, setRuntime] = useState<MatchingRuntimeConfig | null>(null);
  const [test, setTest] = useState<TestState>({ phase: "idle" });

  useEffect(() => {
    let alive = true;
    fetch("/api/matching/capabilities", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (alive && body?.ok) setCaps(body as MatchingCapabilities);
      })
      .catch(() => undefined);
    // Los ajustes efectivos (fallback, caché, máximo visible) no están en
    // capabilities: viven en la config del servidor y los expone /metrics.
    fetch("/api/matching/metrics", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (alive && body?.ok) setRuntime(body.config as MatchingRuntimeConfig);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const runTest = useCallback(async () => {
    setTest({ phase: "testing" });
    try {
      const res = await fetch("/api/health/visual-search", { cache: "no-store" });
      const body = (await res.json()) as HealthResponse;
      setTest({
        phase: "done",
        ok: body.reverseImageSearch === "available",
        // El motivo real del preflight, no un "error" genérico.
        detail: body.reasons[0] ?? t("testOkDetail"),
        at: new Date().toLocaleTimeString("es-ES"),
      });
    } catch (err) {
      setTest({
        phase: "done",
        ok: false,
        detail: err instanceof Error ? err.message : t("testFailed"),
        at: new Date().toLocaleTimeString("es-ES"),
      });
    }
  }, [t]);

  return (
    <Card>
      <CardHeader
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={runTest}
            disabled={test.phase === "testing"}
          >
            <PlugZap className="size-3.5" aria-hidden />
            {test.phase === "testing" ? t("testing") : t("testConnection")}
          </Button>
        }
      >
        <CardTitle className="flex items-center gap-2">
          <Radar className="size-4 text-ink-faint" aria-hidden />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardBody>
        {!caps ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <>
            <DataRow label={t("defaultModeLabel")} mono>
              {MODE_LABEL[caps.defaultMode] ?? caps.defaultMode}
            </DataRow>
            <DataRow label={t("catalogThresholdLabel")} mono>
              {caps.thresholds.catalog}
            </DataRow>
            <DataRow label={t("externalThresholdLabel")} mono>
              {caps.thresholds.external}
            </DataRow>
            <DataRow label={t("hybridThresholdLabel")} mono>
              {caps.thresholds.hybrid}
            </DataRow>
            <DataRow label={t("providerLabel")} mono>
              {caps.external.primaryProvider ?? t("providerMissing")}
            </DataRow>
            <DataRow label={t("indexedLabel")} mono>
              {caps.catalog.indexedProducts ?? "—"}
            </DataRow>
            {runtime && (
              <>
                <DataRow label={t("maxVisibleLabel")} mono>
                  {runtime.catalogMaxVisible}
                </DataRow>
                <DataRow label={t("externalEnabledLabel")} mono>
                  {runtime.externalSearchEnabled ? t("enabled") : t("disabled")}
                </DataRow>
                <DataRow label={t("automaticFallbackLabel")} mono>
                  {runtime.automaticFallback ? t("enabled") : t("disabled")}
                </DataRow>
                <DataRow label={t("cacheLabel")} mono>
                  {runtime.cacheEnabled
                    ? t("cacheTtl", {
                        hours: Math.round(runtime.cacheTtlSeconds / 3600),
                      })
                    : t("disabled")}
                </DataRow>
              </>
            )}
            <DataRow label={t("statusLabel")}>
              <span className="flex flex-wrap items-center gap-1.5">
                <Badge tone={caps.catalog.available ? "success" : "warning"} dot>
                  {t("catalogBadge")}
                </Badge>
                <Badge tone={caps.external.available ? "success" : "warning"} dot>
                  {t("externalBadge")}
                </Badge>
              </span>
            </DataRow>
            {test.phase === "done" && (
              <DataRow label={t("lastTestLabel")}>
                <span
                  className={test.ok ? "text-success" : "text-warning"}
                >
                  {test.at} · {test.detail}
                </span>
              </DataRow>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
