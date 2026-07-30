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
  const toast = useToast();
  const { data, error, loading, refreshing, reload } =
    useAdminResource<Settings>("settings", { pollMs: 60_000 });

  const reindex = async () => {
    const res = await adminPost<{ jobId: string }>("products/reindex");
    if (!res.ok) {
      toast.error("No se pudo lanzar el reindexado", res.error.message);
      return;
    }
    toast.success("Reindexado encolado", `Job ${res.data.jobId.slice(0, 8)}`);
  };

  if (error && !data) {
    return (
      <Card>
        <EmptyState
          icon={CircleAlert}
          title="No se pudo leer la configuración"
          description={error.message}
          action={
            <Button variant="secondary" size="sm" onClick={reload}>
              Reintentar
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
          Estos valores se leen del entorno del servicio de catálogo y se muestran en modo
          lectura: la configuración se cambia en su <code className="font-mono text-[11px]">.env</code>{" "}
          y se aplica al reiniciar. Así queda trazable y no divergen las réplicas.
        </Callout>
        <Button variant="ghost" size="sm" icon onClick={reload} aria-label="Refrescar">
          <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} aria-hidden />
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* --------------------------- claves --------------------------- */}
        <Card>
          <CardHeader
            actions={
              <Badge tone={data.service.authEnforced ? "success" : "danger"} dot>
                {data.service.authEnforced ? "Auth activa" : "Auth deshabilitada"}
              </Badge>
            }
          >
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-4 text-ink-faint" aria-hidden />
              Claves de API
            </CardTitle>
            <CardDescription>
              La clave del servicio nunca sale del servidor: el admin habla con él a través del
              proxy de la app.
            </CardDescription>
          </CardHeader>
          <CardBody>
            <DataRow label="CATALOG_SERVICE_API_KEY">
              {data.service.apiKey.configured ? (
                <span className="text-success">
                  configurada · {data.service.apiKey.length} caracteres
                </span>
              ) : (
                <span className="text-danger">sin configurar</span>
              )}
            </DataRow>
            <DataRow label="Puerto del servicio" mono>
              {data.service.port}
            </DataRow>
            <DataRow label="LOG_LEVEL" mono>
              {data.service.logLevel}
            </DataRow>

            {!data.service.authEnforced && (
              <Callout tone="danger" icon={TriangleAlert} className="mt-3">
                Sin <code className="font-mono text-[11px]">CATALOG_SERVICE_API_KEY</code> el
                servicio acepta cualquier petición. Aceptable en local; nunca en un entorno
                accesible desde fuera.
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
              Almacenamiento
            </CardTitle>
            <CardDescription>
              Backend elegido automáticamente según haya una connection string válida.
            </CardDescription>
          </CardHeader>
          <CardBody>
            <DataRow label="DATABASE_URL">
              {data.storage.databaseConfigured ? (
                <span className="text-success">configurada</span>
              ) : (
                <span className="text-warning">ausente o no es postgres://</span>
              )}
            </DataRow>
            <DataRow label="Directorio de datos" mono>
              {data.storage.dataDir}
            </DataRow>
            <DataRow label="Directorio de imágenes" mono>
              {data.storage.imagesDir}
            </DataRow>

            {data.storage.backend === "file" && (
              <Callout tone="warning" icon={TriangleAlert} className="mt-3">
                Modo fichero: el catálogo persiste en JSON y la búsqueda vectorial se hace en
                memoria. Configura una connection string{" "}
                <code className="font-mono text-[11px]">postgres://</code> (endpoint{" "}
                <code className="font-mono text-[11px]">-pooler</code> de Neon) y ejecuta las
                migraciones para activar pgvector.
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
                Reindexar
              </Button>
            }
          >
            <CardTitle className="flex items-center gap-2">
              <Binary className="size-4 text-ink-faint" aria-hidden />
              Embeddings
            </CardTitle>
            <CardDescription>
              Al cambiar de proveedor cambia la dimensión: hay que reindexar o los vectores
              antiguos dejan de ser comparables.
            </CardDescription>
          </CardHeader>
          <CardBody>
            <DataRow label="Proveedor de imagen" mono>
              {data.embeddings.imageProvider}
            </DataRow>
            <DataRow label="Modelo de imagen" mono>
              {data.embeddings.imageModel}
            </DataRow>
            <DataRow label="Proveedor de texto" mono>
              {data.embeddings.textProvider}
            </DataRow>
            <DataRow label="Activo ahora" mono>
              {data.embeddings.active.name} · {data.embeddings.active.dimension}d
            </DataRow>

            {data.embeddings.imageProvider === "hash" && (
              <Callout tone="warning" icon={TriangleAlert} className="mt-3">
                Proveedor <code className="font-mono text-[11px]">hash</code>: vectores
                deterministas de 64 dimensiones para demo y tests. No hace similitud visual
                real — instala el proveedor local con{" "}
                <code className="font-mono text-[11px]">npm run embeddings:install</code> en
                catalog-scraper y pon{" "}
                <code className="font-mono text-[11px]">
                  CATALOG_IMAGE_EMBEDDING_PROVIDER=local
                </code>
                .
              </Callout>
            )}
          </CardBody>
        </Card>

        {/* --------------------------- matching --------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="size-4 text-ink-faint" aria-hidden />
              Umbrales de matching y dedup
            </CardTitle>
            <CardDescription>
              Nada se publica por debajo del score mínimo: preferimos no devolver resultado a
              devolver uno dudoso.
            </CardDescription>
          </CardHeader>
          <CardBody>
            <DataRow label="Score mínimo de imagen" mono>
              {data.matching.minImageScore}
            </DataRow>
            <DataRow label="Distancia máx. de hash perceptual" mono>
              {data.matching.perceptualHashMaxDistance} / 64
            </DataRow>
            <DataRow label="Umbral de dedup por embedding" mono>
              {data.matching.embeddingDedupThreshold}
            </DataRow>
            <DataRow label="Workers de jobs" mono>
              {data.jobs.workers}
            </DataRow>
          </CardBody>
        </Card>

        {/* --------------------------- scraping --------------------------- */}
        <Card className="lg:col-span-2">
          <CardHeader
            actions={
              <Badge tone="success" dot>
                robots.txt respetado
              </Badge>
            }
          >
            <CardTitle className="flex items-center gap-2">
              <Gauge className="size-4 text-ink-faint" aria-hidden />
              Límites de ingesta y cumplimiento
            </CardTitle>
            <CardDescription>
              Los valores por defecto son deliberadamente conservadores: es mejor tardar más que
              molestar a una tienda.
            </CardDescription>
          </CardHeader>
          <CardBody className="grid gap-x-8 gap-y-0 lg:grid-cols-2">
            <div>
              <DataRow label="Intervalo mínimo por dominio" mono>
                {data.scraping.rateLimitPerDomainMs} ms
              </DataRow>
              <DataRow label="Concurrencia global" mono>
                {data.scraping.maxConcurrency}
              </DataRow>
              <DataRow label="Timeout por petición" mono>
                {data.scraping.requestTimeoutMs} ms
              </DataRow>
            </div>
            <div>
              <DataRow label="Reintentos" mono>
                {data.scraping.maxRetries}
              </DataRow>
              <DataRow label="Umbral del circuit breaker" mono>
                {data.scraping.circuitBreakerThreshold} fallos seguidos
              </DataRow>
              <DataRow label="User-Agent" mono>
                {data.scraping.userAgent}
              </DataRow>
            </div>

            <div className="lg:col-span-2">
              <Callout tone="success" icon={ShieldCheck} className="mt-4" title="Política aplicada">
                {data.scraping.robotsPolicy}. Además: <code className="font-mono text-[11px]">Crawl-delay</code>{" "}
                respetado cuando la tienda lo declara, User-Agent identificable con contacto, y
                circuit breaker que deja de insistir ante bloqueos sostenidos. Las fuentes que
                requieren acuerdo de partner o afiliación no se ingieren hasta tenerlo.
              </Callout>
            </div>
          </CardBody>
        </Card>

        {/* --------------------------- observabilidad --------------------------- */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ScrollText className="size-4 text-ink-faint" aria-hidden />
              Observabilidad y caché
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <DataRow label="Logs">
              Buffer circular en memoria (750 eventos) + JSON estructurado a stdout
            </DataRow>
            <DataRow label="Caché de health de conectores">
              10 minutos por fuente; la comprobación live es manual
            </DataRow>
            <DataRow label="Métricas">
              Contadores en memoria expuestos en{" "}
              <code className="font-mono text-[11px]">/stats</code> y{" "}
              <code className="font-mono text-[11px]">/overview</code>
            </DataRow>
            <p className="text-[11px] leading-relaxed text-ink-faint">
              Todo el estado observable es del proceso: al reiniciar el servicio se reinician
              contadores y buffer de logs. Para histórico real, recoge el stdout y usa el backend
              Postgres.
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
