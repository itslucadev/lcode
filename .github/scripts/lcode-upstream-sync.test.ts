import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { test, type TestContext } from "vite-plus/test";
import { prepareSync } from "./lcode-upstream-sync.cjs";

function fixture(t: TestContext, original = "original\n") {
  const cwd = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "lcode-sync-test-"));
  t.onTestFinished(() => NodeFS.rmSync(cwd, { recursive: true, force: true }));
  const git = (...args: string[]) =>
    NodeChildProcess.execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const commit = (file: string, text: string) => {
    NodeFS.writeFileSync(NodePath.join(cwd, file), text);
    git("add", file);
    git("-c", "commit.gpgsign=false", "commit", "-m", `Update ${file}`);
  };
  git("init", "--initial-branch=main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("config", "core.hooksPath", "/dev/null");
  commit("shared.txt", original);
  git("branch", "upstream");
  const reportPath = NodePath.join(cwd, ".git", "report.md");
  return {
    cwd,
    git,
    commit,
    reportPath,
    sync: () => prepareSync({ cwd, baseRef: "main", upstreamRef: "upstream", reportPath }),
  };
}

test("merges clean updates while retaining custom code and both parents", (t) => {
  const { git, commit, sync, reportPath } = fixture(t);
  commit("custom.txt", "LCode workflow\n");
  const base = git("rev-parse", "main");
  git("checkout", "upstream");
  commit("feature.txt", "upstream improvement\n");
  const upstream = git("rev-parse", "upstream");
  const result = sync();
  NodeAssert.equal(result.status, "merged");
  NodeAssert.equal(git("show", "HEAD:custom.txt"), "LCode workflow");
  NodeAssert.equal(git("show", "HEAD:feature.txt"), "upstream improvement");
  NodeAssert.equal(git("rev-parse", "HEAD^1"), base);
  NodeAssert.equal(git("rev-parse", "HEAD^2"), upstream);
  NodeAssert.equal(git("rev-parse", "main"), base);
  NodeAssert.match(NodeFS.readFileSync(reportPath, "utf8"), /not a passing CI result/);
});

test("aborts conflicts without changing main or leaving a partial merge", (t) => {
  const { git, commit, sync, cwd, reportPath } = fixture(t);
  commit("shared.txt", "LCode customization\n");
  const base = git("rev-parse", "main");
  git("checkout", "upstream");
  commit("shared.txt", "incompatible upstream customization\n");
  NodeAssert.throws(sync, /Upstream merge failed: shared.txt/);
  NodeAssert.equal(git("rev-parse", "HEAD"), base);
  NodeAssert.equal(git("rev-parse", "main"), base);
  NodeAssert.equal(git("status", "--porcelain"), "");
  NodeAssert.equal(NodeFS.existsSync(NodePath.join(cwd, ".git", "MERGE_HEAD")), false);
  NodeAssert.match(NodeFS.readFileSync(reportPath, "utf8"), /Merge blocked/);
  NodeAssert.match(NodeFS.readFileSync(reportPath, "utf8"), /shared\.txt/);
});

test("does nothing when upstream is already an ancestor", (t) => {
  const { git, commit, sync, reportPath } = fixture(t);
  commit("custom.txt", "LCode only\n");
  const before = git("rev-parse", "HEAD");
  NodeAssert.equal(sync().status, "current");
  NodeAssert.equal(git("rev-parse", "HEAD"), before);
  NodeAssert.equal(NodeFS.existsSync(reportPath), false);
});

test("reports overlapping files and sensitive changes without treating them as conflicts", (t) => {
  const original = Array.from({ length: 20 }, (_, index) => `line ${index}\n`).join("");
  const { git, commit, sync, reportPath } = fixture(t, original);
  commit("shared.txt", original.replace("line 0\n", "LCode customization\n"));
  git("checkout", "upstream");
  commit("shared.txt", original.replace("line 19\n", "upstream improvement\n"));
  commit("auth.txt", "new authentication behavior\n");
  const result = sync();
  NodeAssert.deepEqual(result.sensitive, ["auth.txt"]);
  NodeAssert.deepEqual(result.overlap, ["shared.txt"]);
  NodeAssert.match(git("show", "HEAD:shared.txt"), /LCode customization/);
  NodeAssert.match(git("show", "HEAD:shared.txt"), /upstream improvement/);
  NodeAssert.match(NodeFS.readFileSync(reportPath, "utf8"), /auth\.txt/);
});

test("refuses dirty worktrees before attempting a merge", (t) => {
  const { git, commit, sync, cwd } = fixture(t);
  git("checkout", "upstream");
  commit("feature.txt", "upstream\n");
  NodeFS.writeFileSync(NodePath.join(cwd, "shared.txt"), "unsaved customization\n");
  NodeAssert.throws(sync, /clean checkout/);
  NodeAssert.equal(
    NodeFS.readFileSync(NodePath.join(cwd, "shared.txt"), "utf8"),
    "unsaved customization\n",
  );
});
