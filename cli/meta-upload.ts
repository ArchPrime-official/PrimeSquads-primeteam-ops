/**
 * `pto meta-upload` — sobe campanhas Meta Ads em lote via squad bulk-upload.
 *
 * Esconde toda a fricção do time:
 *   - usa session do `pto login` (já cacheada em ~/.primeteam/session.json)
 *   - refresca JWT silenciosamente se está expirando
 *   - chama edge function get-meta-access-token e captura o token Meta do Vault
 *   - delega execução ao script Python `squads/meta-ads/tools/bulk-upload/upload-campaigns.py`
 *     com META_ACCESS_TOKEN env setado
 *
 * Usuário não digita senha, não usa DevTools, não exporta variável nenhuma.
 *
 * Uso:
 *   pto meta-upload --config <path> --copies <path> --state <path> \
 *                   --results <path> --assets <dir> --dry-run
 *   pto meta-upload [...flags acima...] --execute
 *   pto meta-upload [...flags acima...] --activate
 *   pto meta-upload [...flags acima...] --rollback
 *   pto meta-upload [...flags acima...] --only 340 341
 *
 * Adiciona desde 2026-05-15 — substitui scripts ad-hoc com SB_PASSWORD plain.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import { Command } from 'commander';
import { SUPABASE_URL } from './config.js';
import { getRepoRoot } from './paths.js';
import { loadSession, maybeRefresh, readSessionHealth } from './session.js';

const DEFAULT_ACCOUNT_META_ID = '2147699252408628'; // ArchPrime LTD

interface MetaUploadOptions {
  config: string;
  copies: string;
  state: string;
  results: string;
  assets: string;
  dryRun?: boolean;
  execute?: boolean;
  activate?: boolean;
  rollback?: boolean;
  only?: string[];
  account?: string;
  skipPreflight?: boolean;
}

interface TokenResponse {
  access_token: string;
  account_id: string;
  account_name: string;
}

async function ensureValidJwt(): Promise<string> {
  const health = readSessionHealth();
  if (health.status === 'missing' || health.status === 'corrupted') {
    throw new Error('session ausente — rode `pto login` antes de usar meta-upload');
  }
  // Refresca silenciosamente se expirando ou expirado
  if (health.status === 'expiring' || health.status === 'expired') {
    const refreshed = await maybeRefresh(undefined, { throwOnError: true });
    if (refreshed.session) return refreshed.session.access_token;
  }
  const session = loadSession();
  if (!session) throw new Error('session sumiu durante o refresh — tente `pto login`');
  return session.access_token;
}

async function fetchMetaToken(jwt: string, accountMetaId: string): Promise<TokenResponse> {
  const url = `${SUPABASE_URL}/functions/v1/get-meta-access-token`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ad_account_meta_id: accountMetaId }),
  });
  const text = await res.text();
  if (res.status === 401) {
    throw new Error('JWT rejeitado pela edge function — tente `pto login` novamente');
  }
  if (res.status === 403) {
    throw new Error('sua conta não tem role marketing/admin/owner — peça ao Pablo para ajustar');
  }
  if (res.status === 404) {
    throw new Error(`conta Meta ${accountMetaId} não está em meta_ad_accounts`);
  }
  if (!res.ok) {
    throw new Error(`edge function ${res.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as TokenResponse;
}

function resolveScriptPath(repoRoot: string): string {
  const scriptPath = path.join(
    repoRoot,
    'squads',
    'meta-ads',
    'tools',
    'bulk-upload',
    'upload-campaigns.py',
  );
  if (!fs.existsSync(scriptPath)) {
    throw new Error(
      `script bulk-upload não encontrado em ${scriptPath}. Atualize o submodule meta-ads:\n` +
        `  git submodule update --init --recursive`,
    );
  }
  return scriptPath;
}

function buildPythonArgs(options: MetaUploadOptions, scriptPath: string): string[] {
  const args = [scriptPath];
  args.push('--config-path', path.resolve(options.config));
  args.push('--copies-path', path.resolve(options.copies));
  args.push('--state-path', path.resolve(options.state));
  args.push('--results-path', path.resolve(options.results));
  args.push('--assets-dir', path.resolve(options.assets));
  if (options.dryRun) args.push('--dry-run');
  if (options.execute) args.push('--execute');
  if (options.activate) args.push('--activate');
  if (options.rollback) args.push('--rollback');
  if (options.skipPreflight) args.push('--skip-preflight');
  if (options.only && options.only.length > 0) {
    args.push('--only', ...options.only);
  }
  return args;
}

function runPython(args: string[], envExtra: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', args, {
      stdio: 'inherit',
      env: { ...process.env, ...envExtra },
    });
    child.on('error', (err) => reject(err));
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

export async function metaUpload(options: MetaUploadOptions): Promise<void> {
  // Validação básica de modos mutex
  const modes = [options.dryRun, options.execute, options.activate, options.rollback].filter(
    Boolean,
  ).length;
  if (modes !== 1) {
    throw new Error('use exatamente um de: --dry-run, --execute, --activate, --rollback');
  }

  console.log(`${pc.yellow('🔐')} ${pc.dim('resolvendo session...')}`);
  const jwt = await ensureValidJwt();

  const accountMetaId = (options.account || DEFAULT_ACCOUNT_META_ID).replace(/^act_/, '');
  console.log(`${pc.yellow('🔑')} ${pc.dim(`buscando token Meta para act_${accountMetaId}...`)}`);
  const tokenInfo = await fetchMetaToken(jwt, accountMetaId);
  console.log(
    `${pc.green('✓')} token resolvido: ${pc.bold(tokenInfo.account_name)} (${tokenInfo.account_id})`,
  );
  console.log('');

  const repoRoot = getRepoRoot();
  // getRepoRoot retorna a raiz do squad primeteam-ops; precisamos subir para o PrimeTeam parent
  // que contém squads/meta-ads/tools/bulk-upload/. Tenta o cwd se primeteam-ops estiver clonado
  // standalone (fora do PrimeTeam parent).
  let parentRoot = path.resolve(repoRoot, '..', '..');
  if (!fs.existsSync(path.join(parentRoot, 'squads', 'meta-ads'))) {
    parentRoot = process.cwd();
  }
  const scriptPath = resolveScriptPath(parentRoot);

  const args = buildPythonArgs(options, scriptPath);
  console.log(`${pc.cyan('▶')} ${pc.dim(`python3 ${path.relative(process.cwd(), scriptPath)} ...`)}`);
  console.log('');

  const exitCode = await runPython(args, { META_ACCESS_TOKEN: tokenInfo.access_token });
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

export function registerMetaUpload(program: Command): void {
  program
    .command('meta-upload')
    .description('subir campanhas Meta Ads em lote (resolve token automaticamente via session pto)')
    .requiredOption('--config <path>', 'JSON com meta/defaults/audiences/creatives/campaigns')
    .requiredOption('--copies <path>', 'JSON com copies por creative ref')
    .requiredOption('--state <path>', 'state.json (idempotência)')
    .requiredOption('--results <path>', 'results.json (saída de IDs)')
    .requiredOption('--assets <dir>', 'pasta com arquivos de criativo')
    .option('--dry-run', 'só simula, não chama Meta API')
    .option('--execute', 'cria entidades de verdade (PAUSED)')
    .option('--activate', 'ativa entidades já em state.json')
    .option('--rollback', 'deleta tudo em state.json (PERIGOSO)')
    .option('--only <numbers...>', 'rodar só campaign numbers (ex: --only 340 341)')
    .option('--account <id>', `Meta ad account ID (default: ${DEFAULT_ACCOUNT_META_ID} — ArchPrime LTD)`)
    .option('--skip-preflight', 'pula validação token+account+page (não recomendado)')
    .action(async (opts: MetaUploadOptions) => {
      try {
        await metaUpload(opts);
      } catch (err) {
        console.error(`${pc.red('✗')} ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
