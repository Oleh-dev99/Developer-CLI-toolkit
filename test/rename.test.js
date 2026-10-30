import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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

test("a glob pattern picks files in the current folder", async (t) => {
  const root = makeTree(t, { "IMG_1.jpg": "", "IMG_2.png": "", "sub/IMG_3.jpg": "" });
  const { stdout, stderr, code } = await runCli(["rename", "IMG_", "photo_", "*.jpg"], { cwd: root });
  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.equal(stdout, "IMG_1.jpg → photo_1.jpg\nRenamed 1 file.\n");
  assert.deepEqual(namesIn(root), ["IMG_2.png", "photo_1.jpg", "sub"]);
  assert.deepEqual(namesIn(join(root, "sub")), ["IMG_3.jpg"]);
});

test("a ** pattern includes subfolders", async (t) => {
  const root = makeTree(t, {
    "photos/IMG_1.png": "",
    "photos/IMG_2.jpg": "",
    "photos/trip/IMG_3.png": "",
    "other/IMG_4.png": "",
  });
  const { stdout, code } = await runCli(["rename", "IMG_", "photo_", "photos/**/*.png"], { cwd: root });
  assert.equal(code, 0);
  assert.equal(
    stdout,
    `${"photos/IMG_1.png".padEnd(21)} → photos/photo_1.png\n` +
      "photos/trip/IMG_3.png → photos/trip/photo_3.png\n" +
      "Renamed 2 files.\n",
  );
  assert.deepEqual(namesIn(join(root, "photos")), ["IMG_2.jpg", "photo_1.png", "trip"]);
  assert.deepEqual(namesIn(join(root, "photos", "trip")), ["photo_3.png"]);
  assert.deepEqual(namesIn(join(root, "other")), ["IMG_4.png"]);
});

test("with -r, a pattern without / also matches in subfolders", async (t) => {
  const root = makeTree(t, { "IMG_1.jpg": "", "sub/IMG_2.jpg": "", "sub/IMG_3.png": "" });
  const { code } = await runCli(["rename", "-r", "IMG_", "photo_", "*.jpg"], { cwd: root });
  assert.equal(code, 0);
  assert.deepEqual(namesIn(root), ["photo_1.jpg", "sub"]);
  assert.deepEqual(namesIn(join(root, "sub")), ["IMG_3.png", "photo_2.jpg"]);
});

test("a glob pattern and --regex work together", async (t) => {
  const root = makeTree(t, { "report-2024.txt": "", "report-2025.md": "" });
  const { stdout, code } = await runCli(["rename", "--regex", "report-(\\d+)", "$1-report", "*.txt"], { cwd: root });
  assert.equal(code, 0);
  assert.equal(stdout, "report-2024.txt → 2024-report.txt\nRenamed 1 file.\n");
  assert.deepEqual(namesIn(root), ["2024-report.txt", "report-2025.md"]);
});

test("a pattern that matches nothing prints a warning, and the rest still runs", async (t) => {
  const root = makeTree(t, { "old.txt": "" });
  const { stdout, stderr, code } = await runCli(["rename", "old", "new", "*.gif", "*.txt"], { cwd: root });
  assert.equal(code, 0);
  assert.equal(stderr, "warning: no files match *.gif\n");
  assert.equal(stdout, "old.txt → new.txt\nRenamed 1 file.\n");
});

test("a case-only rename really changes the name on disk", async (t) => {
  const root = makeTree(t, { "readme.md": "hello" });
  const { stdout, stderr, code } = await runCli(["rename", "readme", "README"], { cwd: root });
  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.equal(stdout, "readme.md → README.md\nRenamed 1 file.\n");
  // readdir shows the name as stored, so this fails if the case didn't change.
  assert.deepEqual(readdirSync(root), ["README.md"]);
  assert.equal(readFileSync(join(root, "README.md"), "utf8"), "hello");
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
