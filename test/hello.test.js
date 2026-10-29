import assert from "node:assert/strict";
import { test } from "node:test";
import { runCli } from "./helpers.js";

test("hello greets the world by default", async () => {
  const { stdout, stderr, code } = await runCli(["hello"]);
  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.equal(stdout, "Hello, world!\n");
});

test("hello greets the given name", async () => {
  const { stdout, stderr, code } = await runCli(["hello", "Ada"]);
  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.equal(stdout, "Hello, Ada!\n");
});
