import { spawn } from 'node:child_process';

export interface ProcessResult {
  stdout: string;
  stderr: string;
}

export interface RunProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  allowFailure?: boolean;
  retry?: {
    attempts: number;
    delayMs?: number;
    shouldRetry?: (error: Error, attempt: number) => boolean;
  };
}

export async function runProcess(
  command: string,
  args: string[],
  options: RunProcessOptions = {},
): Promise<ProcessResult> {
  const maxAttempts = Math.max(1, options.retry?.attempts ?? 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await runProcessOnce(command, args, options);
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }

      const canRetry = attempt < maxAttempts
        && (options.retry?.shouldRetry?.(error, attempt) ?? Boolean(options.retry));

      if (!canRetry) {
        throw error;
      }

      const delayMs = options.retry?.delayMs ?? 0;

      if (delayMs > 0) {
        await wait(delayMs);
      }
    }
  }

  throw new Error(`${command} 执行失败`);
}

async function runProcessOnce(
  command: string,
  args: string[],
  options: RunProcessOptions,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
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

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
