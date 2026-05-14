/**
 * `pto cycle` — manage cross-squad cycle context manually.
 *
 * Useful para scripts/users que querem propagar cycle_id de forma explicita
 * (ex: edge function reads `pto cycle current` para herdar contexto).
 *
 * Hook universal `~/.claude/hooks/log-claude-activity.cjs` já gerencia
 * cycle_id automaticamente per Claude Code session — este CLI é
 * complementar, para uso fora do hook.
 *
 * Storage: ~/.primeteam/active-cycle.json
 *  {
 *    "cycle_id": "uuid v4",
 *    "sub_squad": "creative-studio" | "strategic-management" | ... | null,
 *    "cross_squad": false,
 *    "started_at": "ISO 8601",
 *    "last_updated_at": "ISO 8601"
 *  }
 *
 * Comandos:
 *   pto cycle start [--sub-squad <name>]   gera novo cycle_id, sobrescreve atual
 *   pto cycle current                      mostra cycle_id ativo (ou nada)
 *   pto cycle close                        apaga cycle_id ativo
 *   pto cycle switch --sub-squad <name>    troca sub_squad sem mudar cycle_id (marca cross_squad)
 *
 * Added: 2026-05-14 (B.FINAL — squad hierarchy data wiring)
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SESSION_DIR } from './paths.js';

const ACTIVE_CYCLE_FILE = path.join(SESSION_DIR, 'active-cycle.json');

const SUB_SQUADS = new Set<string>([
  'creative-studio',
  'strategic-management',
  'meta-ads',
  'primeteam-improve',
]);

interface CycleState {
  cycle_id: string;
  sub_squad: string | null;
  cross_squad: boolean;
  squads_seen: string[];
  started_at: string;
  last_updated_at: string;
}

function ensureSessionDir(): void {
  fs.mkdirSync(SESSION_DIR, { recursive: true, mode: 0o700 });
}

function readState(): CycleState | null {
  if (!fs.existsSync(ACTIVE_CYCLE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(ACTIVE_CYCLE_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function writeState(state: CycleState): void {
  ensureSessionDir();
  fs.writeFileSync(ACTIVE_CYCLE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
}

function deleteState(): void {
  if (fs.existsSync(ACTIVE_CYCLE_FILE)) {
    fs.unlinkSync(ACTIVE_CYCLE_FILE);
  }
}

function validateSubSquad(name: string | undefined): string | null {
  if (!name) return null;
  if (!SUB_SQUADS.has(name)) {
    console.error(`✗ Sub-squad inválido: "${name}"`);
    console.error(`  Aceitos: ${[...SUB_SQUADS].join(', ')}`);
    process.exit(1);
  }
  return name;
}

export async function cycleStart(opts: { subSquad?: string } = {}): Promise<void> {
  const subSquad = validateSubSquad(opts.subSquad);
  const now = new Date().toISOString();
  const state: CycleState = {
    cycle_id: randomUUID(),
    sub_squad: subSquad,
    cross_squad: false,
    squads_seen: subSquad ? [subSquad] : [],
    started_at: now,
    last_updated_at: now,
  };
  writeState(state);
  console.log(`✓ Novo cycle iniciado`);
  console.log(`  cycle_id:   ${state.cycle_id}`);
  console.log(`  sub_squad:  ${state.sub_squad ?? '(nenhum — root squad)'}`);
  console.log(`  started_at: ${state.started_at}`);
  console.log(``);
  console.log(`Para usar em scripts/edge functions:`);
  console.log(`  CYCLE_ID=$(pto cycle current --id-only)`);
}

export async function cycleCurrent(opts: { idOnly?: boolean; json?: boolean } = {}): Promise<void> {
  const state = readState();
  if (!state) {
    if (opts.idOnly) {
      // exit 0 com nada para scripts não quebrarem
      return;
    }
    console.log(`(nenhum cycle ativo — use \`pto cycle start\` para iniciar)`);
    return;
  }
  if (opts.idOnly) {
    process.stdout.write(state.cycle_id);
    return;
  }
  if (opts.json) {
    process.stdout.write(JSON.stringify(state, null, 2));
    return;
  }
  console.log(`Cycle ativo:`);
  console.log(`  cycle_id:        ${state.cycle_id}`);
  console.log(`  sub_squad:       ${state.sub_squad ?? '(nenhum)'}`);
  console.log(`  cross_squad:     ${state.cross_squad ? 'sim' : 'não'}`);
  console.log(`  squads_seen:     ${state.squads_seen.length === 0 ? '(vazio)' : state.squads_seen.join(', ')}`);
  console.log(`  started_at:      ${state.started_at}`);
  console.log(`  last_updated_at: ${state.last_updated_at}`);
}

export async function cycleClose(): Promise<void> {
  const state = readState();
  if (!state) {
    console.log(`(nenhum cycle ativo)`);
    return;
  }
  deleteState();
  console.log(`✓ Cycle ${state.cycle_id} fechado`);
  if (state.squads_seen.length > 1) {
    console.log(`  cross-squad: passou por ${state.squads_seen.length} sub-squads`);
    console.log(`  squads:      ${state.squads_seen.join(' → ')}`);
  }
}

export async function cycleSwitch(opts: { subSquad: string }): Promise<void> {
  const subSquad = validateSubSquad(opts.subSquad);
  if (!subSquad) {
    console.error(`✗ --sub-squad é obrigatório em \`pto cycle switch\``);
    process.exit(1);
  }
  const state = readState();
  if (!state) {
    console.error(`✗ Nenhum cycle ativo — use \`pto cycle start --sub-squad ${subSquad}\` primeiro`);
    process.exit(1);
  }
  const previousSub = state.sub_squad;
  state.sub_squad = subSquad;
  state.last_updated_at = new Date().toISOString();
  if (!state.squads_seen.includes(subSquad)) {
    state.squads_seen.push(subSquad);
  }
  if (state.squads_seen.length > 1) {
    state.cross_squad = true;
  }
  writeState(state);
  console.log(`✓ Cycle ${state.cycle_id} switched: ${previousSub ?? '(nenhum)'} → ${subSquad}`);
  if (state.cross_squad) {
    console.log(`  cross_squad agora = TRUE (squads_seen: ${state.squads_seen.join(', ')})`);
  }
}
