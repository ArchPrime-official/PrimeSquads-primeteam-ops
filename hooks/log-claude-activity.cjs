#!/usr/bin/env node
/**
 * ArchPrime — Claude Code Activity Logger Hook
 *
 * Multi-tenant hook that captures Claude Code events (UserPromptSubmit,
 * PostToolUse, SessionStart, Stop, Notification) and posts them to the
 * `log-claude-event` edge function of the matching tenant (ArchPrime, Lovarch...).
 *
 * Configuration: ~/.claude/.archprime-config.json (created by install-claude-tracking.sh).
 * Wire-up: ~/.claude/settings.json hook entries (also created by installer).
 *
 * Behavior:
 *  - Reads event JSON from stdin (Claude Code hook protocol).
 *  - Resolves tenant via path_regex match against process.cwd() / event.cwd.
 *  - Sanitizes secrets (sk_, sbp_, JWT, AKIA, ghp_, xoxb_, password=...).
 *  - Truncates each string at 4000 chars; total payload at ~32KB.
 *  - Fire-and-forget POST with hard 1.5s timeout. Never blocks Claude Code.
 *  - Exits 0 always (failures must NOT break the user's workflow).
 *
 * Squad hierarchy (since 2026-05-14):
 *  - Detects active sub-squad via slash command in UserPromptSubmit
 *    (`/PrimeteamOps`, `/creativeStudio`, `/stratMgmt`, `/metaAds`, `/ptImprove`)
 *    or repository path heuristics (squads/<name>/).
 *  - Generates cycle_id (UUID v4) per Claude Code session, persisted in
 *    ~/.claude/.archprime-cycle-{sessionId}.json. Lifetime = session.
 *  - Detects cross_squad: if 2+ different sub_squads logged in same cycle,
 *    flips cross_squad=true on subsequent events.
 *  - Sends parent_squad/sub_squad/cycle_id/cross_squad in body root for
 *    log-claude-event v1.1.0+ (older versions ignore unknown keys).
 *
 * Opt-out: set `OPT_OUT_PROMPT=1` in ~/.claude/.archprime-config.json
 *          to drop the raw prompt body and tool inputs (metadata still logged).
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const http = require('node:http');
const crypto = require('node:crypto');

// Hard exit safety net: if anything goes wrong, never break Claude Code.
process.on('uncaughtException', () => process.exit(0));
process.on('unhandledRejection', () => process.exit(0));

const CONFIG_PATH = path.join(os.homedir(), '.claude', '.archprime-config.json');
const REQUEST_TIMEOUT_MS = 1500;
const MAX_STRING = 4000;
const MAX_BYTES = 32_000;

const SECRET_PATTERNS = [
  [/sk_(?:test|live)_[A-Za-z0-9]{16,}/g, 'sk_[REDACTED]'],
  [/sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/g, 'sk-[REDACTED]'],
  [/sbp_[A-Za-z0-9]{32,}/g, 'sbp_[REDACTED]'],
  [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, '[REDACTED_JWT]'],
  [/AKIA[0-9A-Z]{16}/g, '[REDACTED_AWS_KEY]'],
  [/ghp_[A-Za-z0-9]{36}/g, '[REDACTED_GH_TOKEN]'],
  [/xoxb-[A-Za-z0-9-]{20,}/g, '[REDACTED_SLACK]'],
  [/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]'],
];

// ─── Squad detection ─────────────────────────────────────────────
// Mapping de slash command (ou alias) → sub_squad name.
// Slash commands são case-insensitive. Aliases legacy (videoCreative)
// mapeiam para sub_squad atual (creative-studio).
const SLASH_TO_SUB_SQUAD = {
  // creative-studio + alias legacy
  'creativestudio': 'creative-studio',
  'videocreative': 'creative-studio',
  // strategic-management
  'stratmgmt': 'strategic-management',
  // meta-ads
  'metaads': 'meta-ads',
  // primeteam-improve
  'ptimprove': 'primeteam-improve',
  // primeteam-ops é root — quando invocado direto, NÃO popula sub_squad
  // (o ops-chief é orchestrator, não sub-chief).
  'primeteamops': null,
};

const SUB_SQUAD_FROM_PATH = [
  // Heurística por path: squads/<name>/
  [/squads\/creative-studio\b/i, 'creative-studio'],
  [/squads\/video-creative\b/i, 'creative-studio'], // legacy folder
  [/squads\/strategic-management\b/i, 'strategic-management'],
  [/squads\/meta-ads\b/i, 'meta-ads'],
  [/squads\/primeteam-improve\b/i, 'primeteam-improve'],
];

/**
 * Extrai sub_squad de um prompt do user, procurando por slash command.
 * Retorna null se nenhum slash command de sub-squad encontrado.
 *
 * Formatos aceitos:
 *  /creativeStudio
 *  /creativeStudio:agents:ai-strategist
 *  /PrimeteamOps:agents:ops-chief
 */
function detectSubSquadFromPrompt(prompt) {
  if (typeof prompt !== 'string') return null;
  const m = prompt.match(/(?:^|\s)\/([A-Za-z][A-Za-z0-9_-]*)/);
  if (!m) return null;
  const slash = m[1].toLowerCase();
  return SLASH_TO_SUB_SQUAD.hasOwnProperty(slash) ? SLASH_TO_SUB_SQUAD[slash] : null;
}

/**
 * Heurística secundária: detectar sub_squad por path do cwd ou tool_input.file_path.
 * Útil quando user edita arquivo dentro de squads/<name>/ sem invocar slash.
 */
function detectSubSquadFromPath(text) {
  if (typeof text !== 'string') return null;
  for (const [re, name] of SUB_SQUAD_FROM_PATH) {
    if (re.test(text)) return name;
  }
  return null;
}

// ─── Cycle state per Claude Code session ─────────────────────────
// Stored as ~/.claude/.archprime-cycle-{sessionId}.json
// Lifetime: cleared on Stop/SessionEnd events; lingering files cleaned by
// garbage collector after 24h staleness.

function cycleStatePath(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return null;
  // Sanitize sessionId — só [a-z0-9-] permitido (já é UUID v4 do Claude Code)
  if (!/^[a-z0-9-]+$/i.test(sessionId)) return null;
  return path.join(os.homedir(), '.claude', `.archprime-cycle-${sessionId}.json`);
}

function readCycleState(sessionId) {
  const p = cycleStatePath(sessionId);
  if (!p || !fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function writeCycleState(sessionId, state) {
  const p = cycleStatePath(sessionId);
  if (!p) return;
  try {
    fs.writeFileSync(p, JSON.stringify(state), { mode: 0o600 });
  } catch {
    /* ignore */
  }
}

function deleteCycleState(sessionId) {
  const p = cycleStatePath(sessionId);
  if (!p) return;
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function uuidv4() {
  // Node 14.17+ has crypto.randomUUID
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Garbage collect arquivos .archprime-cycle-*.json mais velhos que 24h.
 * Best-effort, fire-and-forget.
 */
function gcStaleCycleFiles() {
  try {
    const dir = path.join(os.homedir(), '.claude');
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith('.archprime-cycle-') || !f.endsWith('.json')) continue;
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      if (stat.mtimeMs < cutoff) fs.unlinkSync(full);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Resolve cycle_id + sub_squad + cross_squad para o evento atual.
 *
 * Logic:
 *  - SessionStart/SessionEnd/Stop: limpa state, retorna cycle_id existente
 *    (se houver) sem criar novo
 *  - UserPromptSubmit com slash de sub-squad detectado → cria/atualiza cycle
 *    state com sub_squad + cycle_id
 *  - PostToolUse/PreToolUse: lê state, mantém sub_squad atual
 *  - cross_squad: TRUE se state.squads_seen tem 2+ entries diferentes
 */
function resolveSquadContext(eventName, event) {
  const sessionId = event.session_id;
  if (!sessionId) return { sub_squad: null, cycle_id: null, cross_squad: false };

  // SessionEnd / Stop — limpa state, mas preserva cycle_id atual no log final
  if (eventName === 'SessionEnd' || eventName === 'Stop') {
    const state = readCycleState(sessionId);
    if (eventName === 'SessionEnd') {
      deleteCycleState(sessionId);
      gcStaleCycleFiles();
    }
    return {
      sub_squad: state?.sub_squad ?? null,
      cycle_id: state?.cycle_id ?? null,
      cross_squad: (state?.squads_seen?.length ?? 0) > 1,
    };
  }

  // UserPromptSubmit — pode iniciar novo cycle ou switch sub-squad
  if (eventName === 'UserPromptSubmit') {
    const subFromPrompt = detectSubSquadFromPrompt(event.prompt);
    let state = readCycleState(sessionId) || {
      cycle_id: uuidv4(),
      sub_squad: null,
      squads_seen: [],
      created_at: new Date().toISOString(),
    };

    if (subFromPrompt && subFromPrompt !== state.sub_squad) {
      state.sub_squad = subFromPrompt;
      if (!state.squads_seen.includes(subFromPrompt)) {
        state.squads_seen.push(subFromPrompt);
      }
      state.last_switch_at = new Date().toISOString();
    }

    writeCycleState(sessionId, state);
    return {
      sub_squad: state.sub_squad,
      cycle_id: state.cycle_id,
      cross_squad: state.squads_seen.length > 1,
    };
  }

  // PostToolUse / PreToolUse / outros — tenta detectar sub_squad por path
  // (mas não sobrescreve se já houver um do prompt)
  const state = readCycleState(sessionId);
  if (!state) return { sub_squad: null, cycle_id: null, cross_squad: false };

  // Heurística secundária por path do file editado/lido
  const filePath = event.tool_input?.file_path || event.tool_input?.path || event.cwd || '';
  const subFromPath = detectSubSquadFromPath(filePath);
  if (subFromPath && subFromPath !== state.sub_squad && !state.sub_squad) {
    // Só atualiza se state.sub_squad é null (não sobrescreve detecção explícita do prompt)
    state.sub_squad = subFromPath;
    if (!state.squads_seen.includes(subFromPath)) {
      state.squads_seen.push(subFromPath);
    }
    writeCycleState(sessionId, state);
  }

  return {
    sub_squad: state.sub_squad,
    cycle_id: state.cycle_id,
    cross_squad: state.squads_seen.length > 1,
  };
}

function sanitizeString(s) {
  if (typeof s !== 'string') return s;
  let out = s;
  for (const [pat, rep] of SECRET_PATTERNS) out = out.replace(pat, rep);
  if (out.length > MAX_STRING) out = out.slice(0, MAX_STRING) + '…[truncated]';
  return out;
}

function sanitizeDeep(value, depth = 0) {
  if (depth > 6) return '[depth_limit]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitizeDeep(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    let i = 0;
    for (const [k, v] of Object.entries(value)) {
      if (i++ > 30) { out._truncated_keys = true; break; }
      out[k] = sanitizeDeep(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
    setTimeout(() => resolve(data), 800);
  });
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function findTenant(config, cwd) {
  if (!config?.tenants?.length) return null;
  for (const t of config.tenants) {
    try {
      if (new RegExp(t.path_regex, 'i').test(cwd)) return t;
    } catch { /* invalid regex — skip */ }
  }
  return null;
}

function actionFromEvent(eventName, toolName) {
  switch (eventName) {
    case 'UserPromptSubmit': return 'prompt_submit';
    case 'PostToolUse': return 'tool_use';
    case 'PreToolUse': return 'tool_pre';
    case 'SessionStart': return 'session_start';
    case 'SessionEnd': return 'session_end';
    case 'Stop': return 'turn_end';
    case 'Notification': return 'notification';
    case 'PreCompact': return 'pre_compact';
    case 'SubagentStop': return 'subagent_end';
    default: return (eventName || 'unknown').toLowerCase();
  }
}

function buildPayload(event, config, tenant) {
  const optOut = config.OPT_OUT_PROMPT === 1 || config.OPT_OUT_PROMPT === '1' || config.OPT_OUT_PROMPT === true;
  const eventName = event.hook_event_name || event.eventName || 'unknown';
  const action = actionFromEvent(eventName, event.tool_name);

  const details = {
    event: eventName,
    cwd: event.cwd,
    session_id: event.session_id,
    tenant: tenant.name,
    project: path.basename(event.cwd || ''),
    timestamp_local: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };

  if (event.tool_name) details.tool = event.tool_name;
  if (event.transcript_path) details.transcript_path = event.transcript_path;

  if (eventName === 'UserPromptSubmit') {
    if (optOut) {
      details.prompt_chars = (event.prompt || '').length;
    } else {
      details.prompt = sanitizeString(event.prompt || '');
    }
  }

  if (eventName === 'PostToolUse' || eventName === 'PreToolUse') {
    if (!optOut && event.tool_input) details.tool_input = sanitizeDeep(event.tool_input);
    if (eventName === 'PostToolUse' && event.tool_response) {
      const resp = event.tool_response;
      if (typeof resp === 'string') {
        details.tool_response_chars = resp.length;
        details.tool_response_preview = sanitizeString(resp).slice(0, 600);
      } else if (resp && typeof resp === 'object') {
        details.tool_response_keys = Object.keys(resp).slice(0, 10);
      }
    }
  }

  if (eventName === 'Notification' && event.message) {
    details.message = sanitizeString(event.message);
  }

  if (eventName === 'PreCompact') {
    details.trigger = event.trigger || null;
    if (event.custom_instructions && !optOut) {
      details.custom_instructions = sanitizeString(event.custom_instructions);
    }
  }

  // ─── Squad hierarchy context ───
  const squadCtx = resolveSquadContext(eventName, event);
  if (squadCtx.sub_squad) details.sub_squad_active = squadCtx.sub_squad;
  if (squadCtx.cycle_id) details.cycle_id_active = squadCtx.cycle_id;

  let body = {
    email: config.user_email,
    user_id: tenant.user_id,
    action,
    tool: event.tool_name || null,
    session_id: event.session_id || null,
    // Squad metadata at root — log-claude-event v1.1.0+ persists into columns
    parent_squad: 'primeteam-ops',
    sub_squad: squadCtx.sub_squad,
    cycle_id: squadCtx.cycle_id,
    cross_squad: squadCtx.cross_squad,
    ...details,
  };

  let json = JSON.stringify(body);
  if (json.length > MAX_BYTES) {
    body = {
      email: config.user_email,
      user_id: tenant.user_id,
      action,
      tool: event.tool_name || null,
      session_id: event.session_id || null,
      parent_squad: 'primeteam-ops',
      sub_squad: squadCtx.sub_squad,
      cycle_id: squadCtx.cycle_id,
      cross_squad: squadCtx.cross_squad,
      event: eventName,
      cwd: event.cwd,
      _oversized: true,
      _original_bytes: json.length,
    };
  }

  return body;
}

function postEvent(tenant, body) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(tenant.endpoint); } catch { return resolve(); }

    const data = JSON.stringify(body);
    const options = {
      method: 'POST',
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Authorization': `Bearer ${tenant.token}`,
        'apikey': tenant.apikey || '',
        'User-Agent': 'archprime-claude-hook/1.1',
      },
      timeout: REQUEST_TIMEOUT_MS,
    };

    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(options, (res) => { res.on('data', () => {}); res.on('end', resolve); });
    req.on('error', () => resolve());
    req.on('timeout', () => { req.destroy(); resolve(); });
    req.write(data);
    req.end();
  });
}

async function main() {
  const config = loadConfig();
  if (!config?.user_email || !Array.isArray(config.tenants)) process.exit(0);

  const stdinRaw = await readStdin();
  let event;
  try { event = JSON.parse(stdinRaw); } catch { process.exit(0); }
  if (!event || typeof event !== 'object') process.exit(0);

  const cwd = event.cwd || process.cwd();
  const tenant = findTenant(config, cwd);
  if (!tenant) process.exit(0);

  const payload = buildPayload({ ...event, cwd }, config, tenant);
  await postEvent(tenant, payload);
  process.exit(0);
}

main();
