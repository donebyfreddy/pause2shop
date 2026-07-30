import { NextResponse } from "next/server";

import { describeConnection } from "@/lib/db";
import { isDatabaseConfigured, getPool } from "@/lib/db/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Migraciones esperadas: db/migrations tiene 7 ficheros .sql. */
const EXPECTED_MIGRATIONS = 7;

/**
 * GET /api/health/database — estado de la base de datos (Neon) SIN exponer
 * usuario, contraseña ni la connection string. Distingue tres cosas que en
 * producción se confunden mucho:
 *
 *   · no configurada      → DATABASE_URL ausente o no es postgres://
 *   · inalcanzable        → hay URL pero la conexión falla
 *   · alcanzable a medias → conecta pero faltan migraciones
 *
 * Del host solo se devuelve el nombre (no lleva credenciales) porque saber a
 * QUÉ rama de Neon está apuntando un deploy es justo el dato que hace falta
 * cuando "los datos no aparecen".
 */
export async function GET() {
  const connection = describeConnection();

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        configured: false,
        reachable: false,
        migrationsUpToDate: false,
        driver: "postgres",
        detail:
          "DATABASE_URL ausente o no es una cadena postgres://. Se usa el " +
          "catálogo en memoria. Copia la connection string del endpoint " +
          "-pooler desde Neon → Connect.",
      },
      { status: 503 }
    );
  }

  try {
    const pool = getPool();
    const startedAt = Date.now();
    const applied = await pool.query<{ count: string }>(
      // to_regclass evita que un esquema sin migrar reviente con "relation
      // does not exist": devuelve null y lo tratamos como 0 aplicadas.
      `select coalesce(
         (select count(*)::text from _catalog_migrations
          where to_regclass('_catalog_migrations') is not null),
         '0'
       ) as count`
    );
    const latencyMs = Date.now() - startedAt;
    const migrationsApplied = Number(applied.rows[0]?.count ?? 0);
    const migrationsUpToDate = migrationsApplied >= EXPECTED_MIGRATIONS;

    return NextResponse.json(
      {
        configured: true,
        reachable: true,
        migrationsUpToDate,
        migrationsApplied,
        migrationsExpected: EXPECTED_MIGRATIONS,
        driver: "postgres",
        latencyMs,
        host: connection?.host ?? null,
        database: connection?.database ?? null,
        provider: connection?.isNeon ? "neon" : "postgres",
        pooled: connection?.pooled ?? null,
        detail: migrationsUpToDate
          ? null
          : `Solo ${migrationsApplied}/${EXPECTED_MIGRATIONS} migraciones ` +
            "aplicadas. Ejecuta `npm run db:migrate`.",
      },
      { status: migrationsUpToDate ? 200 : 503 }
    );
  } catch (err) {
    // No filtramos la connection string; solo el tipo de fallo.
    const name = err instanceof Error ? err.name : "Error";
    return NextResponse.json(
      {
        configured: true,
        reachable: false,
        migrationsUpToDate: false,
        driver: "postgres",
        host: connection?.host ?? null,
        provider: connection?.isNeon ? "neon" : "postgres",
        detail: `No se pudo conectar (${name}). Revisa host, contraseña y SSL de la connection string.`,
      },
      { status: 503 }
    );
  }
}
