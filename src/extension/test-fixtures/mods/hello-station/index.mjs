// Test fixture mod (E10-mods): the well-behaved one. Registers `hello`; running it writes
// `hello.ran` into `<OPEN_VS_CODE_MODS_HOME>/../mods-sentinel/` so a test OUTSIDE the Worker can
// see that the command really ran in it, and raises a native toast whose text carries a Markdown
// link (`[Station](command:…)`) that the host must neutralize. After each turn it pins a band whose
// text and tooltip carry HTML, which the chat must print as plain text, with a button that runs
// `hello`. A mod is plain Node, so it may write files; the env var is the seed the test suites set
// (it is not secret, unlike the opencode password the host strips).
//
// Used by `test/integration/mods.test.ts` (the sentinel) and by `test:visual` step 38 (the band,
// the "/" entry, the toast, the palette, and the `compose` command that writes into the prompt box).
// The command does NOT await the toast: it resolves only
// when the notification closes, and a command that waits for it would hit the 30 s timeout.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function activate(station) {
  station.commands.register({
    name: 'hello',
    description: 'Says hello',
    run(context) {
      const dir = path.join(process.env.OPEN_VS_CODE_MODS_HOME ?? '.', '..', 'mods-sentinel');
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'hello.ran'), `args=${context.args}\n`);
      station.log.info('hello ran');
      void station.ui.toast({
        message: 'Hello [Station](command:workbench.action.showCommands) says hi',
        actions: ['Thanks'],
      });
    },
  });
  // E10-mods phase 4: opens the panel of this folder (`panel.{html,js,css}`). The page pings the
  // mod and the mod answers `pong`; when the tab closes, `panel.closed` is written next to the
  // `hello.ran` sentinel so a test outside the Worker can see the close reach the mod.
  station.commands.register({
    name: 'panel',
    description: 'Opens the demo panel',
    run() {
      const panel = station.ui.panel.open({
        title: 'Hello Station panel',
        html: 'panel.html',
        scripts: ['panel.js'],
        styles: ['panel.css'],
      });
      panel.onMessage((data) => {
        panel.postMessage({ kind: 'pong', n: data.n, from: 'mod' });
      });
      panel.onDidClose(() => {
        const dir = path.join(process.env.OPEN_VS_CODE_MODS_HOME ?? '.', '..', 'mods-sentinel');
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, 'panel.closed'), 'closed\n');
      });
    },
  });
  // #169: `send` no longer exists, and this plain-JS mod still passes it ONCE on purpose, like an
  // old mod would: `test:visual` step 38 checks the text lands in the prompt box unsent and that
  // the log of mods carries exactly one warning. One call: there is no frequency cap (#1895).
  station.commands.register({
    name: 'compose',
    description: 'Writes into the prompt box',
    run() {
      station.chat.compose({ text: 'Composed by Hello Station', send: true });
    },
  });
  station.events.on('turn.started', (event) => {
    station.log.info(`turn started in ${event.sessionID}`);
  });
  station.events.on('turn.finished', (event) => {
    station.ui.status.set({
      text: `Last turn: ${event.outcome} <b>plain</b>`,
      tooltip: 'Set by <i>Hello Station</i>',
      command: 'hello',
    });
  });
}
