import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, sep } from "node:path";
import { test } from "node:test";
import { makeTree, runCli, tempDir } from "./helpers.js";

const year = String(new Date().getFullYear());

// Everything below `folder`, as sorted relative paths with "/".
const filesIn = (folder) =>
  readdirSync(folder, { recursive: true })
    .map((path) => path.split(sep).join("/"))
    .sort();

const read = (...parts) => readFileSync(join(...parts), "utf8");

// These tests are about the files; git init and npm install have their own
// tests in new-git-npm.test.js.
const filesOnly = ["--no-git", "--no-install"];

test("creates a project from a template, filling in the placeholders", async (t) => {
  const cwd = tempDir(t);
  const args = ["new", "node-cli", "my-tool", "--author", "Ada Lovelace", ...filesOnly];
  const { stdout, stderr, code } = await runCli(args, { cwd });
  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.equal(
    stdout,
    "  my-tool/README.md\n  my-tool/.gitignore\n  my-tool/bin/my-tool.js\n  my-tool/package.json\n" +
      'Created "my-tool" from the node-cli template in my-tool.\n',
  );

  const project = join(cwd, "my-tool");
  // {{name}} in a file name is filled in, and _gitignore becomes .gitignore.
  assert.deepEqual(filesIn(project), [".gitignore", "README.md", "bin", "bin/my-tool.js", "package.json"]);
  assert.deepEqual(JSON.parse(read(project, "package.json")), {
    name: "my-tool",
    version: "0.1.0",
    type: "module",
    bin: { "my-tool": "bin/my-tool.js" },
    author: "Ada Lovelace",
  });
  assert.ok(read(project, "README.md").startsWith(`# my-tool\n\nA command-line tool by Ada Lovelace, ${year}.\n`));
  assert.equal(read(project, "bin", "my-tool.js"), '#!/usr/bin/env node\n\nconsole.log("Hello from my-tool!");\n');
  assert.equal(read(project, ".gitignore"), "node_modules/\n");
  for (const path of filesIn(project)) {
    if (statSync(join(project, path)).isFile()) {
      assert.doesNotMatch(read(project, path), /\{\{/, `${path} still has a placeholder`);
    }
  }
});

test("the name defaults to the folder's name, and the author to git's user.name", async (t) => {
  const cwd = tempDir(t);
  const gitConfig = join(tempDir(t), "gitconfig");
  writeFileSync(gitConfig, "[user]\n\tname = Grace Hopper\n");
  const env = { GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: "1" };

  assert.equal((await runCli(["new", "node-cli", "web-app", ...filesOnly], { cwd, env })).code, 0);
  const packageJson = JSON.parse(read(cwd, "web-app", "package.json"));
  assert.equal(packageJson.name, "web-app");
  assert.equal(packageJson.author, "Grace Hopper");

  // --name replaces the folder's name everywhere, file names included.
  const args = ["new", "node-cli", "folder", "--name", "other", "--author", "x", ...filesOnly];
  assert.equal((await runCli(args, { cwd })).code, 0);
  assert.deepEqual(filesIn(join(cwd, "folder")), [".gitignore", "README.md", "bin", "bin/other.js", "package.json"]);
});

test("without a directory it uses the current folder, named after it", async (t) => {
  const cwd = tempDir(t);
  const { stdout, code } = await runCli(["new", "node-cli", "--author", "x", ...filesOnly], { cwd });
  assert.equal(code, 0);
  assert.ok(stdout.endsWith("from the node-cli template in the current folder.\n"), stdout);
  assert.equal(JSON.parse(read(cwd, "package.json")).name, basename(cwd));
});

test("refuses a folder that isn't empty, unless --force is given", async (t) => {
  const cwd = makeTree(t, { "existing/notes.txt": "keep me", "existing/README.md": "old readme" });

  const refused = await runCli(["new", "node-cli", "existing", "--author", "x"], { cwd });
  assert.equal(refused.code, 1);
  assert.equal(refused.stdout, "");
  assert.equal(refused.stderr, "error: existing isn't empty; add --force to write into it anyway\n");
  assert.deepEqual(filesIn(join(cwd, "existing")), ["README.md", "notes.txt"]);

  const forced = await runCli(["new", "node-cli", "existing", "--author", "x", "--force", ...filesOnly], { cwd });
  assert.equal(forced.code, 0);
  assert.match(forced.stdout, /^ {2}existing\/README\.md \(replaced\)$/m);
  assert.equal(read(cwd, "existing", "notes.txt"), "keep me");
  assert.ok(read(cwd, "existing", "README.md").startsWith("# existing\n"));
});

test("a folder with only .git in it counts as empty", async (t) => {
  const cwd = makeTree(t, { "project/.git/HEAD": "ref: refs/heads/main\n" });
  const { code } = await runCli(["new", "node-cli", "project", "--author", "x", ...filesOnly], { cwd });
  assert.equal(code, 0);
  assert.deepEqual(
    filesIn(join(cwd, "project")).filter((path) => !path.startsWith(".git/")),
    [".git", ".gitignore", "README.md", "bin", "bin/project.js", "package.json"],
  );
});

test("no template, an unknown one, an invalid name or a file as the target is an error", async (t) => {
  const cwd = makeTree(t, { "a-file.txt": "" });

  const unknown = await runCli(["new", "nope", "x"], { cwd });
  assert.equal(unknown.code, 1);
  assert.equal(unknown.stderr, 'error: there\'s no template or folder named "nope"; see "toolsmith new --list"\n');

  const missing = await runCli(["new"], { cwd });
  assert.equal(missing.code, 1);
  assert.equal(
    missing.stderr,
    'error: choose a template, like "toolsmith new node-cli my-project"; see "toolsmith new --list"\n',
  );

  const badName = await runCli(["new", "node-cli", "x", "--name", "a/b", "--author", "x"], { cwd });
  assert.equal(badName.code, 1);
  assert.equal(
    badName.stderr,
    'error: "a/b" can\'t be the project name, because it\'s used in file names; choose one with --name\n',
  );

  const file = await runCli(["new", "node-cli", "a-file.txt", "--author", "x"], { cwd });
  assert.equal(file.code, 1);
  assert.equal(file.stderr, "error: a-file.txt is a file, not a folder\n");

  // Nothing was created along the way.
  assert.deepEqual(filesIn(cwd), ["a-file.txt"]);
});
