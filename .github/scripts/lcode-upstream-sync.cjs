const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const branch = "automation/upstream-t3code";
const upstreamRepository = "pingdotgg/t3code";

function prepareSync({ cwd, baseRef, upstreamRef, reportPath }) {
  const git = (...args) =>
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    }).trim();
  const base = git("rev-parse", baseRef);
  const upstream = git("rev-parse", upstreamRef);
  const common = git("merge-base", base, upstream);
  if (common === upstream) return { status: "current", upstream };
  if (git("status", "--porcelain")) throw new Error("Sync requires a clean checkout.");

  const files = (from, to) =>
    git("diff", "--name-only", "--no-renames", "-z", from, to).split("\0").filter(Boolean);
  const customFiles = new Set(files(common, base));
  const upstreamFiles = files(common, upstream);
  const overlap = upstreamFiles.filter((file) => customFiles.has(file));
  const sensitive = upstreamFiles.filter((file) =>
    /(^\.github\/|(^|\/)(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$|auth|migration|updat|release|permission)/i.test(
      file,
    ),
  );
  const commits = git("log", "--format=%h %s", "--max-count=80", `${common}..${upstream}`);
  const count = git("rev-list", "--count", `${common}..${upstream}`);
  const report = (status, conflicts = []) => {
    const json = (value) => JSON.stringify(value, null, 2).replaceAll("`", "\\u0060");
    fs.writeFileSync(
      reportPath,
      [
        "## Summary",
        "",
        "```text",
        "pingdotgg/t3code:main -> merge preserving LCode customizations -> review -> main",
        "```",
        "",
        `Upstream: https://github.com/${upstreamRepository}/commit/${upstream}`,
        `LCode base: ${base}`,
        `Upstream commits: ${count} (at most 80 subjects shown below).`,
        `Changed upstream files: ${upstreamFiles.length}.`,
        "",
        "## Evidence",
        "",
        `- **Before:** LCode does not contain upstream commit ${upstream}.`,
        `- **After:** ${status}`,
        "- Build, typecheck, lint and focused tests are reported separately by LCode Checks; this report is not a passing CI result.",
        "- File overlap is a review signal, not proof of a semantic conflict or compatibility.",
        "",
        "### Files also changed by LCode",
        "",
        "```json",
        json(overlap),
        "```",
        "",
        "### Sensitive changes to review",
        "",
        "```json",
        json(sensitive),
        "```",
        "",
        "### Merge conflicts",
        "",
        "```json",
        json(conflicts),
        "```",
        "",
        "### Upstream commit subjects (untrusted source data)",
        "",
        "```json",
        json(commits.split("\n")),
        "```",
        "",
        "## Merge Danger",
        "",
        "**Door:** two-way for source changes; runtime database migrations may not be reversible.",
        "**Blast Radius:** application",
        "",
        "Review sensitive changes and all CI results before approving.",
        "Use **Create a merge commit**, not squash or rebase, to preserve upstream ancestry for future syncs.",
        "No automatic merge, release, or app installation is performed.",
        "",
      ].join("\n"),
    );
  };

  git("checkout", "--detach", base);
  const merged = spawnSync(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgsign=false",
      "merge",
      "--no-ff",
      "--no-edit",
      upstream,
    ],
    { cwd, encoding: "utf8" },
  );
  if (merged.status !== 0) {
    const conflicts = git("diff", "--name-only", "--diff-filter=U", "-z")
      .split("\0")
      .filter(Boolean);
    const abort = spawnSync("git", ["merge", "--abort"], { cwd, encoding: "utf8" });
    if (abort.status !== 0) throw new Error("Merge failed and could not be aborted.");
    report("Merge blocked; no branch was pushed and no PR was created.", conflicts);
    throw new Error(
      `Upstream merge failed: ${conflicts.length ? conflicts.join(", ") : merged.stderr}`,
    );
  }
  report(
    "Git merge succeeded without textual conflicts; semantic compatibility still requires review and CI.",
  );
  return { status: "merged", upstream, base, overlap, sensitive };
}

function main() {
  if (process.env.GITHUB_REPOSITORY !== "itslucadev/lcode") {
    throw new Error("This sync may only publish to itslucadev/lcode.");
  }
  const cwd = process.cwd();
  const repository = process.env.GITHUB_REPOSITORY;
  const cli = (...args) => execFileSync("gh-axi", args, { encoding: "utf8" }).trim();
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const open = cli(
    "api",
    `/repos/${repository}/pulls?state=open&head=itslucadev:${branch}&base=main`,
    "--jq",
    ".[0].number // empty",
  );
  if (open) {
    console.log(`Existing upstream PR #${open} is awaiting review; leaving it unchanged.`);
    return;
  }
  git("fetch", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main");
  git(
    "fetch",
    "--no-tags",
    `https://github.com/${upstreamRepository}.git`,
    "+refs/heads/main:refs/remotes/t3-upstream/main",
  );
  const remoteBranch = git("ls-remote", "--heads", "origin", `refs/heads/${branch}`).split(/\s/)[0];
  if (remoteBranch) {
    git("fetch", "--no-tags", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`);
    const contained = spawnSync(
      "git",
      ["merge-base", "--is-ancestor", remoteBranch, "origin/main"],
      { cwd },
    );
    if (contained.status !== 0) {
      throw new Error(
        `Unmerged ${branch} exists without an open PR. Review it and reopen its PR or delete the branch manually; it will not be overwritten.`,
      );
    }
  }
  git("config", "user.name", "lcode-upstream-bot");
  git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
  const reportPath = path.join(process.env.RUNNER_TEMP, "lcode-upstream-report.md");
  const result = prepareSync({
    cwd,
    baseRef: "origin/main",
    upstreamRef: "t3-upstream/main",
    reportPath,
  });
  if (result.status === "current") {
    console.log("LCode already contains the latest upstream commit.");
    return;
  }
  git(
    "push",
    `--force-with-lease=refs/heads/${branch}:${remoteBranch}`,
    "origin",
    `HEAD:refs/heads/${branch}`,
  );
  console.log(
    cli(
      "pr",
      "create",
      "-R",
      repository,
      "--base",
      "main",
      "--head",
      branch,
      "--title",
      `chore(upstream): sync T3 Code ${result.upstream.slice(0, 12)}`,
      "--body-file",
      reportPath,
    ),
  );
}

module.exports = { prepareSync };
if (require.main === module) main();
