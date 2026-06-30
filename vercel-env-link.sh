#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-.env}"
TARGETS="${TARGETS:-production preview development}"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ No existe $ENV_FILE"
  exit 1
fi

# Detect CLI
if command -v vercel >/dev/null 2>&1; then
  VERCEL="vercel"
else
  VERCEL="npx --yes vercel@latest"
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔗 Vercel auto link + env upload"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ----------------------------------------------------------
# 1. AUTO LINK (NO PROJECT NAME REQUIRED)
# ----------------------------------------------------------

if [ ! -f ".vercel/project.json" ]; then
  echo "📦 Linking project automatically..."

  $VERCEL link --yes

  echo "✅ Linked"
else
  echo "✅ Already linked"
fi

# ----------------------------------------------------------
# 2. OPTIONAL PULL (sync project)
# ----------------------------------------------------------

echo "📡 Syncing project..."
$VERCEL pull --yes || true

# ----------------------------------------------------------
# 3. PARSE .ENV
# ----------------------------------------------------------

python3 - "$ENV_FILE" <<'PY' > /tmp/env_pairs.txt
import sys, re

file = sys.argv[1]
key_re = re.compile(r"^[A-Z0-9_]+$", re.I)

def clean(v):
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in ("'", '"'):
        return v[1:-1]
    return v

with open(file) as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue

        k, v = line.split("=", 1)
        k, v = k.strip(), clean(v.strip())

        if key_re.match(k):
            print(f"{k}|||{v}")
PY

# ----------------------------------------------------------
# 4. UPLOAD ENV
# ----------------------------------------------------------

COUNT=0

while IFS="|||" read -r KEY VALUE; do
  [ -z "$KEY" ] && continue

  COUNT=$((COUNT+1))

  TMP=$(mktemp)
  printf "%s" "$VALUE" > "$TMP"

  for TARGET in $TARGETS; do
    echo "⬆️  $KEY -> $TARGET"
    $VERCEL env add "$KEY" "$TARGET" --force < "$TMP" || true
  done

  rm -f "$TMP"
done < /tmp/env_pairs.txt

rm -f /tmp/env_pairs.txt

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ DONE"
echo "Variables processed: $COUNT"
echo ""
echo "👉 Deploy:"
echo "   vercel --prod"