import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Command } from "commander";
import { register } from "../index.js";

// What toolsmith passes to register(), for tests: the commands go on a
// Commander program of their own, and messages are collected, not printed.
// run(...args) runs a command line like `toolsmith ...args`.
function withPlugin(settings = {}) {
  const program = new Command().exitOverride();
  const messages = [];
  const say = (kind) => (message) => messages.push(`${kind}: ${message}`);
  register({
    version: "0.1.0",
    command: (nameAndArgs) => program.command(nameAndArgs),
    config: {
      path: "/home/you/.toolsmithrc",
      found: false,
      settings: { protectedBranches: ["main", "master", "develop"], ...settings },
    },
    output: { success: say("success"), info: say("info"), warn: say("warning"), error: say("error") },
  });
  return { program, messages, run: (...args) => program.parseAsync(args, { from: "user" }) };
}

// A temp folder, deleted after test `t`, that is the current folder meanwhile.
function inTempFolder(t) {
  const folder = mkdtempSync(join(tmpdir(), "plugin-test-"));
  const previous = process.cwd();
  process.chdir(folder);
  t.after(() => {
    process.chdir(previous);
    rmSync(folder, { recursive: true, force: true });
  });
  return folder;
}

// Runs git in `cwd` with a user, and without the global or system git config.
function git(cwd, ...args) {
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
    cwd,
    env: { ...process.env, GIT_CONFIG_GLOBAL: join(cwd, "no-global-config"), GIT_CONFIG_NOSYSTEM: "1" },
    stdio: "ignore",
  });
}

test("package.json lists exactly the commands that register() adds", () => {
  const { program } = withPlugin();
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(
    program.commands.map((command) => command.name()),
    packageJson.toolsmith.commands,
  );
});

test("todos prints each comment, and a summary", async (t) => {
  const folder = inTempFolder(t);
  writeFileSync(join(folder, "app.js"), "// TODO: handle errors\n// FIXME: too slow\n// TODO: tests\n");
  const log = t.mock.method(console, "log", () => {});
  const { messages, run } = withPlugin();

  await run("todos");
  assert.deepEqual(
    log.mock.calls.map((call) => call.arguments[0]),
    ["app.js:1  TODO  handle errors", "app.js:2  FIXME  too slow", "app.js:3  TODO  tests"],
  );
  assert.deepEqual(messages, ["info: 3 comments: 2 TODO, 1 FIXME."]);

  log.mock.resetCalls();
  await run("todos", "--json");
  assert.equal(JSON.parse(log.mock.calls[0].arguments[0]).todos.length, 3);
});

test("guard fails on a protected branch, and lets others pass", async (t) => {
  const folder = inTempFolder(t);
  git(folder, "init", "--quiet", "--initial-branch=main");

  await assert.rejects(withPlugin().run("guard"), {
    message: 'main is a protected branch (see "protectedBranches" in /home/you/.toolsmithrc); commit on another branch',
  });

  const unprotected = withPlugin({ protectedBranches: ["release"] });
  await unprotected.run("guard");
  assert.deepEqual(unprotected.messages, ["success: main isn't a protected branch."]);
});

test("guard has nothing to do on a detached HEAD", async (t) => {
  const folder = inTempFolder(t);
  git(folder, "init", "--quiet", "--initial-branch=main");
  git(folder, "commit", "--quiet", "--allow-empty", "-m", "first");
  git(folder, "checkout", "--quiet", "--detach");

  const { messages, run } = withPlugin();
  await run("guard");
  assert.deepEqual(messages, ["info: Not on a branch (HEAD is detached), so there's nothing to guard."]);
});
