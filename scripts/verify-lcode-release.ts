// @effect-diagnostics nodeBuiltinImport:off - Standalone release validation uses synchronous filesystem and SHA-512 APIs.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as Schema from "effect/Schema";
import { fromYaml } from "@t3tools/shared/schemaYaml";

const decodeManifest = Schema.decodeUnknownSync(
  fromYaml(
    Schema.Struct({
      version: Schema.String,
      files: Schema.Array(
        Schema.Struct({
          url: Schema.String,
          sha512: Schema.String,
          size: Schema.Number,
        }),
      ),
      path: Schema.optional(Schema.String),
      sha512: Schema.optional(Schema.String),
    }),
  ),
);
const decodeFeed = Schema.decodeUnknownSync(
  fromYaml(
    Schema.Struct({
      provider: Schema.Literal("github"),
      owner: Schema.Literal("itslucadev"),
      repo: Schema.Literal("lcode"),
    }),
  ),
);

export function verifyLCodeRelease(directory: string, version: string, feedPath: string): void {
  if (!/^0\.0\.[1-9]\d*$/.test(version)) throw new Error("Invalid LCode release version.");
  decodeFeed(NodeFS.readFileSync(feedPath, "utf8"));
  const manifest = decodeManifest(
    NodeFS.readFileSync(NodePath.join(directory, "latest-mac.yml"), "utf8"),
  );
  if (manifest.version !== version)
    throw new Error("Update manifest version does not match the build.");
  const stem = `LCode-${version}-arm64`;
  const zip = `${stem}.zip`;
  if (!manifest.files.some((file) => file.url === zip))
    throw new Error("Update manifest is missing the macOS ZIP.");
  const expectedFiles = new Set([zip, `${stem}.dmg`]);
  for (const name of expectedFiles) {
    if (!NodeFS.statSync(NodePath.join(directory, name)).isFile())
      throw new Error(`Missing release asset: ${name}`);
  }
  const seen = new Set<string>();
  for (const file of manifest.files) {
    if (!expectedFiles.has(file.url) || seen.has(file.url))
      throw new Error("Unexpected or duplicate update asset.");
    seen.add(file.url);
    const contents = NodeFS.readFileSync(NodePath.join(directory, file.url));
    const sha512 = NodeCrypto.createHash("sha512").update(contents).digest("base64");
    if (contents.length !== file.size || sha512 !== file.sha512)
      throw new Error(`Update asset integrity mismatch: ${file.url}`);
  }
  if (manifest.path !== undefined || manifest.sha512 !== undefined) {
    const legacy = manifest.files.find((file) => file.url === manifest.path);
    if (!legacy || legacy.sha512 !== manifest.sha512)
      throw new Error("Legacy update metadata does not match the asset list.");
  }
}

if (
  process.argv[1] &&
  NodePath.resolve(process.argv[1]) === NodeURL.fileURLToPath(import.meta.url)
) {
  const [, , directory, version, feedPath] = process.argv;
  if (!directory || !version || !feedPath)
    throw new Error("Usage: verify-lcode-release.ts <assets-directory> <version> <app-update.yml>");
  verifyLCodeRelease(directory, version, feedPath);
}
