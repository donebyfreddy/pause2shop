"use client";

import {
  AlertTriangle,
  Check,
  Database,
  Download,
  FlaskConical,
  Info,
  Play,
  RotateCcw,
  Search,
  Settings2,
  Target,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import {
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  DataRow,
  Input,
  Label,
  SectionLabel,
  Select,
  useToast,
} from "@/components/ui";
import { adminPost, useAdminResource } from "@/lib/admin/client";
import type {
  DatasetDryRunResponse,
  DatasetInspectResponse,
  DatasetsResponse,
  DatasetTestMatchResponse,
  JobsResponse,
} from "@/lib/catalogService/types";

/**
 * Panel de importación de catálogos de demostración.
 *
 * Principio de la pantalla: se dice CLARAMENTE qué trae el dataset y qué no.
 * Estas fichas no tienen precio, ni stock, ni URL de compra, y confundirlas con
 * catálogo comercial sería el peor resultado posible de esta pantalla. De ahí el
 * bloque de "campos no disponibles" y el aviso de storage efímero.
 */

type Mode = "quick" | "custom";

const MASTER_CATEGORIES = ["Apparel", "Footwear", "Accessories", "Personal Care", "Free Items"];
const GENDERS = ["Men", "Women", "Boys", "Girls", "Unisex"];

export function DatasetImportPanel() {
  const t = useTranslations("datasets");
  const tCommon = useTranslations("common");
  const toast = useToast();
  const router = useRouter();

  const datasets = useAdminResource<DatasetsResponse>("datasets");
  // Los jobs se consultan para poder ofrecer "Reanudar" sobre el último import
  // interrumpido sin que el operador tenga que ir a buscar el jobId.
  const jobs = useAdminResource<JobsResponse>("jobs?limit=40", { pollMs: 8000 });

  const [mode, setMode] = useState<Mode>("quick");
  const [busy, setBusy] = useState<string | null>(null);
  const [inspection, setInspection] = useState<DatasetInspectResponse | null>(null);
  const [dryRun, setDryRun] = useState<DatasetDryRunResponse | null>(null);
  const [testMatch, setTestMatch] = useState<DatasetTestMatchResponse | null>(null);

  const [limit, setLimit] = useState("1000");
  const [offset, setOffset] = useState("0");
  const [batchSize, setBatchSize] = useState("25");
  const [source, setSource] = useState("huggingface");
  const [categories, setCategories] = useState<string[]>([]);
  const [genders, setGenders] = useState<string[]>([]);
  const [uploadImages, setUploadImages] = useState(true);
  const [generateEmbeddings, setGenerateEmbeddings] = useState(true);

  const dataset = datasets.data?.datasets[0] ?? null;
  const storage = datasets.data?.storage ?? null;

  const resumable = useMemo(() => {
    const list = jobs.data?.jobs ?? [];
    return (
      list.find(
        (j) =>
          j.type === "dataset_import" &&
          ["partially_completed", "failed", "cancelled"].includes(j.status) &&
          j.resumeIndex != null
      ) ?? null
    );
  }, [jobs.data?.jobs]);

  const activeImport = useMemo(() => {
    const list = jobs.data?.jobs ?? [];
    return list.find((j) => j.type === "dataset_import" && j.isActive) ?? null;
  }, [jobs.data?.jobs]);

  const buildBody = (overrides: Record<string, unknown> = {}) => ({
    datasetId: dataset?.id,
    source,
    limit: Number(limit) || 0,
    offset: Number(offset) || 0,
    batchSize: Number(batchSize) || 25,
    categories,
    genders,
    uploadImages,
    generateEmbeddings,
    ...overrides,
  });

  const inspect = async () => {
    setBusy("inspect");
    const res = await adminPost<DatasetInspectResponse>("datasets/inspect", {
      datasetId: dataset?.id,
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(t("toast.inspectFailed"), res.error.message);
      return;
    }
    setInspection(res.data);
    if (res.data.reachable) toast.success(t("toast.inspectOk", { rows: res.data.totalRows ?? 0 }));
    else toast.error(t("toast.inspectFailed"), res.data.unreachableReason ?? "");
  };

  const runDryRun = async () => {
    setBusy("dry");
    const res = await adminPost<DatasetDryRunResponse>(
      "datasets/import",
      buildBody({ dryRun: true })
    );
    setBusy(null);
    if (!res.ok) {
      toast.error(t("toast.dryRunFailed"), res.error.message);
      return;
    }
    setDryRun(res.data);
    toast.success(t("toast.dryRunOk", { count: res.data.preview.length }));
  };

  const startImport = async (count?: number) => {
    setBusy(count ? `quick-${count}` : "import");
    const res = await adminPost<{ jobId: string }>(
      "datasets/import",
      buildBody(count ? { limit: count, offset: 0 } : {})
    );
    setBusy(null);
    if (!res.ok) {
      toast.error(t("toast.importFailed"), res.error.message);
      return;
    }
    toast.success(t("toast.importQueued"), t("toast.importQueuedDetail", { jobId: res.data.jobId.slice(0, 8) }));
    // Se navega al job: la importación de mil fichas no cabe en una petición, y
    // el sitio donde se ve avanzar es /admin/jobs.
    router.push(`/admin/jobs?open=${res.data.jobId}`);
  };

  const resume = async () => {
    if (!resumable) return;
    setBusy("resume");
    const res = await adminPost<{ jobId: string }>(`datasets/resume/${resumable.jobId}`);
    setBusy(null);
    if (!res.ok) {
      toast.error(t("toast.resumeFailed"), res.error.message);
      return;
    }
    toast.success(t("toast.resumed"));
    router.push(`/admin/jobs?open=${res.data.jobId}`);
  };

  const cancel = async () => {
    if (!activeImport) return;
    setBusy("cancel");
    const res = await adminPost(`jobs/${activeImport.jobId}/cancel`);
    setBusy(null);
    if (!res.ok) {
      toast.error(t("toast.cancelFailed"), res.error.message);
      return;
    }
    toast.success(t("toast.cancelled"));
    jobs.reload();
  };

  const runTestMatch = async () => {
    setBusy("match");
    const res = await adminPost<DatasetTestMatchResponse>("datasets/test-match", {
      datasetId: dataset?.id,
      topK: 10,
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(t("toast.matchFailed"), res.error.message);
      return;
    }
    setTestMatch(res.data);
    if (res.data.selfFoundAtRank === 1) toast.success(t("toast.matchExact"));
    else if (res.data.selfFoundAtRank) {
      toast.info(t("toast.matchFoundAt", { rank: res.data.selfFoundAtRank }));
    } else toast.warning(t("toast.matchNotFound"));
  };

  const toggle = (list: string[], value: string, set: (v: string[]) => void) => {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  if (datasets.loading) {
    return (
      <Card>
        <CardBody>
          <p className="text-[12px] text-ink-subtle">{tCommon("loading")}</p>
        </CardBody>
      </Card>
    );
  }
  if (!dataset) {
    return (
      <Callout tone="warning" icon={AlertTriangle} title={t("noDatasets")}>
        {datasets.error?.message ?? t("noDatasetsDetail")}
      </Callout>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Database className="size-4 text-brand-bright" aria-hidden />
            {t("title")}
          </CardTitle>
          <p className="mt-1 text-[12px] text-ink-subtle">{t("description")}</p>
          <p className="mt-1 font-mono text-[11px] text-ink-faint">
            {dataset.repo} · {t("origin")}: {dataset.originRepo}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Badge tone="info" dot>
            {t("demoBadge")}
          </Badge>
          <Badge tone="neutral">{t("importedCount", { count: dataset.importedProducts })}</Badge>
        </div>
      </CardHeader>

      <CardBody className="space-y-4">
        {/* Aviso de storage: importar con storage efímero deja un catálogo que
            se queda sin fotos. Se ve ANTES de importar, no después. */}
        {storage && !storage.persistent && (
          <Callout tone="danger" icon={AlertTriangle} title={t("storageEphemeralTitle")}>
            {t("storageEphemeralBody", { provider: storage.provider })}
          </Callout>
        )}

        {/* Lo que el dataset NO trae. Es la información más importante del panel. */}
        <Callout tone="warning" icon={Info} title={t("unavailableTitle")}>
          <p className="mb-1">{t("unavailableBody")}</p>
          <div className="flex flex-wrap gap-1">
            {dataset.unavailableFields.map((f) => (
              <span
                key={f}
                className="rounded border border-line bg-surface-sunken px-1.5 py-0.5 font-mono text-[10px] text-ink-faint"
              >
                {f}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11px]">{t("licenseNote", { license: dataset.license })}</p>
        </Callout>

        {activeImport && (
          <Callout tone="brand" icon={Play} title={t("activeImportTitle")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {t("activeImportBody", {
                  processed: activeImport.processed,
                  total: activeImport.progress.discovered,
                  status: activeImport.status,
                })}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => router.push(`/admin/jobs?open=${activeImport.jobId}`)}
                >
                  {t("actions.viewJob")}
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  loading={busy === "cancel"}
                  onClick={cancel}
                >
                  <X className="size-3.5" aria-hidden />
                  {t("actions.cancel")}
                </Button>
              </div>
            </div>
          </Callout>
        )}

        {resumable && !activeImport && (
          <Callout tone="warning" icon={RotateCcw} title={t("resumableTitle")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {t("resumableBody", {
                  jobId: resumable.jobId.slice(0, 8),
                  row: resumable.resumeIndex ?? 0,
                })}
              </span>
              <Button
                variant="outline"
                size="xs"
                loading={busy === "resume"}
                onClick={resume}
              >
                <RotateCcw className="size-3.5" aria-hidden />
                {t("actions.resume")}
              </Button>
            </div>
          </Callout>
        )}

        {/* --- Acciones rápidas --- */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" loading={busy === "inspect"} onClick={inspect}>
            <Search className="size-3.5" aria-hidden />
            {t("actions.inspect")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={busy === "quick-100"}
            disabled={Boolean(activeImport)}
            onClick={() => void startImport(100)}
          >
            <Download className="size-3.5" aria-hidden />
            {t("actions.import100")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={busy === "quick-1000"}
            disabled={Boolean(activeImport)}
            onClick={() => void startImport(1000)}
          >
            <Download className="size-3.5" aria-hidden />
            {t("actions.import1000")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            loading={busy === "match"}
            disabled={dataset.importedProducts === 0}
            onClick={() => void runTestMatch()}
          >
            <Target className="size-3.5" aria-hidden />
            {t("actions.testMatch")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMode(mode === "custom" ? "quick" : "custom")}
          >
            <Settings2 className="size-3.5" aria-hidden />
            {mode === "custom" ? t("actions.hideCustom") : t("actions.custom")}
          </Button>
        </div>

        {/* --- Importación personalizada --- */}
        {mode === "custom" && (
          <div className="space-y-3 rounded-lg border border-line bg-surface-sunken p-3">
            <SectionLabel>{t("customTitle")}</SectionLabel>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <Label htmlFor="ds-source">{t("fields.source")}</Label>
                <Select id="ds-source" value={source} onChange={(e) => setSource(e.target.value)}>
                  <option value="huggingface">HuggingFace</option>
                  <option value="kaggle">Kaggle ({t("fields.needsCredentials")})</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="ds-limit">{t("fields.limit")}</Label>
                <Input
                  id="ds-limit"
                  type="number"
                  min={1}
                  max={5000}
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="ds-offset">{t("fields.offset")}</Label>
                <Input
                  id="ds-offset"
                  type="number"
                  min={0}
                  value={offset}
                  onChange={(e) => setOffset(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="ds-batch">{t("fields.batchSize")}</Label>
                <Input
                  id="ds-batch"
                  type="number"
                  min={1}
                  max={100}
                  value={batchSize}
                  onChange={(e) => setBatchSize(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>{t("fields.categories")}</Label>
                <div className="mt-1 flex flex-wrap gap-1">
                  {MASTER_CATEGORIES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => toggle(categories, c, setCategories)}
                      className={`rounded border px-2 py-1 text-[11px] transition ${
                        categories.includes(c)
                          ? "border-brand bg-brand/10 text-brand-bright"
                          : "border-line text-ink-subtle hover:border-line-strong"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label>{t("fields.genders")}</Label>
                <div className="mt-1 flex flex-wrap gap-1">
                  {GENDERS.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => toggle(genders, g, setGenders)}
                      className={`rounded border px-2 py-1 text-[11px] transition ${
                        genders.includes(g)
                          ? "border-brand bg-brand/10 text-brand-bright"
                          : "border-line text-ink-subtle hover:border-line-strong"
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-[12px] text-ink-subtle">
                <input
                  type="checkbox"
                  checked={uploadImages}
                  onChange={(e) => setUploadImages(e.target.checked)}
                  className="accent-brand"
                />
                {t("fields.uploadImages")}
              </label>
              <label className="flex items-center gap-2 text-[12px] text-ink-subtle">
                <input
                  type="checkbox"
                  checked={generateEmbeddings}
                  onChange={(e) => setGenerateEmbeddings(e.target.checked)}
                  className="accent-brand"
                />
                {t("fields.generateEmbeddings")}
              </label>
            </div>

            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              <Button
                variant="outline"
                size="sm"
                loading={busy === "dry"}
                onClick={runDryRun}
              >
                <FlaskConical className="size-3.5" aria-hidden />
                {t("actions.dryRun")}
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={busy === "import"}
                disabled={Boolean(activeImport)}
                onClick={() => void startImport()}
              >
                <Play className="size-3.5" aria-hidden />
                {t("actions.runCustom")}
              </Button>
            </div>
          </div>
        )}

        {/* --- Resultado de inspeccionar --- */}
        {inspection && (
          <div className="rounded-lg border border-line p-3">
            <div className="mb-2 flex items-center justify-between">
              <SectionLabel>{t("inspectTitle")}</SectionLabel>
              <Button variant="ghost" size="xs" onClick={() => setInspection(null)}>
                <X className="size-3.5" aria-hidden />
                {tCommon("close")}
              </Button>
            </div>
            {inspection.reachable ? (
              <div className="space-y-1">
                <DataRow label={t("inspect.provider")}>{inspection.provider}</DataRow>
                <DataRow label={t("inspect.totalRows")} mono>
                  {inspection.totalRows?.toLocaleString("es-ES") ?? "—"}
                </DataRow>
                <DataRow label={t("inspect.version")} mono>
                  {inspection.version.slice(0, 12)}
                </DataRow>
                <DataRow label={t("inspect.size")} mono>
                  {inspection.sizeBytes
                    ? `${Math.round(inspection.sizeBytes / 1024 / 1024)} MB`
                    : "—"}
                </DataRow>
                <DataRow label={t("inspect.fields")}>
                  <span className="font-mono text-[10px]">
                    {Object.keys(inspection.features).join(", ")}
                  </span>
                </DataRow>
              </div>
            ) : (
              <Callout tone="danger" icon={AlertTriangle} title={t("inspect.unreachable")}>
                {inspection.unreachableReason}
              </Callout>
            )}
          </div>
        )}

        {/* --- Resultado del ensayo --- */}
        {dryRun && (
          <div className="rounded-lg border border-line p-3">
            <div className="mb-2 flex items-center justify-between">
              <SectionLabel>
                {t("dryRunTitle", { count: dryRun.limitApplied })}
              </SectionLabel>
              <Button variant="ghost" size="xs" onClick={() => setDryRun(null)}>
                <X className="size-3.5" aria-hidden />
                {tCommon("close")}
              </Button>
            </div>
            <Callout tone="info" icon={Check} title={t("dryRunNoWrite")}>
              {t("dryRunCounters", {
                read: dryRun.counters.rowsRead ?? 0,
                would: dryRun.counters.created ?? 0,
                skipped: dryRun.counters.skipped ?? 0,
                errors: dryRun.counters.errors ?? 0,
              })}
            </Callout>
            {dryRun.warnings.map((w) => (
              <p key={w} className="mt-2 text-[11px] text-warning">
                {w}
              </p>
            ))}
            <div className="mt-2 space-y-1">
              {dryRun.preview.slice(0, 5).map((p) => (
                <div
                  key={p.sourceProductId}
                  className="rounded border border-line bg-surface-sunken px-2 py-1.5"
                >
                  <p className="truncate text-[12px] text-ink">{p.title}</p>
                  <p className="text-[10px] text-ink-faint">
                    {t("dryRunRow", {
                      id: p.sourceProductId,
                      brand: p.brand ?? t("brandNotVerifiable"),
                      category: p.category ?? "—",
                      color: p.color ?? "—",
                    })}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
        {/* --- Resultado de la prueba de matching --- */}
        {testMatch && (
          <div className="rounded-lg border border-line p-3">
            <div className="mb-2 flex items-center justify-between">
              <SectionLabel>{t("matchTitle")}</SectionLabel>
              <Button variant="ghost" size="xs" onClick={() => setTestMatch(null)}>
                <X className="size-3.5" aria-hidden />
                {tCommon("close")}
              </Button>
            </div>

            {/* El veredicto honesto: ¿se encuentra a sí mismo? */}
            <Callout
              tone={testMatch.selfFoundAtRank === 1 ? "success" : testMatch.selfFoundAtRank ? "warning" : "danger"}
              icon={testMatch.selfFoundAtRank === 1 ? Check : AlertTriangle}
              title={
                testMatch.selfFoundAtRank
                  ? t("matchSelfFound", { rank: testMatch.selfFoundAtRank })
                  : t("matchSelfMissing")
              }
            >
              {t("matchExplain")}
            </Callout>

            {!testMatch.productionGradeEmbeddings && (
              <Callout tone="warning" icon={AlertTriangle} title={t("matchHashWarningTitle")}>
                {t("matchHashWarningBody")}
              </Callout>
            )}

            <div className="mt-2 flex items-start gap-3">
              {testMatch.target.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={testMatch.target.image}
                  alt={testMatch.target.title}
                  className="size-20 shrink-0 rounded-lg border border-line object-cover"
                />
              )}
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-ink">{testMatch.target.title}</p>
                <p className="text-[11px] text-ink-subtle">
                  {t("matchTargetMeta", {
                    id: testMatch.target.sourceProductId,
                    category: testMatch.target.category ?? "—",
                    provider: testMatch.target.embeddingProvider ?? "—",
                    dimension: testMatch.target.embeddingDimension ?? 0,
                  })}
                </p>
              </div>
            </div>

            <div className="mt-2 space-y-1">
              {testMatch.matches.map((m, i) => (
                <div
                  key={m.productId}
                  className={`flex items-center gap-2 rounded border px-2 py-1.5 ${
                    m.productId === testMatch.target.productId
                      ? "border-success/40 bg-success/5"
                      : "border-line bg-surface-sunken"
                  }`}
                >
                  <span className="w-5 shrink-0 font-mono text-[10px] text-ink-faint">
                    {i + 1}
                  </span>
                  <Badge tone={m.finalScore > 0.82 ? "success" : "warning"} size="sm">
                    {Math.round(m.finalScore * 100)}%
                  </Badge>
                  <Badge tone="neutral" size="sm">
                    {m.matchStage}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-ink">{m.title}</span>
                  {/* Sin URL de compra: es catálogo demo, no una tienda. */}
                  {m.isDemoProduct && (
                    <Badge tone="brand" size="sm">
                      {t("demoBadge")}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
