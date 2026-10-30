import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fakeNpmFolder, gitEnv, makeRepo, makeTree, runCli, tempDir } from "./helpers.js";

// Runs git in `cwd` with the variables from gitEnv, and returns its output.
const gitIn = (cwd, env, ...args) =>
  execFileSync("git", args, { cwd, env: { ...process.env, ...env }, encoding: "utf8" }).trim();

// What the fake npm (see helpers.js) was run with in `folder`, or undefined if
// it didn't run there.
function fakeNpmArgs(folder) {
  const file = join(folder, "fake-npm.txt");
  return existsSync(file) ? readFileSync(file, "utf8").trim() : undefined;
}

// The fake npm on Windows is a batch file, whose lines end with \r\n.
const lf = (text) => text.replaceAll("\r\n", "\n");

test("makes a git repository with a first commit, then runs npm install", async (t) => {
  const cwd = tempDir(t);
  const env = gitEnv(t);
  const args = ["new", "node-cli", "my-tool", "--author", "Ada Lovelace"];
  const { stdout, stderr, code } = await runCli(args, { cwd, env });
  assert.equal(code, 0, stderr);
  assert.equal(stderr, "");
  assert.equal(
    lf(stdout),
    "  my-tool/README.md\n  my-tool/.gitignore\n  my-tool/bin/my-tool.js\n  my-tool/package.json\n" +
      'Created "my-tool" from the node-cli template in my-tool.\n' +
      "Initialized a git repository and committed the files.\n" +
      "Running npm install...\n" +
      "fake npm install\n" +
      "npm install finished.\n",
  );

  const project = join(cwd, "my-tool");
  assert.equal(gitIn(project, env, "log", "--format=%s"), "Initial commit from toolsmith (node-cli)");
  assert.deepEqual(gitIn(project, env, "ls-files").split("\n"), [
    ".gitignore",
    "README.md",
    "bin/my-tool.js",
    "package.json",
  ]);
  // npm ran in the project, after the commit.
  assert.equal(fakeNpmArgs(project), "install");
});

test("with --force, the first commit has only the files from the template", async (t) => {
  const cwd = makeTree(t, { "project/notes.txt": "mine", "project/README.md": "old readme" });
  const env = gitEnv(t);
  const { stderr, code } = await runCli(["new", "node-cli", "project", "--author", "x", "--force", "--no-install"], {
    cwd,
    env,
  });
  assert.equal(code, 0, stderr);
  const project = join(cwd, "project");
  assert.deepEqual(gitIn(project, env, "ls-files").split("\n"), [
    ".gitignore",
    "README.md",
    "bin/project.js",
    "package.json",
  ]);
  assert.equal(gitIn(project, env, "status", "--porcelain"), "?? notes.txt");
});

test("inside a git repository, git init is skipped, and toolsmith says so", async (t) => {
  const repo = makeRepo(t);
  const { stdout, stderr, code } = await runCli(["new", "node-cli", "sub", "--author", "x"], {
    cwd: repo.dir,
    env: repo.env,
  });
  assert.equal(code, 0, stderr);
  assert.equal(stderr, "");
  assert.match(stdout, /^Skipped git init: sub is already in a git repository\.$/m);
  assert.ok(!existsSync(join(repo.dir, "sub", ".git")), "sub got a repository of its own");
  assert.equal(repo.git("log", "--format=%s"), "first commit");
  assert.equal(fakeNpmArgs(join(repo.dir, "sub")), "install");
});

test("--no-git skips git init and the commit", async (t) => {
  const cwd = tempDir(t);
  const { stdout, code } = await runCli(["new", "node-cli", "my-tool", "--author", "x", "--no-git"], {
    cwd,
    env: gitEnv(t),
  });
  assert.equal(code, 0);
  assert.doesNotMatch(stdout, /git init|git repository/);
  assert.ok(!existsSync(join(cwd, "my-tool", ".git")), "a repository was made");
  assert.equal(fakeNpmArgs(join(cwd, "my-tool")), "install");
});

test("--no-install skips npm install", async (t) => {
  const cwd = tempDir(t);
  const env = gitEnv(t);
  const { stdout, code } = await runCli(["new", "node-cli", "my-tool", "--author", "x", "--no-install"], { cwd, env });
  assert.equal(code, 0);
  assert.doesNotMatch(stdout, /npm/);
  assert.equal(fakeNpmArgs(join(cwd, "my-tool")), undefined);
  assert.equal(gitIn(join(cwd, "my-tool"), env, "log", "--format=%s"), "Initial commit from toolsmith (node-cli)");
});

test("npm install only runs for templates with a package.json", async (t) => {
  const cwd = tempDir(t);
  const { stdout, code } = await runCli(["new", "web-static", "site", "--author", "x", "--no-git"], { cwd });
  assert.equal(code, 0);
  assert.doesNotMatch(stdout, /npm/);
  assert.equal(fakeNpmArgs(join(cwd, "site")), undefined);
});

test("a missing git is only a warning, and npm install still runs", async (t) => {
  const cwd = tempDir(t);
  // Nothing on the PATH but the fake npm.
  const { stderr, code } = await runCli(["new", "node-cli", "my-tool", "--author", "x"], {
    cwd,
    env: { PATH: fakeNpmFolder },
  });
  assert.equal(code, 0);
  assert.equal(stderr, "warning: skipped git init (git isn't installed, or isn't on your PATH)\n");
  assert.ok(!existsSync(join(cwd, "my-tool", ".git")), "a repository was made");
  assert.equal(fakeNpmArgs(join(cwd, "my-tool")), "install");
});

test("a failed or missing npm is an error, and the project's files stay", async (t) => {
  const failed = tempDir(t);
  const args = ["new", "node-cli", "my-tool", "--author", "x", "--no-git"];
  const run = await runCli(args, { cwd: failed, env: { FAKE_NPM_EXIT_CODE: "3" } });
  assert.equal(run.code, 1);
  assert.match(lf(run.stdout), /^fake npm install$/m);
  assert.equal(
    lf(run.stderr),
    "fake npm failed\n" +
      "error: npm install failed (exit code 3); the project's files are kept, " +
      'so run "npm install" in my-tool to finish\n',
  );
  assert.ok(existsSync(join(failed, "my-tool", "package.json")));

  const missing = tempDir(t);
  // A PATH with nothing on it.
  const noNpm = await runCli(args, { cwd: missing, env: { PATH: tempDir(t) } });
  assert.equal(noNpm.code, 1);
  assert.equal(
    noNpm.stderr,
    "error: npm isn't installed, or isn't on your PATH; the project's files are kept, " +
      'so run "npm install" in my-tool to finish\n',
  );
  assert.ok(existsSync(join(missing, "my-tool", "package.json")));
});
