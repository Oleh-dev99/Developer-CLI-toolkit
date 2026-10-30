import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { makeTree, runCli } from "./helpers.js";

test("finds files with identical content, in subfolders too", async (t) => {
  const root = makeTree(t, {
    "a/photo.jpg": "same content",
    "b/photo-copy.jpg": "same content",
    "c/other.jpg": "other content",
  });
  const { stdout, stderr, code } = await runCli(["dupes"], { cwd: root });
  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.equal(
    stdout,
    "2 identical files, 12 B each (12 B wasted):\n" +
      "  a/photo.jpg\n" +
      "  b/photo-copy.jpg\n" +
      "\n" +
      "Found 1 group of identical files: 1 duplicate, 12 B wasted.\n",
  );
});

test("same size but different content isn't a duplicate, and empty files are skipped", async (t) => {
  const root = makeTree(t, { "x.txt": "aaaa", "y.txt": "bbbb", "z.txt": "aaaa", "empty-1.txt": "", "empty-2.txt": "" });
  const { stdout, code } = await runCli(["dupes"], { cwd: root });
  assert.equal(code, 0);
  assert.equal(
    stdout,
    "2 identical files, 4 B each (4 B wasted):\n  x.txt\n  z.txt\n\nFound 1 group of identical files: 1 duplicate, 4 B wasted.\n",
  );
});

test("--min-size ignores smaller files and accepts units", async (t) => {
  const big = "x".repeat(2048);
  const root = makeTree(t, { "small-1.txt": "tiny", "small-2.txt": "tiny", "big-1.bin": big, "big-2.bin": big });
  const { stdout, code } = await runCli(["dupes", "--min-size", "1KB"], { cwd: root });
  assert.equal(code, 0);
  assert.equal(
    stdout,
    "2 identical files, 2 KB each (2 KB wasted):\n  big-1.bin\n  big-2.bin\n\nFound 1 group of identical files: 1 duplicate, 2 KB wasted.\n",
  );

  const bad = await runCli(["dupes", "--min-size", "5XB"], { cwd: root });
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /'--min-size <size>' argument '5XB' is invalid/);
});

test(".git and node_modules are skipped", async (t) => {
  const root = makeTree(t, {
    "src/index.js": "same",
    "node_modules/pkg/index.js": "same",
    ".git/objects/ab": "same",
  });
  const { stdout, code } = await runCli(["dupes"], { cwd: root });
  assert.equal(code, 0);
  assert.equal(stdout, "No duplicate files found among 1 file.\n");
});

test("a glob pattern picks the files to compare", async (t) => {
  const root = makeTree(t, { "a.jpg": "pic", "sub/b.jpg": "pic", "c.txt": "pic" });
  const { stdout, code } = await runCli(["dupes", "*.jpg"], { cwd: root });
  assert.equal(code, 0);
  assert.equal(
    stdout,
    "2 identical files, 3 B each (3 B wasted):\n  a.jpg\n  sub/b.jpg\n\nFound 1 group of identical files: 1 duplicate, 3 B wasted.\n",
  );
});

test("--json prints the groups, most wasted space first, and a summary", async (t) => {
  const three = "three copies"; // 12 bytes, 24 wasted
  const two = "two copies, but bigger"; // 22 bytes, 22 wasted
  const root = makeTree(t, {
    "a.txt": three,
    "b.txt": three,
    "sub/c.txt": three,
    "d.txt": two,
    "e.txt": two,
    "unique.txt": "unique",
  });
  const { stdout, stderr, code } = await runCli(["dupes", "--json"], { cwd: root });
  assert.equal(code, 0);
  assert.equal(stderr, "");
  const sha256 = (text) => createHash("sha256").update(text).digest("hex");
  assert.deepEqual(JSON.parse(stdout), {
    groups: [
      { size: 12, sha256: sha256(three), wasted: 24, files: ["a.txt", "b.txt", "sub/c.txt"] },
      { size: 22, sha256: sha256(two), wasted: 22, files: ["d.txt", "e.txt"] },
    ],
    summary: { checkedFiles: 6, groups: 2, duplicateFiles: 3, wasted: 46 },
  });
});

test("says so when there are no duplicates", async (t) => {
  const root = makeTree(t, { "a.txt": "one", "b.txt": "three" });
  const { stdout, code } = await runCli(["dupes"], { cwd: root });
  assert.equal(code, 0);
  assert.equal(stdout, "No duplicate files found among 2 files.\n");
});
