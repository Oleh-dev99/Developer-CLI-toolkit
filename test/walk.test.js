import assert from "node:assert/strict";
import { chmodSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { walk } from "../src/lib/walk.js";
import { makeTree, tempDir } from "./helpers.js";

// The walker's entries as [relativePath, type] pairs.
async function list(root, options) {
  const entries = await Array.fromAsync(walk(root, options));
  return entries.map(({ relativePath, type }) => [relativePath, type]);
}

// Just the relative paths.
async function paths(root, options) {
  return (await list(root, options)).map(([relativePath]) => relativePath);
}

test("walks nested folders, each folder before its contents, sorted by name", async (t) => {
  const root = makeTree(t, {
    "b.txt": "bb",
    "a/one.txt": "1",
    "a/deeper/two.txt": "22",
  });
  const entries = await Array.fromAsync(walk(root));
  assert.deepEqual(
    entries.map(({ relativePath, type, size }) => [relativePath, type, size]),
    [
      ["a", "directory", 0],
      ["a/deeper", "directory", 0],
      ["a/deeper/two.txt", "file", 2],
      ["a/one.txt", "file", 1],
      ["b.txt", "file", 2],
    ],
  );
  // `path` is absolute and uses the OS's own separators.
  assert.equal(entries[2].path, join(root, "a", "deeper", "two.txt"));
});

test("ignore patterns match names at any depth, or paths from the root", async (t) => {
  const root = makeTree(t, {
    ".git/HEAD": "",
    "debug.log": "",
    "docs/guide.md": "",
    "index.js": "",
    "node_modules/dep/index.js": "",
    "src/app.js": "",
    "src/app.log": "",
    "src/node_modules/dep.js": "",
  });
  const ignore = [".git", "node_modules", "*.log", "docs/**"];
  assert.deepEqual(await paths(root, { ignore }), ["index.js", "src", "src/app.js"]);
});

test("maxDepth limits how many levels deep the walk goes", async (t) => {
  const root = makeTree(t, { "top.txt": "", "a/mid.txt": "", "a/b/deep.txt": "" });
  assert.deepEqual(await paths(root, { maxDepth: 1 }), ["a", "top.txt"]);
  assert.deepEqual(await paths(root, { maxDepth: 2 }), ["a", "a/b", "a/mid.txt", "top.txt"]);
  assert.deepEqual(await paths(root), ["a", "a/b", "a/b/deep.txt", "a/mid.txt", "top.txt"]);
});

test("recursive: false lists only the root's own entries", async (t) => {
  const root = makeTree(t, { "top.txt": "", "a/mid.txt": "" });
  assert.deepEqual(await list(root, { recursive: false }), [
    ["a", "directory"],
    ["top.txt", "file"],
  ]);
});

test("empty folders are listed, and an empty root yields nothing", async (t) => {
  const root = makeTree(t, { "empty/": null, "full/file.txt": "x" });
  assert.deepEqual(await list(root), [
    ["empty", "directory"],
    ["full", "directory"],
    ["full/file.txt", "file"],
  ]);
  assert.deepEqual(await list(tempDir(t)), []);
});

test("symlinks are listed but not followed, so a loop can't hang the walk", async (t) => {
  const root = makeTree(t, { "real/file.txt": "x" });
  try {
    // A link back to the root: following it would never end. A junction needs
    // no admin rights on Windows; other systems create a normal symlink.
    symlinkSync(root, join(root, "real", "loop"), "junction");
  } catch (err) {
    if (err.code === "EPERM") {
      t.skip("creating symlinks isn't allowed here");
      return;
    }
    throw err;
  }
  assert.deepEqual(await list(root), [
    ["real", "directory"],
    ["real/file.txt", "file"],
    ["real/loop", "symlink"],
  ]);
});

const canLockFolders = process.platform !== "win32" && process.getuid?.() !== 0;

test(
  "an unreadable folder is skipped with a warning",
  { skip: !canLockFolders && "needs macOS or Linux and a non-root user" },
  async (t) => {
    const root = makeTree(t, { "locked/secret.txt": "x", "open.txt": "y" });
    const locked = join(root, "locked");
    const errorOutput = t.mock.method(console, "error", () => {});
    chmodSync(locked, 0o000);
    let entries;
    try {
      entries = await list(root);
    } finally {
      chmodSync(locked, 0o755);
    }
    assert.deepEqual(entries, [
      ["locked", "directory"],
      ["open.txt", "file"],
    ]);
    const warnings = errorOutput.mock.calls.map((call) => stripVTControlCharacters(call.arguments[0]));
    assert.deepEqual(warnings, [`warning: skipped ${locked} (permission denied)`]);
  },
);

test("a root folder that can't be read is an error", async (t) => {
  const missing = join(tempDir(t), "missing");
  await assert.rejects(Array.fromAsync(walk(missing)), {
    message: `can't read folder ${missing} (not found)`,
  });
});
