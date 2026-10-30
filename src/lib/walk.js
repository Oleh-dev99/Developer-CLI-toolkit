import { lstat, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import picomatch from "picomatch";
import { warn } from "../output.js";

// Walks the folder tree under `root` and yields { path, relativePath, type, size }
// for every file, folder and symlink: sorted by name, each folder right before
// its contents. `path` is absolute; `relativePath` is relative to `root` and
// always uses "/". `type` is "file", "directory", "symlink" or "other", and
// `size` is in bytes (0 for folders).
//
// Options:
//   recursive  go into subfolders (default: true)
//   maxDepth   how many levels deep to go; 1 means only the root's own entries
//   ignore     glob patterns; one without "/" (like "node_modules" or "*.log")
//              matches a name at any depth, one with "/" (like "docs/**")
//              matches the path from the root. Ignored folders aren't opened.
//
// Symlinks are listed but never followed, so a link can't cause a loop.
// Anything below the root that can't be read is skipped with a warning.
export async function* walk(root, { recursive = true, maxDepth = Infinity, ignore = [] } = {}) {
  const isIgnored = ignoreMatcher(ignore);
  const depthLimit = recursive ? maxDepth : 1;

  async function* walkFolder(folder, relativeFolder, dirents, depth) {
    for (const dirent of dirents) {
      const relativePath = relativeFolder ? `${relativeFolder}/${dirent.name}` : dirent.name;
      if (isIgnored(dirent.name, relativePath)) {
        continue;
      }
      const path = join(folder, dirent.name);
      const type = typeOf(dirent);
      let size = 0;
      if (type !== "directory") {
        try {
          size = (await lstat(path)).size;
        } catch (err) {
          warn(`skipped ${path} (${fsErrorReason(err)})`);
          continue;
        }
      }
      yield { path, relativePath, type, size };

      if (type === "directory" && depth < depthLimit) {
        let children;
        try {
          children = await readFolder(path);
        } catch (err) {
          warn(`skipped ${path} (${fsErrorReason(err)})`);
          continue;
        }
        yield* walkFolder(path, relativePath, children, depth + 1);
      }
    }
  }

  const rootPath = resolve(root);
  let rootEntries;
  try {
    rootEntries = await readFolder(rootPath);
  } catch (err) {
    throw new Error(`can't read folder ${rootPath} (${fsErrorReason(err)})`);
  }
  yield* walkFolder(rootPath, "", rootEntries, 1);
}

// Patterns without "/" are matched against an entry's name, so they apply at
// any depth; patterns with "/" are matched against its path from the root.
function ignoreMatcher(patterns) {
  const byName = patterns.filter((pattern) => !pattern.includes("/"));
  const byPath = patterns.filter((pattern) => pattern.includes("/"));
  const matchesName = byName.length > 0 ? picomatch(byName, { dot: true }) : () => false;
  const matchesPath = byPath.length > 0 ? picomatch(byPath, { dot: true }) : () => false;
  return (name, relativePath) => matchesName(name) || matchesPath(relativePath);
}

async function readFolder(folder) {
  const dirents = await readdir(folder, { withFileTypes: true });
  // Plain string order (names in a folder are unique), the same on every OS.
  return dirents.sort((a, b) => (a.name < b.name ? -1 : 1));
}

function typeOf(dirent) {
  if (dirent.isFile()) {
    return "file";
  }
  if (dirent.isDirectory()) {
    return "directory";
  }
  if (dirent.isSymbolicLink()) {
    return "symlink";
  }
  return "other";
}

const reasons = {
  EACCES: "permission denied",
  EBUSY: "in use by another program",
  EPERM: "permission denied",
  ENOENT: "not found",
  ENOTDIR: "not a folder",
};

// A short, readable reason for a file system error, like "permission denied".
export function fsErrorReason(err) {
  return reasons[err.code] ?? err.message;
}
