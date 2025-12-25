#!/usr/bin/env bash
set -e

OUT_FILE=".env"

echo "Este script grava as credenciais necessárias em $OUT_FILE (permissão 600)."
read -p "Insira seu ROBLOX_BEARER (token): " -r ROBLOX_BEARER
if [ -z "$ROBLOX_BEARER" ]; then
  echo "Token vazio; abortando." >&2
  exit 1
fi

cat > "$OUT_FILE" <<EOF
ROBLOX_BEARER="$ROBLOX_BEARER"
# Adicione outras variáveis conforme necessário
EXPERIENCE_SECRET=
ASSET_TYPE=13
OUT_DIR=./out
AUTO_PUBLISH=false
EOF

chmod 600 "$OUT_FILE"
echo "Gravado em $OUT_FILE com permissão 600. Reinicie o serviço ou exporte as variáveis no ambiente atual:"
echo "  export \\$(sed -n 's/"//g; /^#/d; s/=/="/; s/$/"/; p' $OUT_FILE | tr '\n' ' ' )"
