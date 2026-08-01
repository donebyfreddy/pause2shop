import "server-only";
import { headers } from "next/headers";
import { SITE_URL } from "@/lib/seo";

function firstForwardedValue(value: string | null): string | null {
  return value?.split(",")[0]?.trim() || null;
}

/** Resolve absolute metadata URLs from the host that serves the current request. */
export async function requestMetadataBase(): Promise<URL> {
  const requestHeaders = await headers();
  const host =
    firstForwardedValue(requestHeaders.get("x-forwarded-host")) ??
    firstForwardedValue(requestHeaders.get("host"));
  const safeHost =
    host && /^(?:\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/i.test(host)
      ? host
      : null;

  if (!safeHost) return new URL(SITE_URL);

  const forwardedProtocol = firstForwardedValue(
    requestHeaders.get("x-forwarded-proto")
  );
  const protocol =
    forwardedProtocol === "http" || forwardedProtocol === "https"
      ? forwardedProtocol
      : /^(localhost|127\.0\.0\.1)(:|$)/.test(safeHost)
        ? "http"
        : "https";

  return new URL(`${protocol}://${safeHost}`);
}

export function socialCardUrl(metadataBase: URL): string {
  return new URL("/og.png", metadataBase).toString();
}
