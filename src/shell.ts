// Turns the `run` input into a command for `devlanes with`, the way GitHub runs `run:` steps:
// the script goes into a file and each shell gets the flags GitHub passes it.

import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Shell } from './inputs.ts';

/** The file extension each shell needs to run a script. */
const extensions: Record<Shell, string> = {
  bash: '.sh',
  sh: '.sh',
  pwsh: '.ps1',
  powershell: '.ps1',
  cmd: '.cmd'
};

/** The script text for `shell`, with GitHub's error handling around PowerShell scripts. */
export function scriptText(shell: Shell, run: string): string {
  if (shell === 'pwsh' || shell === 'powershell') {
    // GitHub does the same: stop on the first error and exit with the last native exit code.
    return [
      "$ErrorActionPreference = 'stop'",
      run,
      'if ((Test-Path -LiteralPath variable:\\LASTEXITCODE)) { exit $LASTEXITCODE }',
      ''
    ].join('\n');
  }
  if (shell === 'cmd') return `${run.replace(/\r?\n/g, '\r\n')}\r\n`;
  return run.endsWith('\n') ? run : `${run}\n`;
}

/** The argv that runs `file` with `shell`; `bash` is Git Bash's on Windows. */
export function shellArgv(shell: Shell, file: string, platform: NodeJS.Platform): string[] {
  switch (shell) {
    case 'bash':
      return [bashPath(platform), '--noprofile', '--norc', '-eo', 'pipefail', file];
    case 'sh':
      return ['sh', '-e', file];
    case 'pwsh':
    case 'powershell':
      return [
        shell,
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `. '${file.replaceAll("'", "''")}'`
      ];
    case 'cmd':
      return ['cmd', '/D', '/E:ON', '/V:OFF', '/C', 'CALL', file];
  }
}

/**
 * Git Bash on Windows. A bare `bash` there can resolve to WSL's launcher in System32, which
 * runs the script in a Linux distribution that may not exist on the runner.
 */
function bashPath(platform: NodeJS.Platform): string {
  if (platform !== 'win32') return 'bash';
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
  const gitBash = join(programFiles, 'Git', 'bin', 'bash.exe');
  return existsSync(gitBash) ? gitBash : 'bash';
}

/** Writes the `run` script into `dir` and returns the argv that runs it. */
export async function writeScript(
  shell: Shell,
  run: string,
  dir: string,
  platform: NodeJS.Platform
): Promise<string[]> {
  const file = join(dir, `devlanes-run-${process.pid}-${Date.now()}${extensions[shell]}`);
  await writeFile(file, scriptText(shell, run));
  return shellArgv(shell, file, platform);
}
