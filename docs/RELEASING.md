# Releasing

How a version of OpenCode GUI reaches the VS Code Marketplace and Open VSX (issue #43). Nothing
here is run by an agent: the one-time setup, the tag and the approval are done by hand by the
maintainer.

## What the workflow does

[`.github/workflows/release.yml`](../.github/workflows/release.yml) runs in three jobs:

```text
push of a tag vX.Y.Z
  package ──► publish-marketplace ──► publish-open-vsx
  (build, check,    (needs approval in the     (needs the Marketplace job;
   ONE .vsix)        `release` environment)     same .vsix)
```

- **package** checks that the tag, `package.json` and `CHANGELOG.md` agree
  (`scripts/check-release.mjs`), that the tagged commit is on `main`, then runs the format check,
  the unit tests and, through `vscode:prepublish`, the type check and lint. It packages once,
  checks the real file list of the `.vsix` and the version inside it, and uploads the file as the `release-vsix`
  artifact. The three-OS matrix and the integration tests are not repeated: CI already ran them on
  `main`.
- **publish-marketplace** and **publish-open-vsx** publish that same file. Both run only for a
  tag push, both wait for a manual approval, and Open VSX waits for the Marketplace job, so if the
  Marketplace rejects the package nothing reaches Open VSX and the two listings never diverge.

Any other trigger is a **dry run**: `workflow_dispatch` (`gh workflow run release.yml --ref main`),
or a pull request that touches the workflow, the check scripts, `package.json`,
`package-lock.json` or `.vscodeignore`. It packages and checks exactly
the same way, the summary starts with `DRY RUN — nothing was published`, and it has no job that can
read a token. A dry run on `main` prints a WARNING while `CHANGELOG.md` still has only
`## [Unreleased]`: it means a real tag would fail until the release PR (below) is merged.

Only **stable** releases are published: tags are `vMAJOR.MINOR.PATCH`, with no `-beta` suffix (the
Marketplace rejects it) and no `--pre-release` channel.

## One-time setup

Do all of this **before the first tag**.

### 1. The display name

The package's `displayName` is "OpenCode GUI", and the Marketplace already lists
`TanishqKancharla.opencode-vscode` under that name. Whether the Marketplace rejects a duplicate
display name is unverified. **Choose another `displayName` before the first tag** (a separate
issue, not part of the release workflow); the first Marketplace publish is the real test.

### 2. VS Code Marketplace

1. Create the publisher `sergwei` at <https://marketplace.visualstudio.com/manage>.
2. Create a Personal Access Token in Azure DevOps:
   - Organization: **All accessible organizations**.
   - Scope: **Marketplace › Manage** only.
   - Expiration: short, for example 90 days. Write the date down.
3. Check it locally without publishing anything. Read the token into the environment without
   echoing it, so it never appears on a command line or in the shell history:

   ```bash
   read -rs VSCE_PAT && export VSCE_PAT
   npx vsce verify-pat sergwei
   ```

   ```powershell
   $env:VSCE_PAT = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR((Read-Host -AsSecureString 'VSCE_PAT')))
   npx vsce verify-pat sergwei
   ```

**The PAT will be retired.** The official guide says global PATs in Azure DevOps are retired on
1 December 2026, and a later announcement postpones it to a date that is not clear. Treat a PAT as
something that lives weeks or a few months. See [PAT retirement](#pat-retirement-and-the-next-step).
Sources:
<https://code.visualstudio.com/api/working-with-extensions/publishing-extension> and
<https://devblogs.microsoft.com/devops/retirement-of-global-personal-access-tokens-in-azure-devops/>.

### 3. Open VSX

1. Sign in at <https://open-vsx.org> with the GitHub account, link an eclipse.org account and sign
   the Publisher Agreement.
2. Create a token in Settings › Access Tokens.
3. Create the namespace, passing the token through the environment, not the command line:

   ```bash
   read -rs OVSX_PAT && export OVSX_PAT
   npx ovsx create-namespace sergwei
   ```

   ```powershell
   $env:OVSX_PAT = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR((Read-Host -AsSecureString 'OVSX_PAT')))
   npx ovsx create-namespace sergwei
   ```

4. Claim ownership of the namespace separately (creating it does not make you the verified owner);
   the steps are in <https://github.com/eclipse/openvsx/wiki/Publishing-Extensions>.
5. Check the token without publishing (same variable as above): `npx ovsx verify-pat sergwei`.

The first publication to Open VSX has to use the token. Per the Open VSX wiki, trusted publishing
only works for extensions that already exist there
(<https://github.com/eclipse/openvsx/wiki/Trusted-Publishing>; HYPOTHESIS: read there, not tried).

### 4. GitHub: the `release` environment and its secrets

The environment and **both secrets must exist before the first tag**. If they do not, GitHub may
create an unprotected `release` environment on the fly (unverified); in that case the job still
stops with `::error::VSCE_PAT is not set in the release environment` (or `OVSX_PAT`) before
publishing anything.

In Settings › Environments › New environment, name it `release` and set:

- **Required reviewers**: `sergwei`.
- **Prevent self-review**: **OFF**. The maintainer is the only collaborator, and with it on nobody
  could approve a deployment that they started.
- **Deployment branches and tags**: **Selected** → add a **tag** pattern `v*` and **no branches**.
- **Environment secrets** (not repository secrets): `VSCE_PAT` and `OVSX_PAT`. An environment
  secret reaches only a job that references the environment, and only after approval.

Optional, recommended: a ruleset on tags `refs/tags/v*` that blocks deleting and moving them, so a
published version cannot be silently re-pointed.

## Cutting a release

1. **Release PR.** On its own branch, bump `version` in `package.json` (a plain `X.Y.Z`), rename
   `## [Unreleased]` in `CHANGELOG.md` to `## [X.Y.Z] - YYYY-MM-DD` and add a new empty
   `## [Unreleased]` above it. After the first publication, also change the README's Installation
   section (it says the extension is not on the Marketplace yet). Merge it.
2. Wait for CI to be green on `main`.
3. Optional dry run: `gh workflow run release.yml --ref main`. Read the summary; the WARNING about
   the changelog must be gone.
4. Tag the merged commit and push **one tag at a time** (GitHub creates no event when more than
   three tags are pushed together):

   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z" <commit-on-main>
   git push origin vX.Y.Z
   ```

5. In the run, open **Review deployments** and check the commit and the sha256 in the summary
   before approving. Approve the Marketplace job, then Open VSX.
6. Check both listings:
   <https://marketplace.visualstudio.com/items?itemName=sergwei.open-vs-code> and
   <https://open-vsx.org/extension/sergwei/open-vs-code>.

## When something fails

- **Before approving**: reject the deployment. Nothing was published.
- **Halfway** (for example the Marketplace accepted it and Open VSX failed): use **Re-run failed
  jobs**. Never re-tag and never reuse a version number: published versions cannot be republished
  in either registry, and `unpublish` is irreversible and reserves the number. The publish steps
  deliberately do not use `--skip-duplicate`, so re-running a job that already published fails with
  "already exists", which is what you want.
- A bad release is fixed with a **new patch version**.

## If a token leaks

1. Revoke it: Azure DevOps › User settings › Personal access tokens for `VSCE_PAT`;
   open-vsx.org › Settings › Access Tokens for `OVSX_PAT`.
2. Create a new one and replace the secret in the `release` environment.
3. Review the latest runs of `release.yml` and the versions of both listings for anything you did
   not publish.

Tokens live only in environment secrets and only in the `env:` of the steps that use them (the
token check and the publish step); they are never on a command line, and the jobs that hold them
install dependencies with `--ignore-scripts` and without the npm cache. A compromised dependency of `vsce` or `ovsx` is the remaining risk, which is why
both are pinned in `package-lock.json`.

## PAT retirement and the next step

When the PAT stops working, move the Marketplace job to trusted publishing:

1. Register a trusted publishing policy for this repository and `release.yml` on the Marketplace
   (unverified: Microsoft has no official guide for it; `vsce` 4.0.0's README describes the
   policy).
2. In `publish-marketplace`, set `permissions: { contents: read, id-token: write }`, drop the
   `VSCE_PAT` secret and the "Check the token" step, and publish with
   `npx --no-install vsce publish --oidc --packagePath "$VSIX"` (`--oidc` is hidden from `--help`
   in vsce 4.0.0). It does not fall back to the PAT if it fails.
3. Delete `VSCE_PAT` from the environment and revoke the global PAT in Azure DevOps.
4. Update `src/extension/workflows.test.ts`, which forbids `id-token` today so that the Open VSX
   job can never get it by accident (ovsx would try trusted publishing instead of the PAT). Keep
   it forbidden in `publish-open-vsx`.

The other documented option is Microsoft Entra ID (`vsce publish --azure-credential`).

## Not covered

- A GitHub Release with the `.vsix` attached (it needs `contents: write`).
- Pre-release channel.
