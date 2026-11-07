// Which file names Auto work mode treats as secrets (E3-work-mode). Pure: no `vscode`, no I/O.
// Decision of Sergio, 07/11/2026 (Engram `e3-work-mode/decisions/secretos-y-borrados`): Auto never
// approves, on the user's behalf, a `read` permission whose resource is a secret, nor a shell
// command that names one as an argument. The list is the env files of opencode's own default rule
// (`read *.env` and `*.env.*` ask, `*.env.example` allows: `packages/schema/src/agent.ts` L46-51 of
// `anomalyco/opencode@843a6c51`, read, not run) plus the common key and credential files below.

/** Base names (lower case) that are secrets: SSH keys, certificates and keystores, token files. */
const SECRET_BASE_NAMES: readonly RegExp[] = [
  /^id_(rsa|ed25519|ecdsa|dsa)/,
  /\.(pem|key|p12|pfx|kdbx)$/,
  /^credentials.*\.json$/,
  /^(\.npmrc|\.pypirc|\.netrc|\.git-credentials|\.envrc)$/,
];

/** Whole-path endings (lower case, `/` separators) that are secrets whatever the directory. */
const SECRET_PATH_ENDINGS: readonly RegExp[] = [
  /(^|\/)\.aws\/credentials$/,
  /(^|\/)\.docker\/config\.json$/,
  /(^|\/)\.kube\/config$/,
  /(^|\/)\.config\/gh\/hosts\.yml$/,
];

/**
 * True when `text` names an env file the way opencode's default rules do: `*.env` and `*.env.*`
 * match, `*.env.example` does not. The whole string is matched, not the basename, because opencode's
 * `*` also crosses `/`, so `config/.env.local` and `dir.env.d/x` both count. A false positive only
 * costs the user one card.
 */
function isEnvName(text: string): boolean {
  if (text.endsWith('.env.example')) return false;
  return text.endsWith('.env') || text.includes('.env.');
}

/** True for one normalised spelling of a path (lower case, `/` separators). */
function matches(text: string): boolean {
  if (isEnvName(text)) return true;
  if (SECRET_PATH_ENDINGS.some((pattern) => pattern.test(text))) return true;
  const base = text.slice(text.lastIndexOf('/') + 1);
  return SECRET_BASE_NAMES.some((pattern) => pattern.test(base));
}

/**
 * True when `text` is, or ends in, the name of a secret file: a `read` resource or one argument of a
 * shell command (`cat .env`, `--env-file=.env`, `type C:\Users\me\.ssh\id_rsa`). Tested on the text,
 * on what follows its last `=` (an option value) and with the backslashes removed instead of read as
 * separators (`.e\nv`), because the shell strips an escape before it opens the file.
 * HYPOTHESIS that a `read` request carries the path as its resource in these forms: the type only
 * says `string` (`PermissionRequest.resources`, `types.d.ts` of `@opencode/client@2.0.32`) and a real
 * `read` of `.env` was seen asking but its `resources` were not recorded.
 * VERIFIED by `workMode.test.ts` and `destructiveCommand.test.ts` (fabricated names: they pin the
 * list of the decision, not what a server sends).
 */
export function isSecretPath(text: string): boolean {
  const lower = text.toLowerCase();
  const spellings = [lower.replace(/\\/g, '/'), lower.replace(/\\/g, '')];
  return spellings.some((spelling) => {
    const afterEquals = spelling.slice(spelling.lastIndexOf('=') + 1);
    return matches(spelling) || matches(afterEquals);
  });
}
