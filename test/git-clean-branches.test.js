import assert from "node:assert/strict";
import { test } from "node:test";
import { makeRepo, runCli, tempDir, writeTempConfig } from "./helpers.js";

// A repository with "feature-a" and "feature-b" merged into the base branch,
// "develop" (merged, and protected by default) and "feature-c" (not merged).
function repoWithBranches(t, { branch = "main" } = {}) {
  const repo = makeRepo(t, { branch });
  const { git } = repo;
  for (const feature of ["feature-a", "feature-b"]) {
    git("checkout", "--quiet", "-b", feature);
    git("commit", "--quiet", "--allow-empty", "-m", `work on ${feature}`);
    git("checkout", "--quiet", branch);
    git("merge", "--quiet", "--no-ff", "-m", `merge ${feature}`, feature);
  }
  git("branch", "develop");
  git("checkout", "--quiet", "-b", "feature-c");
  git("commit", "--quiet", "--allow-empty", "-m", "unfinished work");
  git("checkout", "--quiet", branch);
  return repo;
}

const branchesIn = (repo) => repo.git("for-each-ref", "--format=%(refname:lstrip=2)", "refs/heads/").split("\n");

const cleanBranches = (repo, args = [], { env, input } = {}) =>
  runCli(["git", "clean-branches", ...args], { cwd: repo.dir, env: { ...repo.env, ...env }, input });

test("--dry-run lists the merged branches and deletes nothing", async (t) => {
  const repo = repoWithBranches(t);
  const { stdout, stderr, code } = await cleanBranches(repo, ["--dry-run"]);
  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.equal(
    stdout,
    "Merged into main:\n  feature-a\n  feature-b\nKept: develop (protected)\nDry run: nothing was deleted.\n",
  );
  assert.deepEqual(branchesIn(repo), ["develop", "feature-a", "feature-b", "feature-c", "main"]);
});

test("--yes deletes the merged branches and keeps the unmerged one", async (t) => {
  const repo = repoWithBranches(t);
  const { stdout, stderr, code } = await cleanBranches(repo, ["--yes"]);
  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.equal(stdout, "Merged into main:\n  feature-a\n  feature-b\nKept: develop (protected)\nDeleted 2 branches.\n");
  assert.deepEqual(branchesIn(repo), ["develop", "feature-c", "main"]);
});

test("asks before deleting; only yes deletes", async (t) => {
  const repo = repoWithBranches(t);
  const before = branchesIn(repo);

  const no = await cleanBranches(repo, [], { input: "n\n" });
  assert.equal(no.code, 0);
  assert.equal(no.stderr, "Delete 2 branches? [y/N] ");
  assert.ok(no.stdout.endsWith("Nothing was deleted.\n"), no.stdout);

  // Input that ends without an answer is a no too.
  const noAnswer = await cleanBranches(repo);
  assert.ok(noAnswer.stdout.endsWith("Nothing was deleted.\n"), noAnswer.stdout);
  assert.deepEqual(branchesIn(repo), before);

  const yes = await cleanBranches(repo, [], { input: "y\n" });
  assert.equal(yes.code, 0);
  assert.ok(yes.stdout.endsWith("Deleted 2 branches.\n"), yes.stdout);
  assert.deepEqual(branchesIn(repo), ["develop", "feature-c", "main"]);
});

test("never deletes the current branch, the base branch or protected branches", async (t) => {
  const repo = repoWithBranches(t);
  repo.git("branch", "release");
  repo.git("checkout", "--quiet", "-b", "wip");
  // This list replaces the default one, so "develop" isn't protected here.
  const config = writeTempConfig(t, '{"protectedBranches": ["release"]}');

  const { stdout, code } = await cleanBranches(repo, ["--yes"], { env: { TOOLSMITH_CONFIG: config } });
  assert.equal(code, 0);
  assert.equal(
    stdout,
    "Merged into main:\n  develop\n  feature-a\n  feature-b\nKept: release (protected), wip (current branch)\nDeleted 3 branches.\n",
  );
  assert.deepEqual(branchesIn(repo), ["feature-c", "main", "release", "wip"]);
});

test("the base is main, or else master; --base picks another", async (t) => {
  const master = repoWithBranches(t, { branch: "master" });
  assert.match((await cleanBranches(master, ["--dry-run"])).stdout, /^Merged into master:\n/);

  const trunk = makeRepo(t, { branch: "trunk" });
  const none = await cleanBranches(trunk, ["--dry-run"]);
  assert.equal(none.code, 1);
  assert.equal(none.stderr, "error: found no main or master branch; choose the base branch with --base <name>\n");

  const chosen = await cleanBranches(trunk, ["--dry-run", "--base", "trunk"]);
  assert.equal(chosen.code, 0);
  assert.equal(chosen.stdout, "No merged branches to delete.\n");

  const missing = await cleanBranches(trunk, ["--base", "nope"]);
  assert.equal(missing.code, 1);
  assert.equal(missing.stderr, "error: there's no local branch named nope\n");
});

test("outside a git repository it says so", async (t) => {
  const { stdout, stderr, code } = await runCli(["git", "clean-branches"], { cwd: tempDir(t) });
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /^error: .+ isn't in a git repository\n$/);
});

test("without git it says git isn't installed", async (t) => {
  const repo = makeRepo(t);
  // An empty folder as PATH; Windows calls the variable "Path".
  const env = { PATH: tempDir(t), Path: undefined };
  const { stderr, code } = await cleanBranches(repo, ["--dry-run"], { env });
  assert.equal(code, 1);
  assert.equal(stderr, "error: git isn't installed, or isn't on your PATH\n");
});
