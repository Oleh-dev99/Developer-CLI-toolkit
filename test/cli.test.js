import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runCli, writeTempConfig } from "./helpers.js";

const { version } = createRequire(import.meta.url)("../package.json");

test("--help lists the commands and global options", async () => {
  const { stdout, stderr, code } = await runCli(["--help"]);
  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.match(stdout, /^Usage: toolsmith \[options\] \[command\]/);
  for (const text of ["--version", "--debug", "--no-color", "config", "hello [name]"]) {
    assert.ok(stdout.includes(text), `--help should mention ${text}`);
  }
});

test("--version prints the version from package.json", async () => {
  const { stdout, stderr, code } = await runCli(["--version"]);
  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.equal(stdout, `${version}\n`);
});

test("an unknown command prints an error to stderr and exits with 1", async () => {
  const { stdout, stderr, code } = await runCli(["nope"]);
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.equal(stderr, "error: unknown command 'nope'\n");
});

test("--debug adds the stack trace to errors", async (t) => {
  const env = { TOOLSMITH_CONFIG: writeTempConfig(t, "{") };
  const plain = await runCli(["hello"], { env });
  assert.equal(plain.code, 1);
  assert.doesNotMatch(plain.stderr, /^\s+at /m);
  const debug = await runCli(["hello", "--debug"], { env });
  assert.equal(debug.code, 1);
  assert.ok(debug.stderr.startsWith(plain.stderr), debug.stderr);
  assert.match(debug.stderr, /^\s+at loadConfig /m);
});

test("FORCE_COLOR colors the output even when it is piped", async () => {
  const env = { FORCE_COLOR: "1", NO_COLOR: undefined };
  const hello = await runCli(["hello"], { env });
  assert.equal(hello.stdout, "\x1b[32mHello, world!\x1b[39m\n");
  const nope = await runCli(["nope"], { env });
  assert.equal(nope.stderr, "\x1b[31merror: unknown command 'nope'\x1b[39m\n");
});

test("--no-color turns colors off, even with FORCE_COLOR", async () => {
  const env = { FORCE_COLOR: "1", NO_COLOR: undefined };
  const hello = await runCli(["hello", "--no-color"], { env });
  assert.equal(hello.stdout, "Hello, world!\n");
  const nope = await runCli(["nope", "--no-color"], { env });
  assert.equal(nope.stderr, "error: unknown command 'nope'\n");
});
