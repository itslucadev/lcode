# LCode upstream updates

LCode keeps the Git history of `pingdotgg/t3code` so updates can be merged without replacing our customizations.
The sync opens reviewable pull requests; it never automatically merges, publishes a release, or installs an app update.

## One-time setup

1. Commit and push the LCode changes, including both `lcode-*.yml` workflows, to `itslucadev/lcode:main`.
2. Enable GitHub Actions for the fork if needed.
3. Create a fine-grained personal access token restricted to `itslucadev/lcode`, with **Contents**, **Pull requests**, and **Workflows** write permissions.
   Store it as the repository Actions secret `UPSTREAM_SYNC_TOKEN`, and rotate it before expiration.
   Never commit the token or share it in chat.
   A dedicated bot identity is preferable to a personal identity for long-term use.
4. Start **LCode Upstream Sync** manually from Actions to verify setup.
5. Protect `main` with a rule requiring review and the **LCode Check** status before merging, and disallow force pushes.
   Configure the rule after the check has run once so GitHub can offer its status name.

The built-in `GITHUB_TOKEN` is deliberately not a fallback: PRs created with it do not trigger the normal PR workflows.
The sync runs daily at 03:00 UTC and can also be started manually on `main`.
Its publishing job only runs in `itslucadev/lcode`.

## Review an update

The workflow fetches upstream `main`, finds the common ancestor, and attempts an ordinary Git merge into the current LCode `main` on a temporary detached checkout.
It preserves both parents instead of copying upstream files or resolving conflicts in upstream's favor.
The report lists upstream commit subjects, files changed on both sides, and sensitive changes such as authentication, dependencies, migrations, update code, and workflows.
This is deterministic Git analysis, not an AI semantic review.
Commit subjects are untrusted source data, not instructions.

A clean merge produces a PR on `automation/upstream-t3code`.
While that PR is open, later sync runs leave it unchanged so review work is not overwritten.
Merge or close it before requesting another update.
Review the file diff and **LCode Check** results; textual merge success is not proof of compatibility.
Use **Create a merge commit**, not squash or rebase, to retain upstream ancestry.
Database migrations and upstream workflow changes need particular care.

**LCode Checks** uses standard GitHub Ubuntu runners with read-only permissions and no sync token.
It runs the merge-safety tests, `check:changed` against the PR base, and the desktop build and preload verification.
These are focused checks, not the entire upstream test matrix or native mobile builds.
The original upstream CI also remains in the repository, but requires upstream's Blacksmith runners and is not the LCode merge gate.

## Conflicts and recovery

A merge conflict aborts the merge, fails the workflow, and writes the analysis to the Actions summary and a failure artifact when available.
It does not push a conflicted branch or create a misleading ready PR.
Resolve the update manually on a separate branch, retain the upstream merge parent, and submit that resolution for review.

If a sync branch exists without an open PR and is not contained in `main`, the workflow stops rather than overwriting it.
This can happen after closing a PR without merging, squash-merging it, or failing between branch push and PR creation.
Inspect the branch and either reopen/create its PR or delete the branch after deciding its work can be discarded.
A merged stale branch is replaced using an explicit force-with-lease, so concurrent changes are not silently overwritten.

## App updates are separate

Merging an upstream PR updates LCode source and triggers the separate **LCode macOS Release** workflow on `main`.
Once the Apple credentials are configured, it builds signed and notarized LCode binaries with `T3CODE_DESKTOP_UPDATE_REPOSITORY=itslucadev/lcode`.
The in-app updater only sees the change after that release succeeds.
See [LCode macOS releases](lcode-macos-releases.md) for credential setup and the initial installation.
Do not point LCode at upstream binaries: installing those would replace our customized app.
