// The variables that make Node, Deno, Python and OpenSSL-based tools trust the devlanes CA
// without touching the OS store, which on macOS and Windows runners needs a dialog nobody can
// answer. They mirror what devlanes sets for its own services.

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** The CA certificate and the bundle (system roots plus the CA) in a devlanes home. */
export interface CaFiles {
  cert: string;
  bundle: string;
}

/** CA files of the devlanes home `home`. */
export function caFiles(home: string): CaFiles {
  return { cert: join(home, 'ca', 'ca.pem'), bundle: join(home, 'ca', 'bundle.pem') };
}

/**
 * Each runtime variable and the file it should name. `SSL_CERT_FILE` and `REQUESTS_CA_BUNDLE`
 * replace the trust store instead of adding to it, so they get the bundle; pointing them at
 * the CA alone would break every other HTTPS call in later steps.
 */
export function caTargets(files: CaFiles): [string, string][] {
  return [
    ['NODE_EXTRA_CA_CERTS', files.cert],
    ['DENO_CERT', files.cert],
    ['SSL_CERT_FILE', files.bundle],
    ['REQUESTS_CA_BUNDLE', files.bundle]
  ];
}

/**
 * The value for each CA variable. A variable the workflow already points at its own PEM keeps
 * that PEM: the action writes a file with both into `dir` instead of replacing it.
 */
export async function caVariables(
  files: CaFiles,
  env: NodeJS.ProcessEnv,
  dir: string
): Promise<Record<string, string>> {
  const variables: Record<string, string> = {};
  for (const [name, target] of caTargets(files)) {
    const existing = env[name];
    // A second action step in the same job sees the combined file the first one wrote.
    if (existing && resolve(existing).startsWith(resolve(dir))) {
      variables[name] = existing;
      continue;
    }
    if (!existing || resolve(existing) === resolve(target) || !existsSync(existing)) {
      variables[name] = target;
      continue;
    }

    await mkdir(dir, { recursive: true });
    const combined = join(dir, `${name}.pem`);
    const pems = [readFileSync(existing, 'utf8').trimEnd(), readFileSync(target, 'utf8').trimEnd()];
    await writeFile(combined, `${pems.join('\n')}\n`);
    variables[name] = combined;
  }
  return variables;
}
