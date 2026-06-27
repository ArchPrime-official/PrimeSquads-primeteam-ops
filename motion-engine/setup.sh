#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# setup.sh — Prepara o motion-engine numa máquina nova (roda 1x por funcionário).
# Instala/verifica as dependências: ffmpeg + playwright (chromium).
# Rodar a partir da raiz do PrimeTeam:  bash motion-engine/setup.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e
echo "▶ motion-engine setup"

# 1. ffmpeg
if command -v ffmpeg >/dev/null 2>&1; then
  echo "  ✓ ffmpeg: $(ffmpeg -version | head -1 | cut -d' ' -f3)"
else
  echo "  ⏳ instalando ffmpeg..."
  if command -v brew >/dev/null 2>&1; then brew install ffmpeg;
  else echo "  ✗ instale ffmpeg manualmente (https://ffmpeg.org/download.html)"; exit 1; fi
fi

# 2. playwright + chromium (resolvido a partir do node_modules do PrimeTeam)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if node -e "require('playwright')" >/dev/null 2>&1; then
  echo "  ✓ playwright instalado"
else
  echo "  ⏳ instalando playwright..."; npm i playwright --no-save
fi
echo "  ⏳ garantindo chromium..."; npx playwright install chromium >/dev/null 2>&1 && echo "  ✓ chromium pronto"

# 3. smoke rápido (render de 1 preset existente → MP4)
echo "▶ smoke test (render scene-planning)..."
node motion-engine/scripts/render-motion.mjs motion-engine/clips/planning.json >/dev/null 2>&1 \
  && echo "  ✓ render OK — motion-engine pronto!" \
  || echo "  ✗ render falhou — verifique as deps acima"

echo ""
echo "Pronto. Para animar uma tela:"
echo "  node motion-engine/scripts/render-motion.mjs motion-engine/clips/<tela>.json"
echo "Para gravar um fluxo (pergunta o PrimeVoice):"
echo "  node motion-engine/scripts/flow-runner.mjs motion-engine/flows/render-image-generation.json"
echo ""
echo "Nota: capture-ground-truth.mjs e seed-demo-data.mjs exigem SUPABASE_ACCESS_TOKEN (admin)."
