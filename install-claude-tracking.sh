#!/usr/bin/env bash
# ArchPrime — Claude Code activity tracking installer.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/ArchPrime-official/PrimeSquads-primeteam-ops/main/install-claude-tracking.sh | bash
#
# What it does:
#   1. Asks (or detects via git) your company email
#   2. Calls enroll-claude-tracking edge function → gets HMAC token + endpoint
#   3. Saves config at ~/.claude/.archprime-config.json
#   4. Downloads hook to ~/.claude/hooks/log-claude-activity.cjs
#   5. Wires hook into ~/.claude/settings.json (UserPromptSubmit/PostToolUse/SessionStart/Stop)
#
# Safe to re-run. Merges into existing settings.json instead of overwriting.

set -euo pipefail

readonly SUPABASE_URL="https://xmqmuxwlecjbpubjdkoj.supabase.co"
readonly SUPABASE_ANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhtcW11eHdsZWNqYnB1Ympka29qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNzQzNzAsImV4cCI6MjA4Nzk1MDM3MH0.fzHfYzJNeCUnG6DjoHYPPbUg3Q1paMPGaDruiDGe1MU"
readonly REPO_RAW="https://raw.githubusercontent.com/ArchPrime-official/PrimeSquads-primeteam-ops/main"

CLAUDE_DIR="$HOME/.claude"
HOOK_DIR="$CLAUDE_DIR/hooks"
CONFIG_FILE="$CLAUDE_DIR/.archprime-config.json"
HOOK_FILE="$HOOK_DIR/log-claude-activity.cjs"
SETTINGS_FILE="$CLAUDE_DIR/settings.json"

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
ok()    { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn()  { printf '\033[33m!\033[0m %s\n' "$*"; }
err()   { printf '\033[31m✗\033[0m %s\n' "$*" >&2; }

bold "ArchPrime · Claude Code activity tracking"
echo

# 1. Pre-flight checks
command -v node >/dev/null 2>&1 || { err "Node.js não encontrado. Instale Node 18+."; exit 1; }
command -v curl >/dev/null 2>&1 || { err "curl não encontrado."; exit 1; }
mkdir -p "$HOOK_DIR"

# 2. Resolve email
EMAIL="${ARCHPRIME_EMAIL:-}"
if [ -z "$EMAIL" ]; then
  GIT_EMAIL="$(git config --global user.email 2>/dev/null || true)"
  if [ -n "$GIT_EMAIL" ]; then
    printf 'Email da empresa [%s]: ' "$GIT_EMAIL"
  else
    printf 'Email da empresa: '
  fi
  if [ -t 0 ]; then
    read -r INPUT
  else
    INPUT=""
    warn "Sem TTY — usando git config"
  fi
  EMAIL="${INPUT:-$GIT_EMAIL}"
fi

if [ -z "$EMAIL" ]; then
  err "Email não informado."
  exit 1
fi

bold "→ Registrando $EMAIL..."

# 3. Call enroll endpoint
RESPONSE=$(curl -fsS -X POST "$SUPABASE_URL/functions/v1/enroll-claude-tracking" \
  -H "Content-Type: application/json" \
  -H "apikey: $SUPABASE_ANON" \
  -H "Authorization: Bearer $SUPABASE_ANON" \
  -d "{\"email\":\"$EMAIL\"}" 2>&1) || {
    err "Falha no enrollment:"
    echo "$RESPONSE" | sed 's/^/  /'
    err "Verifique seu email ou peça ao admin para criar seu profile."
    exit 1
}

# 4. Build config (merges with existing config if present, to preserve other tenants)
EXISTING_CONFIG="{}"
[ -f "$CONFIG_FILE" ] && EXISTING_CONFIG="$(cat "$CONFIG_FILE")"

CONFIG_JSON=$(node -e "
const incoming = $RESPONSE;
const existing = $EXISTING_CONFIG;
const tenants = Array.isArray(existing.tenants) ? existing.tenants : [];
const filtered = tenants.filter(t => t.name !== incoming.tenant);
filtered.push({
  name: incoming.tenant,
  endpoint: incoming.endpoint,
  token: incoming.token,
  user_id: incoming.user_id,
  apikey: '$SUPABASE_ANON',
  path_regex: incoming.path_regex,
});
const merged = {
  user_email: incoming.email,
  full_name: incoming.full_name || existing.full_name || null,
  OPT_OUT_PROMPT: existing.OPT_OUT_PROMPT === 1 ? 1 : 0,
  tenants: filtered,
};
process.stdout.write(JSON.stringify(merged, null, 2));
") || { err "Falha ao construir config"; exit 1; }

printf '%s\n' "$CONFIG_JSON" > "$CONFIG_FILE"
chmod 600 "$CONFIG_FILE"
ok "Config gravada em $CONFIG_FILE"

# 5. Download hook
curl -fsS "$REPO_RAW/hooks/log-claude-activity.cjs" -o "$HOOK_FILE" || {
  err "Falha ao baixar hook script"
  exit 1
}
chmod +x "$HOOK_FILE"
ok "Hook baixado em $HOOK_FILE"

# 6. Merge into ~/.claude/settings.json
node -e "
const fs = require('fs');
const path = require('path');
const SETTINGS = '$SETTINGS_FILE';
const HOOK = '$HOOK_FILE';

let settings = {};
try { settings = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch {}
settings.hooks = settings.hooks || {};

const events = ['UserPromptSubmit', 'PostToolUse', 'SessionStart', 'Stop', 'Notification', 'PreCompact', 'SubagentStop'];
const cmd = 'node ' + HOOK;

for (const ev of events) {
  settings.hooks[ev] = Array.isArray(settings.hooks[ev]) ? settings.hooks[ev] : [];
  const exists = settings.hooks[ev].some((entry) => {
    const arr = Array.isArray(entry?.hooks) ? entry.hooks : [];
    return arr.some((h) => typeof h?.command === 'string' && h.command.includes('log-claude-activity.cjs'));
  });
  if (!exists) {
    settings.hooks[ev].push({ hooks: [{ type: 'command', command: cmd }] });
  }
}

fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2));
console.log('OK');
" || { err "Falha ao registrar hook em settings.json"; exit 1; }

ok "Hook registrado em $SETTINGS_FILE"

echo
bold "✓ Pronto!"
echo
echo "  Tracking ativo em:"
node -e "
const c = require('$CONFIG_FILE');
for (const t of c.tenants) console.log('    · ' + t.name + ' → ' + t.path_regex);
"
echo
echo "  Para desativar prompts (manter apenas metadata):"
echo "    edite $CONFIG_FILE  →  \"OPT_OUT_PROMPT\": 1"
echo
echo "  Para remover tudo:"
echo "    rm $CONFIG_FILE $HOOK_FILE  (e remova entradas em $SETTINGS_FILE)"
echo
