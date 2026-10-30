import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chooseValues } from "../src/commands/new.js";
import { createPrompt } from "../src/lib/prompt.js";
import { promptStreams, runCli, tempDir, terminalEnv } from "./helpers.js";

const templates = readdirSync(fileURLToPath(new URL("../templates/", import.meta.url)), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const templateQuestion = `Template (${templates.join(", ")}): `;
const defaults = { name: "my-folder", author: "Grace Hopper" };

// Runs chooseValues with `answers` typed in. Returns the values it chose and
// everything it asked.
async function choose(given, answers) {
  const io = promptStreams(answers);
  const prompt = createPrompt(io);
  try {
    return { chosen: await chooseValues(given, { defaults, prompt }), asked: io.written() };
  } finally {
    prompt.close();
  }
}

// A git config with user.name "Grace Hopper", for the author default.
function gitEnv(t) {
  const file = join(tempDir(t), "gitconfig");
  writeFileSync(file, "[user]\n\tname = Grace Hopper\n");
  return { GIT_CONFIG_GLOBAL: file, GIT_CONFIG_NOSYSTEM: "1" };
}

const packageJson = (folder) => JSON.parse(readFileSync(join(folder, "package.json"), "utf8"));

test("Enter takes the defaults shown in brackets", async () => {
  const { chosen, asked } = await choose({}, "node-cli\n\n\n");
  assert.deepEqual(chosen, { template: "node-cli", name: "my-folder", author: "Grace Hopper" });
  assert.equal(asked, `${templateQuestion}Project name [my-folder]: Author [Grace Hopper]: `);
});

test("typed answers are used", async () => {
  const { chosen } = await choose({}, "web-static\nsite\nAda Lovelace\n");
  assert.deepEqual(chosen, { template: "web-static", name: "site", author: "Ada Lovelace" });
});

test("values from the command line are never asked again", async () => {
  const { chosen, asked } = await choose({ template: "node-lib", author: "Ada Lovelace" }, "\n");
  assert.deepEqual(chosen, { template: "node-lib", name: "my-folder", author: "Ada Lovelace" });
  assert.equal(asked, "Project name [my-folder]: ");
});

test("a bad answer is explained and asked again", async () => {
  const { chosen, asked } = await choose({}, "nope\nnode-cli\na/b\nok-name\n\n");
  assert.deepEqual(chosen, { template: "node-cli", name: "ok-name", author: "Grace Hopper" });
  assert.equal(
    asked,
    templateQuestion +
      '  There\'s no template named "nope".\n' +
      templateQuestion +
      'Project name [my-folder]:   "a/b" can\'t be the project name, because it\'s used in file names.\n' +
      "Project name [my-folder]: Author [Grace Hopper]: ",
  );
});

test("bad values on the command line fail at once, without questions", async () => {
  const cases = [
    [{ template: "nope" }, 'there\'s no template named "nope"; see "toolsmith new --list"'],
    [{ template: "node-cli", name: "a/b" }, '"a/b" can\'t be the project name, because it\'s used in file names; choose one with --name'],
  ];
  for (const [given, message] of cases) {
    const io = promptStreams("node-cli\n\n\n");
    const prompt = createPrompt(io);
    await assert.rejects(chooseValues(given, { defaults, prompt }), { message });
    prompt.close();
    assert.equal(io.written(), "");
  }
});

test("without a prompt (--yes, or no terminal) the defaults are taken, but a template is needed", async () => {
  assert.deepEqual(await chooseValues({ template: "node-cli" }, { defaults, prompt: null }), {
    template: "node-cli",
    ...defaults,
  });
  await assert.rejects(chooseValues({}, { defaults, prompt: null }), {
    message: 'choose a template, like "toolsmith new node-cli my-project"; see "toolsmith new --list"',
  });
});

test("the end of the input cancels", async () => {
  const io = promptStreams("node-cli\n");
  const prompt = createPrompt(io);
  await assert.rejects(chooseValues({}, { defaults, prompt }), { message: "cancelled; nothing was created" });
  prompt.close();
  assert.equal(io.written(), `${templateQuestion}Project name [my-folder]: \n`);
});

test("toolsmith new never asks when its input isn't a terminal, even with answers piped in", async (t) => {
  const cwd = tempDir(t);
  const { stderr, code } = await runCli(["new", "node-cli", "project"], {
    cwd,
    env: gitEnv(t),
    input: "other-name\nSomeone Else\n",
  });
  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.equal(packageJson(join(cwd, "project")).name, "project");
  assert.equal(packageJson(join(cwd, "project")).author, "Grace Hopper");
});

test("toolsmith new asks for what's missing in a terminal", async (t) => {
  const cwd = tempDir(t);
  const { stdout, stderr, code } = await runCli(["new"], {
    cwd,
    env: { ...terminalEnv, ...gitEnv(t) },
    input: "node-lib\nmy-lib\n\n",
  });
  assert.equal(code, 0, stderr);
  assert.equal(stderr, `${templateQuestion}Project name [${basename(cwd)}]: Author [Grace Hopper]: `);
  assert.ok(stdout.endsWith('Created "my-lib" from the node-lib template in the current folder.\n'), stdout);
  assert.equal(packageJson(cwd).name, "my-lib");
  assert.equal(packageJson(cwd).author, "Grace Hopper");
});

test("--yes and -y ask nothing, even in a terminal", async (t) => {
  for (const flag of ["--yes", "-y"]) {
    const cwd = tempDir(t);
    const { stderr, code } = await runCli(["new", "node-cli", flag], {
      cwd,
      env: { ...terminalEnv, ...gitEnv(t) },
      input: "ignored\n",
    });
    assert.equal(code, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(packageJson(cwd).name, basename(cwd));
    assert.equal(packageJson(cwd).author, "Grace Hopper");
  }
});

test("ending the input in a terminal stops with a short message and writes nothing", async (t) => {
  const cwd = tempDir(t);
  const { stdout, stderr, code } = await runCli(["new", "node-cli"], {
    cwd,
    env: { ...terminalEnv, ...gitEnv(t) },
    input: "",
  });
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.equal(stderr, `Project name [${basename(cwd)}]: \nerror: cancelled; nothing was created\n`);
  assert.deepEqual(readdirSync(cwd), []);
});
