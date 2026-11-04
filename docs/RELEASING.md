# Releasing

How a version of OpenCode Station reaches the VS Code Marketplace and Open VSX (issue #43). Nothing
here is run by an agent: the one-time setup, the tag and the approval are done by hand by the
maintainer.

## What the workflow does

[`.github/workflows/release.yml`](../.github/workflows/release.yml) runs in three jobs:

```text
push of a tag vX.Y.Z
  package ──► publish-marketplace ──► publish-open-vsx
  (build, check,    (needs approval in the     (needs the Marketplace job;
   ONE .vsix)        `release` environment;     same .vsix; uses the
                     trusted publishing,        `OVSX_PAT` secret)
                     no token)
```

- **package** checks that the tag, `package.json` and `CHANGELOG.md` agree
  (`scripts/check-release.mjs`), that the tagged commit is on `main`, then runs the format check,
  the unit tests and, through `vscode:prepublish`, the type check and lint. It packages once,
  checks the real file list of the `.vsix` and the version inside it, and uploads the file as the
  `release-vsix` artifact. The three-OS matrix and the integration tests are not repeated: CI already ran them on
  `main`.
- **publish-marketplace** publishes that file with `vsce publish --oidc`: **trusted publishing**,
  with no token. The job asks GitHub for an OIDC token (`id-token: write`, granted to this job and
  to no other) and `vsce` exchanges it for a 15-minute Marketplace credential, which the
  Marketplace only gives if a policy of the publisher matches this repository, workflow and
  environment (step 2 below).
- **publish-open-vsx** publishes the same file with the `OVSX_PAT` environment secret. Open VSX
  needs a token for the first version of an extension (see [Next step](#next-step-trusted-publishing-on-open-vsx)).
- Both publish jobs run only for a tag push and wait for a manual approval, and Open VSX waits for
  the Marketplace job, so if the Marketplace rejects the package nothing reaches Open VSX and the
  two listings never diverge.

Any other trigger is a **dry run**: `workflow_dispatch` (`gh workflow run release.yml --ref main`),
or a pull request that touches the workflow, the check scripts, `package.json`,
`package-lock.json` or `.vscodeignore`. It packages and checks exactly
the same way, the summary starts with `DRY RUN — nothing was published`, and it has no job that can
read a secret or ask for an OIDC token. A dry run on `main` prints a WARNING while `CHANGELOG.md`
still has only `## [Unreleased]`: it means a real tag would fail until the release PR (below) is
merged.

Only **stable** releases are published: tags are `vMAJOR.MINOR.PATCH`, with no `-beta` suffix (the
Marketplace rejects it) and no `--pre-release` channel. The first published version is `1.0.0`.

`@vscode/vsce` is pinned at `4.1.0` or later: `4.0.0` exchanges the OIDC token with a request the
Marketplace rejects (`microsoft/vscode-vsce#1337`, confirmed in `#1275`). A test fails if the pin
goes back.

## One-time setup

Do all of this **before the first tag**.

### 1. The display name

The package's `displayName` is "OpenCode Station". It was chosen because "OpenCode GUI" is taken
(the Marketplace lists `TanishqKancharla.opencode-vscode` under that name), and it was checked
free on 2026-10-31 by exact display name, ignoring case, in the Marketplace (gallery
`extensionquery`) and in Open VSX (`api/-/search`). Whether the Marketplace would reject a
duplicate display name no longer matters; the first Marketplace publish is still the real test of
the name.

### 2. VS Code Marketplace: the trusted publishing policy

No Personal Access Token, no Azure DevOps organization and no Azure subscription are needed: the
page below opens and offers the form without asking for any of them (seen by the maintainer on
2026-11-04). It was done on 2026-11-04.

1. The publisher `sergwei` exists at <https://marketplace.visualstudio.com/manage>.
2. Open <https://marketplace.visualstudio.com/manage/publishers/sergwei/trustedpublishing> and
   **Create** a policy with these values:

   | Field            | Value              |
   | ---------------- | ------------------ |
   | Policy name      | `Release workflow` |
   | Provider         | GitHub Actions     |
   | Repository owner | `sergwei`          |
   | Repository       | `open-vs-code`     |
   | Workflow         | `release.yml`      |
   | Environment      | `release`          |

   **The environment is not optional here.** The policy has no field for a branch, ref or tag, so
   the only things that limit which runs can publish are the workflow file name and the
   environment. Without `release`, any run of `release.yml` that has `id-token` (a branch of this
   repository that edits the workflow) would match. With it, the run must pass the environment's
   rules: tags `v*` only and a required reviewer (step 3).

The repository is public, so the 48-hour window that applies to private repositories does not: per
the official guide the policy is activated permanently by its first successful token exchange.
Source: <https://code.visualstudio.com/api/working-with-extensions/publishing-extension> (read
2026-11-04).

### 3. GitHub: the `release` environment and its secret

**Done on 2026-11-04**: `release` exists with required reviewers `sergwei`, only the tag pattern
`v*` and the `OVSX_PAT` secret (checked with the GitHub API). The environment **must exist and be
protected before any tag**, because the policy above names it. There is no "Check the token" step in the
Marketplace job any more to stop an unprotected run: if `release` did not exist, GitHub would
create it on the fly without protection (HYPOTHESIS: read for GitHub Enterprise Server, not tried
on github.com), the policy would match, and the Marketplace job would publish without anybody's
approval.

Before pushing a tag, the maintainer (or the main thread of the session) checks it:

```bash
gh api repos/sergwei/open-vs-code/environments/release --jq '.protection_rules[].type'
gh api repos/sergwei/open-vs-code/environments/release/secrets --jq '.secrets[].name'
```

The first must list `required_reviewers` and the second `OVSX_PAT`. If the environment is missing
or has no reviewers, **do not push the tag**. Without `OVSX_PAT`, the tag would publish to the
Marketplace and then fail on Open VSX, leaving the two listings at different versions until a re-run.

In Settings › Environments › New environment, name it `release` and set:

- **Required reviewers**: `sergwei`.
- **Prevent self-review**: **OFF**. The maintainer is the only collaborator, and with it on nobody
  could approve a deployment that they started.
- **Deployment branches and tags**: **Selected** → add a **tag** pattern `v*` and **no branches**.
- **Environment secrets** (not repository secrets): `OVSX_PAT` only. An environment secret reaches
  only a job that references the environment, and only after approval. There is no Marketplace
  secret.

Optional, recommended: a ruleset on tags `refs/tags/v*` that blocks deleting and moving them, so a
published version cannot be silently re-pointed.

### 4. Open VSX

**Done on 2026-11-04**, except the ownership claim: the namespace `sergwei` exists
(`https://open-vsx.org/api/sergwei` answers `"verified":false`) and the `OVSX_PAT` secret is a
token with the **Publishing only** scope. Such a token could not create the namespace (the server
answered "Invalid access token."), so a temporary token with more scopes created it and was then
deleted.

1. Sign in at <https://open-vsx.org> with the GitHub account, link an eclipse.org account and sign
   the Publisher Agreement.
2. Create a token in Settings › Access Tokens.
3. Create the namespace, passing the token through the environment, not the command line:

   ```bash
   read -rs OVSX_PAT && export OVSX_PAT
   npx ovsx create-namespace sergwei
   ```

   ```powershell
   $secure = Read-Host -AsSecureString 'OVSX_PAT'
   $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
   $env:OVSX_PAT = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
   [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
   npx ovsx create-namespace sergwei
   ```

4. Claim ownership of the namespace separately (creating it does not make you the verified owner);
   the steps are in <https://github.com/eclipse/openvsx/wiki/Publishing-Extensions>. Do it **after
   the first Marketplace publication**: the claim form's Option 1 ("VS Code Publisher with Repo")
   needs an extension already published there with its repository in `package.json`, and then the
   proof is just "The extension repo … is owned by the GitHub ID making this request". The other
   options need a domain or temporary reader access to the Marketplace publisher.
5. Check the token without publishing (same variable as above): `npx ovsx verify-pat sergwei`.
   Then remove it from the session: `unset OVSX_PAT` (bash) or `Remove-Item Env:OVSX_PAT`
   (PowerShell).
6. Store the token as the `OVSX_PAT` secret of the `release` environment (step 3).

The first publication to Open VSX has to use the token: per the Open VSX wiki, the first version of
an extension has to be published the ordinary way, with an access token
(<https://github.com/eclipse-openvsx/openvsx/wiki/Trusted-Publishing>, read 2026-11-04).

## Cutting a release

1. **Release PR.** On its own branch, bump `version` in `package.json` (a plain `X.Y.Z`), rename
   `## [Unreleased]` in `CHANGELOG.md` to `## [X.Y.Z] - YYYY-MM-DD` and add a new empty
   `## [Unreleased]` above it. After the first publication, also change the README's Installation
   section (it says the extension is not on the Marketplace yet). Merge it.
2. Wait for CI to be green on `main`.
3. Optional dry run: `gh workflow run release.yml --ref main`. Read the summary; the WARNING about
   the changelog must be gone.
4. Check the `release` environment exists, has reviewers and holds `OVSX_PAT` (the two `gh api`
   commands of step 3 of the setup).
5. Tag the merged commit and push **one tag at a time** (GitHub creates no event when more than
   three tags are pushed together):

   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z" <commit-on-main>
   git push origin vX.Y.Z
   ```

6. In the run, open **Review deployments** and check the commit and the sha256 in the summary
   before approving. Approve the Marketplace job, then Open VSX.
7. Check both listings:
   <https://marketplace.visualstudio.com/items?itemName=sergwei.open-vs-code> and
   <https://open-vsx.org/extension/sergwei/open-vs-code>.

## The first publication

The official guide does not say whether trusted publishing can **create** an extension that does
not exist yet. Everything points to yes (the policy belongs to the publisher and has no extension
field, and `vsce` creates the extension on publish when it is missing), but nobody has been found
who tried it; the case confirmed in the wild was a new version of an existing extension. Only the
first tag tells (HYPOTHESIS). Also untested until then: the token exchange and that the policy
matches. If any of that fails, `publish-marketplace` fails and **nothing was published**.

Read the error of the failed step:

- `Marketplace OIDC token exchange failed…`: the policy did not match. Compare it with the table in
  step 2 (a typo in the repository, the workflow or the environment). Fix the policy and use
  **Re-run failed jobs** (each attempt gets a new OIDC token).
- A failure after the exchange (the Marketplace refuses to create the extension with that
  credential): use the manual route below.

**Manual route (plan B).** `publish-open-vsx` was skipped because it needs the Marketplace job,
and **Re-run failed jobs** would not help once you upload by hand, so do both by hand with the
SAME file:

1. `gh run download <run-id> -n release-vsix` and compare its sha256 with the one in the run
   summary.
2. Upload it at <https://marketplace.visualstudio.com/manage> › New extension › Visual Studio Code.
3. Publish the same file to Open VSX, with the token in the environment as in setup step 4:
   `npx ovsx publish <file>.vsix`.

Later versions go through the workflow. Never re-tag and never reuse a version number.

## When something fails

- **Before approving**: reject the deployment. Nothing was published.
- **Halfway** (for example the Marketplace accepted it and Open VSX failed): use **Re-run failed
  jobs**. Never re-tag and never reuse a version number: published versions cannot be republished
  in either registry, and `unpublish` is irreversible and reserves the number. The publish steps
  deliberately do not use `--skip-duplicate`, so re-running a job that already published fails with
  "already exists", which is what you want.
- **The Marketplace job fails before publishing**: see [The first publication](#the-first-publication).
- A bad release is fixed with a **new patch version**.

## If a credential leaks

1. `OVSX_PAT`: revoke it at open-vsx.org › Settings › Access Tokens, create a new one and replace
   the secret in the `release` environment.
2. Marketplace: there is no secret to leak; a credential lives 15 minutes and each OIDC token is
   exchanged once. If a run you did not start is suspected, delete the policy at
   <https://marketplace.visualstudio.com/manage/publishers/sergwei/trustedpublishing> and create
   it again with the table of setup step 2.
3. Review the latest runs of `release.yml` and the versions of both listings for anything you did
   not publish.

The only secret lives in an environment secret and only in the `env:` of the steps of the Open
VSX job; it is never on a command line. The jobs that publish install dependencies with
`--ignore-scripts` and without the npm cache. A compromised dependency of `vsce` or `ovsx` is the
remaining risk, which is why both are pinned in `package-lock.json`; in the Marketplace job it
could ask for tokens while the job lasts, but the job exists only after approval on a tag.

## Next step: trusted publishing on Open VSX

After the first version exists on Open VSX:

1. Register the repository at open-vsx.org › Settings › Trusted Publishers (owner `sergwei`,
   repository `open-vs-code`, workflow `release.yml`, environment `release`).
2. Give `publish-open-vsx` `id-token: write` in its job-level permissions, and change
   `ovsx publish` to `ovsx publish --trusted-publishing` if needed.
3. **Delete the `OVSX_PAT` secret.** In ovsx 1.3.0 a PAT takes precedence over trusted publishing,
   so with the secret still there the token keeps being used.
4. Update `src/extension/workflows.test.ts`, which forbids `id-token` in that job today.

**Open question for that step**: with `id-token: write`, the Open VSX job would run in the same
`release` environment that the Marketplace policy trusts, so code compromised in that job could ask
for a Marketplace credential too (the policy matches repository, workflow and environment, not the
job). That is exactly what keeping `id-token` out of it avoids today. Before doing this step, decide
between a separate environment for Open VSX (and a matching Open VSX registration) or accepting
that risk in writing.

The other documented Marketplace option is Microsoft Entra ID (`vsce publish --azure-credential`);
it was not chosen because it needs an Azure subscription.

## Not covered

- A GitHub Release with the `.vsix` attached (it needs `contents: write`).
- Pre-release channel.

## Sources

- <https://code.visualstudio.com/api/working-with-extensions/publishing-extension> (read 2026-11-04)
- <https://learn.microsoft.com/en-us/azure/devops/extend/publish/overview?view=azure-devops#publish-with-oidc-trusted-publishing>
  (read 2026-11-04)
- <https://developer.microsoft.com/blog/trusted-publishing-visual-studio-marketplace/> (read
  2026-11-04)
- <https://github.com/microsoft/vscode-vsce/pull/1337> and
  <https://github.com/microsoft/vscode-vsce/issues/1275> (read 2026-11-04)
- <https://github.com/eclipse-openvsx/openvsx/wiki/Trusted-Publishing> (read 2026-11-04)
