import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { hardLinkOrSkip, makeTree, runCli, tempDir } from "./helpers.js";

// big.bin 4 KB; photos/ 3 KB (a.jpg 2 KB + 2024/b.jpg 1 KB); docs/ 100 B.
const tree = {
  "big.bin": "x".repeat(4096),
  "photos/a.jpg": "x".repeat(2048),
  "photos/2024/b.jpg": "x".repeat(1024),
  "docs/readme.txt": "x".repeat(100),
};

// The JSON items as [path, type, size] lists.
async function items(root, args) {
  const { stdout } = await runCli(["size", root, "--json", ...args]);
  return JSON.parse(stdout).items.map(({ path, type, size }) => [path, type, size]);
}

test("folder sizes include everything inside them, largest first", async (t) => {
  const root = makeTree(t, tree);
  const { stdout, stderr, code } = await runCli(["size"], { cwd: root });
  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.equal(
    stdout,
    " 4 KB   56%  big.bin\n" +
      " 3 KB   42%  photos/\n" +
      "100 B    1%  docs/\n" +
      "Total: 7.1 KB in 4 files.\n",
  );
});

test("--depth shows more folder levels", async (t) => {
  const root = makeTree(t, tree);
  assert.deepEqual(await items(root, ["--depth", "2"]), [
    ["big.bin", "file", 4096],
    ["photos", "directory", 3072],
    ["photos/a.jpg", "file", 2048],
    ["photos/2024", "directory", 1024],
    ["docs", "directory", 100],
    ["docs/readme.txt", "file", 100],
  ]);
  assert.equal((await items(root, ["--depth", "all"])).length, 7);
});

test("--top limits the list and says how much is hidden", async (t) => {
  const root = makeTree(t, tree);
  const { stdout } = await runCli(["size", "--top", "2"], { cwd: root });
  assert.equal(
    stdout,
    "4 KB   56%  big.bin\n3 KB   42%  photos/\nTotal: 7.1 KB in 4 files. Showing the 2 largest of 3 items.\n",
  );
});

test("--files-only and --folders-only", async (t) => {
  const root = makeTree(t, tree);
  assert.deepEqual(
    (await items(root, ["--files-only", "--depth", "all"])).map(([path]) => path),
    ["big.bin", "photos/a.jpg", "photos/2024/b.jpg", "docs/readme.txt"],
  );
  assert.deepEqual(
    (await items(root, ["--folders-only", "--depth", "all"])).map(([path]) => path),
    ["photos", "photos/2024", "docs"],
  );
  const both = await runCli(["size", root, "--files-only", "--folders-only"]);
  assert.equal(both.code, 1);
});

test("--json prints the root, the totals and the items with percentages", async (t) => {
  const root = makeTree(t, tree);
  const { stdout, code } = await runCli(["size", root, "--json"]);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout), {
    root,
    total: 7268,
    files: 4,
    items: [
      { path: "big.bin", type: "file", size: 4096, percent: 56.4 },
      { path: "photos", type: "directory", size: 3072, percent: 42.3 },
      { path: "docs", type: "directory", size: 100, percent: 1.4 },
    ],
  });
});

test(".git and node_modules are skipped unless --all is given", async (t) => {
  const root = makeTree(t, {
    "app.js": "x".repeat(10),
    "node_modules/big/index.js": "x".repeat(5000),
    ".git/objects/pack": "x".repeat(3000),
  });
  const { stdout } = await runCli(["size"], { cwd: root });
  assert.equal(stdout, "10 B  100%  app.js\nTotal: 10 B in 1 file.\n");

  const all = JSON.parse((await runCli(["size", root, "--all", "--json"])).stdout);
  assert.equal(all.total, 8010);
  assert.equal(all.files, 3);
});

test("an empty folder has a total of 0 B", async (t) => {
  const { stdout, code } = await runCli(["size"], { cwd: tempDir(t) });
  assert.equal(code, 0);
  assert.equal(stdout, "Total: 0 B in 0 files.\n");

  const root = makeTree(t, { "empty/": null });
  assert.equal((await runCli(["size"], { cwd: root })).stdout, "0 B    0%  empty/\nTotal: 0 B in 0 files.\n");
});

test("hard-linked files count once", async (t) => {
  const root = makeTree(t, { "a.bin": "x".repeat(1000) });
  if (!hardLinkOrSkip(t, join(root, "a.bin"), join(root, "b.bin"))) {
    return;
  }
  const result = JSON.parse((await runCli(["size", root, "--json"])).stdout);
  assert.equal(result.total, 1000);
  assert.equal(result.files, 1);
});
