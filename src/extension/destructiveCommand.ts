// Heuristic classifier of shell commands for the Auto work mode (E3-work-mode). Pure: no `vscode`,
// no I/O. Decisions of Sergio (07/11/2026, Engram `e3-work-mode/decisions/` `nunca-destructivo`,
// `secretos-y-borrados`, `infra-y-publicar`, `ronda-extra-lista-negra`, `ronda-lista-negra-3`,
// `ronda-lista-negra-4`, `ronda-lista-negra-5-cierre` and `despliegues-y-cierre`): in Auto the host
// does not approve for the user a shell command that this module recognises as destructive (disk,
// git, infrastructure and cloud), as naming a secret file, as publishing, pushing or DEPLOYING
// (`git push`, `npm publish`, `vercel --prod`, `firebase deploy`, `kubectl apply`…: they delete
// nothing but cannot be taken back), or as running text or a program it cannot see. The module
// keeps its name although "destructive" now means all of that.
//
// WHAT KIND OF LIST IT IS, honestly: a HEURISTIC BLACKLIST over text, built by FAMILY. It is NOT a
// guarantee that Auto never approves a destructive command: six reviews in a row found commands
// that it approved, and the next one may find more (the last found no new class, only variants and
// tools not named here, such as `fd -X rm`, `trash` or `rclone`). What it recognises asks; what is DOUBTFUL also asks; anything else is
// approved. The families (the test has rows for the doors into each that the reviews found: a
// prefix, `export`, a launcher, another spelling; it does not prove there is no other door):
// - the form of the text: a command word that is not a plain literal identifier or has a
//   backslash (`r\m`, `.\gradlew.bat`); a word with a backslash in an ARGUMENT is read twice, as
//   written (a Windows path, `type src\app.ts` is approved) and without the backslashes (a POSIX
//   escape: `git pu\sh` is `git push`), and asks if either reading does; an unquoted `*`, `?`, `[`,
//   `]`, `{`, `}` or `$` in an argument (`@{u}` of git excepted); a `NAME=value` that configures
//   execution (`GIT_*`, `*PAGER*`, `LD_*`, `PYTHON*`, `*_COMMAND`, `NODE_OPTIONS`, `PATH`…) as a
//   prefix, after `env`/`cross-env` or in `export`/`declare`/`set`/`setx` (a short list of harmless
//   values, such as `GIT_EDITOR=true`, passes); `env` with no command;
// - commands that delete, move, overwrite or publish: `rm`, `mv`, `cp`, `rsync --del*`, `git reset
//   --hard`, every `git push`, `npm publish`, cloud and infrastructure CLIs and UPLOADS to the cloud
//   (`aws s3 sync . s3://b`, `gcloud storage cp … gs://`, `az storage blob upload`, `azcopy`;
//   downloads are approved), framework database resets (`rails db:drop`, `php artisan
//   migrate:fresh`, `manage.py flush`, `dotnet ef database drop`…), overwriting `>`/`tee`;
// - text or programs it cannot see: `eval`, `iex`, `xargs`, launchers (`wsl`, `ssh`, `start`,
//   `docker run|exec`, `kubectl run|exec`, SQL clients…), shells and interpreters reading stdin or
//   inline code (flags alone, `-c`, a heredoc, `--import`), `git -c`, `git config` writes and the
//   git options that run a command (`rebase --exec`, `submodule foreach`, `--upload-pack`…), `sed
//   -i`, `awk`; `npx`, `pnpm|yarn|npm|bun exec|dlx|x`, `uv run`, `uv tool run`, `corepack <pm>`,
//   `poetry run`… are classified by the
//   tool they launch;
// - reading secrets without naming them: recursive `grep` of the current directory, `rg --hidden`,
//   a recursive `Get-ChildItem`/`dir /s`/`ls -R` that is not a list of names (in Windows a leading
//   dot hides nothing, so `| Select-String KEY` reads the `.env` files), `printenv`, `env`, `set`,
//   `export` or `declare -x` alone, `%VAR%`, `Get-ChildItem env:`, `tar … -`, `curl` uploads.
// WHAT STAYS OUT, and no change to this list closes: an alias or function already configured (`git
// p` for `git push`), the CONTENT of a script (`bash build.sh`, `make clean`, `npm run clean`), and
// every tool that is not named here. Long options of git count when they are a prefix of a dangerous
// one (`--har`), because git accepts them.
//
// HOW TO CHANGE THIS LIST (issue #184: six reviews reopened a covered family by another door):
// - Test a family in EVERY door, not in the one that was reported: add the core to
//   `DANGEROUS_CORES` and the door to `ASKING_DOORS` in `destructiveCommand.test.ts` (prefixes,
//   `export`, `env`, `sudo`, launchers, `bash -c`, escapes, separators). A new door goes in that
//   list too: the doors are private sets here (`TRANSPARENT`, `ELEVATORS`, `RUNNERS`, and the
//   launchers `npx`, `pnpm exec`, `corepack <pm>`, `uv tool run`…), so the test keeps its own copy.
//   A runner or launcher that classifies the command after it is a door for EVERY family.
// - An exception is for the EXACT command (`GIT_EDITOR=true`, `git rm --cached`), never for a
//   whole tool or a whole option family.
// - Options that take a value are a table per tool (`NPM_VALUE_OPTIONS`, `UVX_VALUE_OPTIONS`,
//   `TERRAFORM_VALUE_OPTIONS`): a value read as the command is how `-w a rimraf` slipped through.
// - Probe daily use before believing a rule: add the commands people type all day (`date
//   +%Y%m%d`, `git log --format=%H%n%B`, `node -v`, `terraform plan -var x=1`) to `DAILY_CORES`,
//   so a rule that asks for them shows up as a red case, not as a user turning Auto off.
// - A CLI that is also run through `npx` is classified under the npm PACKAGE name (`firebase-tools`,
//   `netlify-cli`, `aws-cdk`), so add that name next to the binary's.
//
// What the server sends for a `shell` permission (read in the v2.0.32 tag, NOT run against a real
// server): `resources` holds one entry per simple command the tool's parser found, the text of the
// command node (with its redirection when it has one), `shell.ts` L138-146 and `shell/parse.ts`
// L185-198 of `anomalyco/opencode@843a6c51`. A line such as `a && b | c` therefore arrives as
// several resources, but this module still splits what it is given, so a whole line works too.
// Auto only answers what opencode asks: a command that opencode's own rules allow runs the same in
// Manual and in Auto.

import { isSecretPath } from './secretPaths';

/** Words that open or close a shell construct and are skipped to reach the command they precede. */
const SYNTAX_WORDS = new Set([
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'for',
  'while',
  'until',
  'do',
  'done',
  'case',
  'esac',
  'function',
  'select',
  'coproc',
  '{',
  '}',
  '!',
]);

/**
 * Prefixes that run the next command unchanged and are skipped (see `segmentAsks` for options).
 * `cross-env` takes `NAME=value` like `env`; `shx` runs a portable `rm`, `mv`, `cp`…
 */
const TRANSPARENT = new Set([
  'command',
  'builtin',
  'nohup',
  'time',
  'exec',
  'env',
  'cross-env',
  'shx',
  'nice',
  'timeout',
]);

/** Commands that elevate privileges or switch user: whatever follows is out of our sight. */
const ELEVATORS = new Set(['sudo', 'su', 'doas', 'pkexec', 'runas', 'gsudo', 'run0', 'sudoedit']);

/**
 * Commands that ask whatever follows: they run text or another command that their options make hard
 * to classify (each could be made transparent like `env`, but their options differ per system, so in
 * doubt they ask), open a shell or a program that executes commands, SQL clients (their scripts reach
 * the shell with `\!`, `system` or `.shell`), or print the environment.
 */
const OPAQUE = new Set([
  'eval',
  'xargs',
  'source',
  '.',
  'parallel',
  'iex',
  'invoke-expression',
  'invoke-command',
  'icm',
  'start-process',
  'saps',
  'start',
  'watch',
  'alias',
  'trap',
  'wsl',
  'busybox',
  'ssh',
  'setsid',
  'stdbuf',
  'flock',
  'ionice',
  'taskset',
  'chroot',
  'runuser',
  'firejail',
  'strace',
  'ltrace',
  'unbuffer',
  'caffeinate',
  'script',
  'forfiles',
  'psexec',
  'wmic',
  'schtasks',
  'invoke-wmimethod',
  'nsenter',
  'unshare',
  'systemd-run',
  'gosu',
  'xvfb-run',
  'winpty',
  'noglob',
  'nocorrect',
  'gdb',
  'valgrind',
  'nodemon',
  'concurrently',
  'dotenv',
  'env-cmd',
  'nix-shell',
  'nix',
  'devbox',
  'direnv',
  'emacs',
  'tclsh',
  'expect',
  'elixir',
  'erl',
  'groovy',
  'racket',
  'guile',
  'jshell',
  'vim',
  'nvim',
  'vi',
  'ex',
  'view',
  'awk',
  'gawk',
  'mawk',
  'nawk',
  'pkill',
  'killall',
  'nc',
  'ncat',
  'netcat',
  'foreach-object',
  'foreach',
  'printenv',
  'psql',
  'mysql',
  'mariadb',
  'sqlite3',
  'sqlcmd',
  'sqlplus',
  'duckdb',
]);

/**
 * Commands that delete or overwrite files whatever their flags (a deletion asks, as an `edit` that
 * deletes does). `mv` and `cp` (and the Windows and PowerShell spellings) are here because they
 * overwrite or move, and whether the destination exists is not known.
 */
const DELETERS = new Set([
  'rm',
  'unlink',
  'shred',
  'srm',
  'rimraf',
  'del',
  'erase',
  'remove-item',
  'ri',
  'mv',
  'cp',
  'move',
  'copy',
  'move-item',
  'mi',
  'copy-item',
  'cpi',
]);

/** Disk, power, database and filesystem commands that are destructive by nature. */
const ALWAYS_DESTRUCTIVE = new Set([
  'dd',
  'format',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  'truncate',
  'wipefs',
  'fdisk',
  'sfdisk',
  'parted',
  'diskpart',
  'restart-computer',
  'stop-computer',
  'clear-disk',
  'format-volume',
  'clear-content',
  'clc',
  'dropdb',
  'dropuser',
]);

/** Shells (POSIX and others with `-c`): an inline script or stdin is unclassifiable. */
const POSIX_SHELLS = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  'fish',
  'ash',
  'xonsh',
  'nu',
  'elvish',
]);

/** Runtimes that take `-e`/`-p` inline code like Node (`tsx`, `ts-node`, `esno` wrap it). */
const NODE_LIKE = new Set(['node', 'nodejs', 'tsx', 'ts-node', 'esno']);

/** Interpreters (besides Python, Node-likes and Deno) and the letters of their inline-code flags. */
const INLINE_LETTERS: Record<string, string> = {
  perl: 'eE',
  ruby: 'e',
  php: 'rRBE',
  lua: 'e',
  rscript: 'e',
  r: 'e',
  julia: 'eE',
  osascript: 'e',
};

/**
 * Tools that run another program after a `run`/`exec`/`x` subcommand and are classified by it
 * (`uv run pytest` yes, `uv run --with x pytest` asks because an option could take a value).
 */
const RUNNERS = new Set([
  'uv',
  'poetry',
  'pipx',
  'mise',
  'asdf',
  'bundle',
  'conda',
  'pipenv',
  'pyenv',
  'volta',
  'fnm',
  'corepack',
  'hatch',
  'pdm',
  'rye',
  'pixi',
  'rtx',
  'lerna',
  'nx',
  'bun',
]);

/** Characters that make a command word an expansion, a glob or a brace list (`!` and backtick too). */
const EXPANSION = /[$*?[\]{}`!]/;

/** A leading `NAME=value` assignment. */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;

/**
 * Names of environment variables that change what a program executes (git's `GIT_SSH_COMMAND`,
 * `GIT_EXTERNAL_DIFF`, `GIT_CONFIG_*`, pagers, the loader, interpreter options, `PATH`…). A prefix
 * `NAME=value` with one of them asks. Any other prefix (`CI=1 npm test`) does not: it cannot be
 * bounded further without asking for every `NODE_ENV=test`.
 */
const EXEC_ENV =
  /^(GIT_|LD_|DYLD_|TF_CLI_ARGS|PYTHON|PERL|RUBY|JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|NODE_OPTIONS|NODE_PATH|NPM_CONFIG_|BASH_ENV$|ENV$|PROMPT_COMMAND$|PATH$|IFS$|SHELL$|EDITOR$|VISUAL$|BROWSER$|LESSOPEN$|PULUMI_SKIP_CONFIRMATIONS$)|PAGER|_(COMMAND|CMD)$/i;

/**
 * The assignments of {@link EXEC_ENV} names that are approved because their value cannot run
 * anything (decision `ronda-lista-negra-4`): exactly `GIT_EDITOR=true`, `GIT_TERMINAL_PROMPT=0`,
 * `NODE_OPTIONS=--max-old-space-size=<n>` and nothing else in that variable, and `PYTHONPATH` with a
 * plain path. The rest of the family keeps asking.
 */
const HARMLESS_ENV =
  /^(GIT_EDITOR=true|GIT_TERMINAL_PROMPT=0|NODE_OPTIONS=--max-old-space-size=\d+|PYTHONPATH=[\w./:~-]+)$/;

/** True for a word `NAME=value` whose NAME is in {@link EXEC_ENV} and is not {@link HARMLESS_ENV}. */
function execEnv(word: string): boolean {
  return (
    ASSIGNMENT.test(word) &&
    EXEC_ENV.test(word.slice(0, word.indexOf('=')).replace(/\+$/, '')) &&
    !HARMLESS_ENV.test(word)
  );
}

/** Files `tee` and friends may "write" without destroying anything. */
const HARMLESS_TARGETS = new Set(['/dev/null', 'nul', '$null', '/dev/stdout', '/dev/stderr']);

/** A command name that is a plain literal identifier. */
const LITERAL_NAME = /^[a-z0-9_][a-z0-9_.+@-]*$/;

/**
 * One simple command: its words with quotes removed, for each word whether it had an unquoted `*`,
 * `?`, `[`, `]`, `{`, `}` (git's `@{u}` excepted) or a `$` (also inside double quotes, which the
 * shell expands), and whether the command overwrites a file with `>`.
 */
interface Segment {
  words: string[];
  metas: boolean[];
  /** For each word, whether it had a backslash outside quotes (an escape in POSIX shells). */
  escs: boolean[];
  overwrites: boolean;
}

/**
 * Splits `text` into simple commands at unquoted `;`, `&&`, `||`, `|`, `&`, `(`, `)` and line
 * breaks, removing quotes from the words. Returns `undefined` when it cannot do it safely: an
 * unbalanced quote, a substitution (`$(`, a backtick, `<(`, `>(`), which hides a command, or a
 * PowerShell call operator (`& expr`, a `&` that opens a command), which runs an expression.
 * `>` is recorded as an overwrite unless it is `>>`, a descriptor copy (`2>&1`, `>&-`; `>&a` is a
 * write to `a`) or a write to `/dev/null` or `nul`.
 * A backslash outside quotes keeps itself and the character after it in the word (so `\'` does not
 * open a quote and `\<newline>` stays in the word) and marks the word in `escs`; the caller reads
 * such a word twice, as written (a Windows path) and without the backslashes (a POSIX escape).
 */
function split(text: string): Segment[] | undefined {
  if (text.includes('`') || text.includes('$(') || text.includes('<(') || text.includes('>(')) {
    return undefined;
  }
  const segments: Segment[] = [];
  let words: string[] = [];
  let metas: boolean[] = [];
  let escs: boolean[] = [];
  let overwrites = false;
  let word: string | undefined;
  let wordMeta = false;
  let wordEsc = false;
  let inAtBrace = false;
  let quote: '"' | "'" | undefined;
  const endWord = (): void => {
    if (word !== undefined) {
      words.push(word);
      metas.push(wordMeta);
      escs.push(wordEsc);
    }
    word = undefined;
    wordMeta = false;
    wordEsc = false;
    inAtBrace = false;
  };
  const endSegment = (): void => {
    endWord();
    if (words.length > 0) segments.push({ words, metas, escs, overwrites });
    words = [];
    metas = [];
    escs = [];
    overwrites = false;
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (quote !== undefined) {
      if (ch === quote) quote = undefined;
      else if (ch === '\\' && quote === '"' && text.charAt(i + 1) === '"') {
        word = (word ?? '') + '"';
        i += 1;
      } else {
        word = (word ?? '') + ch;
        if (quote === '"' && ch === '$') wordMeta = true; // double quotes still expand `$`
      }
      continue;
    }
    if (ch === '\\') {
      // An escape: the shell drops the backslash and keeps the next character as a literal.
      word = (word ?? '') + ch + text.charAt(i + 1);
      wordEsc = true;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      word = word ?? '';
      continue;
    }
    if (ch === ';' || ch === '|' || ch === '&' || ch === '(' || ch === ')' || ch === '\n') {
      // `2>&1` and `&>`: the `&` belongs to a redirection, not to a separator.
      if (ch === '&' && (text.charAt(i - 1) === '>' || text.charAt(i + 1) === '>')) {
        word = (word ?? '') + ch;
        continue;
      }
      // A single `&` that opens a command is PowerShell's call operator: what follows is an expression.
      if (
        ch === '&' &&
        text.charAt(i - 1) !== '&' &&
        text.charAt(i + 1) !== '&' &&
        words.length === 0 &&
        word === undefined
      ) {
        return undefined;
      }
      endSegment();
      continue;
    }
    if (ch === '>') {
      const next = text.charAt(i + 1);
      if (next === '>') {
        i += 1; // append
        endWord();
        continue;
      }
      if (next === '&') {
        // `>&` copies a descriptor only before a digit or `-` (`2>&1`, `>&-`); `>&a` writes the file `a`.
        if (!/[\d-]/.test(text.charAt(i + 2))) overwrites = true;
        endWord();
        continue;
      }
      const target = /^\s*(\S+)/.exec(text.slice(i + 1))?.[1]?.toLowerCase();
      if (target !== '/dev/null' && target !== 'nul' && target !== '$null') overwrites = true;
      // A descriptor number before `>` is part of the operator, not a word.
      if (word !== undefined && /^\d$/.test(word)) word = undefined;
      endWord();
      continue;
    }
    if (/\s/.test(ch)) {
      endWord();
      continue;
    }
    // git's revision syntax `@{u}`, `@{upstream}`, `@{-1}`: the braces are not a brace expansion.
    if (ch === '{' && word?.endsWith('@') === true) inAtBrace = true;
    else if (ch === '}' && inAtBrace) inAtBrace = false;
    else if (/[*?[\]{}$]/.test(ch)) wordMeta = true;
    word = (word ?? '') + ch;
  }
  if (quote !== undefined) return undefined;
  endSegment();
  return segments;
}

/** Lower-case base name of a command word: `/bin/rm`, `C:\Tools\RM.EXE` and `rm` are all `rm`. */
function baseName(word: string): string {
  const last = word.split(/[\\/]/).pop() ?? word;
  return last.toLowerCase().replace(/\.(exe|cmd|bat|com|ps1)$/, '');
}

/**
 * The name of the tool a launcher runs: `baseName` without a version (`rimraf@5`, `ovsx@latest`,
 * `@vscode/vsce@2` are `rimraf`, `ovsx`, `vsce`).
 */
function toolName(word: string): string {
  const name = baseName(word);
  const bare = name.replace(/@[^/@]*$/, '');
  return bare === '' ? name : bare;
}

/**
 * The names a command word can have once the shell has read it: `baseName` with the backslashes as
 * path separators (Windows) and with them removed as escapes (`r\m` is `rm`, `/bin/r\m` too). Both
 * are classified, and the command asks when either does.
 */
function namesOf(word: string): string[] {
  return [...new Set([baseName(word), baseName(word.replace(/\\/g, ''))])];
}

/** True when some flag token (`-rf`) carries ANY of the single letters in `letters`. */
function hasShort(args: readonly string[], letters: string): boolean {
  return args.some(
    (arg) => /^-[A-Za-z]+$/.test(arg) && [...letters].some((letter) => arg.includes(letter)),
  );
}

/** True when some argument equals one of `names`, compared case-insensitively. */
function hasAny(args: readonly string[], names: readonly string[]): boolean {
  const wanted = names.map((name) => name.toLowerCase());
  return args.some((arg) => wanted.includes(arg.toLowerCase()));
}

/** True when some short-flag cluster (`-pe`, never `--long`) carries one of `letters`. */
function cluster(args: readonly string[], letters: string): boolean {
  return args.some(
    (arg) => !arg.startsWith('--') && new RegExp(`^-[A-Za-z]*[${letters}]`).test(arg),
  );
}

/**
 * True when some argument is one of the long options `fulls` or an abbreviation of one (`--har` for
 * `--hard`): git's option parser, and many others', accept any unambiguous prefix, so a prefix counts
 * as the dangerous option (an ambiguous one is a false positive). `--x=value` is read as `--x`.
 */
function longOpt(args: readonly string[], ...fulls: string[]): boolean {
  return args.some((arg) => {
    if (!arg.startsWith('--') || arg.length <= 2) return false;
    const name = arg.split('=')[0] ?? arg;
    return fulls.some((full) => full.startsWith(name));
  });
}

/** The arguments that are not options (do not start with `-`). */
function operands(args: readonly string[]): string[] {
  return args.filter((arg) => !arg.startsWith('-'));
}

/**
 * The git subcommand and its arguments, skipping the global options that come before it, or `null`
 * when a global option makes git run something we cannot see: `-c` (also glued, `-ckey=v`),
 * `--config-env` (can define an alias that starts with `!`, or `core.sshCommand`) and `--exec-path`.
 */
function gitParts(args: readonly string[]): { sub: string; rest: string[] } | null | undefined {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? '';
    if (arg.startsWith('-c') || arg.startsWith('--config-env') || arg.startsWith('--exec-path')) {
      return null;
    }
    if (
      arg === '-C' ||
      arg === '--git-dir' ||
      arg === '--work-tree' ||
      arg === '--namespace' ||
      arg === '--super-prefix' ||
      arg === '--attr-source'
    ) {
      i += 1;
    } else if (!arg.startsWith('-')) {
      return { sub: arg.toLowerCase(), rest: args.slice(i + 1) };
    }
  }
  return undefined;
}

/**
 * True when this git invocation can lose work, rewrite or delete history, publish, or run a command
 * that is not git. Long options count by prefix ({@link longOpt}). Families: destructive
 * subcommands; `config` that writes (an `alias.*`, `core.pager`, `core.fsmonitor`, `core.sshCommand`,
 * `*.cmd`, `credential.helper` or `core.hooksPath` key runs a program later); `credential`; and the
 * options and subcommands that execute a command (`rebase --exec`, `submodule foreach`, `bisect
 * run`, `difftool --extcmd`, `--upload-pack` of clone/fetch/pull/ls-remote, `grep -O`, `--ext-diff`).
 */
function gitDestructive(sub: string, rest: readonly string[]): boolean {
  if (longOpt(rest, '--exec', '--extcmd', '--upload-pack', '--receive-pack', '--exec-path')) {
    return true;
  }
  if (longOpt(rest, '--open-files-in-pager', '--ext-diff', '--config', '--config-env')) return true;
  switch (sub) {
    case 'reset':
      return longOpt(rest, '--hard');
    case 'clean':
      return hasShort(rest, 'fxXd') || longOpt(rest, '--force');
    case 'push':
      // Every push asks (decision `infra-y-publicar`): it publishes work that cannot be taken back
      // from the remote, forced or not (`--force`, `--delete`, `:ref` and `+ref` included).
      return true;
    case 'branch':
      return (
        rest.some((arg) => /^-[A-Za-z]*D[A-Za-z]*$/.test(arg)) ||
        ((longOpt(rest, '--delete') || hasShort(rest, 'd')) &&
          (longOpt(rest, '--force') || hasShort(rest, 'f')))
      );
    case 'checkout': {
      // `git checkout <path>` restores the path and discards its changes, and it reads the same as
      // `git checkout <branch>`: only creating a branch or switching to ONE plain word is approved.
      if (rest.includes('--') || rest.includes('.') || rest.includes('-f')) return true;
      if (longOpt(rest, '--force')) return true;
      if (rest.includes('-b') || rest.includes('-B') || longOpt(rest, '--orphan')) return false;
      const targets = operands(rest);
      return targets.length > 1 || (targets.length === 1 && !/^[\w-]+$/.test(targets[0] ?? ''));
    }
    case 'switch':
      return longOpt(rest, '--discard-changes', '--force') || rest.includes('-f');
    case 'restore':
      // Only `--staged` (unstage) leaves the working tree alone.
      return !(
        (rest.includes('--staged') || rest.includes('-S')) &&
        !longOpt(rest, '--worktree') &&
        !rest.includes('-W')
      );
    case 'stash':
      return rest[0] === 'drop' || rest[0] === 'clear';
    case 'rm':
      return !rest.includes('--cached');
    case 'filter-branch':
    case 'filter-repo':
    case 'prune':
    case 'prune-packed':
    case 'credential':
      return true;
    case 'gc':
      return longOpt(rest, '--prune');
    case 'reflog':
      return rest[0] === 'expire' || rest[0] === 'delete';
    case 'tag':
      return hasShort(rest, 'd') || longOpt(rest, '--delete');
    case 'update-ref':
      return hasShort(rest, 'd');
    case 'worktree':
    case 'remote':
      return ['remove', 'rm', 'prune'].includes(rest[0] ?? '');
    case 'config': {
      const read =
        longOpt(rest, '--get', '--get-all', '--get-regexp', '--list', '--get-urlmatch') ||
        hasShort(rest, 'l');
      const write =
        longOpt(
          rest,
          '--add',
          '--unset',
          '--unset-all',
          '--replace-all',
          '--edit',
          '--rename-section',
          '--remove-section',
        ) || hasShort(rest, 'e');
      return write || (!read && operands(rest).length >= 2);
    }
    case 'submodule':
      return rest.includes('foreach');
    case 'bisect':
      return rest.includes('run');
    case 'rebase':
      return hasShort(rest, 'x');
    case 'difftool':
      return hasShort(rest, 'x');
    case 'clone':
      // `-c key=value` of clone sets configuration in the new repository (`core.sshCommand`,
      // `core.fsmonitor`); `-u` is `--upload-pack`. (`switch -c` creates a branch: not here.)
      return hasShort(rest, 'u') || rest.some((arg) => /^-c/.test(arg) && !arg.startsWith('--'));
    case 'fetch':
    case 'pull':
    case 'ls-remote':
      return hasShort(rest, 'u');
    case 'grep':
      return rest.some((arg) => arg.startsWith('-O'));
    default:
      return false;
  }
}

/**
 * `tee` overwrites each file it names unless it appends (`-a`, `--append`). Whether the file exists
 * is not known here, so a named file asks (W9 of the review of E3-work-mode).
 */
function teeOverwrites(args: readonly string[]): boolean {
  const files = args.filter(
    (arg) => !arg.startsWith('-') && !HARMLESS_TARGETS.has(arg.toLowerCase()),
  );
  return files.length > 0 && !(args.includes('--append') || cluster(args, 'a'));
}

/**
 * True for `powershell`/`pwsh` unless they run a script file: the arguments may only be the harmless
 * switches, `-ExecutionPolicy <x>` and then `-File` (or a prefix of it). A bare shell, `-Command`,
 * `-EncodedCommand`, `-e`, and a positional command (which Windows PowerShell 5.1 reads as
 * `-Command`) all ask.
 */
function powershellAsks(args: readonly string[]): boolean {
  for (let i = 0; i < args.length; i += 1) {
    const arg = (args[i] ?? '').toLowerCase();
    if (['-nologo', '-noprofile', '-noninteractive', '-nol', '-nop', '-noni'].includes(arg))
      continue;
    if (['-executionpolicy', '-ep', '-exec'].includes(arg)) {
      i += 1;
      continue;
    }
    // `-File -` reads the script from stdin (VERIFIED in Windows PowerShell 5.1, review #2009).
    if (/^-f(?:i(?:l(?:e)?)?)?$/.test(arg)) return (args[i + 1] ?? '-') === '-';
    return true;
  }
  return true;
}

/**
 * True for a POSIX-like shell that runs text we cannot see: it reads stdin (`-`, `/dev/stdin`, a
 * redirection, a heredoc, or NO script operand once the options are skipped, so `curl x | bash -e`
 * asks), or it is given a command (`-c`) or `-s`. `bash script.sh`, `bash -e script.sh` and
 * `bash --version` are approved. `fish -C` / `--init-command` and `nu -e` / `--execute` take a
 * command, like `-c` (HYPOTHESIS, from their manuals; fish and nu were not run). A short option group that ends in `o` or `O` (`-o`, `-eo`, `-euo`)
 * takes the next argument as its value (`pipefail`), and so do `--rcfile` and `--init-file`: those
 * values are skipped, not read as the script.
 */
function shellAsks(command: string, args: readonly string[]): boolean {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? '';
    if (arg === '-' || arg === '/dev/stdin' || arg.startsWith('<')) return true;
    if (command === 'fish' && (arg === '-C' || arg === '--init-command')) return true;
    if (command === 'nu' && ['-e', '--execute', '--commands'].includes(arg)) return true;
    if (arg === '--version' || arg === '--help') return false; // prints and exits
    if (!arg.startsWith('-') && !arg.startsWith('+')) return false; // the script
    if (!arg.startsWith('--') && /^-[A-Za-z]*[cs]/.test(arg)) return true;
    if (/^[-+][A-Za-z]*[oO]$/.test(arg) || ['--rcfile', '--init-file'].includes(arg)) i += 1;
  }
  return true; // only options: it reads its commands from stdin
}

/**
 * Flags that print the version or the help and exit, so the interpreter does not read stdin:
 * `-V`, `--version`, `-h`, `--help` (VERIFIED for `python`, `node`, `bash` and `perl` in Windows,
 * review #2009: `python -V -c`, `node -v -e` and `perl -v -e` print and run nothing), and `-v`
 * ONLY for node, perl and php (VERIFIED for node and perl; HYPOTHESIS for php and for `tsx`,
 * `ts-node` and `esno`, which wrap node and were not run). In Python `-v` is verbose, in Ruby (VERIFIED: `ruby
 * -v -e` prints the version AND runs the code) and in Lua (HYPOTHESIS, from its manual) it prints the
 * version and goes on, so those stay "options only".
 */
function printsAndExits(command: string, arg: string): boolean {
  if (['-V', '--version', '-h', '--help'].includes(arg)) return true;
  return arg === '-v' && (NODE_LIKE.has(command) || command === 'perl' || command === 'php');
}

/**
 * True for an interpreter that runs inline code or reads its program from stdin: Python (`-c`, a
 * `-m module` is classified as that tool, so `python -m twine upload` asks and `-m pytest` does not),
 * Node and its wrappers (`-e`/`-p`, `--import`/`--require`/`-r`/`--loader`, which run code before the
 * script), Deno (`eval`, `repl`, and `publish`, which publishes), Django's `python manage.py flush|
 * reset_db|sqlflush` (they empty the database) and the rest of {@link INLINE_LETTERS}. In all of them a `-`, an
 * argument that starts with `<` (redirection, heredoc, here-string) or NO script operand after the
 * options (only flags: `python -u`, `node --no-warnings`, `perl -w`) means stdin. Any other command
 * returns false.
 */
function interpreterAsks(command: string, args: readonly string[]): boolean {
  const python = /^(python|pypy|pythonw)\d*(\.\d+)*$/.test(command) || command === 'py';
  const letters = INLINE_LETTERS[command];
  if (!python && !NODE_LIKE.has(command) && command !== 'deno' && letters === undefined) {
    return false;
  }
  if (args.some((arg) => arg === '-' || arg.startsWith('<'))) return true;
  if (command === 'deno') {
    return (
      args.length === 0 ||
      args.some(
        (arg) => arg === 'eval' || arg === 'repl' || arg === 'publish' || arg.startsWith('--eval'),
      )
    );
  }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? '';
    if (!arg.startsWith('-')) {
      // The script; Django's `manage.py flush|reset_db|sqlflush` empties the database.
      return (
        python &&
        /manage\.py$/i.test(arg) &&
        args.slice(i + 1).some((rest) => /^(flush|reset_db|sqlflush)$/.test(rest))
      );
    }
    // `node -v`, `python --version`, `node --test` print or run files and do not read stdin.
    // (`--test-reporter=…` and `--test-only` read stdin or run code: only the whole words count.)
    if (printsAndExits(command, arg) || (NODE_LIKE.has(command) && /^--(test|run)$/.test(arg))) {
      return false;
    }
    if (python) {
      if (!arg.startsWith('--') && arg.slice(1).includes('c')) return true;
      if (arg.startsWith('-m') && !arg.startsWith('--')) {
        const module = arg.length > 2 ? arg.slice(2) : args[i + 1];
        const rest = args.slice(arg.length > 2 ? i + 1 : i + 2);
        return module === undefined || launchedAsks(toolName(module), rest);
      }
      if (arg === '-W' || arg === '-X' || arg === '--check-hash-based-pycs') i += 1;
    } else if (NODE_LIKE.has(command)) {
      if (/^--(eval|print)(=|$)/.test(arg)) return true;
      if (!arg.startsWith('--') && /[ep]/.test(arg.slice(1))) return true;
      if (/^--(import|require|loader|experimental-loader)/.test(arg)) return true;
      if (!arg.startsWith('--') && arg.startsWith('-r')) return true;
      if (['--input-type', '--conditions', '-C', '--title'].includes(arg)) i += 1;
    } else if (letters !== undefined && cluster([arg], letters)) {
      return true;
    }
  }
  return true; // only options: stdin
}

/**
 * True when the launcher's command line asks: `npx`, `bunx`, `pnpx`, `uvx` and `npm|pnpm|yarn
 * exec|dlx`, given the arguments after the launcher's own subcommand. The tool is the first word that
 * is not an option, skipping the values that THIS launcher takes as a separate word, and it is then
 * classified with its own arguments (its `@version` removed):
 * - `npm` and `npx` skip the values of `-w`, `--workspace` and `--prefix`. VERIFIED on Windows 11
 *   with Node 24 (07/11/2026, the bundled module run against a probe of 52 command lines): `npx -w a
 *   rimraf dist` asks, `npx -w a tsc` does not.
 * - `uvx` skips the value of `--python`: `uvx --python 3.12 ruff check` does not ask. Same probe.
 * - `pnpm`, `yarn` and `bunx` skip no value, so there `-w` is a flag and the tool is the next word:
 *   `pnpm exec -w rimraf dist` asks, the example of what this function is for. HYPOTHESIS: that
 *   `-w` is a boolean flag in pnpm and yarn comes from their documentation; not run against the
 *   real binaries. The probe above only checked what this module answers for the text.
 * - `-c`/`--call` run a shell string, and `-p`/`--package`, `--from` and `--with` change which
 *   package supplies the tool: they always ask. `npx ovsx@latest publish` asks (the tool is `ovsx`,
 *   its version dropped), `npx prettier --check .` does not. Options with a value that are not listed (`--registry u`) are read as the
 *   tool: a known limit.
 */
function launcherAsks(args: readonly string[], launcher: string): boolean {
  // The tool is the first word that is not an option nor the value of one that takes a value in THIS
  // launcher: `-w`, `--workspace` and `--prefix` in npm and npx (`npx -w a rimraf dist` asks, the
  // tool is `rimraf`), `--python` in uvx. In pnpm and yarn `-w` is a flag (HYPOTHESIS, see the
  // header), so `pnpm exec -w rimraf dist` runs `rimraf`.
  const valued =
    launcher === 'uvx'
      ? UVX_VALUE_OPTIONS
      : launcher === 'npm' || launcher === 'npx'
        ? NPM_VALUE_OPTIONS
        : undefined;
  let first = 0;
  while (first < args.length) {
    const arg = args[first] ?? '';
    if (valued?.has(arg) === true) first += 2;
    else if (arg.startsWith('-')) first += 1;
    else break;
  }
  if (first >= args.length) first = -1;
  // Only the launcher's own options count: `npx tsc -p tsconfig.json` has the tool's `-p`.
  const own = first < 0 ? args : args.slice(0, first);
  if (
    own.some(
      (arg) =>
        arg === '-c' ||
        arg === '--call' ||
        arg.startsWith('--call=') ||
        arg === '-p' ||
        arg.startsWith('--package') ||
        arg.startsWith('--from') ||
        arg.startsWith('--with'),
    )
  ) {
    return true;
  }
  const tool = first;
  const word = args[tool];
  if (tool < 0 || word === undefined) return false;
  const name = toolName(word);
  if (!LITERAL_NAME.test(name)) return true;
  return launchedAsks(name, args.slice(tool + 1));
}

/**
 * Classifies a command that a launcher runs (`npx`, `uv run`, `python -m`, `yarn <bin>`…) as a
 * command line of its own: transparent prefixes and `NAME=value` are skipped, so `npx shx rm -rf x`,
 * `npx cross-env A=1 rimraf dist` and `uv run env GIT_SSH_COMMAND=x git fetch` ask like the bare
 * `rm`, `rimraf` and `git fetch` do. Its arguments carry no marks (the launcher's own line was
 * marked as a whole).
 */
function launchedAsks(tool: string, args: readonly string[]): boolean {
  const words = [tool, ...args];
  const none = words.map(() => false);
  return segmentAsks(words, none, none);
}

/** The package managers `corepack` runs by name; their line is classified as if typed without it. */
const PACKAGE_MANAGERS = new Set(['pnpm', 'pnpx', 'yarn', 'yarnpkg', 'npm', 'npx']);

/** Subcommands that launch another program; one after a global option makes a runner line ask. */
const LAUNCH_WORDS = new Set(['run', 'exec', 'x']);

/**
 * True for `uv run X`, `poetry run X`, `bun x X`, `mise exec -- X`… (the {@link RUNNERS}): after
 * `run`, `exec` or `x` the tool must come right away (an option before it could take a value, so it
 * asks) and is classified with its arguments. `uv publish` and `poetry publish` ask. Two runners
 * nest another launcher and are classified by what they run: `corepack <pm> …` (`pnpm`, `yarn`,
 * `npm`, `npx`, `pnpx`: `corepack pnpm rm -rf x` asks like `pnpm rm -rf x`; `corepack enable` and
 * `corepack pnpm install` are approved) and `uv tool run X` (as `uvx X`). Other subcommands (`uv
 * sync`, `bun install`) are approved. `hatch run X` asks like the others, so `hatch run test:cov`
 * asks too (a name with `:` is not a literal tool): deliberate, decision of Sergio 07/11/2026.
 * `corepack` followed by a word that is not a package manager goes on to the `run|exec|x` reading
 * like any runner. `mise|rtx exec|x <tool[@ver]>… -- <command>` is classified by the command after
 * `--`: with no tool before `--` (`mise exec -- git status`, decision 07/11/2026), no `--`, an
 * option or a non-literal name among the tools (`mise exec cargo:x -- ls`) or no command, it asks
 * (`mise exec node -- git status` is approved: the tool is explicit and the command is harmless). A global option before the subcommand (`uv --quiet
 * run pytest`, `hatch -e test run pytest`) makes the line ask whenever `run`, `exec`, `x` or a
 * package manager appears, because whether the option takes a value is unknown: asking for those
 * daily-use lines is deliberate (decision of Sergio 07/11/2026). `unpublish` asks like `publish`.
 * The nested forms of `corepack`, `uv tool run`, `hatch`, `nix` (all of `nix …` asks, see `OPAQUE`) and
 * `dotnet tool run` (in `commandAsks`) are the ones PROBED, not a proof that there are no others
 * (HYPOTHESIS, read from the tools' documentation; no real binary was run). VERIFIED by the checks
 * "asks for what corepack and uv tool run launch, and approves their daily use", "asks for hatch
 * run, nix and dotnet tool run, on purpose" and "asks for the closing round of runner forms" of
 * `destructiveCommand.test.ts` (07/11/2026, Windows 11, Node 24; fabricated text).
 */
function runnerAsks(command: string, args: readonly string[]): boolean {
  if (command === 'bun' && (cluster(args, 'ep') || longOpt(args, '--eval', '--print'))) return true;
  if (
    command === 'bun' &&
    (args.length === 0 || args.some((a) => a === '-' || a.startsWith('<')))
  ) {
    return true;
  }
  if (hasAny(args, ['publish', 'unpublish'])) return true;
  // A global option before the subcommand (`uv --quiet run rm -rf x`, `hatch -e test run …`,
  // `corepack --x pnpm …`) may or may not take a value, so where the subcommand starts is unknown:
  // when such a line names a launching subcommand or package manager anywhere, it asks.
  if (
    args[0]?.startsWith('-') === true &&
    args.some((arg) => LAUNCH_WORDS.has(arg) || PACKAGE_MANAGERS.has(toolName(arg)))
  ) {
    return true;
  }
  if (command === 'corepack') {
    // `corepack pnpm rm -rf x` runs the package manager it names with the rest of the line; any
    // other word goes on to the `run|exec|x` reading below, as it did before.
    const manager = args[0] === undefined ? '' : toolName(args[0]);
    if (PACKAGE_MANAGERS.has(manager)) return launchedAsks(manager, args.slice(1));
  }
  if ((command === 'mise' || command === 'rtx') && (args[0] === 'exec' || args[0] === 'x')) {
    // `mise exec <tool[@ver]>… -- <command>`: what follows `--` is the command. Without a tool
    // before `--` (decision of Sergio, 07/11/2026), without `--`, with an option before it or with
    // no command after it, it asks.
    const dashes = args.indexOf('--');
    const tools = args.slice(1, dashes < 0 ? undefined : dashes);
    const run = dashes < 0 ? [] : args.slice(dashes + 1);
    const [word, ...rest] = run;
    // A tool whose name is not literal (`cargo:x`, `npm:rimraf`) asks, as it did before the `--`
    // reading existed (closing review of #184).
    const odd = (tool: string): boolean =>
      tool.startsWith('-') || !LITERAL_NAME.test(toolName(tool));
    if (tools.length === 0 || tools.some(odd) || word === undefined) {
      return true;
    }
    const name = toolName(word);
    return !LITERAL_NAME.test(name) || launchedAsks(name, rest);
  }
  // `uv tool run X` is `uvx X`: the same launcher, classified by the tool it runs.
  if (command === 'uv' && args[0] === 'tool' && args[1] === 'run') {
    return launcherAsks(args.slice(2), 'uvx');
  }
  const sub = args[0];
  if (sub !== 'run' && sub !== 'exec' && sub !== 'x') return false;
  const word = args[1];
  if (word === undefined) return false;
  if (word.startsWith('-')) return true;
  const name = toolName(word);
  return !LITERAL_NAME.test(name) || launchedAsks(name, args.slice(2));
}

/**
 * Options of `pnpm` and `yarn` that take the next word as their value, so it is not the binary. `-w`
 * and `--workspace` are NOT here: in pnpm they are the boolean `--workspace-root` (HYPOTHESIS, from
 * its documentation; not run), and in yarn there is no such option (HYPOTHESIS too, yarn was not
 * run). In npm they take a value, see {@link NPM_VALUE_OPTIONS}.
 */
const PACKAGE_VALUE_OPTIONS = new Set(['--filter', '-F', '--filter-prod', '-C', '--dir', '--cwd']);

/** The subcommands of `vercel` that deploy nothing; everything else (a path, a flag alone) deploys. */
const VERCEL_SAFE = new Set([
  'dev',
  'env',
  'link',
  'login',
  'logout',
  'whoami',
  'list',
  'ls',
  'inspect',
  'logs',
  'pull',
  'build',
  'help',
  'switch',
  'teams',
  'domains',
  'dns',
  'certs',
  'bisect',
]);

/** Options of `npm` and `npx` that take the next word as their value (`npm exec -w a -- tool`). */
const NPM_VALUE_OPTIONS = new Set(['-w', '--workspace', '--prefix']);

/** Options of `uvx` that take the next word as their value (`uvx --python 3.12 tool`). */
const UVX_VALUE_OPTIONS = new Set(['--python']);

/** Options of `terraform apply` that take the next word as their value (with one or two dashes). */
const TERRAFORM_VALUE_OPTIONS = new Set([
  'var',
  'var-file',
  'target',
  'replace',
  'lock-timeout',
  'parallelism',
  'state',
  'state-out',
  'backup',
]);

/**
 * How many operands follow `apply` once the values of {@link TERRAFORM_VALUE_OPTIONS} are skipped: a
 * plan file is an operand, `-var x=1` is not. An option it does not know and that takes a separate
 * value leaves that value counted as an operand, so it asks.
 */
function terraformOperands(args: readonly string[]): number {
  let count = 0;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? '';
    if (arg.startsWith('-')) {
      if (!arg.includes('=') && TERRAFORM_VALUE_OPTIONS.has(arg.replace(/^--?/, ''))) i += 1;
    } else {
      count += 1;
    }
  }
  return count;
}

/**
 * True for a copy to the cloud: the verb is one of `verbs` and some path other than the first starts
 * with `scheme` (`aws s3 sync . s3://b`, `gcloud storage cp -r . gs://b`, `azcopy copy f https://…`).
 * A download (`aws s3 sync s3://b ./local`) has the scheme only in the first path and is approved.
 * The paths are the operands that are not the verbs themselves (`s3`, `storage`, `blob`…).
 */
function uploadsTo(args: readonly string[], scheme: string, verbs: readonly string[]): boolean {
  if (!hasAny(args, verbs)) return false;
  const skip = new Set(
    [...verbs, 's3', 'storage', 'objects', 'blob', 'cp'].map((w) => w.toLowerCase()),
  );
  const paths = operands(args).filter((arg) => !skip.has(arg.toLowerCase()));
  return paths.slice(1).some((arg) => arg.toLowerCase().startsWith(scheme));
}

/** True for `php artisan` commands that drop or empty the database. */
function artisanResets(args: readonly string[]): boolean {
  return (
    args.some((arg) => /(^|[\\/])artisan$/i.test(arg)) &&
    args.some((arg) => /^(migrate:(fresh|reset|refresh)|db:wipe)/.test(arg))
  );
}

/**
 * True for an operand of `rsync` or `scp` on another machine: `host:path`, `user@host:path` or
 * `rsync://…`. A one-letter prefix is a Windows drive (`C:\x`), and a `--option=a:b` is not an operand.
 */
function remoteOperand(arg: string): boolean {
  return arg.startsWith('rsync://') || /^(?:[^\s@:/\\-][^\s@:/\\]*@)?[A-Za-z0-9._-]{2,}:/.test(arg);
}

/**
 * True for the PowerShell web cmdlets (`Invoke-WebRequest`/`iwr`, `Invoke-RestMethod`/`irm`, and the
 * `curl` alias) when they upload or write: `-Method` other than Get/Head, `-InFile`, `-Body`,
 * `-Form` or `-OutFile` (abbreviations of PowerShell parameters included, from the shortest that is
 * not ambiguous with the `curl` flags).
 */
function powershellWebAsks(args: readonly string[]): boolean {
  return args.some((raw, k) => {
    // `-Method:Post` is the same parameter with its value attached.
    const attached = /^(-[A-Za-z]+):(.*)$/.exec(raw);
    const arg = attached?.[1] ?? raw;
    if (/^-me(t(h(o(d)?)?)?)?$/i.test(arg)) {
      return !/^(get|head)$/i.test(attached?.[2] ?? args[k + 1] ?? '');
    }
    return /^-(inf(i(l(e)?)?)?|bo(d(y)?)?|form|outf(i(l(e)?)?)?)$/i.test(arg);
  });
}

/** True when a recursive search of the current directory or a broad root could print a secret. */
function recursiveSecretSearch(command: string, args: readonly string[]): boolean {
  const broad = (arg: string): boolean => /^(\.|\.\/|\.\.|\.\.\/|~|~\/|\/)$/.test(arg);
  if (['grep', 'egrep', 'fgrep'].includes(command)) {
    const recursive = args.some(
      (arg) =>
        arg === '--recursive' ||
        arg === '--dereference-recursive' ||
        (arg.startsWith('-') && !arg.startsWith('--') && /[rR]/.test(arg)),
    );
    const paths = operands(args);
    return recursive && (paths.length <= 1 || paths.some(broad));
  }
  if (['rg', 'ag', 'ack', 'pt'].includes(command)) {
    // `-.` is `--hidden`; `-uu` and `--no-ignore*` search ignored files too.
    return args.some(
      (arg) =>
        arg === '--hidden' ||
        /^-u{2,}$/.test(arg) ||
        arg.startsWith('--no-ignore') ||
        (/^-[A-Za-z.]+$/.test(arg) && arg.includes('.')),
    );
  }
  if (command === 'findstr') return args.some((arg) => /^\/s$/i.test(arg));
  if (['get-childitem', 'gci', 'dir', 'ls'].includes(command)) {
    // A recursive listing that also gives the contents to a search (`| Select-String KEY`) reads the
    // `.env` files: in Windows a leading dot hides nothing (VERIFIED, review #2009). Only a listing
    // of names (`-Name`, `-Directory`, `dir /b`, `dir /ad`) is approved.
    const recursive =
      args.some((arg) => /^-r(e(c(u(r(s(e)?)?)?)?)?)?$/i.test(arg) || /^\/s$/i.test(arg)) ||
      (command === 'ls' && cluster(args, 'R'));
    const namesOnly = args.some(
      (arg) =>
        /^-n(a(m(e)?)?)?$/i.test(arg) ||
        /^-(di(r(e(c(t(o(r(y)?)?)?)?)?)?)?|ad)$/i.test(arg) ||
        /^\/(b|ad)$/i.test(arg),
    );
    return recursive && !namesOnly;
  }
  return false;
}

/**
 * True when the command `command` (already a lower-case literal name) with `args` is destructive or
 * runs text that cannot be classified. The cases are grouped by family, see the header of the file.
 * `dotnet tool run X` is classified by the local tool `X` (`dotnet-ef database drop` asks like
 * `dotnet ef database drop`); `nix` asks whatever it runs ({@link
 * OPAQUE}). For `npm|pnpm|yarn`, an `exec`/`dlx` that is the subcommand is classified by the tool it launches,
 * and an `exec` anywhere else on the line (`yarn kubectl exec pod`) does not end the reading: for
 * pnpm and yarn the first word is read as a binary too, so the binary's own `exec` asks. VERIFIED by the check "asks
 * for a binary run by yarn or pnpm whose own subcommand is exec" of `destructiveCommand.test.ts`
 * (the matrix found the hole on 07/11/2026, Windows 11, Node 24; not run against a real yarn or
 * pnpm).
 */
function commandAsks(command: string, args: readonly string[]): boolean {
  if (ELEVATORS.has(command) || OPAQUE.has(command)) return true;
  if (DELETERS.has(command) || ALWAYS_DESTRUCTIVE.has(command) || command.startsWith('mkfs')) {
    return true;
  }
  // `yarnpkg` is the other name of `yarn`.
  if (command === 'yarnpkg') return commandAsks('yarn', args);
  if (RUNNERS.has(command)) return runnerAsks(command, args);
  if (recursiveSecretSearch(command, args)) return true;
  switch (command) {
    case 'rmdir':
    case 'rd':
      // Unix `rmdir` removes only an empty directory; Windows `rmdir`/`rd` with `/s` removes a tree
      // (also glued, `/q/s`), and in PowerShell they are `Remove-Item`, where `-r` is a prefix of
      // `-Recurse`.
      return args.some(
        (arg) =>
          /^-r/i.test(arg) ||
          (arg.startsWith('/') && arg.toLowerCase().split('/').includes('s')) ||
          /^\/s/i.test(arg),
      );
    case 'chmod':
    case 'chown':
    case 'chgrp':
      return args.includes('-R') || args.includes('--recursive') || hasShort(args, 'R');
    case 'find':
      return hasAny(args, [
        '-delete',
        '-exec',
        '-execdir',
        '-ok',
        '-okdir',
        '-fprint',
        '-fprintf',
        '-fls',
      ]);
    case 'git': {
      // `push` anywhere asks, whichever global option with a value (`--namespace x`) precedes it.
      if (args.includes('push')) return true;
      const parts = gitParts(args);
      if (parts === null) return true;
      return parts !== undefined && gitDestructive(parts.sub, parts.rest);
    }
    case 'rsync':
      // `--del*` deletes at the destination; a `host:` or `user@host:` operand copies to or from a
      // remote machine (a deploy or an exfiltration).
      return args.some(
        (arg) => arg.startsWith('--del') || arg.startsWith('--remove-source') || remoteOperand(arg),
      );
    case 'scp':
      return args.some(remoteOperand);
    case 'sftp':
      return true;
    case 'export':
    case 'declare':
    case 'typeset':
    case 'local':
    case 'readonly':
      // Sets a variable of the shell: the same families as a `NAME=value` prefix, by another door.
      // With no name at all (`export`, `export -p`, `declare -x`, `typeset -x`) it prints the
      // environment, secrets included.
      return args.some(execEnv) || operands(args).length === 0;
    case 'set':
      // `set` alone prints the variables; `set -e` and the like only change options.
      return args.some(execEnv) || args.length === 0;
    case 'setx': {
      const at = args.findIndex((arg) => !arg.startsWith('/')); // `setx /M NAME value`
      const name = args[at] ?? '';
      return EXEC_ENV.test(name) && !HARMLESS_ENV.test(`${name}=${args[at + 1] ?? ''}`);
    }
    case 'tee-object':
      return !args.some((arg) => /^-ap/i.test(arg)); // `-Append` is the only way not to overwrite
    case 'new-item':
    case 'ni':
      return args.some((arg) => /^-fo/i.test(arg)); // `-Force` empties an existing file
    case 'robocopy':
      return args.some((arg) => /^\/(mir|purge|mov|move)$/i.test(arg));
    case 'diskutil':
      return args.some((arg) => /^erase/i.test(arg));
    case 'crontab':
      return args.includes('-r');
    case 'reg':
      return hasAny(args, ['delete']);
    case 'kill':
      return args.includes('-1') || args.includes('0'); // every process
    case 'taskkill':
      return hasAny(args, ['/f']);
    case 'stop-process':
      return args.some((arg) => /^-fo/i.test(arg));
    case 'redis-cli':
      return hasAny(args, ['flushall', 'flushdb', 'del', 'eval']);
    case 'mysqladmin':
      return hasAny(args, ['drop']);
    case 'prisma':
      return (
        (hasAny(args, ['migrate']) && hasAny(args, ['reset'])) || longOpt(args, '--force-reset')
      );
    case 'tee':
      return teeOverwrites(args);
    case 'tar':
    case 'zip':
    case '7z':
    case '7za':
      return args.includes('-'); // archive to stdout, usually piped to the network
    case 'curl':
      // Uploads (-T, -d, -F), writes (-o, -O) and non-GET methods (-X); and the PowerShell flags,
      // because `curl` is an alias of `Invoke-WebRequest` there.
      return (
        args.some(
          (arg) =>
            /^-[A-Za-z]*[TdFoOX]/.test(arg) ||
            /^--(upload-file|data|form|output|remote-name|request|json)/.test(arg),
        ) || powershellWebAsks(args)
      );
    case 'invoke-webrequest':
    case 'iwr':
    case 'invoke-restmethod':
    case 'irm':
      return powershellWebAsks(args);
    case 'wget':
      // `wget` is an alias of `Invoke-WebRequest` in Windows PowerShell 5.1, like `curl`.
      return (
        powershellWebAsks(args) ||
        args.some(
          (arg) =>
            /^-[A-Za-z]*[OP]/.test(arg) ||
            /^--(output-document|post-|directory-prefix|mirror|recursive)/.test(arg),
        )
      );
    case 'sed':
      // `-i` edits files in place; the `e` flag of `s///e` and the `e` command run a shell.
      return (
        cluster(args, 'i') ||
        longOpt(args, '--in-place') ||
        args.some(
          (arg) => /\/[gIimMp0-9]*e[gIimMp0-9]*$/.test(arg) || /(^|[;{}\s\d])e(\s|$)/.test(arg),
        )
      );
    case 'set-content':
    case 'sc':
      return true; // overwrites; whether the file exists is not known
    case 'out-file':
      return !args.some((arg) => /^-ap/i.test(arg)); // `-Append` is the only way not to overwrite
    case 'add-content':
    case 'ac':
      return args.some((arg) => /^-fo/i.test(arg)); // `-Force` writes through read-only files
    // Infrastructure and cloud (decision `infra-y-publicar` 1): the verbs are looked for among all
    // the arguments, so `kubectl -n prod delete …` and `aws s3 rb …` are found; a false positive
    // (`docker run img rm`) only costs a card.
    case 'kubectl':
    case 'oc':
      return (
        // `apply` deploys to the cluster (decision `despliegues-y-cierre`); `get` and `diff` read.
        hasAny(args, ['delete', 'drain', 'exec', 'run', 'debug', 'cp', 'apply']) ||
        (hasAny(args, ['replace']) && hasAny(args, ['--force']))
      );
    // Deployments to the outside (decision `despliegues-y-cierre`): a deploy publishes. The local
    // servers (`vercel dev`, `netlify dev`, `firebase emulators:start`) and the dry runs (`cdk
    // synth`, `cdk diff`) are approved.
    case 'vercel': {
      // A bare `vercel`, `vercel <dir>`, `vercel --yes` and `vercel deploy` deploy; only its other
      // subcommands (`dev`, `env`, `pull`, `logs`…) are approved.
      const sub = operands(args)[0];
      return sub === undefined || !VERCEL_SAFE.has(sub);
    }
    // `firebase-tools`, `netlify-cli` and `aws-cdk` are the npm package names of the CLIs `firebase`,
    // `netlify` and `cdk`, so `npx firebase-tools deploy` is the real form with npx (HYPOTHESIS, from
    // the package names; not run).
    case 'netlify':
    case 'netlify-cli':
    case 'firebase':
    case 'firebase-tools':
    case 'fly':
    case 'flyctl':
      // `deploy`, `firebase hosting:channel:deploy`, `fly apps destroy`.
      return args.some((arg) => /(^|:)(deploy|destroy)$/i.test(arg));
    case 'serverless':
    case 'sls':
      return hasAny(args, ['deploy', 'remove']);
    case 'wrangler':
      return hasAny(args, ['deploy', 'publish']);
    case 'cdk':
    case 'aws-cdk':
      return hasAny(args, ['deploy', 'destroy']);
    case 'sam':
      return hasAny(args, ['deploy', 'delete']);
    case 'terraform':
    case 'tofu':
      return (
        hasAny(args, ['destroy']) ||
        (hasAny(args, ['apply']) && args.some((arg) => /^--?auto-approve/.test(arg))) ||
        // `apply <planfile>` applies a saved plan without asking, like `-auto-approve`.
        (args.includes('apply') && terraformOperands(args.slice(args.indexOf('apply') + 1)) > 0) ||
        (hasAny(args, ['state']) && hasAny(args, ['rm'])) ||
        (hasAny(args, ['workspace']) && hasAny(args, ['delete']))
      );
    case 'helm':
      return hasAny(args, ['uninstall', 'delete', 'del', 'un']);
    case 'docker':
    case 'podman':
    case 'nerdctl':
    case 'docker-compose':
    case 'podman-compose':
      // `volume rm`, `system prune`, `docker push` and `buildx … --push`; `run`, `exec`, `compose run`
      // and `cp` run a command or write the host with the disk mounted (`-v`, `--mount`), which is
      // hard to bound, so every one asks; `compose down -v` drops the volumes.
      return (
        hasAny(args, ['rm', 'rmi', 'prune', 'push', 'exec', 'run', 'cp']) ||
        args.some((arg) => arg.startsWith('--push')) ||
        (hasAny(args, ['down']) && hasAny(args, ['-v', '--volumes']))
      );
    case 'aws':
      return (
        hasAny(args, ['rm', 'rb', 'mv']) ||
        args.some((arg) => /^(delete|terminate|batch-delete|purge)-/i.test(arg)) ||
        (hasAny(args, ['sync']) && longOpt(args, '--delete')) ||
        uploadsTo(args, 's3://', ['sync', 'cp', 'mv'])
      );
    case 'gcloud':
    case 'gsutil':
      // `delete`/`rm`, `--delete-unmatched-destination-objects`, and uploads to `gs://`.
      return (
        hasAny(args, ['delete', 'rm', 'deploy']) || // `gcloud app deploy`, `functions deploy`
        args.some((arg) => /^(--delete|delete-|purge)/i.test(arg)) ||
        uploadsTo(args, 'gs://', ['cp', 'rsync', 'mv'])
      );
    case 'az':
      return (
        hasAny(args, ['delete', 'rm', 'upload', 'upload-batch', 'sync']) ||
        args.some((arg) => /^(--delete|delete-|purge)/i.test(arg))
      );
    case 'azcopy':
      return (
        hasAny(args, ['remove', 'rm']) ||
        uploadsTo(args, 'https://', ['copy', 'cp', 'sync', 'make']) ||
        uploadsTo(args, 'http://', ['copy', 'cp', 'sync'])
      );
    case 'pulumi':
      return (
        hasAny(args, ['destroy']) ||
        (hasAny(args, ['up']) &&
          (hasAny(args, ['--yes', '-y']) || args.some((arg) => /^--yes=/.test(arg)))) ||
        (hasAny(args, ['stack']) && hasAny(args, ['rm']))
      );
    // Framework database resets (decision `ronda-lista-negra-5-cierre`): they drop or empty the database.
    case 'rails':
    case 'rake':
      return args.some((arg) => /^db:(drop|reset|schema:load|migrate:reset|purge)/.test(arg));
    case 'artisan':
      return args.some((arg) => /^(migrate:(fresh|reset|refresh)|db:wipe)/.test(arg));
    case 'django-admin':
      return args.some((arg) => /^(flush|reset_db|sqlflush)$/.test(arg));
    case 'php':
      return artisanResets(args) || interpreterAsks(command, args);
    case 'supabase':
      return hasAny(args, ['db']) && hasAny(args, ['reset']);
    case 'knex':
      return hasAny(args, ['migrate:rollback']) && args.includes('--all');
    case 'sequelize':
    case 'sequelize-cli':
      return args.some((arg) => /^db:(drop|migrate:undo:all)/.test(arg));
    // Actions towards the outside (decision `infra-y-publicar` 2): they ask although they delete
    // nothing. `git push` is in `gitDestructive`.
    case 'npm':
    case 'pnpm':
    case 'yarn': {
      // `exec` and `dlx` (after any option with a value: `npm -w a exec`, `pnpm --filter a exec`)
      // and `npm x` run another tool: classified by the tool, like `npx`.
      const exec = args.findIndex((arg) => arg === 'exec' || arg === 'dlx');
      const execAsks = exec >= 0 && launcherAsks(args.slice(exec + 1), command);
      if (execAsks) return true;
      // The first word that is not an option nor the value of one (`--filter a`, `-C dir`, `--cwd
      // dir`, `yarn workspace a`): that is the subcommand or the binary.
      let at = 0;
      while (at < args.length) {
        const arg = args[at] ?? '';
        if (
          PACKAGE_VALUE_OPTIONS.has(arg) ||
          (command === 'npm' && NPM_VALUE_OPTIONS.has(arg)) ||
          (command === 'yarn' && arg === 'workspace')
        ) {
          at += 2;
        } else if (arg.startsWith('-')) at += 1;
        else break;
      }
      if (at >= args.length) at = -1;
      const sub = (args[at] ?? '').toLowerCase();
      // `exec` as the subcommand was classified above and nothing else is left to read; an `exec`
      // further on (`yarn kubectl exec pod`, a binary's own subcommand) is not the launcher's, so
      // the line is still classified as a binary below (matrix of `destructiveCommand.test.ts`).
      if (exec >= 0 && exec === at) return false;
      if (command === 'npm' && sub === 'x') return launcherAsks(args.slice(at + 1), command);
      if (hasAny(args, ['publish', 'unpublish', 'deprecate'])) return true;
      if ((command === 'yarn' || command === 'pnpm') && at >= 0) {
        // `yarn <bin>` and `yarn run <bin>` run a binary or script by name; `pnpm <bin>` does too
        // (HYPOTHESIS for pnpm, not run: asking is cheap).
        const bin = sub === 'run' ? args.findIndex((arg, k) => k > at && !arg.startsWith('-')) : at;
        const word = args[bin];
        return word !== undefined && launchedAsks(toolName(word), args.slice(bin + 1));
      }
      return false;
    }
    case 'vsce':
    case 'ovsx':
    case 'cargo':
    case 'flit':
      return hasAny(args, ['publish', 'unpublish']);
    case 'gem':
      return hasAny(args, ['push', 'yank']);
    case 'dotnet':
    case 'nuget': {
      // `dotnet tool run X` runs the local tool `X`: classified by it, like `npx X`.
      const toolRun = args.findIndex((arg, k) => arg === 'tool' && args[k + 1] === 'run');
      const word = toolRun >= 0 ? args[toolRun + 2] : undefined;
      if (command === 'dotnet' && word !== undefined) {
        const name = toolName(word);
        if (!LITERAL_NAME.test(name) || launchedAsks(name, args.slice(toolRun + 3))) return true;
      }
      return (
        hasAny(args, ['push']) ||
        (hasAny(args, ['ef']) && hasAny(args, ['database']) && hasAny(args, ['drop']))
      );
    }
    case 'dotnet-ef':
      // The standalone name of `dotnet ef` (reached by `dotnet tool run dotnet-ef …`).
      return hasAny(args, ['database']) && hasAny(args, ['drop']);
    case 'mvn':
      return hasAny(args, ['deploy']);
    case 'gradle':
    case 'gradlew':
      // `publish`, `publishPlugins`, `publishToMavenCentral`, `:lib:publish`.
      return args.some((arg) => /(^|:)publish/i.test(arg));
    case 'twine':
      return hasAny(args, ['upload']);
    case 'gh':
      return (
        (hasAny(args, ['pr']) && hasAny(args, ['merge'])) ||
        (hasAny(args, ['release']) && hasAny(args, ['create', 'upload'])) ||
        hasAny(args, ['delete', 'archive']) ||
        // Publishing by another verb: `repo create --push|--public`, `repo edit --visibility`,
        // `gist create --public`, `secret set`, `workflow run`.
        (hasAny(args, ['repo']) &&
          hasAny(args, ['create']) &&
          args.some((arg) => arg.startsWith('--push') || arg.startsWith('--public'))) ||
        (hasAny(args, ['repo']) &&
          hasAny(args, ['edit']) &&
          args.some((arg) => arg.startsWith('--visibility'))) ||
        (hasAny(args, ['gist']) &&
          hasAny(args, ['create']) &&
          args.some((arg) => arg.startsWith('--public') || arg === '-p')) ||
        (hasAny(args, ['secret']) && hasAny(args, ['set'])) ||
        (hasAny(args, ['workflow']) && hasAny(args, ['run'])) ||
        (hasAny(args, ['api']) &&
          args.some((arg) => /^(-X|--method|-f|-F|--field|--raw-field|--input)/.test(arg)))
      );
    case 'npx':
    case 'bunx':
    case 'pnpx':
    case 'uvx':
      return launcherAsks(args, command);
    default:
      break;
  }
  if (POSIX_SHELLS.has(command)) return shellAsks(command, args);
  // `cmd` takes no script file: with `/c`, `/k`, `/r` it runs a command line, and without them
  // (`cmd`, `cmd /q`, `cmd /d`) it reads its commands from stdin. It always asks.
  if (command === 'cmd') return true;
  if (command === 'powershell' || command === 'pwsh') return powershellAsks(args);
  return interpreterAsks(command, args);
}

/**
 * True when the command whose possible `names` (see {@link namesOf}) is followed by `args` asks: the
 * name is not a plain literal identifier, an argument has an unquoted glob, brace, `$` or backslash
 * (`metas`), an argument names a secret file or the environment (`env:`), or {@link commandAsks}.
 */
function namedCommandAsks(
  names: readonly string[],
  args: readonly string[],
  metas: readonly boolean[],
): boolean {
  if (!names.every((name) => LITERAL_NAME.test(name))) return true;
  // The closing `]` of `[ … ]` is the one exception.
  if (args.some((arg, k) => metas[k] === true && arg !== ']' && arg !== ']]')) return true;
  // A secret by name, the environment drive (`env:`) or a cmd variable (`%OPENAI_API_KEY%`).
  if (
    args.some((arg) => isSecretPath(arg) || /^env:/i.test(arg) || /%[A-Z_][A-Z0-9_]{2,}%/.test(arg))
  ) {
    return true;
  }
  return names.some((name) => commandAsks(name, args));
}

/**
 * True when one simple command must be asked about: it is destructive, it names a secret file or it
 * cannot be classified. `words` has no quotes. Skips leading assignments (`FOO=1 rm`; one that
 * configures execution, {@link EXEC_ENV}, asks), syntax words and transparent prefixes, then looks at
 * the command and its arguments.
 *
 * The word that names the command (and every prefix) must be a plain literal identifier: one with a
 * `$`, `*`, `?`, `[`, `]`, `{`, `}`, a backtick, `!` or a backslash, or that does not start like a
 * name (`-r`, a leading `%`), asks. A prefix (`env`, `timeout`, `exec`, `nice`, `time`…) may carry
 * only `NAME=value` for `env` and `cross-env`, a duration for `timeout`/`nice` and `-n N` for `nice`:
 * any other option could take a value (`env -S`, `timeout -s KILL`, `exec -a x`) that would be
 * mistaken for the command, so it asks; the one exception is `command -v` / `command -V`, which only
 * print where a command is and are approved; `env` with no command prints the environment and asks.
 */
function segmentAsks(
  words: readonly string[],
  metas: readonly boolean[],
  escs: readonly boolean[],
): boolean {
  let i = 0;
  for (;;) {
    const word = words[i];
    if (word === undefined) return false; // nothing left to run
    if (ASSIGNMENT.test(word)) {
      if (execEnv(word)) return true;
      i += 1;
      continue;
    }
    if (SYNTAX_WORDS.has(word)) {
      i += 1;
      continue;
    }
    if (word === '[' || word === '[[') return false; // `test`: it runs nothing
    // The word that names the command: an expansion, a glob or ANY backslash asks (`.\gradlew.bat`
    // too: a command with a path in Windows syntax is rarer than an escaped name).
    if (EXPANSION.test(word) || metas[i] === true || escs[i] === true || word.startsWith('%')) {
      return true;
    }
    const names = namesOf(word);
    const prefix = names.find((name) => TRANSPARENT.has(name));
    if (prefix === undefined) {
      return namedCommandAsks(names, words.slice(i + 1), metas.slice(i + 1));
    }
    i += 1;
    const sets = prefix === 'env' || prefix === 'cross-env';
    for (;;) {
      const next = words[i] ?? '';
      if (sets && ASSIGNMENT.test(next)) {
        if (execEnv(next)) return true;
        i += 1;
      } else if ((prefix === 'nice' || prefix === 'timeout') && /^\d+(\.\d+)?[smhd]?$/.test(next)) {
        i += 1;
      } else if (prefix === 'nice' && next === '-n' && /^-?\d+$/.test(words[i + 1] ?? '')) {
        i += 2;
      } else if (prefix === 'command' && (next === '-v' || next === '-V')) {
        return false; // `command -v node` only prints where a command is
      } else if (next.startsWith('-')) {
        return true;
      } else break;
    }
    if (sets && words[i] === undefined) return true; // `env` alone prints the environment
  }
}

/**
 * True when Auto must NOT approve the shell command `text` on its own: it matches the blacklist of
 * the decisions (`rm`, `mv` and `cp` and the other deleters or overwriters, also behind `npx`,
 * `pnpm exec` or a prefix such as `shx` or `env`; `rmdir /s`, `git reset --hard` and its
 * abbreviations, `chmod -R`, `find -delete`, overwriting `>` or `>&file`, `tee`, `Set-Content`,
 * `rsync --delete`, `kubectl delete`, `terraform destroy`, `docker rm`, `aws … rb`, `sudo`…), it
 * publishes, pushes or copies to another machine (`git push`, `npm publish`, `docker push`, `gh pr
 * merge`, `gh repo create --push`, `scp`/`rsync host:`, `sftp`…), it names a secret file (`cat .env`,
 * `type id_rsa`, see `secretPaths.ts`) or it cannot be classified: `eval`, `iex`, `$(…)`,
 * backticks, the PowerShell `&` call operator, a shell or interpreter reading stdin, a heredoc or
 * inline code, `xargs`, a launcher such as `wsl`, `ssh` or `start`, a SQL client, an unbalanced
 * quote, a command word with a backslash, an expansion, brace or glob, an UNQUOTED glob, brace or `$`
 * in any argument, and a `NAME=value` that configures execution. A command line asks when ANY of its
 * simple commands does.
 * `echo rm -rf x` is text and does not ask; `rmdir` without `/s`, `git rm --cached`, `bash
 * script.sh` and `npm run format` do not either.
 * It is a HEURISTIC BLACKLIST by family: what it does not know it approves (see the header).
 * VERIFIED by `destructiveCommand.test.ts` (a table of fabricated commands, one row per form listed
 * in the reviews of E3-work-mode and per family: it pins the criterion, it does not show what a
 * shell or opencode would do with them).
 */
export function commandNeedsAsk(text: string): boolean {
  if (text.trim() === '') return true;
  const segments = split(text);
  if (segments === undefined) return true;
  return segments.some((segment) => {
    if (segment.overwrites || segmentAsks(segment.words, segment.metas, segment.escs)) return true;
    if (!segment.escs.some(Boolean)) return false;
    // A word with a backslash is read twice: as written (a Windows path: `type src\app.ts`) above,
    // and here without the backslashes and the line continuations (a POSIX escape: `git pu\sh` is
    // `git push`). The command asks when either reading does.
    const unescaped = segment.words.map((word) => word.replace(/\\\r?\n/g, '').replace(/\\/g, ''));
    return segmentAsks(
      unescaped,
      segment.metas,
      segment.words.map(() => false),
    );
  });
}
