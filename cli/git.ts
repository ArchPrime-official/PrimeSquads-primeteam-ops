import { execSync, spawn, SpawnOptions } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface GitOptions {
  cwd?: string;
  timeoutMs?: number;
}

function exec(args: string[], options: GitOptions = {}): string {
  return execSync(`git ${args.join(' ')}`, {
    cwd: options.cwd,
    encoding: 'utf-8',
    timeout: options.timeoutMs ?? 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function tryExec(args: string[], options: GitOptions = {}): string | null {
  try {
    return exec(args, options);
  } catch {
    return null;
  }
}

export function isGitRepo(cwd?: string): boolean {
  return tryExec(['rev-parse', '--git-dir'], { cwd }) !== null;
}

export function isGitInstalled(): boolean {
  try {
    execSync('git --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function getCurrentBranch(cwd?: string): string | null {
  return tryExec(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
}

export function hasUncommittedChanges(cwd?: string): boolean {
  const out = tryExec(['status', '--porcelain'], { cwd });
  return out !== null && out.length > 0;
}

export function getHeadSha(cwd?: string): string | null {
  return tryExec(['rev-parse', '--short', 'HEAD'], { cwd });
}

export async function fetchRemote(remote = 'origin', options: GitOptions = {}): Promise<void> {
  await spawnAsync('git', ['fetch', remote, '--quiet'], options);
}

export function countCommitsBehind(
  branch = 'main',
  remote = 'origin',
  cwd?: string,
): number | null {
  const out = tryExec(['rev-list', '--count', `HEAD..${remote}/${branch}`], { cwd });
  return out !== null ? parseInt(out, 10) : null;
}

export function countCommitsAhead(
  branch = 'main',
  remote = 'origin',
  cwd?: string,
): number | null {
  const out = tryExec(['rev-list', '--count', `${remote}/${branch}..HEAD`], { cwd });
  return out !== null ? parseInt(out, 10) : null;
}

export function listChangedFiles(from: string, to = 'HEAD', cwd?: string): string[] {
  const out = tryExec(['diff', '--name-only', `${from}..${to}`], { cwd });
  return out ? out.split('\n').filter(Boolean) : [];
}

export function getRecentCommitMessages(
  from: string,
  to = 'HEAD',
  limit = 10,
  cwd?: string,
): string[] {
  const out = tryExec(
    ['log', '--pretty=format:%h %s', `-n${limit}`, `${from}..${to}`],
    { cwd },
  );
  return out ? out.split('\n').filter(Boolean) : [];
}

export async function pullFastForward(
  remote = 'origin',
  branch = 'main',
  options: GitOptions = {},
): Promise<void> {
  await spawnAsync('git', ['pull', remote, branch, '--ff-only', '--quiet'], options);
}

export function packageLockChanged(
  from: string,
  to = 'HEAD',
  cwd?: string,
): boolean {
  const files = listChangedFiles(from, to, cwd);
  return files.some((f) => f === 'package.json' || f === 'package-lock.json');
}

export interface RepoStatus {
  isRepo: boolean;
  branch: string | null;
  headSha: string | null;
  dirty: boolean;
  behind: number | null;
  ahead: number | null;
}

export function readRepoStatus(cwd?: string): RepoStatus {
  if (!isGitRepo(cwd)) {
    return { isRepo: false, branch: null, headSha: null, dirty: false, behind: null, ahead: null };
  }
  return {
    isRepo: true,
    branch: getCurrentBranch(cwd),
    headSha: getHeadSha(cwd),
    dirty: hasUncommittedChanges(cwd),
    behind: countCommitsBehind('main', 'origin', cwd),
    ahead: countCommitsAhead('main', 'origin', cwd),
  };
}

export function readPackageVersion(repoRoot: string): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

function spawnAsync(
  cmd: string,
  args: string[],
  options: GitOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const spawnOpts: SpawnOptions = {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    };
    const child = spawn(cmd, args, spawnOpts);
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error(`git ${args.join(' ')}: timeout`));
        }, options.timeoutMs)
      : null;
    child.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `git ${args.join(' ')} exited ${code}`));
    });
    child.on('error', (err) => {
      if (timeout) clearTimeout(timeout);
      reject(err);
    });
  });
}
