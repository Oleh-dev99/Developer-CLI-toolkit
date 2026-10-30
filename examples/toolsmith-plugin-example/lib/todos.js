import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const tags = /\b(TODO|FIXME|HACK)\b[:\s]*(.*)$/;
const skippedFolders = new Set([".git", "node_modules"]);

// The TODO, FIXME and HACK comments in the files and folders `paths`, as
// { path, line, tag, text }, sorted by path and line. Paths are relative to
// `cwd`, with "/". .git and node_modules folders are skipped, and so are files
// that look binary (they have a zero byte, as git checks it).
export async function findTodos(paths, { cwd = process.cwd() } = {}) {
  const todos = [];
  for (const file of await listFiles(paths.map((path) => resolve(cwd, path)))) {
    const content = await readFile(file);
    if (content.subarray(0, 8000).includes(0)) {
      continue;
    }
    const path = relative(cwd, file).split(sep).join("/");
    content
      .toString("utf8")
      .split(/\r?\n/)
      .forEach((text, index) => {
        const match = tags.exec(text);
        if (match) {
          todos.push({ path, line: index + 1, tag: match[1], text: match[2].trim() });
        }
      });
  }
  return todos.sort((a, b) => (a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1));
}

async function listFiles(paths) {
  const files = new Set();
  for (const path of paths) {
    const stats = await stat(path).catch(() => null);
    if (!stats) {
      throw new Error(`${path} not found`);
    }
    if (stats.isDirectory()) {
      for await (const file of filesIn(path)) {
        files.add(file);
      }
    } else {
      files.add(path);
    }
  }
  return [...files];
}

async function* filesIn(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory() && !skippedFolders.has(entry.name)) {
      yield* filesIn(path);
    } else if (entry.isFile()) {
      yield path;
    }
  }
}
