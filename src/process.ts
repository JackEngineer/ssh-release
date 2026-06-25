import { spawn } from 'node:child_process';

export interface ProcessResult {
  stdout: string;
  stderr: string;
}

export interface RunProcessOptions {
  cwd?: string;
  allowFailure?: boolean;
}

export async function runProcess(
  command: string,
  args: string[],
  options: RunProcessOptions = {},
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

    child.on('error', reject);
    child.on('close', (code) => {
      const result = {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };

      if (code === 0 || options.allowFailure) {
        resolve(result);
        return;
      }

      reject(new Error(`${command} 执行失败: ${result.stderr.trim() || `exit ${code}`}`));
    });
  });
}
