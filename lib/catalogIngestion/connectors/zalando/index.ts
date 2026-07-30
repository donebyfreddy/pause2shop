import { ScaffoldConnector } from "../base/BaseConnector";
import type { FetchFn } from "../base/httpClient";
import { EUROPE_SOURCES } from "../sources/europe";

const SPEC = EUROPE_SOURCES.find((s) => s.id === "zalando")!;

/**
 * Conector Zalando — RESERVADO, requiere Zalando Partner API.
 *
 * Zalando protege el catálogo con challenge anti-bot agresivo, así que el
 * scraping queda descartado por diseño. La vía legítima es la Partner API
 * (OAuth con credenciales de partner); aquí irá su cliente cuando existan.
 */
export class ZalandoConnector extends ScaffoldConnector {
  constructor(fetchFn?: FetchFn) {
    super(SPEC, fetchFn);
  }
}
