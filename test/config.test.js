import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runCli, tempDir, writeTempConfig } from "./helpers.js";

test("runCli never reads the real ~/.toolsmithrc", async () => {
  const { stdout } = await runCli(["config"]);
  assert.ok(stdout.startsWith(`Config file: none, using defaults (no file at ${tmpdir()}`), stdout);
});

test("a missing config file means defaults, silently", async (t) => {
  const path = join(tempDir(t), "missing.json");
  const { stdout, stderr, code } = await runCli(["config"], { env: { TOOLSMITH_CONFIG: path } });
  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.equal(
    stdout,
    `Config file: none, using defaults (no file at ${path})\nSettings:\n  color: true\n  greeting: "Hello"\n` +
      `  protectedBranches: ["main","master","develop"]\n  templates: {}\n`,
  );
});

test("a valid config file is used", async (t) => {
  const path = writeTempConfig(t, '{"greeting": "Hi"}');
  const env = { TOOLSMITH_CONFIG: path };

  const config = await runCli(["config"], { env });
  assert.equal(config.code, 0);
  assert.equal(config.stderr, "");
  assert.equal(
    config.stdout,
    `Config file: ${path}\nSettings:\n  color: true\n  greeting: "Hi"\n  protectedBranches: ["main","master","develop"]\n` +
      "  templates: {}\n",
  );

  const hello = await runCli(["hello", "Ada"], { env });
  assert.equal(hello.stdout, "Hi, Ada!\n");
});

test("invalid JSON is an error that names the file", async (t) => {
  const path = writeTempConfig(t, '{"greeting": "Hi"');
  const { stdout, stderr, code } = await runCli(["hello"], { env: { TOOLSMITH_CONFIG: path } });
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.ok(stderr.startsWith(`error: config file ${path} is not valid JSON: `), stderr);
});

test("a wrong value type is an error that names the file", async (t) => {
  const path = writeTempConfig(t, '{"color": "yes"}');
  const { stdout, stderr, code } = await runCli(["hello"], { env: { TOOLSMITH_CONFIG: path } });
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.equal(stderr, `error: "color" in config file ${path} must be a boolean, got "yes"\n`);
});

test("a list setting must be a list of strings", async (t) => {
  const path = writeTempConfig(t, '{"protectedBranches": "main"}');
  const { stderr, code } = await runCli(["config"], { env: { TOOLSMITH_CONFIG: path } });
  assert.equal(code, 1);
  assert.equal(stderr, `error: "protectedBranches" in config file ${path} must be a list of strings, got "main"\n`);
});

test("a map setting must map names to text", async (t) => {
  const path = writeTempConfig(t, '{"templates": {"team": 1}}');
  const { stderr, code } = await runCli(["config"], { env: { TOOLSMITH_CONFIG: path } });
  assert.equal(code, 1);
  assert.equal(stderr, `error: "templates" in config file ${path} must be a map of names to text, got {"team":1}\n`);
});

test("a config file that isn't a JSON object is an error", async (t) => {
  const path = writeTempConfig(t, '["greeting", "Hi"]');
  const { stderr, code } = await runCli(["hello"], { env: { TOOLSMITH_CONFIG: path } });
  assert.equal(code, 1);
  assert.equal(stderr, `error: config file ${path} must contain a JSON object\n`);
});

test("a UTF-16 config file (Windows PowerShell's default) is read", async (t) => {
  const contents = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('{"greeting": "Hi"}', "utf16le")]);
  const path = writeTempConfig(t, contents);
  const { stdout, code } = await runCli(["hello"], { env: { TOOLSMITH_CONFIG: path } });
  assert.equal(code, 0);
  assert.equal(stdout, "Hi, world!\n");
});

test("a UTF-8 config file with a byte order mark is read", async (t) => {
  const contents = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"greeting": "Hi"}')]);
  const path = writeTempConfig(t, contents);
  const { stdout, code } = await runCli(["hello"], { env: { TOOLSMITH_CONFIG: path } });
  assert.equal(code, 0);
  assert.equal(stdout, "Hi, world!\n");
});

test("an unknown setting only prints a warning", async (t) => {
  const path = writeTempConfig(t, '{"greeting": "Hi", "colour": false}');
  const { stdout, stderr, code } = await runCli(["hello"], { env: { TOOLSMITH_CONFIG: path } });
  assert.equal(code, 0);
  assert.equal(stdout, "Hi, world!\n");
  assert.equal(stderr, `warning: unknown setting "colour" in config file ${path} (ignored)\n`);
});

test('"color": false turns colors off, like --no-color', async (t) => {
  const path = writeTempConfig(t, '{"color": false}');
  const env = { TOOLSMITH_CONFIG: path, FORCE_COLOR: "1", NO_COLOR: undefined };
  const { stdout } = await runCli(["hello"], { env });
  assert.equal(stdout, "Hello, world!\n");
});

test("command-line flags override the config file", async (t) => {
  const path = writeTempConfig(t, '{"color": true}');
  const { stdout } = await runCli(["config", "--no-color"], { env: { TOOLSMITH_CONFIG: path } });
  assert.ok(stdout.includes("  color: false\n"), stdout);
});

test("--help and --version still work with a broken config file", async (t) => {
  const env = { TOOLSMITH_CONFIG: writeTempConfig(t, "{") };
  assert.equal((await runCli(["--help"], { env })).code, 0);
  assert.equal((await runCli(["--version"], { env })).code, 0);
});
