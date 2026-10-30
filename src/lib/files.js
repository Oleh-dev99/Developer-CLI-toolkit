import { lstat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import picomatch from "picomatch";
import { warn } from "../output.js";
import { walk } from "./walk.js";

const skipFolders = [".git", "node_modules"];

// Turns command-line paths into a list of files ({ path, size }) without
// repeats. Each path is a file, a folder (with its subfolders if `recursive`),
// or a glob pattern. A path that exists is used as it is, even if it looks like
// a pattern (such as "photo[1].jpg"). .git and node_modules are skipped.
export async function findFiles(paths, { recursive }) {
  const files = new Map();
  const add = (path, size) => files.set(path, { path, size });

  for (const path of paths) {
    const stats = await lstat(path).catch(() => null);
    if (stats?.isFile()) {
      add(resolve(path), stats.size);
    } else if (stats?.isDirectory()) {
      for await (const entry of walk(path, { recursive, ignore: skipFolders })) {
        if (entry.type === "file") {
          add(entry.path, entry.size);
        }
      }
    } else if (!stats && picomatch.scan(path).isGlob) {
      const matches = await expandGlob(path, recursive);
      if (matches.length === 0) {
        warn(`no files match ${path}`);
      }
      for (const match of matches) {
        add(match.path, match.size);
      }
    } else if (!stats) {
      throw new Error(`${path} not found`);
    }
  }
  return [...files.values()];
}

// Expands a pattern like "*.jpg" or "photos/**/*.png" from the current folder.
// Shells on Windows don't do this, so toolsmith does it the same way everywhere.
// With `recursive`, a pattern without "/" also matches in subfolders.
async function expandGlob(pattern, recursive) {
  // In a glob "\" escapes the next character, but on Windows it's a separator.
  const slashed = process.platform === "win32" ? pattern.replaceAll("\\", "/") : pattern;
  const { base, glob } = picomatch.scan(slashed);
  const fullGlob = recursive && !glob.includes("/") ? `**/${glob}` : glob;
  const isMatch = picomatch(fullGlob);
  const maxDepth = fullGlob.includes("**") ? Infinity : fullGlob.split("/").length;

  const matches = [];
  try {
    for await (const entry of walk(base || ".", { maxDepth, ignore: skipFolders })) {
      if (entry.type === "file" && isMatch(entry.relativePath)) {
        matches.push(entry);
      }
    }
  } catch {
    // The folder in front of the pattern doesn't exist, so nothing matches.
  }
  return matches;
}

// Paths inside the current folder are shown relative to it, with "/".
export function displayPath(path) {
  const relativePath = relative(process.cwd(), path);
  return relativePath.startsWith("..") || isAbsolute(relativePath)
    ? path
    : relativePath.split(sep).join("/");
}
