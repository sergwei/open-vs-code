// SYNTHETIC stand-in for `opencode`, used only by the unit tests of issue #8. It is NOT opencode.
//
// It imitates what was READ (never seen running) in opencode v2.0.32 (`server-process.ts`,
// `env.ts`, `process.ts` of github.com/anomalyco/opencode at 843a6c51):
//   - `--version` prints `opencode v<version>`.
//   - `serve --stdio ...` listens on 127.0.0.1:<ephemeral>, prints ONE stdout line
//     `{"url":"http://127.0.0.1:<port>"}`, requires Basic `opencode:<OPENCODE_PASSWORD>` on
//     `GET /api/info`, and exits when stdin ends.
// Tests that pass against it prove our spawn/parse/stop logic, NOT that real opencode behaves
// this way (the project rule: synthetic data is not verification).
//
// Behaviour switches, comma separated in FAKE_OPENCODE_MODE (default `ok`):
//   noise         a non-JSON and a JSON-without-url stdout line before the URL
//   silent        never prints the URL
//   exit-early    prints "boom" on stderr and exits with code 3 before listening
//   hold-stdout   spawns a grandchild that inherits stdout (20 s), reports its pid and exits with 3
//   ignore-stdin  does not exit when stdin ends
//   grandchild    spawns a `node` grandchild (stdio ignored) and reports its pid on stderr
//   port-zero     prints a URL with port 0 when it was given `--port`
//   always-401    answers 401 to every /api/info
// FAKE_OPENCODE_VERSION sets the version reported by `--version` and `/api/info`.
// On start it writes one stderr line `{"fake":"argv",...}` so tests can check args, cwd and env.
// Every mode has a hard 60 s lifetime so a test that fails half-way cannot leave it running.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const version = process.env.FAKE_OPENCODE_VERSION ?? '2.0.32';
const modes = (process.env.FAKE_OPENCODE_MODE ?? 'ok').split(',').map((m) => m.trim());
const has = (mode) => modes.includes(mode);

/** Writes to stderr and then exits, so the text is flushed before the process goes away. */
function exitAfterStderr(text, code) {
  process.stderr.write(text, () => process.exit(code));
}

if (args.includes('--version')) {
  process.stdout.write(`opencode v${version}\n`, () => process.exit(0));
} else if (args[0] !== 'serve') {
  exitAfterStderr(`fake-opencode: unknown command ${JSON.stringify(args)}\n`, 2);
} else {
  runServe();
}

/** Runs the `serve --stdio` imitation described in the file header. */
function runServe() {
  const password = process.env.OPENCODE_PASSWORD;
  process.stderr.write(
    `${JSON.stringify({
      fake: 'argv',
      pid: process.pid,
      argv: args,
      cwd: process.cwd(),
      hasPassword: typeof password === 'string' && password !== '',
      hasLegacy: 'OPENCODE_SERVER_PASSWORD' in process.env,
    })}\n`,
  );

  if (has('exit-early')) {
    exitAfterStderr('boom\n', 3);
    return;
  }

  if (has('hold-stdout')) {
    // A grandchild that inherits OUR stdout pipe, then we exit with code 3: stdout stays open
    // after the child is gone, which is the case the `exit` event in the start race exists for.
    const holder = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 20000)'], {
      stdio: ['ignore', 'inherit', 'ignore'],
    });
    process.stderr.write(`${JSON.stringify({ fake: 'grandchild', pid: holder.pid })}\n`);
    setTimeout(() => process.exit(3), 150);
    return;
  }

  setTimeout(() => process.exit(0), 60_000); // hard cap, see header

  if (has('grandchild')) {
    // detached on Windows only: there Node puts non-detached children in a job object that kills
    // them when their parent dies, so a non-detached grandchild would die even without
    // `taskkill /T` and the kill test could not tell the difference (review of issue #8, verified
    // with a probe). On POSIX detached would move it out of the process group `kill(-pgid)` hits.
    const grandchild = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 60000)'], {
      stdio: 'ignore',
      detached: process.platform === 'win32',
    });
    process.stderr.write(`${JSON.stringify({ fake: 'grandchild', pid: grandchild.pid })}\n`);
  }

  const expected = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
  const server = createServer((request, response) => {
    const authorized = !has('always-401') && request.headers.authorization === expected;
    if (!authorized) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ _tag: 'UnauthorizedError', message: 'unauthorized' }));
      return;
    }
    if (request.url === '/api/info') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ version, pid: process.pid, urls: [], paths: { tmp: tmpdir() } }),
      );
      return;
    }
    response.writeHead(404);
    response.end();
  });

  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    if (has('noise')) {
      process.stdout.write('starting opencode, please wait...\n');
      process.stdout.write('{"hello":"world"}\n');
    }
    if (!has('silent')) {
      const shown = has('port-zero') && args.includes('--port') ? 0 : port;
      process.stdout.write(`${JSON.stringify({ url: `http://127.0.0.1:${shown}` })}\n`);
    }
  });

  if (!has('ignore-stdin')) {
    const shutdown = () => {
      server.close();
      process.exit(0);
    };
    process.stdin.on('end', shutdown);
    process.stdin.on('close', shutdown);
    process.stdin.resume();
  }
}
