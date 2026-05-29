import { spawn } from 'node:child_process';

const isWindows = process.platform === 'win32';
const npmBin = isWindows ? 'npm.cmd' : 'npm';
const nodeBin = process.execPath;

const processes = [
  spawn(npmBin, ['run', 'dev'], {
    stdio: 'inherit',
    shell: true,
  }),
  spawn(nodeBin, ['--experimental-strip-types', '--loader', './server/ts-loader.mjs', 'server/index.ts'], {
    stdio: 'inherit',
    shell: false,
  }),
];

let shuttingDown = false;

for (const child of processes) {
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    if (code === 0) {
      shutdown(0);
      return;
    }

    shutdown(code ?? (signal ? 1 : 0));
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

function shutdown(code: number): void {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of processes) {
    if (!child.killed) {
      child.kill();
    }
  }

  process.exit(code);
}
