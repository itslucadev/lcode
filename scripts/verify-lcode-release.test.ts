// @effect-diagnostics nodeBuiltinImport:off - Tests exercise the release verifier against real disposable files.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { test, expect, type TestContext } from "vite-plus/test";
import { verifyLCodeRelease } from "./verify-lcode-release.ts";

function fixture(t: TestContext) {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "lcode-release-test-"));
  t.onTestFinished(() => NodeFS.rmSync(directory, { recursive: true, force: true }));
  const zip = "LCode-0.0.12-arm64.zip";
  const sha512 = NodeCrypto.createHash("sha512").update("signed zip fixture").digest("base64");
  NodeFS.writeFileSync(NodePath.join(directory, zip), "signed zip fixture");
  NodeFS.writeFileSync(NodePath.join(directory, "LCode-0.0.12-arm64.dmg"), "installer fixture");
  const feedPath = NodePath.join(directory, "app-update.yml");
  NodeFS.writeFileSync(feedPath, "provider: github\nowner: itslucadev\nrepo: lcode\n");
  const manifest = {
    version: "0.0.12",
    files: [{ url: zip, sha512, size: 18 }],
    path: zip,
    sha512,
  };
  const write = () =>
    NodeFS.writeFileSync(NodePath.join(directory, "latest-mac.yml"), JSON.stringify(manifest));
  write();
  return {
    directory,
    feedPath,
    manifest,
    write,
    verify: () => verifyLCodeRelease(directory, "0.0.12", feedPath),
  };
}

test("accepts matching assets and a LCode-only update feed", (t) => {
  expect(fixture(t).verify).not.toThrow();
});

test("rejects upstream feeds instead of delivering T3 Code binaries", (t) => {
  const { verify, feedPath } = fixture(t);
  NodeFS.writeFileSync(feedPath, "provider: github\nowner: pingdotgg\nrepo: t3code\n");
  expect(verify).toThrow();
});

test("rejects wrong versions, missing ZIPs and unsafe asset paths", (t) => {
  const { verify, manifest, write } = fixture(t);
  manifest.version = "0.0.11";
  write();
  expect(verify).toThrow(/version/);
  manifest.version = "0.0.12";
  manifest.files[0]!.url = "../outside.zip";
  write();
  expect(verify).toThrow(/missing.*ZIP/);
});

test("rejects changed bytes, sizes and legacy metadata", (t) => {
  const { verify, manifest, write, directory } = fixture(t);
  NodeFS.writeFileSync(NodePath.join(directory, manifest.path), "tampered zip bytes");
  expect(verify).toThrow(/integrity mismatch/);
  NodeFS.writeFileSync(NodePath.join(directory, manifest.path), "signed zip fixture");
  manifest.files[0]!.size = 19;
  write();
  expect(verify).toThrow(/integrity mismatch/);
  manifest.files[0]!.size = 18;
  manifest.sha512 = "not the ZIP hash";
  write();
  expect(verify).toThrow(/Legacy update metadata/);
});

test("rejects missing installers and duplicate manifest entries", (t) => {
  const { verify, manifest, write, directory } = fixture(t);
  manifest.files.push(manifest.files[0]!);
  write();
  expect(verify).toThrow(/duplicate/);
  manifest.files.pop();
  write();
  NodeFS.unlinkSync(NodePath.join(directory, "LCode-0.0.12-arm64.dmg"));
  expect(verify).toThrow();
});
