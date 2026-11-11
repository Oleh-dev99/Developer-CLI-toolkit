import { lstatSync, readdirSync, watch } from "node:fs";
import { join, relative, sep } from "node:path";

// Watching the folder tree for toolsmith ui, so that the Files panel and the
// Git status panel keep up with changes made outside it.

// On macOS and Windows, one fs.watch watches a whole tree, with the system's
// own recursive watching. Elsewhere, on Linux above all, the system can only
// watch one folder at a time, and Node's recursive fs.watch does that in
// JavaScript; since Node 24.22 and 26.13, that code throws from inside
// fs.watch's callback when a folder in the tree can't be searched any more
// (after chmod 000, say): an uncaught EACCES that ends the dashboard, and
// that nothing here could catch. There, watchFolders() does the work instead.
const watchesTrees = process.platform === "darwin" || process.platform === "win32";

// Watches everything under `root`, and calls `onChange({ files, git })` once
// for each burst of changes: `files` when something under `filesIn` changed (a
// folder in `root`, as a relative path ending in "/", or "" for all of it),
// `git` when the git status may have changed (anything outside .git, or in
// it). A burst ends after `quiet` milliseconds without changes, or `longest`
// milliseconds after it began, whichever comes first. Changes in node_modules,
// in .git/objects (which a commit also shows elsewhere) and to git's lock
// files are ignored. Errors, like running out of watches, go to `onError`;
// nothing is watched then.
export function watchTree(root, { onChange, onError = () => {}, filesIn = "", quiet = 150, longest = 1000 }) {
  const pending = { files: false, git: false };
  let timer = null;
  let started = 0;
  const flush = () => {
    timer = null;
    const changed = { ...pending };
    pending.files = false;
    pending.git = false;
    onChange(changed);
  };
  const note = (path) => {
    const change = changeOf(path, filesIn);
    if (!change) {
      return;
    }
    pending.git = true;
    pending.files ||= change.files;
    const now = Date.now();
    if (timer === null) {
      started = now;
    }
    clearTimeout(timer);
    timer = setTimeout(flush, now - started >= longest ? 0 : quiet);
  };

  const watcher = watchesTrees ? watchWhole(root, note, onError) : watchFolders(root, { onChange: note, onError });
  return {
    close() {
      clearTimeout(timer);
      watcher.close();
    },
  };
}

// One recursive fs.watch on `root`, for macOS and Windows: `onChange` gets the
// path that changed, relative to `root` and with "/".
function watchWhole(root, onChange, onError) {
  let watcher = null;
  try {
    // Some systems don't always say what changed; then anything may have.
    watcher = watch(root, { recursive: true }, (event, name) => onChange(name ? String(name).replaceAll("\\", "/") : ""));
    watcher.on("error", (err) => {
      onError(err);
      watcher.close();
    });
  } catch (err) {
    onError(err);
  }
  return { close: () => watcher?.close() };
}

// What a folder that can't be watched or listed says: it's locked, or it's
// gone, or it isn't a folder any more.
const notThere = new Set(["EACCES", "EPERM", "ENOENT", "ENOTDIR"]);

// Watches the tree under `root` one folder at a time, with a plain fs.watch
// for each (a folder's watch reports its entries by name, so files need no
// watch of their own), and calls `onChange(path)` with the path of each entry
// that changed, relative to `root` and with "/". New folders, and folders
// renamed or moved here, are watched as they come, and those that go aren't
// any more. node_modules and .git/objects aren't watched at all (changeOf()
// ignores what changes there anyway), and symlinks are never followed. A
// folder that can't be watched or listed, because it's locked or already
// gone, is simply left out, and tried again when it changes, as it does when
// it's unlocked. Only an error that isn't about one folder in it, like running
// out of watches or `root` itself not being there, goes to `onError`, and
// nothing is watched after that, as when one fs.watch fails. `folders()` lists
// the folders watched, relative to `root`, with "/" ("" for `root`).
export function watchFolders(root, { onChange, onError = () => {} }) {
  const watchers = new Map(); // folder → its fs.watch
  let stopped = false;
  const relativePath = (path) => relative(root, path).split(sep).join("/");
  const left = (folder) => /(^|\/)node_modules$|^\.git\/objects$/.test(relativePath(folder));

  const stop = () => {
    stopped = true;
    for (const watcher of watchers.values()) {
      watcher.close();
    }
    watchers.clear();
  };
  const fail = (err) => {
    stop();
    onError(err);
  };

  // Stops watching `folder` and the folders in it.
  const forget = (folder) => {
    if (!watchers.has(folder)) {
      return;
    }
    for (const [path, watcher] of watchers) {
      if (path === folder || path.startsWith(folder + sep)) {
        watcher.close();
        watchers.delete(path);
      }
    }
  };

  // Watches `folder`, then the folders in it.
  const add = (folder) => {
    if (stopped || watchers.has(folder) || left(folder)) {
      return;
    }
    let watcher;
    try {
      watcher = watch(folder, (event, name) => changed(folder, name));
    } catch (err) {
      if (folder === root || !notThere.has(err.code)) {
        fail(err);
      }
      return;
    }
    // An error is about this folder only, like it being deleted on Windows.
    watcher.on("error", () => forget(folder));
    watchers.set(folder, watcher);
    let entries = [];
    try {
      entries = readdirSync(folder, { withFileTypes: true });
    } catch {
      // Locked, or gone: what's in it isn't watched.
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        add(join(folder, entry.name));
      }
    }
  };

  // Something about the entry `name` in `folder` changed. On Linux, a change
  // to the folder itself is reported under the folder's own name; the path is
  // then one in the folder that isn't there, which is still the right folder
  // for onChange.
  const changed = (folder, name) => {
    if (stopped) {
      return;
    }
    const path = name ? join(folder, String(name)) : folder;
    onChange(relativePath(path));
    if (!name || stopped) {
      return;
    }
    let stats;
    try {
      stats = lstatSync(path);
    } catch (err) {
      if (err.code === "ENOENT" || err.code === "ENOTDIR") {
        forget(path);
      }
      // Otherwise it can't be looked at, as in a locked folder: it stays as
      // it was.
      return;
    }
    if (stats.isDirectory()) {
      add(path);
    } else {
      forget(path);
    }
  };

  add(root);
  return {
    folders: () => [...watchers.keys()].map(relativePath).sort(),
    close: stop,
  };
}

// What a change to `path` (relative to the watched folder, with "/", or ""
// when it isn't known) means for watchTree(): null when it's ignored, or else
// { files } saying whether it's under `filesIn`. Every change that isn't
// ignored may change the git status.
export function changeOf(path, filesIn = "") {
  if (/(^|\/)node_modules(\/|$)/.test(path)) {
    return null;
  }
  if (path === ".git" || path.startsWith(".git/")) {
    return /^\.git\/objects\/|\.lock$/.test(path) ? null : { files: false };
  }
  return { files: path === "" || path.startsWith(filesIn) || `${path}/` === filesIn };
}
