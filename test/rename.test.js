import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { makeTree, runCli } from "./helpers.js";

// The names in a folder, sorted.
const namesIn = (folder) => readdirSync(folder).sort();

test("replaces plain text in file names in the current folder", async (t) => {
  const root = makeTree(t, { "IMG_001.jpg": "", "IMG_002.jpg": "", "IMG_dir/": null, "notes.txt": "" });
  const { stdout, stderr, code } = await runCli(["rename", "IMG_", "photo_"], { cwd: root });
  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.equal(stdout, "IMG_001.jpg → photo_001.jpg\nIMG_002.jpg → photo_002.jpg\nRenamed 2 files.\n");
  // Folder names never change.
  assert.deepEqual(namesIn(root), ["IMG_dir", "notes.txt", "photo_001.jpg", "photo_002.jpg"]);
});

test("--regex replaces with capture groups like $1", async (t) => {
  const root = makeTree(t, { "report-2024.txt": "", "report-2025.txt": "", "summary.txt": "" });
  const { stdout, code } = await runCli(["rename", "--regex", "report-(\\d+)", "$1-report"], { cwd: root });
  assert.equal(code, 0);
  assert.equal(stdout, "report-2024.txt → 2024-report.txt\nreport-2025.txt → 2025-report.txt\nRenamed 2 files.\n");
  assert.deepEqual(namesIn(root), ["2024-report.txt", "2025-report.txt", "summary.txt"]);
});

test("files in subfolders are only renamed with -r", async (t) => {
  const root = makeTree(t, { "old.txt": "", "old-folder/old.txt": "" });

  const flat = await runCli(["rename", "old", "new"], { cwd: root });
  assert.equal(flat.stdout, "old.txt → new.txt\nRenamed 1 file.\n");
  assert.deepEqual(namesIn(root), ["new.txt", "old-folder"]);
  assert.deepEqual(namesIn(join(root, "old-folder")), ["old.txt"]);

  const deep = await runCli(["rename", "-r", "old", "new"], { cwd: root });
  assert.equal(deep.stdout, "old-folder/old.txt → old-folder/new.txt\nRenamed 1 file.\n");
  assert.deepEqual(namesIn(join(root, "old-folder")), ["new.txt"]);
});

test("paths choose the folders to work on", async (t) => {
  const root = makeTree(t, { "a/old.txt": "", "b/old.txt": "" });
  const { stdout, code } = await runCli(["rename", "old", "new", "a"], { cwd: root });
  assert.equal(code, 0);
  assert.equal(stdout, "a/old.txt → a/new.txt\nRenamed 1 file.\n");
  assert.deepEqual(namesIn(join(root, "b")), ["old.txt"]);
});

test("--dry-run shows the table but changes nothing", async (t) => {
  const root = makeTree(t, { "draft-a.md": "", "draft-b.md": "" });
  const { stdout, code } = await runCli(["rename", "draft-", "final-", "--dry-run"], { cwd: root });
  assert.equal(code, 0);
  assert.equal(
    stdout,
    "draft-a.md → final-a.md\ndraft-b.md → final-b.md\nDry run: 2 files would be renamed. Nothing was changed.\n",
  );
  assert.deepEqual(namesIn(root), ["draft-a.md", "draft-b.md"]);
});

test("all conflicts are listed and nothing is renamed", async (t) => {
  const root = makeTree(t, { "a-1.txt": "", "a_1.txt": "", "b-2.txt": "", "b2.txt": "", "c-3.txt": "" });
  const before = namesIn(root);
  const { stdout, stderr, code } = await runCli(["rename", "--regex", "[-_]", ""], { cwd: root });
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.equal(
    stderr,
    "error: 2 conflicts, nothing was renamed:\n" +
      "  a-1.txt, a_1.txt → a1.txt: would get the same name\n" +
      "  b-2.txt → b2.txt: b2.txt already exists\n",
  );
  // c-3.txt had no conflict, but it isn't renamed either.
  assert.deepEqual(namesIn(root), before);
});

test("a new name with a path separator is a conflict", async (t) => {
  const root = makeTree(t, { "a_b.txt": "" });
  const { stderr, code } = await runCli(["rename", "_", "/"], { cwd: root });
  assert.equal(code, 1);
  assert.equal(stderr, 'error: 1 conflict, nothing was renamed:\n  a_b.txt → "a/b.txt": not a valid file name\n');
  assert.deepEqual(namesIn(root), ["a_b.txt"]);
});

test("says so when no file names match", async (t) => {
  const root = makeTree(t, { "a.txt": "" });
  const plain = await runCli(["rename", "zzz", "y"], { cwd: root });
  assert.equal(plain.code, 0);
  assert.equal(plain.stdout, 'No file names contain "zzz".\n');
  const regex = await runCli(["rename", "--regex", "^z+$", "y"], { cwd: root });
  assert.equal(regex.code, 0);
  assert.equal(regex.stdout, "No file names match /^z+$/.\n");
});
