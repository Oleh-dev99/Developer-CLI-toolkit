import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chooseValues } from "../src/commands/new.js";
import { createPrompt } from "../src/lib/prompt.js";
import { gitEnv, makeTree, promptStreams, runCli, tempDir, terminalEnv } from "./helpers.js";

const templates = readdirSync(fileURLToPath(new URL("../templates/", import.meta.url)), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const templateQuestion = `Template (${templates.join(", ")}, a folder or a git URL): `;
const installQuestion = "Run npm install? [Y/n] ";
const defaults = { name: "my-folder", author: "Grace Hopper" };

// chooseValues' result, with the template closed and given by its name.
async function byName(chosen) {
  await chosen.template.close();
  return { ...chosen, template: chosen.template.name };
}

// Runs chooseValues with `answers` typed in. Returns the values it chose and
// everything it asked.
async function choose(given, answers) {
  const io = promptStreams(answers);
  const prompt = createPrompt(io);
  try {
    return { chosen: await byName(await chooseValues(given, { defaults, prompt })), asked: io.written() };
  } finally {
    prompt.close();
  }
}

const packageJson = (folder) => JSON.parse(readFileSync(join(folder, "package.json"), "utf8"));

// Whether the fake npm (see helpers.js) ran in `folder`.
const npmRanIn = (folder) => existsSync(join(folder, "fake-npm.txt"));

test("Enter takes the defaults shown in brackets", async () => {
  const { chosen, asked } = await choose({}, "node-cli\n\n\n\n");
  assert.deepEqual(chosen, { template: "node-cli", name: "my-folder", author: "Grace Hopper", install: true });
  assert.equal(asked, `${templateQuestion}Project name [my-folder]: Author [Grace Hopper]: ${installQuestion}`);
});

test("typed answers are used", async () => {
  const { chosen } = await choose({}, "node-lib\nmy-lib\nAda Lovelace\nn\n");
  assert.deepEqual(chosen, { template: "node-lib", name: "my-lib", author: "Ada Lovelace", install: false });
});

test("npm install is only asked about for templates with a package.json", async () => {
  const { chosen, asked } = await choose({}, "web-static\nsite\n\n");
  assert.deepEqual(chosen, { template: "web-static", name: "site", author: "Grace Hopper", install: false });
  assert.equal(asked, `${templateQuestion}Project name [my-folder]: Author [Grace Hopper]: `);
});

test("values from the command line are never asked again", async () => {
  // install: false is what --no-install gives.
  const given = { template: "node-lib", author: "Ada Lovelace", install: false };
  const { chosen, asked } = await choose(given, "\n");
  assert.deepEqual(chosen, { template: "node-lib", name: "my-folder", author: "Ada Lovelace", install: false });
  assert.equal(asked, "Project name [my-folder]: ");
});

test("a bad answer is explained and asked again", async () => {
  const { chosen, asked } = await choose({}, "nope\nnode-cli\na/b\nok-name\n\nmaybe\ny\n");
  assert.deepEqual(chosen, { template: "node-cli", name: "ok-name", author: "Grace Hopper", install: true });
  assert.equal(
    asked,
    templateQuestion +
      '  There\'s no template or folder named "nope".\n' +
      templateQuestion +
      'Project name [my-folder]:   "a/b" can\'t be the project name, because it\'s used in file names.\n' +
      "Project name [my-folder]: Author [Grace Hopper]: " +
      `${installQuestion}  Please answer y or n.\n` +
      installQuestion,
  );
});

test("a folder works as an answer to the template question too", async (t) => {
  const folder = makeTree(t, { "README.md": "# {{name}}\n" });
  const missing = join(folder, "missing");
  const { chosen, asked } = await choose({}, `${missing}\n${folder}\n\n\n`);
  // This template has no package.json, so there's no npm install question.
  assert.deepEqual(chosen, { template: folder, name: "my-folder", author: "Grace Hopper", install: false });
  assert.equal(
    asked,
    `${templateQuestion}  The template folder ${missing} doesn't exist.\n` +
      `${templateQuestion}Project name [my-folder]: Author [Grace Hopper]: `,
  );
});

test("bad values on the command line fail at once, without questions", async () => {
  const cases = [
    [{ template: "nope" }, 'there\'s no template or folder named "nope"; see "toolsmith new --list"'],
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
  const withoutPrompt = async (given) => byName(await chooseValues(given, { defaults, prompt: null }));
  assert.deepEqual(await withoutPrompt({ template: "node-cli" }), { template: "node-cli", ...defaults, install: true });
  assert.equal((await withoutPrompt({ template: "node-cli", install: false })).install, false);
  assert.equal((await withoutPrompt({ template: "web-static" })).install, false);
  await assert.rejects(withoutPrompt({}), {
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

// The CLI tests below skip git init (--no-git), which isn't about questions.

test("toolsmith new never asks when its input isn't a terminal, even with answers piped in", async (t) => {
  const cwd = tempDir(t);
  const { stderr, code } = await runCli(["new", "node-cli", "project", "--no-git"], {
    cwd,
    env: gitEnv(t),
    input: "other-name\nSomeone Else\nn\n",
  });
  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.equal(packageJson(join(cwd, "project")).name, "project");
  assert.equal(packageJson(join(cwd, "project")).author, "Grace Hopper");
  assert.ok(npmRanIn(join(cwd, "project")), "npm install didn't run");
});

test("toolsmith new asks for what's missing in a terminal", async (t) => {
  const cwd = tempDir(t);
  const { stdout, stderr, code } = await runCli(["new", "--no-git"], {
    cwd,
    env: { ...terminalEnv, ...gitEnv(t) },
    input: "node-lib\nmy-lib\n\nn\n",
  });
  assert.equal(code, 0, stderr);
  assert.equal(stderr, `${templateQuestion}Project name [${basename(cwd)}]: Author [Grace Hopper]: ${installQuestion}`);
  assert.ok(stdout.endsWith('Created "my-lib" from the node-lib template in the current folder.\n'), stdout);
  assert.equal(packageJson(cwd).name, "my-lib");
  assert.equal(packageJson(cwd).author, "Grace Hopper");
  assert.ok(!npmRanIn(cwd), "npm install ran, though the answer was no");
});

test("--yes and -y ask nothing, even in a terminal", async (t) => {
  for (const flag of ["--yes", "-y"]) {
    const cwd = tempDir(t);
    const { stderr, code } = await runCli(["new", "node-cli", flag, "--no-git"], {
      cwd,
      env: { ...terminalEnv, ...gitEnv(t) },
      input: "ignored\n",
    });
    assert.equal(code, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(packageJson(cwd).name, basename(cwd));
    assert.equal(packageJson(cwd).author, "Grace Hopper");
    assert.ok(npmRanIn(cwd), "npm install didn't run");
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
