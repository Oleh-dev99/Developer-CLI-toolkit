import { watch } from "node:fs";

// Watching the folder tree for toolsmith ui, so that the Files panel's sizes
// and the Git status panel keep up with changes made outside it.

// Watches everything under `root` with one recursive fs.watch, and calls
// `onChange({ files, git })` once for each burst of changes: `files` when
// something under `filesIn` changed (a folder in `root`, as a relative path
// ending in "/", or "" for all of it), `git` when the git status may have
// changed (anything outside .git, or in it). A burst ends after `quiet`
// milliseconds without changes, or `longest` milliseconds after it began,
// whichever comes first. Changes in node_modules, in .git/objects (which a
// commit also shows elsewhere) and to git's lock files are ignored. On Linux,
// Node watches every folder for this, node_modules too, and only the changes
// there are ignored. Errors, like running out of watches, go to `onError`;
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
  const note = (files) => {
    pending.git = true;
    pending.files ||= files;
    const now = Date.now();
    if (timer === null) {
      started = now;
    }
    clearTimeout(timer);
    timer = setTimeout(flush, now - started >= longest ? 0 : quiet);
  };

  let watcher = null;
  try {
    watcher = watch(root, { recursive: true }, (event, name) => {
      // Some systems don't say what changed; then anything may have.
      const change = changeOf(name ? String(name).replaceAll("\\", "/") : "", filesIn);
      if (change) {
        note(change.files);
      }
    });
    watcher.on("error", (err) => {
      onError(err);
      watcher.close();
    });
  } catch (err) {
    onError(err);
  }
  return {
    close() {
      clearTimeout(timer);
      watcher?.close();
    },
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
