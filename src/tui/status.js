import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { git } from "../lib/git.js";
import { createList } from "./list.js";
import { printable } from "./screen.js";

// The Git status panel of toolsmith ui: the branch, how far it is ahead of and
// behind its upstream, and the staged, unstaged, conflicted and untracked
// files, from `git status --porcelain=v2 --branch -z`.

// What a status letter means.
const kinds = { M: "modified", T: "type changed", A: "added", D: "deleted", R: "renamed", C: "copied" };
const conflicts = {
  UU: "both modified",
  AA: "both added",
  DD: "both deleted",
  AU: "added by us",
  UA: "added by them",
  DU: "deleted by us",
  UD: "deleted by them",
};

// Reads the output of `git status --porcelain=v2 --branch -z`. With -z,
// entries end in NUL and paths aren't quoted, so spaces, wide characters and
// even newlines in names come through as they are. Returns { branch, detached,
// initial, commit, upstream, ahead, behind, staged, unstaged, conflicts,
// untracked }: branch is null when HEAD is detached; ahead and behind are null
// without an upstream, or when it's gone; each file is { path, code, kind },
// and a renamed or copied one also has `from`.
export function parseStatus(output) {
  const status = { branch: null, detached: false, initial: false, commit: null, upstream: null, ahead: null, behind: null, staged: [], unstaged: [], conflicts: [], untracked: [] };
  const entries = output.split("\0");
  const add = (staged, unstaged, file) => {
    if (staged !== ".") {
      status.staged.push({ ...file, code: staged, kind: kinds[staged] ?? staged });
    }
    if (unstaged !== ".") {
      status.unstaged.push({ ...file, code: unstaged, kind: kinds[unstaged] ?? unstaged });
    }
  };
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    let match;
    if ((match = /^# (\S+) (.*)$/s.exec(entry))) {
      const [, key, value] = match;
      if (key === "branch.oid") {
        status.initial = value === "(initial)";
        status.commit = status.initial ? null : value;
      } else if (key === "branch.head") {
        status.detached = value === "(detached)";
        status.branch = status.detached ? null : value;
      } else if (key === "branch.upstream") {
        status.upstream = value;
      } else if (key === "branch.ab") {
        const [, ahead, behind] = /^\+(\d+) -(\d+)$/.exec(value) ?? [];
        status.ahead = Number(ahead);
        status.behind = Number(behind);
      }
    } else if ((match = /^1 (\S)(\S) (?:\S+ ){6}(.*)$/s.exec(entry))) {
      add(match[1], match[2], { path: match[3] });
    } else if ((match = /^2 (\S)(\S) (?:\S+ ){6}[RC]\d+ (.*)$/s.exec(entry))) {
      // The original path is the next entry.
      add(match[1], match[2], { path: match[3], from: entries[++index] });
    } else if ((match = /^u (\S\S) (?:\S+ ){8}(.*)$/s.exec(entry))) {
      status.conflicts.push({ path: match[2], code: match[1], kind: conflicts[match[1]] ?? "conflict" });
    } else if (entry.startsWith("? ")) {
      status.untracked.push({ path: entry.slice(2), code: "?", kind: "untracked" });
    }
  }
  return status;
}

// The panel's rows: the branch, ahead and behind, then a section for each kind
// of change. Rows for files have `path` (from the repository's top).
export function statusRows(status) {
  const rows = [];
  if (status.detached) {
    rows.push({ text: `HEAD detached at ${status.commit?.slice(0, 7) ?? "?"}` });
  } else {
    rows.push({ text: status.initial ? `${status.branch} (no commits yet)` : status.upstream ? `${status.branch} → ${status.upstream}` : status.branch });
  }
  if (status.upstream && status.ahead === null) {
    rows.push({ text: "its upstream is gone" });
  } else if (status.upstream) {
    rows.push({ text: status.ahead || status.behind ? `${status.ahead} ahead, ${status.behind} behind` : "up to date" });
  } else if (!status.detached) {
    rows.push({ text: "no upstream" });
  }
  const sections = [
    ["Conflicts", status.conflicts],
    ["Staged", status.staged],
    ["Not staged", status.unstaged],
    ["Untracked", status.untracked],
  ];
  for (const [title, files] of sections.filter(([, files]) => files.length > 0)) {
    rows.push({ text: "" }, { text: `${title} (${files.length})` });
    for (const file of files) {
      const name = printable(file.from ? `${file.from} → ${file.path}` : file.path);
      rows.push({ text: `${file.code.padEnd(2)} ${name}`, path: file.path });
    }
  }
  if (sections.every(([, files]) => files.length === 0)) {
    rows.push({ text: "" }, { text: "Nothing to commit" });
  }
  return rows;
}

// The repository `folder` is in: the nearest folder, `folder` or one above it,
// with a .git folder (or file, in a worktree), or null. No git is run for
// this, so a folder that isn't in a repository costs nothing.
export function findRepository(folder) {
  for (let current = resolve(folder); ; current = dirname(current)) {
    if (existsSync(join(current, ".git"))) {
      return current;
    }
    if (dirname(current) === current) {
      return null;
    }
  }
}

// The panel's state: its list, whether the folder is in a git repository with
// git installed (`available`: null until the first status is read), and the
// repository's top folder. refresh() reads the status again; it never runs
// two git commands at once: one asked for while another runs happens once,
// right after it. `run` runs git (src/lib/git.js), and `onChange` is called
// when there's something new to show. Once stop() is called, nothing more is
// read; settled() resolves when no git command is running any more.
export function createGitStatus({ cwd, env, run = git, onChange = () => {}, onWarning = () => {} }) {
  // Each refresh makes new rows; the selection stays on the row with the same
  // text.
  const list = createList([], { label: (row) => row.text, key: (row) => row.text, empty: "Reading git status…" });
  const panel = { list, available: findRepository(cwd) ? null : false, top: null, status: null };
  let reading = null; // the refresh that's running, as a promise
  let again = false;
  let stopped = false;
  panel.stop = () => {
    stopped = true;
  };
  panel.settled = () => reading ?? Promise.resolve();

  panel.refresh = () => {
    if (panel.available === false || stopped) {
      return Promise.resolve();
    }
    if (reading) {
      again = true;
      return reading;
    }
    reading = read().finally(() => {
      reading = null;
      onChange();
    });
    return reading;
  };

  async function read() {
    try {
      do {
        again = false;
        panel.top ??= resolve(await run(["rev-parse", "--show-toplevel"], { cwd, env }));
        // --no-optional-locks: status doesn't write the index, so reading it
        // doesn't look like a change to the watcher.
        panel.status = parseStatus(await run(["--no-optional-locks", "status", "--porcelain=v2", "--branch", "-z"], { cwd, env }));
        panel.available = true;
        list.setItems(statusRows(panel.status));
      } while (again && !stopped);
    } catch (err) {
      if (/not a git repository|isn't installed/i.test(`${err.message} ${err.stderr ?? ""}`)) {
        panel.available = false;
      } else {
        onWarning(err.message);
      }
    }
  }
  return panel;
}
