import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { readCommandLine } from "../src/cli.js";
import { makeTree, pluginPackage as plugin, runCli, writeTempConfig } from "./helpers.js";

// Plugin code that counts its imports in imported.txt, next to it, and adds
// `command`, which prints `text`.
const counted = (command, text) => `import { appendFileSync } from "node:fs";
appendFileSync(new URL("./imported.txt", import.meta.url), "imported\\n");
export function register(api) {
  api
    .command(${JSON.stringify(command)})
    .description("prints ${text}")
    .argument("<target>", "where to")
    .action((target) => api.output.success(${JSON.stringify(text)} + " to " + target));
}
`;

// How many times the plugin in node_modules/`name` under `cwd` was imported.
function imports(cwd, name) {
  const file = join(cwd, "node_modules", name, "imported.txt");
  return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).length : 0;
}

test("a plugin that lists its commands is imported only when one of them runs, or for help and the plugin list", async (t) => {
  const cwd = makeTree(t, {
    ...plugin("toolsmith-plugin-deploy", counted("deploy", "deployed"), { commands: ["deploy"] }),
    // Without a list, a plugin is imported every time, as always.
    ...plugin("toolsmith-plugin-plain", counted("plain", "plain")),
  });
  const run = (...args) => runCli(args, { cwd });

  assert.equal((await run("hello")).stdout, "Hello, world!\n");
  assert.equal((await run("--version")).code, 0);
  assert.equal(imports(cwd, "toolsmith-plugin-deploy"), 0);
  assert.equal(imports(cwd, "toolsmith-plugin-plain"), 2);

  const deploy = await run("deploy", "prod");
  assert.equal(deploy.stderr, "");
  assert.equal(deploy.stdout, "deployed to prod\n");
  assert.equal(imports(cwd, "toolsmith-plugin-deploy"), 1);

  // Help shows the real command, with its arguments and description.
  assert.match((await run("--help")).stdout, /^ {2}deploy <target> +prints deployed$/m);
  assert.match((await run("deploy", "--help")).stdout, /^Usage: toolsmith deploy \[options\] <target>$/m);
  assert.match((await run("help", "deploy")).stdout, /^Usage: toolsmith deploy \[options\] <target>$/m);
  assert.match((await run("plugins")).stdout, /^toolsmith-plugin-deploy {2}1\.0\.0 {2}project {2}loaded on demand, adds deploy$/m);
  assert.equal(imports(cwd, "toolsmith-plugin-deploy"), 5);

  // Its name is known without importing it, so a typo gets a suggestion.
  const typo = await run("deploi", "prod");
  assert.equal(typo.code, 1);
  assert.match(typo.stderr, /Did you mean deploy\?/);
  assert.equal(imports(cwd, "toolsmith-plugin-deploy"), 5);
});

test("clashes, turned-off plugins and version checks come out the same when plugins list their commands", async (t) => {
  // The same plugins as in plugins.test.js, once as they are and once with
  // their commands listed.
  const setup = (listed) => {
    const list = (commands) => (listed ? { commands } : {});
    return makeTree(t, {
      ...plugin(
        "toolsmith-plugin-a",
        `export function register(api) {
          api.command("hello").action(() => api.output.success("hello from a"));
          api.command("deploy").action(() => api.output.success("deployed by a"));
        }`,
        list(["hello", "deploy"]),
      ),
      ...plugin(
        "toolsmith-plugin-b",
        `export function register(api) {
          api.command("ship").alias("deploy").action(() => api.output.success("shipped by b"));
          api.command("wave").action(() => api.output.success("waved by b"));
        }`,
        list([{ name: "ship", aliases: ["deploy"] }, "wave"]),
      ),
      ...plugin("toolsmith-plugin-off", 'throw new Error("loaded");', list(["off"])),
      ...plugin("toolsmith-plugin-old", 'throw new Error("loaded");', { toolsmith: ">=99.0.0", ...list(["old"]) }),
    });
  };
  const env = { TOOLSMITH_CONFIG: writeTempConfig(t, '{"plugins": {"toolsmith-plugin-off": false}}') };
  const outcome = async (cwd, args) => {
    const { stdout, stderr, code } = await runCli(args, { cwd, env });
    // The plugin list says how plugins are loaded; the rest is the same.
    return { stdout: stdout.replaceAll("loaded on demand,", "loaded,"), stderr, code };
  };

  const plain = setup(false);
  const listed = setup(true);
  const commandLines = [["hello"], ["deploy"], ["wave"], ["ship"], ["off"], ["old"], ["plugins"], ["plugins", "--json"]];
  for (const args of commandLines) {
    const expected = await outcome(plain, args);
    const actual = await outcome(listed, args);
    if (args.includes("--json")) {
      const withoutOnDemand = (output) =>
        JSON.parse(output.stdout).plugins.map(({ name, status, reason, commands, skippedCommands }) => ({
          name,
          status,
          reason,
          commands,
          skippedCommands,
        }));
      assert.deepEqual(withoutOnDemand(actual), withoutOnDemand(expected));
    } else {
      assert.deepEqual(actual, expected, `toolsmith ${args.join(" ")}`);
    }
  }
});

test("commands that don't match the list in package.json are skipped with a warning", async (t) => {
  const cwd = makeTree(t, {
    ...plugin(
      "toolsmith-plugin-mixed",
      `export function register(api) {
        api.command("listed").action(() => api.output.success("listed works"));
        api.command("unlisted").action(() => api.output.success("unlisted"));
        api.command("other-alias").alias("x").action(() => api.output.success("other"));
      }`,
      { commands: ["listed", "missing", { name: "other-alias", aliases: ["y"] }] },
    ),
    ...plugin("toolsmith-plugin-bad-list", 'throw new Error("loaded");', { commands: "deploy" }),
  });
  const { stdout, stderr, code } = await runCli(["listed"], { cwd });
  assert.equal(code, 0);
  assert.equal(stdout, "listed works\n");
  assert.equal(
    stderr,
    "warning: plugin toolsmith-plugin-bad-list failed to load, so it was skipped " +
      '("commands" under "toolsmith" in its package.json must list command names)\n' +
      'warning: plugin toolsmith-plugin-mixed\'s command "unlisted" was skipped: its package.json doesn\'t list it under "toolsmith"\n' +
      'warning: plugin toolsmith-plugin-mixed\'s command "other-alias" was skipped: its aliases aren\'t the ones its package.json lists\n' +
      'warning: plugin toolsmith-plugin-mixed\'s command "missing" was skipped: the plugin lists it in its package.json, but doesn\'t add it\n',
  );
});

test("the command line is read the way Commander reads it", () => {
  const cases = [
    [[], { help: true }],
    [["hello", "Ada"], { command: "hello" }],
    [["--debug", "--no-color", "deploy", "--help"], { command: "deploy" }],
    [["--help", "deploy"], { help: true }],
    [["-h"], { help: true }],
    [["--version", "deploy"], { version: true }],
    [["-V"], { version: true }],
    [["--", "deploy"], { command: "deploy" }],
    [["--"], { help: true }],
    [["-", "deploy"], { command: "-" }],
  ];
  for (const [args, expected] of cases) {
    assert.deepEqual(readCommandLine(args), expected, args.join(" "));
  }
});
