// Test fixture mod (E10-mod-toggles): the mod that must NOT restart when ANOTHER mod is switched
// off or on. Registers `count`, which adds 1 to a counter held in MEMORY (module state, so a fresh
// Worker starts again from 0) and writes `count=<n>` into
// `<OPEN_VS_CODE_MODS_HOME>/../mods-sentinel/quiet.count`. A test OUTSIDE the Worker reads that file:
// 1 then 2 means the Worker survived; 1 again means it was restarted (what a full reload would do).
//
// Used by `test/integration/mods.test.ts` ("turning one mod off stops only that mod: the other keeps
// its in-memory state") and by `test:visual` step 45, whose check "/quiet:count counts 2: switching
// hello-station did not restart quiet" reads the file this fixture writes.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

let count = 0;

export function activate(station) {
  station.commands.register({
    name: 'count',
    description: 'Counts in memory',
    run() {
      count += 1;
      const dir = path.join(process.env.OPEN_VS_CODE_MODS_HOME ?? '.', '..', 'mods-sentinel');
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'quiet.count'), `count=${count}\n`);
    },
  });
}
