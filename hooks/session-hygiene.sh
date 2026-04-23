#!/bin/bash
# session-hygiene.sh
#
# Hook Claude Code (UserPromptSubmit) que detecta sessões longas e dispara
# avisos amigáveis. Baseado em Claude Code idle-management patterns.
#
# Lê do stdin o JSON do Claude Code (inclui session_id). Grava o timestamp
# de início em ~/.claude/session-state/<id>.start. A cada UserPromptSubmit,
# recalcula e emite aviso se bater em algum gatilho:
#
#   - 2h de sessão contínua   → informativo leve
#   - 4h                      → sugere /compact + pausa
#   - após 23h hora local     → sugere parar e continuar amanhã
#   - após 0h (meia-noite)    → bloqueio suave (pede "sigo" para continuar)
#   - virada de data          → neutro, só menciona "virou o dia"
#
# Cada aviso dispara UMA VEZ por sessão (marca em <id>.warned).
#
# Silencioso em caso de erro — NUNCA bloquear o prompt do usuário.
# Para pular: export PTO_SKIP_HYGIENE=1

set -euo pipefail

# Opt-out para contextos automatizados
if [ "${PTO_SKIP_HYGIENE:-0}" = "1" ] || [ "${CI:-}" = "true" ]; then
  exit 0
fi

# Ler o JSON do stdin
INPUT=$(cat)

# Extrair session_id; se jq não está instalado, degradamos silenciosamente
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
if [ -z "$SESSION_ID" ]; then
  exit 0
fi

STATE_DIR="$HOME/.claude/session-state"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

START_FILE="$STATE_DIR/$SESSION_ID.start"
WARN_FILE="$STATE_DIR/$SESSION_ID.warned"
DATE_FILE="$STATE_DIR/$SESSION_ID.date"

NOW=$(date +%s)
HOUR=$(date +%H)
TODAY=$(date +%Y-%m-%d)

# Grava timestamp inicial no primeiro run
if [ ! -f "$START_FILE" ]; then
  echo "$NOW" > "$START_FILE"
  echo "$TODAY" > "$DATE_FILE"
  exit 0
fi

START=$(cat "$START_FILE" 2>/dev/null || echo "$NOW")
PREV_DATE=$(cat "$DATE_FILE" 2>/dev/null || echo "$TODAY")

ELAPSED=$(( NOW - START ))
HOURS=$(( ELAPSED / 3600 ))

touch "$WARN_FILE"

# Emite aviso no formato que o Claude Code entende
emit() {
  local msg="$1"
  jq -n --arg msg "$msg" '{
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: $msg
    }
  }'
  exit 0
}

# 1) Virada de data (neutro, informativo)
if [ "$TODAY" != "$PREV_DATE" ]; then
  echo "$TODAY" > "$DATE_FILE"
  if ! grep -q "date_rollover" "$WARN_FILE" 2>/dev/null; then
    echo "date_rollover" >> "$WARN_FILE"
    emit "[session-hygiene] Virou o dia — hoje é $TODAY. Você começou a sessão em $PREV_DATE."
  fi
fi

# 2) Meia-noite — bloqueio suave
if [ "$HOUR" -lt "06" ] && [ "$HOUR" != "00" ] 2>/dev/null && ! grep -q "midnight_hard" "$WARN_FILE" 2>/dev/null; then
  :
fi
if { [ "$HOUR" = "00" ] || [ "$HOUR" = "01" ] || [ "$HOUR" = "02" ] || [ "$HOUR" = "03" ] || [ "$HOUR" = "04" ]; } && ! grep -q "midnight_hard" "$WARN_FILE" 2>/dev/null; then
  echo "midnight_hard" >> "$WARN_FILE"
  emit "[session-hygiene] Passou da meia-noite. Considere salvar com /compact e continuar amanhã — dormir cedo melhora o trabalho de amanhã. Se for crítico continuar agora, tudo bem."
fi

# 3) 23h local — sugestão empática (só uma vez)
if [ "$HOUR" = "23" ] && ! grep -q "late_night" "$WARN_FILE" 2>/dev/null; then
  echo "late_night" >> "$WARN_FILE"
  emit "[session-hygiene] Já passa das 23h. Descansar hoje ajuda o trabalho de amanhã — se puder parar por hoje, vale a pena."
fi

# 4) 4h de sessão contínua — sugere /compact
if [ "$HOURS" -ge 4 ] && ! grep -q "4h" "$WARN_FILE" 2>/dev/null; then
  echo "4h" >> "$WARN_FILE"
  emit "[session-hygiene] Você está há 4h nesta sessão. Bom momento para rodar /compact (libera contexto) + uma pausa curta — volta mais nítido."
fi

# 5) 2h de sessão contínua — informativo leve
if [ "$HOURS" -ge 2 ] && ! grep -q "2h" "$WARN_FILE" 2>/dev/null; then
  echo "2h" >> "$WARN_FILE"
  emit "[session-hygiene] Você está há 2h nesta sessão. Tudo bem por aí?"
fi

exit 0
