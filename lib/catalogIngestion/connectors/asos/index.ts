import { ScaffoldConnector } from "../base/BaseConnector";
import type { FetchFn } from "../base/httpClient";
import { EUROPE_SOURCES } from "../sources/europe";

const SPEC = EUROPE_SOURCES.find((s) => s.id === "asos")!;

/**
 * Conector ASOS — RESERVADO, requiere acceso de partner/afiliación.
 *
 * ASOS no publica JSON-LD Product completo en las fichas y su catálogo se
 * sirve vía API interna (api.asos.com) cuyo uso no está autorizado para
 * scraping. La vía legítima es el feed de producto de su programa de
 * afiliación: con `ASOS_AFFILIATE_FEED_URL` configurada, la implementación
 * pasa a leer el feed — nunca la web.
 *
 * Se mantiene como clase propia (en lugar de un ScaffoldConnector genérico)
 * porque es donde irá el parser del feed cuando lleguen las credenciales.
 */
export class AsosConnector extends ScaffoldConnector {
  constructor(fetchFn?: FetchFn) {
    super(SPEC, fetchFn);
  }
}
