import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
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

// Commits `contents` as `file` on the current branch.
function commitFile(repo, file, contents, message) {
  writeFileSync(join(repo.dir, file), contents);
  repo.git("add", file);
  repo.git("commit", "--quiet", "-m", message);
}

// A repository where "feature-s" (two commits) is squash-merged into main, and
// "feature-t" is squash-merged too but got another commit afterwards.
function repoWithSquashMerges(t) {
  const repo = makeRepo(t);
  const { git } = repo;
  git("checkout", "--quiet", "-b", "feature-s");
  commitFile(repo, "s.txt", "one\n", "add s");
  commitFile(repo, "s.txt", "one\ntwo\n", "extend s");
  git("checkout", "--quiet", "-b", "feature-t", "main");
  commitFile(repo, "t.txt", "t\n", "add t");
  git("checkout", "--quiet", "main");
  for (const branch of ["feature-s", "feature-t"]) {
    git("merge", "--quiet", "--squash", branch);
    git("commit", "--quiet", "-m", `squash ${branch}`);
  }
  git("checkout", "--quiet", "feature-t");
  commitFile(repo, "t.txt", "t\nmore\n", "more work after the squash");
  git("checkout", "--quiet", "main");
  return repo;
}

// repoWithBranches plus a bare repository as origin with all its branches, and
// "old-feature": merged into main, but only on origin.
function repoWithOrigin(t) {
  const repo = repoWithBranches(t);
  const origin = tempDir(t);
  repo.git("init", "--quiet", "--bare", origin);
  repo.git("remote", "add", "origin", origin);
  repo.git("branch", "old-feature", "feature-a");
  repo.git("push", "--quiet", "origin", "main", "develop", "feature-a", "feature-b", "feature-c", "old-feature");
  repo.git("branch", "-D", "old-feature");
  const branchesOnOrigin = () =>
    repo.git("ls-remote", "--heads", "origin").split("\n").map((line) => line.replace(/^.*\trefs\/heads\//, ""));
  return { ...repo, branchesOnOrigin };
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

test("finds squash-merged branches, but not one with work added after the squash", async (t) => {
  const repo = repoWithSquashMerges(t);
  const dry = await cleanBranches(repo, ["--dry-run"]);
  assert.equal(dry.code, 0);
  assert.equal(dry.stdout, "Squash-merged into main:\n  feature-s\nDry run: nothing was deleted.\n");

  // -d would refuse feature-s; it's deleted with -D after the confirmation.
  const { stdout, stderr, code } = await cleanBranches(repo, [], { input: "y\n" });
  assert.equal(code, 0);
  assert.equal(stderr, "Delete 1 branch? [y/N] ");
  assert.equal(stdout, "Squash-merged into main:\n  feature-s\nDeleted 1 branch.\n");
  assert.deepEqual(branchesIn(repo), ["feature-t", "main"]);

  // The check created no refs and didn't touch the working tree.
  assert.equal(repo.git("for-each-ref", "--format=%(refname)"), "refs/heads/feature-t\nrefs/heads/main");
  assert.equal(repo.git("status", "--porcelain"), "");
});

test("--remote also deletes merged branches on origin", async (t) => {
  const repo = repoWithOrigin(t);
  const { stdout, stderr, code } = await cleanBranches(repo, ["--remote", "--yes"]);
  assert.equal(code, 0, stderr);
  assert.equal(stderr, "");
  assert.equal(
    stdout,
    "Merged into main:\n  feature-a\n  feature-b\nKept: develop (protected)\n" +
      "On origin:\n  feature-a\n  feature-b\n  old-feature\n" +
      "Deleted 2 branches.\nDeleted 3 branches on origin.\n",
  );
  assert.deepEqual(branchesIn(repo), ["develop", "feature-c", "main"]);
  assert.deepEqual(repo.branchesOnOrigin(), ["develop", "feature-c", "main"]);
});

test("--remote respects --dry-run, protected branches and its own question", async (t) => {
  const repo = repoWithOrigin(t);
  const onOrigin = repo.branchesOnOrigin();

  // develop (protected) and main (the base) are never listed for origin.
  const dry = await cleanBranches(repo, ["--remote", "--dry-run"]);
  assert.equal(dry.code, 0);
  assert.ok(dry.stdout.endsWith("On origin:\n  feature-a\n  feature-b\n  old-feature\nDry run: nothing was deleted.\n"));
  assert.deepEqual(repo.branchesOnOrigin(), onOrigin);

  // Yes to deleting the local branches, no to deleting them on origin.
  const answered = await cleanBranches(repo, ["--remote"], { input: "y\nn\n" });
  assert.equal(answered.code, 0);
  assert.equal(answered.stderr, "Delete 2 branches? [y/N] Delete 3 branches on origin? [y/N] ");
  assert.ok(answered.stdout.endsWith("Deleted 2 branches.\nBranches on origin were kept.\n"), answered.stdout);
  assert.deepEqual(branchesIn(repo), ["develop", "feature-c", "main"]);
  assert.deepEqual(repo.branchesOnOrigin(), onOrigin);

  const noOrigin = await cleanBranches(repoWithBranches(t), ["--remote", "--dry-run"]);
  assert.equal(noOrigin.code, 1);
  assert.equal(noOrigin.stderr, "error: there's no remote named origin\n");
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
