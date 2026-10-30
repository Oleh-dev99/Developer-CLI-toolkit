import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { test } from "node:test";
import { makeTree, pluginPackage as plugin, pluginSays as says, runCli, tempDir, writeTempConfig } from "./helpers.js";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// A project and a global folder (under npm's prefix) with a plugin for every
// status, and a config file that turns one off. Returns { cwd, env, globalFolder }.
function pluginsOfEveryKind(t) {
  // npm installs global packages in <prefix>/lib/node_modules, or in
  // <prefix>\node_modules on Windows.
  const globalFolder = process.platform === "win32" ? "node_modules" : "lib/node_modules";
  const prefix = makeTree(t, {
    ...plugin("toolsmith-plugin-wave", says("wave", "waved"), { folder: globalFolder, version: "3.0.0" }),
    // Also in the project, whose copy is used.
    ...plugin("toolsmith-plugin-deploy", says("deploy", "global deploy"), { folder: globalFolder, version: "0.9.0" }),
  });
  const cwd = makeTree(t, {
    ...plugin("toolsmith-plugin-broken", 'throw new Error("crashed");', { version: "0.1.0" }),
    ...plugin(
      "toolsmith-plugin-deploy",
      `export function register(api) {
        api.command("deploy").action(() => api.output.success("deployed"));
        api.command("hello");
      }`,
      { version: "1.2.0", toolsmith: `^${version}` },
    ),
    ...plugin("toolsmith-plugin-old", "", { version: "0.3.0", toolsmith: ">=99" }),
    ...plugin("toolsmith-plugin-quiet", says("quiet", "quiet"), { version: "2.0.0" }),
  });
  const config = writeTempConfig(t, '{"plugins": {"toolsmith-plugin-quiet": false}}');
  return { cwd, env: { npm_config_prefix: prefix, TOOLSMITH_CONFIG: config }, globalFolder };
}

test("toolsmith plugins lists every plugin found, with its version, where it's from and its status", async (t) => {
  const { cwd, env } = pluginsOfEveryKind(t);
  const { stdout, stderr, code } = await runCli(["plugins"], { cwd, env });
  assert.equal(code, 0);
  // The list says it all, so there are no warnings here.
  assert.equal(stderr, "");
  assert.equal(
    stdout,
    "toolsmith-plugin-broken  0.1.0  project  skipped: it failed to load (crashed)\n" +
      "toolsmith-plugin-deploy  1.2.0  project  loaded, adds deploy\n" +
      '  its command "hello" was skipped: toolsmith has a built-in command "hello"\n' +
      `toolsmith-plugin-old     0.3.0  project  incompatible: it needs toolsmith >=99, and this is toolsmith ${version}\n` +
      "toolsmith-plugin-quiet   2.0.0  project  turned off\n" +
      "toolsmith-plugin-deploy  0.9.0  global   skipped: the copy in node_modules/toolsmith-plugin-deploy is used instead\n" +
      "toolsmith-plugin-wave    3.0.0  global   loaded, adds wave\n" +
      "6 plugins: 2 loaded, 1 turned off, 1 incompatible, 2 skipped.\n",
  );

  // Other commands still warn about the plugins with problems.
  const deploy = await runCli(["deploy"], { cwd, env });
  assert.equal(deploy.stdout, "deployed\n");
  assert.equal(deploy.stderr.trimEnd().split("\n").length, 3, deploy.stderr);
});

test("toolsmith plugins --json gives the same for scripts", async (t) => {
  const { cwd, env, globalFolder } = pluginsOfEveryKind(t);
  const { stdout, stderr, code } = await runCli(["plugins", "--json"], { cwd, env });
  assert.equal(code, 0);
  assert.equal(stderr, "");
  const result = JSON.parse(stdout);
  assert.equal(result.toolsmith, version);

  // Paths are absolute, and the start depends on the OS's temp folder.
  for (const plugin of result.plugins) {
    assert.ok(isAbsolute(plugin.path), plugin.path);
    const folder = plugin.source === "global" ? globalFolder : "node_modules";
    assert.ok(plugin.path.endsWith(join(folder, plugin.name)), plugin.path);
    delete plugin.path;
  }
  // Each entry, with what a plugin that added nothing has unless given.
  const entry = (name, fields) => ({
    name,
    reason: null,
    toolsmithRange: null,
    commands: [],
    skippedCommands: [],
    ...fields,
  });
  assert.deepEqual(result.plugins, [
    entry("toolsmith-plugin-broken", {
      version: "0.1.0",
      source: "project",
      status: "skipped",
      reason: "it failed to load (crashed)",
    }),
    entry("toolsmith-plugin-deploy", {
      version: "1.2.0",
      source: "project",
      status: "loaded",
      toolsmithRange: `^${version}`,
      commands: ["deploy"],
      skippedCommands: [{ name: "hello", reason: 'toolsmith has a built-in command "hello"' }],
    }),
    entry("toolsmith-plugin-old", {
      version: "0.3.0",
      source: "project",
      status: "incompatible",
      reason: `it needs toolsmith >=99, and this is toolsmith ${version}`,
      toolsmithRange: ">=99",
    }),
    entry("toolsmith-plugin-quiet", { version: "2.0.0", source: "project", status: "off" }),
    entry("toolsmith-plugin-deploy", {
      version: "0.9.0",
      source: "global",
      status: "skipped",
      reason: "the copy in node_modules/toolsmith-plugin-deploy is used instead",
    }),
    entry("toolsmith-plugin-wave", { version: "3.0.0", source: "global", status: "loaded", commands: ["wave"] }),
  ]);
});

test("with no plugins, toolsmith plugins says so", async (t) => {
  const json = await runCli(["plugins", "--json"], { cwd: tempDir(t) });
  assert.deepEqual(JSON.parse(json.stdout), { toolsmith: version, plugins: [] });
  const text = await runCli(["plugins"], { cwd: tempDir(t) });
  assert.equal(
    text.stdout,
    'No plugins found. Plugins are npm packages named toolsmith-plugin-*; see "toolsmith plugins --help".\n',
  );
});

test("plugins disable and enable change only the plugins setting in the config file", async (t) => {
  const cwd = makeTree(t, plugin("toolsmith-plugin-deploy", says("deploy", "deployed")));
  // Its own layout: CRLF line endings, and a list on one line.
  const original = '{\r\n  "greeting": "Hi",\r\n  "protectedBranches": ["main", "release"]\r\n}\r\n';
  const path = writeTempConfig(t, original);
  const env = { TOOLSMITH_CONFIG: path };
  const withPlugin = (on) =>
    '{\r\n  "greeting": "Hi",\r\n  "protectedBranches": ["main", "release"],\r\n' +
    `  "plugins": {\r\n    "toolsmith-plugin-deploy": ${on}\r\n  }\r\n}\r\n`;

  const disable = await runCli(["plugins", "disable", "toolsmith-plugin-deploy"], { cwd, env });
  assert.equal(disable.stdout, `Turned off toolsmith-plugin-deploy (in ${path}).\n`);
  assert.equal(readFileSync(path, "utf8"), withPlugin(false));
  assert.match((await runCli(["deploy"], { cwd, env })).stderr, /^error: unknown command 'deploy'$/m);
  assert.match((await runCli(["plugins"], { cwd, env })).stdout, /^toolsmith-plugin-deploy {2}1\.0\.0 {2}project {2}turned off$/m);

  const again = await runCli(["plugins", "disable", "toolsmith-plugin-deploy"], { cwd, env });
  assert.equal(again.stdout, "toolsmith-plugin-deploy is already turned off.\n");

  const enable = await runCli(["plugins", "enable", "toolsmith-plugin-deploy"], { cwd, env });
  assert.equal(enable.stdout, `Turned on toolsmith-plugin-deploy (in ${path}).\n`);
  assert.equal(readFileSync(path, "utf8"), withPlugin(true));
  assert.equal((await runCli(["deploy"], { cwd, env })).stdout, "deployed\n");

  const unknown = await runCli(["plugins", "disable", "toolsmith-plugin-nope"], { cwd, env });
  assert.equal(unknown.code, 1);
  assert.equal(unknown.stderr, 'error: there\'s no plugin named "toolsmith-plugin-nope"; see "toolsmith plugins"\n');
  assert.equal(readFileSync(path, "utf8"), withPlugin(true));
});

test("plugins disable creates the config file if there's none, and keeps a UTF-16 one in UTF-16", async (t) => {
  const cwd = makeTree(t, plugin("toolsmith-plugin-deploy", says("deploy", "deployed")));
  const args = ["plugins", "disable", "toolsmith-plugin-deploy"];

  const missing = join(tempDir(t), "toolsmithrc.json");
  assert.equal((await runCli(args, { cwd, env: { TOOLSMITH_CONFIG: missing } })).code, 0);
  assert.equal(readFileSync(missing, "utf8"), '{\n  "plugins": {\n    "toolsmith-plugin-deploy": false\n  }\n}\n');

  // As Windows PowerShell 5.1 writes it: a byte order mark, then UTF-16.
  const utf16 = join(tempDir(t), "toolsmithrc.json");
  writeFileSync(utf16, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('{ "greeting": "Hi" }', "utf16le")]));
  assert.equal((await runCli(args, { cwd, env: { TOOLSMITH_CONFIG: utf16 } })).code, 0);
  const bytes = readFileSync(utf16);
  assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xfe]);
  assert.equal(bytes.toString("utf16le", 2), '{ "greeting": "Hi", "plugins": { "toolsmith-plugin-deploy": false } }');
});
