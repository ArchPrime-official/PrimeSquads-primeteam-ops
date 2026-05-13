/**
 * `pto squads list` + `pto status` — exibe hierarquia de squads PrimeTeam.
 *
 * Lê config.yaml de cada squad para construir hierarchy view.
 * Não invoca squads (CLI continua auth-only) — apenas inspect view.
 *
 * Added: 2026-05-14 (B.6 — squad hierarchy refactor)
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

interface SquadInfo {
  name: string;
  version: string;
  role: 'root_squad' | 'sub_squad' | 'meta_squad' | 'design_resource' | 'unknown';
  parent?: string;
  sub_chief?: string;
  domain?: string;
  slash_prefix?: string;
}

function findRepoRoot(start: string = process.cwd()): string {
  // Walk up until we find squads/ folder
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, 'squads'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

function parseSquadConfig(configPath: string): Partial<SquadInfo> {
  if (!existsSync(configPath)) return {};
  try {
    const raw = readFileSync(configPath, 'utf-8');

    // Crude YAML parsing — enough for our needs (name, version, hierarchy.role, parent, sub_chief)
    const result: Partial<SquadInfo> = {};

    const nameMatch = raw.match(/^\s*name:\s*([^\s#]+)/m);
    if (nameMatch) result.name = nameMatch[1];

    const versionMatch = raw.match(/^\s*version:\s*['"]?([^\s'"#]+)/m);
    if (versionMatch) result.version = versionMatch[1];

    const slashPrefixMatch = raw.match(/^\s*slash[Pp]refix:\s*([^\s#]+)/m);
    if (slashPrefixMatch) result.slash_prefix = slashPrefixMatch[1];

    // Hierarchy block (flat YAML parsing)
    const roleMatch = raw.match(/^\s+role:\s*(root_squad|sub_squad|meta_squad|design_resource)/m);
    if (roleMatch) result.role = roleMatch[1] as SquadInfo['role'];

    const parentMatch = raw.match(/^\s+parent:\s*([^\s#]+)/m);
    if (parentMatch) result.parent = parentMatch[1];

    const subChiefMatch = raw.match(/^\s+sub_chief:\s*['"]?([^\s'"#]+)/m);
    if (subChiefMatch) result.sub_chief = subChiefMatch[1];

    const domainMatch = raw.match(/^\s+domain:\s*['"](.*?)['"]/m);
    if (domainMatch) result.domain = domainMatch[1];

    return result;
  } catch (e) {
    return {};
  }
}

function discoverSquads(repoRoot: string): SquadInfo[] {
  const squadsDir = path.join(repoRoot, 'squads');
  if (!existsSync(squadsDir)) return [];

  const entries = readdirSync(squadsDir, { withFileTypes: true });
  const squads: SquadInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const squadDir = path.join(squadsDir, entry.name);
    const configPath = path.join(squadDir, 'config.yaml');

    const partial = parseSquadConfig(configPath);
    squads.push({
      name: partial.name || entry.name,
      version: partial.version || '?',
      role: partial.role || 'unknown',
      parent: partial.parent,
      sub_chief: partial.sub_chief,
      domain: partial.domain,
      slash_prefix: partial.slash_prefix,
    });
  }

  return squads;
}

export async function squadsList(): Promise<void> {
  const repoRoot = findRepoRoot();
  const squads = discoverSquads(repoRoot);

  if (squads.length === 0) {
    console.log('Nenhum squad encontrado em squads/');
    return;
  }

  // Group by role
  const root = squads.filter((s) => s.role === 'root_squad');
  const sub = squads.filter((s) => s.role === 'sub_squad');
  const meta = squads.filter((s) => s.role === 'meta_squad');
  const design = squads.filter((s) => s.role === 'design_resource');
  const unknown = squads.filter((s) => s.role === 'unknown');

  console.log('\n📦 Squad Hierarchy (PrimeTeam)\n');
  console.log('═'.repeat(70));

  if (root.length > 0) {
    console.log('\n🎯 ROOT SQUAD (master orchestrator):');
    for (const s of root) {
      console.log(`  ⚙️  ${s.name} v${s.version}`);
      console.log(`      Slash: /${s.slash_prefix || s.name}`);
      console.log(`      Master: @ops-chief (conhece todos os sub-chiefs)`);
    }
  }

  if (sub.length > 0) {
    console.log('\n🔗 SUB-SQUADS (subordinated to ops-chief):');
    for (const s of sub) {
      console.log(`  • ${s.name} v${s.version}`);
      if (s.sub_chief) console.log(`      Sub-chief: ${s.sub_chief}`);
      if (s.domain) console.log(`      Domain: ${s.domain}`);
      if (s.slash_prefix) console.log(`      Slash: /${s.slash_prefix}`);
      console.log(`      Reports to: @ops-chief (primeteam-ops)`);
      console.log('');
    }
  }

  if (meta.length > 0) {
    console.log('🛠️  META-SQUADS (tooling, not operational):');
    for (const s of meta) {
      console.log(`  • ${s.name} v${s.version}`);
      if (s.slash_prefix) console.log(`      Slash: /${s.slash_prefix}`);
      console.log('');
    }
  }

  if (design.length > 0) {
    console.log('🎨 DESIGN RESOURCES (not AIOS squads):');
    for (const s of design) {
      console.log(`  • ${s.name} v${s.version}`);
      console.log('');
    }
  }

  if (unknown.length > 0) {
    console.log('❓ UNCATEGORIZED:');
    for (const s of unknown) {
      console.log(`  • ${s.name} v${s.version}`);
      console.log('');
    }
  }

  console.log('═'.repeat(70));
  console.log('\n💡 Tip: invoque /PrimeteamOps:agents:ops-chief para qualquer demanda.');
  console.log('   Ele rotearrá automaticamente para o sub-chief apropriado.\n');
}

export async function ptoStatus(): Promise<void> {
  const repoRoot = findRepoRoot();
  const squads = discoverSquads(repoRoot);

  const root = squads.find((s) => s.role === 'root_squad');
  const sub = squads.filter((s) => s.role === 'sub_squad');
  const meta = squads.filter((s) => s.role === 'meta_squad');

  console.log('\n📊 PrimeTeam Status\n');
  console.log('═'.repeat(70));

  // Root squad
  if (root) {
    console.log(`\n🎯 Root: ${root.name} v${root.version}`);
    console.log(`   Master orchestrator: @ops-chief`);
    console.log(`   CLI binary: pto`);
    console.log(`   Slash: /${root.slash_prefix || root.name}`);
  } else {
    console.log('\n⚠️  Nenhum root_squad declarado em squads/*/config.yaml');
  }

  // Sub-squads count
  console.log(`\n🔗 Sub-squads operacionais: ${sub.length}`);
  for (const s of sub) {
    console.log(`   • ${s.name.padEnd(25)} ${s.sub_chief?.padEnd(25) || ''} (v${s.version})`);
  }

  // Meta squads
  if (meta.length > 0) {
    console.log(`\n🛠️  Meta-squads: ${meta.length}`);
    for (const s of meta) {
      console.log(`   • ${s.name} (v${s.version})`);
    }
  }

  console.log('\n═'.repeat(70));
  console.log('\n💡 Comandos úteis:');
  console.log('   pto squads list      → listagem detalhada');
  console.log('   pto whoami           → quem está logado');
  console.log('   pto doctor           → diagnostic ambiente');
  console.log('   claude               → abre Claude Code');
  console.log('     /PrimeteamOps:agents:ops-chief  → ativa master orchestrator\n');
}
