import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import { Octokit } from '@octokit/rest';
import {
  RegisterApiSchema,
  RegisterRepositorySchema,
  countRepoSize,
  parseSpec,
  type FieldErrors,
  type RegisterRepository,
  type Result,
  err,
  ok,
  type RegisterApi,
} from '@sma/core';
import { fileSystemRepoReader } from '../infra/repo/reader.js';
import { allowedSpecUrl, containsCredential, redact } from '../infra/spec-source/security.js';

const exec = promisify(execFile);
/** Injectable reachability check prevents tests from requiring live GitHub credentials. */
export type RepositoryProbe = (repo: RegisterRepository, token: string) => Promise<void>;
/** Check authenticated repository access; tokens never leave this adapter as data. */
export const probeGitHub: RepositoryProbe = async (repo, token) => {
  const octokit = new Octokit({
    auth: token,
    request: { timeout: 15_000 },
    log: { debug() {}, info() {}, warn() {}, error() {} },
  });
  await octokit.repos.get({ owner: repo.owner, repo: repo.name });
};
/** Collect field errors without persisting input or starting any pipeline work. */
export async function validateRepository(
  input: unknown,
  probe: RepositoryProbe = probeGitHub,
): Promise<Result<RegisterRepository, FieldErrors>> {
  const parsed = RegisterRepositorySchema.safeParse(input);
  const errors: FieldErrors = parsed.success
    ? []
    : parsed.error.issues.map((i) => ({
        field: i.path.join('.'),
        message: 'Missing or invalid field',
      }));
  const candidate = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  if (containsCredential(JSON.stringify(candidate)))
    errors.push({
      field: 'credentialRef',
      message: 'Supply only the credential environment variable name; remove credential values',
    });
  if (typeof candidate.localPath === 'string' && candidate.localPath.trim()) {
    try {
      const root = resolve(candidate.localPath);
      const { stdout } = await exec('git', ['-C', root, 'rev-parse', '--show-toplevel'], {
        timeout: 5000,
      });
      if ((await realpath(stdout.trim())) !== (await realpath(root)))
        throw new Error('Not repository root');
      if (typeof candidate.defaultBranch === 'string' && candidate.defaultBranch) {
        try {
          await exec('git', ['check-ref-format', '--branch', candidate.defaultBranch], {
            timeout: 5000,
          });
          await exec(
            'git',
            [
              '-C',
              root,
              'show-ref',
              '--verify',
              '--quiet',
              `refs/heads/${candidate.defaultBranch}`,
            ],
            { timeout: 5000 },
          );
        } catch {
          errors.push({
            field: 'defaultBranch',
            message: 'Default branch does not exist locally or is invalid',
          });
        }
      }
      const size = await countRepoSize(root, fileSystemRepoReader);
      if (size.exceeded)
        errors.push({
          field: 'localPath',
          message: 'Repository exceeds 200 selected TypeScript files or 20,000 lines',
        });
    } catch {
      errors.push({
        field: 'localPath',
        message: 'Repository is unreachable, unreadable, symbolic, or not a Git repository root',
      });
    }
  }
  if (parsed.success && parsed.data.credentialRef && process.env[parsed.data.credentialRef]) {
    try {
      await probe(parsed.data, process.env[parsed.data.credentialRef]!);
    } catch {
      errors.push({
        field: 'credentialRef',
        message: 'GitHub repository is unreachable with the referenced credential',
      });
    }
  }
  return parsed.success && errors.length === 0
    ? ok({ ...parsed.data, localPath: resolve(parsed.data.localPath) })
    : err(errors);
}
/** Validate URL/upload registration completely before inserting an API or a check. */
export async function validateApi(input: unknown): Promise<Result<RegisterApi, FieldErrors>> {
  const parsed = RegisterApiSchema.safeParse(input);
  const errors: FieldErrors = parsed.success
    ? []
    : parsed.error.issues.map((i) => ({
        field: i.path.join('.'),
        message: 'Missing or invalid field',
      }));
  const candidate = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  if (containsCredential(JSON.stringify(candidate)))
    errors.push({
      field: 'configuration',
      message: 'Remove credential values from configuration and specification',
    });
  if (typeof candidate.specSourceUrl === 'string' && !allowedSpecUrl(candidate.specSourceUrl))
    errors.push({
      field: 'specSourceUrl',
      message: 'Use HTTPS or local demo HTTP without credentials or fragments',
    });
  if (typeof candidate.specText === 'string') {
    const spec = await parseSpec(candidate.specText);
    if (!spec.ok) errors.push({ field: 'specText', message: redact(spec.error.message) });
  }
  return parsed.success && errors.length === 0 ? ok(parsed.data) : err(errors);
}
