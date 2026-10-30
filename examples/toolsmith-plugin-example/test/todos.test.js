import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { findTodos } from "../lib/todos.js";

// A temp folder with `files` (relative path → content), deleted after test `t`.
function folderWith(t, files) {
  const root = mkdtempSync(join(tmpdir(), "todos-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

test("finds TODO, FIXME and HACK comments, sorted by file and line", async (t) => {
  const root = folderWith(t, {
    "src/app.js": "// TODO: handle errors\nconst x = 1;\n// FIXME the timeout is too short\r\n",
    "notes.md": "- HACK: works for now\n- todo in lowercase isn't a tag\n- neither is TODOS\n",
    "node_modules/lib/index.js": "// TODO: not ours\n",
    ".git/hooks/pre-commit": "# TODO: not ours either\n",
    "logo.png": Buffer.from([0x89, 0x50, 0x00, ...Buffer.from(" TODO: binary")]),
  });
  assert.deepEqual(await findTodos(["."], { cwd: root }), [
    { path: "notes.md", line: 1, tag: "HACK", text: "works for now" },
    { path: "src/app.js", line: 1, tag: "TODO", text: "handle errors" },
    { path: "src/app.js", line: 3, tag: "FIXME", text: "the timeout is too short" },
  ]);
});

test("searches only the files and folders it's given, each file once", async (t) => {
  const root = folderWith(t, { "a.js": "// TODO: a\n", "b/c.js": "// TODO: c\n", "d.js": "// TODO: d\n" });
  const todos = await findTodos(["a.js", "b", "b/c.js"], { cwd: root });
  assert.deepEqual(
    todos.map(({ path }) => path),
    ["a.js", "b/c.js"],
  );
});

test("a path that doesn't exist is an error", async (t) => {
  const root = folderWith(t, {});
  await assert.rejects(findTodos(["missing"], { cwd: root }), { message: `${join(root, "missing")} not found` });
});
