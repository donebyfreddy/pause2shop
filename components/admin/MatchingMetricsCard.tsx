"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { PiggyBank } from "lucide-react";
import {
  Badge,
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
  DataRow,
  Skeleton,
} from "@/components/ui";
import type { MatchingMetrics } from "@/lib/server/matchingMetrics";

/**
 * Resolución de productos: cuánto resuelve el catálogo propio.
 *
 * La métrica que gobierna la decisión de producto es `resolutionRate`: si el
 * catálogo resuelve poco, cada objeto detectado cuesta una llamada externa. El
 * ranking de "categorías sin resolver" es la lista de trabajo que sale de ahí:
 * dice exactamente qué indexar para que ese coste baje.
 */

type MetricsResponse = {
  ok: boolean;
  metrics: MatchingMetrics;
};

function pct(value: number | null): string {
  if (value == null) return "—";
  return `${Math.round(value * 100)}%`;
}

function usd(value: number): string {
  return `$${value.toFixed(4)}`;
}

export function MatchingMetricsCard() {
  const t = useTranslations("settings.sections.matchingMetrics");
  const [metrics, setMetrics] = useState<MatchingMetrics | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/matching/metrics", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: MetricsResponse | null) => {
        if (alive && body?.ok) setMetrics(body.metrics);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PiggyBank className="size-4 text-ink-faint" aria-hidden />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardBody>
        {!metrics ? (
          <Skeleton className="h-32 w-full" />
        ) : metrics.detections === 0 ? (
          <p className="text-xs text-ink-faint">{t("none")}</p>
        ) : (
          <>
            <DataRow label={t("detections")} mono>
              {metrics.detections}
            </DataRow>
            <DataRow label={t("byCatalog")} mono>
              <span className="text-success">{metrics.resolvedByCatalog}</span>
            </DataRow>
            <DataRow label={t("byExternal")} mono>
              <span className="text-accent">{metrics.resolvedByExternal}</span>
            </DataRow>
            <DataRow label={t("unresolved")} mono>
              {metrics.unresolved}
            </DataRow>
            <DataRow label={t("resolutionRate")}>
              <Badge
                tone={
                  (metrics.catalogResolutionRate ?? 0) >= 0.5 ? "success" : "warning"
                }
                dot
              >
                {pct(metrics.catalogResolutionRate)}
              </Badge>
            </DataRow>
            <DataRow label={t("externalCalls")} mono>
              {metrics.externalCalls}
            </DataRow>
            <DataRow label={t("externalFallbacks")} mono>
              {metrics.externalFallbacks}
            </DataRow>
            <DataRow label={t("externalManual")} mono>
              {metrics.externalManualRequests}
            </DataRow>
            <DataRow label={t("cacheHits")} mono>
              {metrics.cacheHits}
            </DataRow>
            <DataRow label={t("externalCost")} mono>
              {usd(metrics.externalCostUsd)}
            </DataRow>
            {/* El ahorro atribuible al catálogo: una llamada externa por cada
                objeto que resolvió sin salir fuera. */}
            <DataRow label={t("externalCostAvoided")} mono>
              <span className="text-success">{usd(metrics.externalCostAvoidedUsd)}</span>
            </DataRow>
            <DataRow label={t("averageDuration")} mono>
              {metrics.averageDurationMs != null
                ? `${metrics.averageDurationMs} ms`
                : t("empty")}
            </DataRow>
            {metrics.topUnresolvedCategories.length > 0 && (
              <DataRow label={t("topUnresolved")}>
                <span className="flex flex-wrap gap-1">
                  {metrics.topUnresolvedCategories.map((c) => (
                    <Badge key={c.category} tone="neutral">
                      {c.category} · {c.count}
                    </Badge>
                  ))}
                </span>
              </DataRow>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
