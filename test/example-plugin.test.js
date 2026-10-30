import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { makeRepo, makeTree, runCli, writeTempConfig } from "./helpers.js";

const example = fileURLToPath(new URL("../examples/toolsmith-plugin-example", import.meta.url));
const { version } = JSON.parse(readFileSync(join(example, "package.json"), "utf8"));

// Links the example plugin into `project`'s node_modules, as
// `npm install ../toolsmith-plugin-example` does. On Windows it's a junction,
// which, unlike a symbolic link, needs no special rights.
function installExample(project) {
  mkdirSync(join(project, "node_modules"), { recursive: true });
  symlinkSync(example, join(project, "node_modules", "toolsmith-plugin-example"), "junction");
}

test("the example plugin's todos command runs through toolsmith", async (t) => {
  const project = makeTree(t, {
    "src/app.js": "// TODO: handle a missing config file\nexport {};\n// FIXME: the timeout is too short\n",
    "README.md": "# Project\n\nHACK: works for now\n",
  });
  installExample(project);

  const { stdout, stderr, code } = await runCli(["todos"], { cwd: project });
  assert.equal(code, 0, stderr);
  assert.equal(stderr, "");
  assert.equal(
    stdout,
    "README.md:3  HACK  works for now\n" +
      "src/app.js:1  TODO  handle a missing config file\n" +
      "src/app.js:3  FIXME  the timeout is too short\n" +
      "3 comments: 1 HACK, 1 TODO, 1 FIXME.\n",
  );

  const json = await runCli(["todos", "src", "--json"], { cwd: project });
  assert.deepEqual(JSON.parse(json.stdout).todos, [
    { path: "src/app.js", line: 1, tag: "TODO", text: "handle a missing config file" },
    { path: "src/app.js", line: 3, tag: "FIXME", text: "the timeout is too short" },
  ]);

  const plugins = await runCli(["plugins"], { cwd: project });
  assert.equal(
    plugins.stdout,
    `toolsmith-plugin-example  ${version}  project  loaded on demand, adds todos, guard\n1 plugin: 1 loaded.\n`,
  );
});

test("the example plugin's guard command reads protectedBranches from the config file", async (t) => {
  const repo = makeRepo(t);
  installExample(repo.dir);
  const path = writeTempConfig(t, '{"protectedBranches": ["main", "release"]}');
  const env = { ...repo.env, TOOLSMITH_CONFIG: path };

  const onMain = await runCli(["guard"], { cwd: repo.dir, env });
  assert.equal(onMain.code, 1);
  assert.equal(
    onMain.stderr,
    `error: main is a protected branch (see "protectedBranches" in ${path}); commit on another branch\n`,
  );

  repo.git("switch", "--quiet", "--create", "feature");
  const onFeature = await runCli(["guard"], { cwd: repo.dir, env });
  assert.equal(onFeature.code, 0, onFeature.stderr);
  assert.equal(onFeature.stdout, "feature isn't a protected branch.\n");
});

test("the example plugin's own tests pass", () => {
  // The test runner tells test files about itself through NODE_TEST_CONTEXT; a
  // "node --test" started from here would think it belongs to this run.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ["--test"], { cwd: example, env, encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});
