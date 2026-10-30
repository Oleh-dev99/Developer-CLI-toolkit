import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { makeRepo, runCli, tempDir, writeTempConfig } from "./helpers.js";

const template = (repo, args, { config } = {}) =>
  runCli(["git", "template", ...args], {
    cwd: repo.dir,
    env: { ...repo.env, ...(config && { TOOLSMITH_CONFIG: config }) },
  });

// A value from the repository's own git config, or null.
function localValue(repo, key) {
  try {
    return repo.git("config", "--local", "--get", key);
  } catch {
    return null;
  }
}

test("list shows built-in and user templates and marks the active one", async (t) => {
  const repo = makeRepo(t);
  const config = writeTempConfig(t, JSON.stringify({ templates: { team: "Team template\n" } }));

  const before = await template(repo, ["list"], { config });
  assert.equal(before.code, 0);
  assert.equal(before.stdout, "  conventional  built-in\n  team          user\nNo template is active in this repository.\n");

  await template(repo, ["use", "team"], { config });
  const after = await template(repo, ["list"], { config });
  assert.equal(after.stdout, "  conventional  built-in\n* team          user\nActive in this repository: team\n");
});

test("show prints a template, and user templates replace built-ins", async (t) => {
  const repo = makeRepo(t);
  const builtIn = await template(repo, ["show", "conventional"]);
  assert.equal(builtIn.code, 0);
  assert.ok(builtIn.stdout.startsWith("\n# <type>(<scope>): <summary>\n"), builtIn.stdout);
  assert.match(builtIn.stdout, /^# {3}feat {6}a new feature$/m);

  const config = writeTempConfig(t, JSON.stringify({ templates: { conventional: "Our own way" } }));
  assert.equal((await template(repo, ["show", "conventional"], { config })).stdout, "Our own way\n");
  assert.equal(
    (await template(repo, ["list"], { config })).stdout,
    "  conventional  user (replaces built-in)\nNo template is active in this repository.\n",
  );
});

test("use writes .git/toolsmith-template and sets commit.template for this repository only", async (t) => {
  const repo = makeRepo(t);
  const { stdout, stderr, code } = await template(repo, ["use", "conventional"]);
  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.equal(stdout, 'git commit now starts from the "conventional" template in this repository.\n');

  const path = localValue(repo, "commit.template");
  assert.ok(path.endsWith("/.git/toolsmith-template"), path);
  assert.equal(readFileSync(path, "utf8"), (await template(repo, ["show", "conventional"])).stdout);
  assert.equal(localValue(repo, "toolsmith.template"), "conventional");
  // The global git config (a file that doesn't exist in these tests) is untouched.
  assert.equal(existsSync(repo.env.GIT_CONFIG_GLOBAL), false);

  // git commit really starts from it: "cat" as the editor prints the message
  // git prepared, and git then gives up because the template wasn't changed.
  const commit = spawnSync("git", ["commit", "--allow-empty"], {
    cwd: repo.dir,
    env: { ...process.env, ...repo.env, GIT_EDITOR: "cat" },
    encoding: "utf8",
  });
  assert.match(commit.stdout, /^# <type>\(<scope>\): <summary>$/m);
  assert.notEqual(commit.status, 0);
});

test("use warns when it replaces a commit.template set some other way", async (t) => {
  const repo = makeRepo(t);
  repo.git("config", "--local", "commit.template", "other-template.txt");
  const { stderr, code } = await template(repo, ["use", "conventional"]);
  assert.equal(code, 0);
  assert.equal(stderr, "warning: replacing the commit.template that pointed to other-template.txt\n");
  assert.ok(localValue(repo, "commit.template").endsWith("/.git/toolsmith-template"));
});

test("unset removes the setting and the file", async (t) => {
  const repo = makeRepo(t);
  await template(repo, ["use", "conventional"]);
  const path = localValue(repo, "commit.template");

  const { stdout, code } = await template(repo, ["unset"]);
  assert.equal(code, 0);
  assert.equal(stdout, "Removed the commit template from this repository.\n");
  assert.equal(localValue(repo, "commit.template"), null);
  assert.equal(localValue(repo, "toolsmith.template"), null);
  assert.equal(existsSync(path), false);

  const again = await template(repo, ["unset"]);
  assert.equal(again.code, 0);
  assert.equal(again.stdout, "No commit template is set in this repository.\n");
});

test("unset leaves a commit.template that toolsmith didn't set", async (t) => {
  const repo = makeRepo(t);
  repo.git("config", "--local", "commit.template", "other-template.txt");
  const { stderr, code } = await template(repo, ["unset"]);
  assert.equal(code, 1);
  assert.equal(
    stderr,
    "error: commit.template points to other-template.txt, which toolsmith didn't set; " +
      "remove it with: git config --local --unset commit.template\n",
  );
  assert.equal(localValue(repo, "commit.template"), "other-template.txt");
});

test("an unknown template name is an error", async (t) => {
  const repo = makeRepo(t);
  for (const command of ["show", "use"]) {
    const { stderr, code } = await template(repo, [command, "nope"]);
    assert.equal(code, 1);
    assert.equal(stderr, 'error: there\'s no template named "nope"; see "toolsmith git template list"\n');
  }
  assert.equal(localValue(repo, "commit.template"), null);
});

test("use and unset need a git repository; list and show don't", async (t) => {
  const cwd = tempDir(t);
  for (const args of [["use", "conventional"], ["unset"]]) {
    const { stderr, code } = await runCli(["git", "template", ...args], { cwd });
    assert.equal(code, 1);
    assert.match(stderr, /^error: .+ isn't in a git repository\n$/);
  }
  const list = await runCli(["git", "template", "list"], { cwd });
  assert.equal(list.code, 0);
  assert.equal(list.stdout, "  conventional  built-in\n");
  assert.equal((await runCli(["git", "template", "show", "conventional"], { cwd })).code, 0);
});
