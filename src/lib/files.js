import { lstat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import picomatch from "picomatch";
import { warn } from "../output.js";
import { statDetails, walk } from "./walk.js";

// Folders the file tools leave out unless asked otherwise.
export const skipFolders = [".git", "node_modules"];

// Turns command-line paths into a list of files ({ path, size, fileId, links })
// without repeats. Each path is a file, a folder (with its subfolders if
// `recursive`), or a glob pattern. A path that exists is used as it is, even if
// it looks like a pattern (such as "photo[1].jpg"). .git and node_modules are
// skipped.
export async function findFiles(paths, { recursive }) {
  const files = new Map();
  const add = (file) => files.set(file.path, file);

  for (const path of paths) {
    const stats = await lstat(path, { bigint: true }).catch(() => null);
    if (stats?.isFile()) {
      add({ path: resolve(path), ...statDetails(stats) });
    } else if (stats?.isDirectory()) {
      for await (const entry of walk(path, { recursive, ignore: skipFolders })) {
        if (entry.type === "file") {
          add(entry);
        }
      }
    } else if (!stats && picomatch.scan(path).isGlob) {
      const matches = await expandGlob(path, recursive);
      if (matches.length === 0) {
        warn(`no files match ${path}`);
      }
      for (const match of matches) {
        add(match);
      }
    } else if (!stats) {
      throw new Error(`${path} not found`);
    }
  }
  return [...files.values()];
}

// Hard links share their data, so only the first path to each is kept.
export function withoutHardLinks(files) {
  const seen = new Set();
  return files.filter(({ fileId, links }) => {
    if (links < 2) {
      return true;
    }
    if (seen.has(fileId)) {
      return false;
    }
    seen.add(fileId);
    return true;
  });
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

// Whether `name` works as a single file or folder name on this system: not
// empty, not "." or "..", and no "/" (which would point into another folder).
export function isValidFileName(name) {
  if (name === "" || name === "." || name === ".." || /[/\0]/.test(name)) {
    return false;
  }
  // Windows also forbids these characters, and names ending in a dot or space.
  return process.platform !== "win32" || !/[\\<>:"|?*\x00-\x1f]|[. ]$/.test(name);
}

// Paths inside the current folder are shown relative to it, with "/".
export function displayPath(path) {
  const relativePath = relative(process.cwd(), path);
  return relativePath.startsWith("..") || isAbsolute(relativePath)
    ? path
    : relativePath.split(sep).join("/");
}
