#!/usr/bin/env bash
set -euo pipefail

# Sube las variables de un fichero .env al proyecto de Vercel.
#
#   ./vercel-env-link.sh [fichero]          # por defecto .env
#   TARGETS="production" ./vercel-env-link.sh
#
# OJO con el fichero de origen: por defecto es `.env`, NO `.env.local`.
# `.env.local` es el que escribe `vercel env pull`, así que usarlo como origen
# monta un bucle en el que cualquier basura que ya esté en Vercel se re-sube.
#
# ------------------------------------------------------------------------------
# HISTORIA DE UN BUG, PARA QUE NO VUELVA
#
# La versión anterior separaba clave y valor con:
#
#     while IFS="|||" read -r KEY VALUE; do
#
# En bash `IFS` es un CONJUNTO DE CARACTERES, no un separador de varios
# caracteres: `IFS="|||"` es exactamente igual que `IFS="|"`. Al leer
# `CLAVE|||valor`, el primer `|` separa, los otros dos generan campos vacíos y,
# como VALUE es la última variable, se queda con el resto INCLUIDOS los
# delimitadores → `VALUE="||valor"`.
#
# Resultado: se subieron 131 variables con el prefijo `||` (`||true`,
# `||sk-proj-…`, `||postgresql://…`). Como `.env.local` se regenera con
# `vercel env pull`, la corrupción volvió al disco y de ahí a la app, donde
# `SCRAPER_AI_ENABLED="||true"` se evalúa como false y una connection string
# `||postgresql://…` no pasa el check de `postgres://`.
#
# Ahora el separador es un TAB y se lee con `IFS=$'\t'`, que sí es un único
# carácter. No cambies esto por un separador de varios caracteres.
# ------------------------------------------------------------------------------

ENV_FILE="${1:-.env}"
TARGETS="${TARGETS:-production preview development}"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ No existe $ENV_FILE"
  exit 1
fi

# La CLI tiene que ser >= 58. En la 54, `env add … preview` NO acepta el valor
# por stdin: contesta `action_required / git_branch_required` y exige
# `--value <valor>`, que dejaría el secreto visible en `ps`. Con la 58 el stdin
# funciona y el valor no pasa nunca por argv.
MIN_CLI_MAJOR=58
VERCEL="npx --yes vercel@latest"

if command -v vercel >/dev/null 2>&1; then
  CLI_MAJOR="$(vercel --version 2>/dev/null | head -1 | sed -E 's/[^0-9]*([0-9]+).*/\1/')"
  if [ -n "$CLI_MAJOR" ] && [ "$CLI_MAJOR" -ge "$MIN_CLI_MAJOR" ] 2>/dev/null; then
    VERCEL="vercel"
  else
    echo "ℹ️  vercel CLI v${CLI_MAJOR:-?} es < $MIN_CLI_MAJOR: se usa npx vercel@latest."
    echo "   (Para acelerarlo: npm i -g vercel@latest)"
  fi
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔗 Vercel env upload — origen: $ENV_FILE"
echo "   destinos: $TARGETS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ----------------------------------------------------------
# 1. LINK
# ----------------------------------------------------------
if [ ! -f ".vercel/project.json" ]; then
  echo "📦 Linking project…"
  $VERCEL link --yes
else
  echo "✅ Ya enlazado"
fi

# ----------------------------------------------------------
# 2. PARSE
# ----------------------------------------------------------
# Los pares van a un fichero temporal con permisos 600 y se borra al salir
# (incluso si el script falla): lleva secretos en claro. La versión anterior
# usaba /tmp/env_pairs.txt, una ruta fija y legible por cualquier usuario.
PAIRS="$(mktemp "${TMPDIR:-/tmp}/vercel-env-pairs.XXXXXX")"
chmod 600 "$PAIRS"
trap 'rm -f "$PAIRS"' EXIT INT TERM

python3 - "$ENV_FILE" <<'PY' > "$PAIRS"
import sys, re

path = sys.argv[1]
key_re = re.compile(r"^[A-Za-z0-9_]+$")

def clean(v):
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in ("'", '"'):
        v = v[1:-1]
    return v

skipped_empty, skipped_bad = [], []
with open(path) as f:
    for raw in f:
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k, v = k.strip(), clean(v)
        if not key_re.match(k):
            skipped_bad.append(k)
            continue
        if v == "":
            # Una variable vacía en Vercel no es lo mismo que ausente y
            # `vercel env add` con stdin vacío falla. Mejor no subirla.
            skipped_empty.append(k)
            continue
        if "\t" in v or "\n" in v:
            skipped_bad.append(k)
            continue
        print(f"{k}\t{v}")

for k in skipped_empty:
    print(f"·  vacía, no se sube: {k}", file=sys.stderr)
for k in skipped_bad:
    print(f"!  clave/valor no soportado, no se sube: {k}", file=sys.stderr)
PY

TOTAL=$(wc -l < "$PAIRS" | tr -d ' ')
echo "📄 $TOTAL variable(s) con valor a subir"
echo ""

# ----------------------------------------------------------
# 3. UPLOAD
# ----------------------------------------------------------
OK=0
FAILED=""

# `IFS=$'\t'` — UN carácter. Ver la historia del bug arriba.
while IFS=$'\t' read -r KEY VALUE; do
  [ -z "${KEY:-}" ] && continue

  for TARGET in $TARGETS; do
    # El valor va por una tubería, no por un fichero ni por argv: así no
    # aparece en `ps` ni queda en disco. Nunca se imprime el valor.
    if printf '%s' "$VALUE" | $VERCEL env add "$KEY" "$TARGET" --force >/dev/null 2>&1; then
      echo "⬆️  $KEY → $TARGET"
      OK=$((OK+1))
    else
      echo "❌ $KEY → $TARGET"
      FAILED="$FAILED $KEY:$TARGET"
    fi
  done
done < "$PAIRS"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ $OK subida(s) correcta(s)"
if [ -n "$FAILED" ]; then
  echo "❌ Fallos:$FAILED"
  echo ""
  echo "👉 Revisa lo de arriba antes de desplegar."
  exit 1
fi
echo ""
echo "👉 Despliega:  vercel --prod"
