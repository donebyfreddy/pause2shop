"use client";

import {
  Binary,
  CircleAlert,
  Cpu,
  Database,
  Gauge,
  KeyRound,
  Lock,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  CardDescription,
  DataRow,
  EmptyState,
  Skeleton,
  useToast,
} from "@/components/ui";
import { MatchingSourceCard } from "@/components/admin/MatchingSourceCard";
import { adminPost, useAdminResource } from "@/lib/admin/client";
import type { Settings } from "@/lib/catalogService/types";

/**
 * Ajustes. Es una vista de LECTURA a propósito: la configuración del servicio
 * vive en su entorno (.env), y un panel que la editara en caliente sería un
 * agujero (cambios sin trazabilidad, divergencia entre réplicas). Aquí se ve la
 * config efectiva, se dice qué variable la controla, y se ofrecen las acciones
 * que sí son operativas (reindexar embeddings).
 */

export function SettingsView() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const toast = useToast();
  const { data, error, loading, refreshing, reload } =
    useAdminResource<Settings>("settings", { pollMs: 60_000 });

  const reindex = async () => {
    const res = await adminPost<{ jobId: string }>("products/reindex");
    if (!res.ok) {
      toast.error(t("sections.embeddings.reindexErrorTitle"), res.error.message);
      return;
    }
    toast.success(
      t("sections.embeddings.reindexSuccessTitle"),
      t("sections.embeddings.reindexSuccessBody", { jobId: res.data.jobId.slice(0, 8) }),
    );
  };

  if (error && !data) {
    return (
      <Card>
        <EmptyState
          icon={CircleAlert}
          title={t("empty.errorTitle")}
          description={error.message}
          action={
            <Button variant="secondary" size="sm" onClick={reload}>
              {tCommon("retry")}
            </Button>
          }
        />
      </Card>
    );
  }

  if (loading || !data) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i}>
            <CardBody className="space-y-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </CardBody>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Callout tone="info" icon={Lock} className="flex-1">
          {t.rich("banner.body", {
            code: (chunks) => <code className="font-mono text-[11px]">{chunks}</code>,
          })}
        </Callout>
        <Button variant="ghost" size="sm" icon onClick={reload} aria-label={t("refresh")}>
          <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} aria-hidden />
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* --------------------------- claves --------------------------- */}
        <Card>
          <CardHeader
            actions={
              <Badge tone={data.service.authEnforced ? "success" : "danger"} dot>
                {data.service.authEnforced
                  ? t("sections.keys.authBadgeOn")
                  : t("sections.keys.authBadgeOff")}
              </Badge>
            }
          >
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-4 text-ink-faint" aria-hidden />
              {t("sections.keys.title")}
            </CardTitle>
            <CardDescription>{t("sections.keys.description")}</CardDescription>
          </CardHeader>
          <CardBody>
            <DataRow label="CATALOG_SERVICE_API_KEY">
              {data.service.apiKey.configured ? (
                <span className="text-success">
                  {t("sections.keys.configured", { count: data.service.apiKey.length })}
                </span>
              ) : (
                <span className="text-danger">{t("sections.keys.notConfigured")}</span>
              )}
            </DataRow>
            <DataRow label={t("sections.keys.portLabel")} mono>
              {data.service.port}
            </DataRow>
            <DataRow label="LOG_LEVEL" mono>
              {data.service.logLevel}
            </DataRow>

            {!data.service.authEnforced && (
              <Callout tone="danger" icon={TriangleAlert} className="mt-3">
                {t.rich("sections.keys.authWarning", {
                  code: (chunks) => <code className="font-mono text-[11px]">{chunks}</code>,
                })}
              </Callout>
            )}
          </CardBody>
        </Card>

        {/* --------------------------- almacenamiento --------------------------- */}
        <Card>
          <CardHeader
            actions={
              <Badge tone={data.storage.backend === "postgres" ? "success" : "warning"} dot>
                {data.storage.backend}
              </Badge>
            }
          >
            <CardTitle className="flex items-center gap-2">
              <Database className="size-4 text-ink-faint" aria-hidden />
              {t("storage")}
            </CardTitle>
            <CardDescription>{t("sections.storage.description")}</CardDescription>
          </CardHeader>
          <CardBody>
            <DataRow label="DATABASE_URL">
              {data.storage.databaseConfigured ? (
                <span className="text-success">{t("sections.storage.configured")}</span>
              ) : (
                <span className="text-warning">{t("sections.storage.missing")}</span>
              )}
            </DataRow>
            <DataRow label={t("sections.storage.dataDirLabel")} mono>
              {data.storage.dataDir}
            </DataRow>
            <DataRow label={t("sections.storage.imagesDirLabel")} mono>
              {data.storage.imagesDir}
            </DataRow>

            {data.storage.backend === "file" && (
              <Callout tone="warning" icon={TriangleAlert} className="mt-3">
                {t.rich("sections.storage.fileWarning", {
                  code: (chunks) => <code className="font-mono text-[11px]">{chunks}</code>,
                })}
              </Callout>
            )}
          </CardBody>
        </Card>

        {/* --------------------------- embeddings --------------------------- */}
        <Card>
          <CardHeader
            actions={
              <Button variant="secondary" size="xs" onClick={reindex}>
                <Sparkles className="size-3.5" aria-hidden />
                {t("sections.embeddings.reindex")}
              </Button>
            }
          >
            <CardTitle className="flex items-center gap-2">
              <Binary className="size-4 text-ink-faint" aria-hidden />
              {t("embeddings")}
            </CardTitle>
            <CardDescription>{t("sections.embeddings.description")}</CardDescription>
          </CardHeader>
          <CardBody>
            <DataRow label={t("sections.embeddings.imageProviderLabel")} mono>
              {data.embeddings.imageProvider}
            </DataRow>
            <DataRow label={t("sections.embeddings.imageModelLabel")} mono>
              {data.embeddings.imageModel}
            </DataRow>
            <DataRow label={t("sections.embeddings.textProviderLabel")} mono>
              {data.embeddings.textProvider}
            </DataRow>
            <DataRow label={t("sections.embeddings.activeNowLabel")} mono>
              {data.embeddings.active.name} · {data.embeddings.active.dimension}d
            </DataRow>

            {data.embeddings.imageProvider === "hash" && (
              <Callout tone="warning" icon={TriangleAlert} className="mt-3">
                {t.rich("sections.embeddings.hashWarning", {
                  code: (chunks) => <code className="font-mono text-[11px]">{chunks}</code>,
                })}
              </Callout>
            )}
          </CardBody>
        </Card>

        {/* --------------------------- matching --------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="size-4 text-ink-faint" aria-hidden />
              {t("sections.matching.title")}
            </CardTitle>
            <CardDescription>{t("sections.matching.description")}</CardDescription>
          </CardHeader>
          <CardBody>
            <DataRow label={t("sections.matching.minImageScoreLabel")} mono>
              {data.matching.minImageScore}
            </DataRow>
            <DataRow label={t("sections.matching.perceptualHashLabel")} mono>
              {data.matching.perceptualHashMaxDistance} / 64
            </DataRow>
            <DataRow label={t("sections.matching.dedupThresholdLabel")} mono>
              {data.matching.embeddingDedupThreshold}
            </DataRow>
            <DataRow label={t("sections.matching.jobsWorkersLabel")} mono>
              {data.jobs.workers}
            </DataRow>
          </CardBody>
        </Card>

        {/* --------------- fuente de coincidencias (producto) -------------- */}
        <MatchingSourceCard />

        {/* --------------------------- scraping --------------------------- */}
        <Card className="lg:col-span-2">
          <CardHeader
            actions={
              <Badge tone="success" dot>
                {t("sections.compliance.robotsBadge")}
              </Badge>
            }
          >
            <CardTitle className="flex items-center gap-2">
              <Gauge className="size-4 text-ink-faint" aria-hidden />
              {t("sections.compliance.title")}
            </CardTitle>
            <CardDescription>{t("sections.compliance.description")}</CardDescription>
          </CardHeader>
          <CardBody className="grid gap-x-8 gap-y-0 lg:grid-cols-2">
            <div>
              <DataRow label={t("sections.compliance.rateLimitLabel")} mono>
                {data.scraping.rateLimitPerDomainMs} ms
              </DataRow>
              <DataRow label={t("sections.compliance.concurrencyLabel")} mono>
                {data.scraping.maxConcurrency}
              </DataRow>
              <DataRow label={t("sections.compliance.timeoutLabel")} mono>
                {data.scraping.requestTimeoutMs} ms
              </DataRow>
            </div>
            <div>
              <DataRow label={t("sections.compliance.retriesLabel")} mono>
                {data.scraping.maxRetries}
              </DataRow>
              <DataRow label={t("sections.compliance.circuitBreakerLabel")} mono>
                {data.scraping.circuitBreakerThreshold} {t("sections.compliance.circuitBreakerSuffix")}
              </DataRow>
              <DataRow label={t("sections.compliance.userAgentLabel")} mono>
                {data.scraping.userAgent}
              </DataRow>
            </div>

            <div className="lg:col-span-2">
              <Callout
                tone="success"
                icon={ShieldCheck}
                className="mt-4"
                title={t("sections.compliance.policyTitle")}
              >
                {t.rich("sections.compliance.policyBody", {
                  policy: data.scraping.robotsPolicy,
                  code: (chunks) => <code className="font-mono text-[11px]">{chunks}</code>,
                })}
              </Callout>
            </div>
          </CardBody>
        </Card>

        {/* --------------------------- observabilidad --------------------------- */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ScrollText className="size-4 text-ink-faint" aria-hidden />
              {t("sections.observability.title")}
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <DataRow label={t("sections.observability.logsLabel")}>
              {t("sections.observability.logsValue")}
            </DataRow>
            <DataRow label={t("sections.observability.healthCacheLabel")}>
              {t("sections.observability.healthCacheValue")}
            </DataRow>
            <DataRow label={t("sections.observability.metricsLabel")}>
              {t.rich("sections.observability.metricsValue", {
                code: (chunks) => <code className="font-mono text-[11px]">{chunks}</code>,
              })}
            </DataRow>
            <p className="text-[11px] leading-relaxed text-ink-faint">
              {t("sections.observability.footnote")}
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
