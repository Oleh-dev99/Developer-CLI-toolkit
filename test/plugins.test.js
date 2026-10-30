import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { makeTree, runCli, writeTempConfig } from "./helpers.js";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// Files for makeTree: a plugin package `name` in `folder`, with `code` as its
// index.js and a package.json (an ES module package, unless given).
function plugin(name, code, { folder = "node_modules", packageJson } = {}) {
  return {
    [`${folder}/${name}/package.json`]: packageJson ?? JSON.stringify({ name, version: "1.0.0", type: "module" }),
    [`${folder}/${name}/index.js`]: code,
  };
}

// Plugin code that adds `command`, which prints `text`.
const says = (command, text) => `export function register(api) {
  api.command(${JSON.stringify(command)}).description("prints ${text}").action(() => api.output.success(${JSON.stringify(text)}));
}
`;

const greet = `export function register(api) {
  api
    .command("greet")
    .description("greet someone, from a plugin")
    .argument("[name]", "who to greet", "world")
    .action((name) => api.output.success(\`\${api.config.settings.greeting} from toolsmith \${api.version}, \${name}!\`));
}
`;

test("a plugin in the project's node_modules adds a command that uses toolsmith's config and output", async (t) => {
  const project = makeTree(t, { ...plugin("toolsmith-plugin-greet", greet), "src/deep/": "" });
  const env = { TOOLSMITH_CONFIG: writeTempConfig(t, '{"greeting": "Hi"}') };

  const run = await runCli(["greet", "Ada"], { cwd: project, env });
  assert.equal(run.stderr, "");
  assert.equal(run.stdout, `Hi from toolsmith ${version}, Ada!\n`);

  // From a folder deeper in the project too, as Node.js finds packages.
  const deep = await runCli(["greet"], { cwd: join(project, "src", "deep"), env });
  assert.equal(deep.stdout, `Hi from toolsmith ${version}, world!\n`);

  const help = await runCli(["--help"], { cwd: project });
  assert.match(help.stdout, /^ {2}greet \[name\] +greet someone, from a plugin$/m);
});

test("scoped plugins are found too, and other packages are left alone", async (t) => {
  const cwd = makeTree(t, {
    ...plugin("@acme/toolsmith-plugin-deploy", says("deploy", "deployed")),
    // Not plugins: if toolsmith loaded them, their broken package.json would
    // get a warning.
    "node_modules/toolsmith-plugin/package.json": "{",
    "node_modules/toolsmith-helper/package.json": "{",
    "node_modules/@acme/helper/package.json": "{",
  });
  const { stdout, stderr, code } = await runCli(["deploy"], { cwd });
  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.equal(stdout, "deployed\n");
});

test("global plugins are found under npm's prefix, and a project's own copy wins", async (t) => {
  // npm installs global packages in <prefix>/lib/node_modules, or in
  // <prefix>\node_modules on Windows.
  const folder = process.platform === "win32" ? "node_modules" : "lib/node_modules";
  const prefix = makeTree(t, {
    ...plugin("toolsmith-plugin-greet", says("greet", "global greet"), { folder }),
    ...plugin("toolsmith-plugin-wave", says("wave", "global wave"), { folder }),
  });
  const cwd = makeTree(t, plugin("toolsmith-plugin-greet", says("greet", "project greet")));
  const env = { npm_config_prefix: prefix };

  assert.equal((await runCli(["greet"], { cwd, env })).stdout, "project greet\n");
  assert.equal((await runCli(["wave"], { cwd, env })).stdout, "global wave\n");
});

test("a plugin that's turned off in ~/.toolsmithrc isn't even loaded", async (t) => {
  const cwd = makeTree(t, {
    // If this plugin were loaded, it would get a warning.
    ...plugin("toolsmith-plugin-off", 'throw new Error("this plugin was loaded");'),
    ...plugin("toolsmith-plugin-on", says("on", "turned on")),
  });
  const config = '{"plugins": {"toolsmith-plugin-off": false, "toolsmith-plugin-on": true}}';
  const env = { TOOLSMITH_CONFIG: writeTempConfig(t, config) };

  const on = await runCli(["on"], { cwd, env });
  assert.equal(on.stderr, "");
  assert.equal(on.stdout, "turned on\n");
});

test("a plugin that fails to load gets a warning, and everything else still works", async (t) => {
  const cwd = makeTree(t, {
    ...plugin("toolsmith-plugin-bad-json", "", { packageJson: "{" }),
    ...plugin("toolsmith-plugin-crashes", 'throw new Error("crashed while loading");'),
    // It adds a command before failing; that command isn't used.
    ...plugin("toolsmith-plugin-half", 'export function register(api) { api.command("half"); throw new Error("half done"); }'),
    ...plugin("toolsmith-plugin-no-register", "export const nothing = true;"),
    ...plugin("toolsmith-plugin-syntax", "export function register( {"),
    ...plugin("toolsmith-plugin-works", says("works", "still works")),
  });
  const warnings = [
    /^warning: plugin toolsmith-plugin-bad-json failed to load, so it was skipped \(can't read its package\.json: .+\)$/,
    /^warning: plugin toolsmith-plugin-crashes failed to load, so it was skipped \(crashed while loading\)$/,
    /^warning: plugin toolsmith-plugin-half failed to load, so it was skipped \(half done\)$/,
    /^warning: plugin toolsmith-plugin-no-register failed to load, so it was skipped \(it doesn't export a register function\)$/,
    /^warning: plugin toolsmith-plugin-syntax failed to load, so it was skipped \(.+\)$/,
  ];

  for (const [args, output] of [
    [["works"], "still works\n"],
    [["hello"], "Hello, world!\n"],
  ]) {
    const { stdout, stderr, code } = await runCli(args, { cwd });
    assert.equal(code, 0, stderr);
    assert.equal(stdout, output);
    const lines = stderr.trimEnd().split("\n");
    assert.equal(lines.length, warnings.length, stderr);
    lines.forEach((line, index) => assert.match(line, warnings[index]));
  }

  const half = await runCli(["half"], { cwd });
  assert.equal(half.code, 1);
  assert.match(half.stderr, /^error: unknown command 'half'$/m);
});

test("built-in commands win name clashes, and between plugins the first one found wins", async (t) => {
  const cwd = makeTree(t, {
    ...plugin(
      "toolsmith-plugin-a",
      `export function register(api) {
        api.command("hello").action(() => api.output.success("hello from a"));
        api.command("deploy").action(() => api.output.success("deployed by a"));
      }`,
    ),
    ...plugin(
      "toolsmith-plugin-b",
      `export function register(api) {
        api.command("ship").alias("deploy").action(() => api.output.success("shipped by b"));
        api.command("wave").action(() => api.output.success("waved by b"));
      }`,
    ),
  });
  const warnings =
    'warning: plugin toolsmith-plugin-a\'s command "hello" was skipped: toolsmith has a built-in command "hello"\n' +
    'warning: plugin toolsmith-plugin-b\'s command "ship" was skipped: the plugin toolsmith-plugin-a already adds "deploy"\n';

  for (const [command, output] of [
    ["hello", "Hello, world!\n"],
    ["deploy", "deployed by a\n"],
    ["wave", "waved by b\n"],
  ]) {
    const { stdout, stderr } = await runCli([command], { cwd });
    assert.equal(stdout, output);
    assert.equal(stderr, warnings);
  }
});

test("CommonJS plugins work, and so do entry points set by exports", async (t) => {
  const cwd = makeTree(t, {
    ...plugin(
      "toolsmith-plugin-cjs",
      'module.exports = { register(api) { api.command("cjs").action(() => api.output.success("from CommonJS")); } };',
      { packageJson: JSON.stringify({ name: "toolsmith-plugin-cjs", version: "1.0.0" }) },
    ),
    "node_modules/toolsmith-plugin-esm/package.json": JSON.stringify({
      name: "toolsmith-plugin-esm",
      type: "module",
      exports: { ".": { import: "./lib/plugin.js", require: "./lib/missing.cjs" } },
    }),
    "node_modules/toolsmith-plugin-esm/lib/plugin.js": says("esm", "from exports"),
  });
  const cjs = await runCli(["cjs"], { cwd });
  assert.equal(cjs.stderr, "");
  assert.equal(cjs.stdout, "from CommonJS\n");
  assert.equal((await runCli(["esm"], { cwd })).stdout, "from exports\n");
});

test("plugins aren't loaded when the config file can't be read", async (t) => {
  const cwd = makeTree(t, plugin("toolsmith-plugin-works", says("works", "works")));
  const env = { TOOLSMITH_CONFIG: writeTempConfig(t, "{") };
  const { stdout, stderr, code } = await runCli(["--help"], { cwd, env });
  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.doesNotMatch(stdout, /works/);
});
