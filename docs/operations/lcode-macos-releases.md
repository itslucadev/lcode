# LCode macOS releases

The **LCode macOS Release** workflow builds an Apple Silicon Mac installer after every push to protected `main`, including merged upstream PRs.
It can also be started manually on `main`.
It does not run for pull requests, other branches, or other repositories.
The first installation is manual; subsequent releases are delivered by the existing in-app updater.

## Configure Apple credentials once

The GitHub environment [`lcode-release`](https://github.com/itslucadev/lcode/settings/environments) is restricted to protected branches.
Add these **environment secrets**, not source files:

| Secret             | Value                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `CSC_LINK`         | Base64-encoded Developer ID Application `.p12`, including its private key.                                   |
| `CSC_KEY_PASSWORD` | The password used to export that `.p12`.                                                                     |
| `APPLE_API_KEY`    | The full raw contents of the notarization `.p8` private-key file, including its BEGIN/END lines, not base64. |
| `APPLE_API_KEY_ID` | The corresponding App Store Connect API key ID.                                                              |
| `APPLE_API_ISSUER` | The issuer ID for that team's API key.                                                                       |

Add the environment **variable** `APPLE_TEAM_ID` with the 10-character team ID that issued the Developer ID certificate.
Use a team API key authorized for notarization, not an unrelated individual key.
The workflow writes the private key to a restricted temporary file and removes it after packaging.
Missing credentials fail the job; the pipeline never silently publishes an unsigned app.
The publishing job uses its short-lived `GITHUB_TOKEN`, not `UPSTREAM_SYNC_TOKEN` or the Apple keys.

Obtain the certificate from [Apple Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/certificates/list), and export its certificate and private key together from Keychain Access as a password-protected `.p12`.
A public `.cer` alone cannot sign the app.
Create or locate the notarization team API key in [App Store Connect](https://appstoreconnect.apple.com/access/integrations/api).
Apple only allows the private key to be downloaded once; keep your original securely.

For uploading file contents directly from your Mac without pasting secrets into chat or command arguments:

```bash
base64 -i "/path/to/DeveloperID.p12" | tr -d '\n' | \
  gh-axi secret set CSC_LINK -R itslucadev/lcode --env lcode-release

gh-axi secret set APPLE_API_KEY -R itslucadev/lcode --env lcode-release \
  < "/path/to/AuthKey.p8"
```

Use the environment settings UI for the remaining values.
Never commit the certificate, `.p8`, passwords, or a local credential file.

## First installation

Configure the environment before merging the pipeline PR, or manually start the workflow after adding the credentials.
The workflow must be merged to `main` before it can produce a release.
Wait for the build and publishing jobs to succeed, then open [Releases](https://github.com/itslucadev/lcode/releases/latest).
Download the `LCode-0.0.N-arm64.dmg`, open it, and drag **LCode (Beta)** into **Applications**.
Use this build rather than a T3 Code installer.
Keep the app's update channel on **Latest**, not **Nightly**; the LCode pipeline currently publishes only one channel.

## Later updates

Merge a reviewed PR into `main` and wait for a new published release.
The app checks for updates automatically, and its **Check for Updates…** menu action can check immediately.
Restart through the app's update action to install a downloaded update.
A source push is not available in the app until its build, notarization, verification, and publishing jobs succeed.

LCode uses its own monotonically increasing `0.0.N` version and `v0.0.N+lcode` release tag, where `N` is this workflow's GitHub run number.
The SemVer build-metadata suffix keeps LCode tags separate from the T3 tags inherited by the fork, while updater version comparisons use `0.0.N`.
This is independent of the T3 Code source version; skipped or failed runs leave harmless gaps.
The workflow changes package versions only in its checkout and does not push version commits to `main`.
Concurrent releases are serialized; GitHub may coalesce pending runs when several merges arrive during a build.
A previously published version is never overwritten, and an older run cannot replace a newer published release.
The publish job first uploads into a draft, then publishes it as latest only after all assets are uploaded.
If publishing fails halfway through, inspect and remove its unpublished draft/tag before retrying that same version, or start a new workflow run to use a new version.
Never replace assets on a release that users may already have installed.

## Verification and limitations

Before publishing, the workflow requires a valid Developer ID signature from `APPLE_TEAM_ID`, a stapled notarization ticket, Gatekeeper acceptance, the LCode bundle identifier, and the expected app version.
It also validates the embedded update feed, the macOS ZIP, and the manifest's file sizes and SHA-512 digests.
Only the installer, ZIP, update manifest, and available blockmaps are uploaded, not build configuration dumps or signing files.
Actual installation and an update from one installed version to the next still need a one-time test on your Mac after two successful releases.

The bundle ID is `dev.itslucadev.lcode`; the updater reads only `itslucadev/lcode`.
Native passkeys requiring upstream's Associated Domains provisioning are disabled for this fork's releases because our Apple team cannot claim T3's domain association.
This does not remove the standard Electron hardened runtime or code signing.
Do not assume T3-hosted authentication features will work with a different bundle ID without additional upstream service configuration.
Internal server data paths are still inherited from T3 Code, so do not run both apps simultaneously against the same local data.

Signing and notarization follow [electron-builder's code-signing guidance](https://www.electron.build/code-signing) and [notarization guidance](https://www.electron.build/docs/features/code-signing/notarization).
The repository currently pins electron-builder 26.16.1; this pipeline uses that version's configuration layout.
