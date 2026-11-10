import { relative, sep } from "node:path";
import { skipFolders } from "../lib/files.js";
import { formatSize } from "../lib/format.js";
import { fsErrorReason, walk } from "../lib/walk.js";
import { createList } from "./list.js";
import { printable, spread, width } from "./screen.js";

// The Files panel of toolsmith ui: the folder tree under `root`, read with the
// M2 directory walker and the same folders left out as the file tools (.git
// and node_modules). Symlinks are shown but never followed.
//
// Nothing here waits for the file system in a way that holds up key presses:
// a folder's entries are read when it's opened, and appear as they come; the
// folders' sizes are worked out in the background, in one pass over the whole
// tree, and each folder shows "…" until its own is known. When files change,
// reload() reads the open folders again, in the background too.

// `onChange` is called when there's something new to show; `onWarning` with a
// message for each entry that couldn't be read. Messages name entries the way
// the panel does, by their path from `root`, so that the reason still fits on
// a line when `root` itself is deep down.
export function createTree(root, { onChange = () => {}, onWarning = () => {}, ignore = skipFolders } = {}) {
  const top = { name: "", relativePath: "", path: root, type: "directory", depth: -1, open: true, children: null };
  // Folder sizes: relative path → bytes, once they're known.
  const sizes = new Map();
  let stopped = false;

  // For walk()'s onWarning: an entry it skipped, named from `root`.
  const skipped = (message, err) =>
    onWarning(err?.path ? `skipped ${relative(root, err.path).split(sep).join("/")} (${fsErrorReason(err)})` : message);

  // Each row: the entry's name, indented by its depth, with "+" for a closed
  // folder and "-" for an open one, and its size at the right where there's
  // room. Files line up with folders' names, except in a narrow panel. Filters
  // look in the name only.
  const label = (node, room) => {
    if (room === undefined) {
      return node.name;
    }
    const marker = node.type === "directory" ? (node.open ? "- " : "+ ") : room < 16 ? "" : "  ";
    const name = `${"  ".repeat(node.depth)}${marker}${printable(node.name)}${node.type === "directory" ? "/" : node.type === "symlink" ? "@" : ""}`;
    const size = sizeText(node);
    return width(name) + 1 + width(size) <= room ? spread(name, size, room) : name;
  };
  const list = createList([], {
    label,
    empty: () => (top.loading || top.children === null ? "Reading the folder…" : top.error ? "This folder can't be read" : "Empty folder"),
  });
  function sizeText(node) {
    if (node.error) {
      return "can't read";
    }
    if (node.type === "file") {
      return formatSize(node.size);
    }
    if (node.type === "directory") {
      return sizes.has(node.relativePath) ? formatSize(sizes.get(node.relativePath)) : "…";
    }
    return node.type === "symlink" ? "link" : "";
  }

  // The rows shown: every entry whose folders are all open, in tree order.
  function refresh() {
    const rows = [];
    const add = (node) => {
      for (const child of node.children ?? []) {
        rows.push(child);
        if (child.open) {
          add(child);
        }
      }
    };
    add(top);
    list.setItems(rows);
    onChange();
  }

  // The node for `entry`, from reading `folder`. Files have a `fileId`.
  const nodeFor = (folder, entry) => ({
    name: entry.relativePath,
    relativePath: folder.relativePath ? `${folder.relativePath}/${entry.relativePath}` : entry.relativePath,
    path: entry.path,
    type: entry.type,
    size: entry.size,
    fileId: entry.fileId,
    depth: folder.depth + 1,
    open: false,
    children: null,
    parent: folder,
  });

  // Reads one folder's entries, adding them as they come.
  async function load(folder) {
    folder.children = [];
    folder.loading = true;
    refresh();
    try {
      let count = 0;
      for await (const entry of walk(folder.path, { recursive: false, ignore, onWarning: skipped })) {
        if (stopped) {
          return;
        }
        folder.children.push(nodeFor(folder, entry));
        // Show what's there so far, now and then, in a big folder.
        if (++count % 200 === 0) {
          refresh();
        }
      }
    } catch (err) {
      folder.error = err.message;
      const reason = fsErrorReason(err.cause ?? err);
      onWarning(folder === top ? `can't read this folder (${reason})` : `can't read folder ${folder.relativePath} (${reason})`);
    } finally {
      folder.loading = false;
      refresh();
    }
  }

  // Reads a folder that was read before again, and merges what's there now
  // into its entries: an entry that's still there keeps its node, so an open
  // folder stays open, with its own entries; a renamed file keeps its node too
  // (found by its file ID; a renamed folder comes back closed); new entries are
  // added, and those that are gone are dropped. When a folder is read twice at
  // once, only the later read counts. Returns whether anything changed.
  // Entries that can't be read were reported when the folder was first read,
  // so they aren't reported again on every change. An entry that's gone by
  // the time it's looked at means the folder changed while it was read, as
  // when a file is renamed then, so it's read again (a few times at most):
  // otherwise the renamed file would be missing from this read, and lose its
  // node.
  async function reread(folder) {
    const read = {};
    folder.reading = read;
    let entries;
    for (let attempt = 1; ; attempt++) {
      let vanished = false;
      entries = [];
      try {
        const onWarning = (message, err) => {
          vanished ||= err?.code === "ENOENT";
        };
        for await (const entry of walk(folder.path, { recursive: false, ignore, onWarning })) {
          entries.push(entry);
        }
      } catch {
        // It's gone, so the folder it was in drops it, or it can't be read
        // just now; either way, what it showed stays until it's read again.
        return false;
      }
      if (!vanished || attempt === 3 || stopped || folder.reading !== read) {
        break;
      }
    }
    if (stopped || folder.reading !== read) {
      return false;
    }
    const before = folder.children;
    const byName = new Map(before.map((node) => [node.name, node]));
    const sameName = entries.map((entry) => (byName.get(entry.relativePath)?.type === entry.type ? byName.get(entry.relativePath) : undefined));
    const kept = new Set(sameName.filter(Boolean));
    const renamed = new Map(before.filter((node) => !kept.has(node) && node.fileId).map((node) => [node.fileId, node]));
    let changed = entries.length !== before.length;
    folder.children = entries.map((entry, index) => {
      let node = sameName[index];
      if (!node && renamed.get(entry.fileId)?.type === entry.type) {
        node = renamed.get(entry.fileId);
        renamed.delete(entry.fileId);
      }
      if (!node) {
        changed = true;
        return nodeFor(folder, entry);
      }
      changed ||= node !== before[index] || node.name !== entry.relativePath || node.size !== entry.size;
      return Object.assign(node, nodeFor(folder, entry), { open: node.open, children: node.children });
    });
    return changed;
  }

  // Reads again every folder that's shown under `from`: `from`, and each open
  // folder in it whose folders are all open, one at a time, showing each one's
  // changes as soon as it's read. Folders read before that aren't shown now
  // are only marked, and read again when they're opened.
  async function reloadFrom(from) {
    const shown = [];
    const visit = (folder, isShown) => {
      if (folder.children === null || folder.loading) {
        return;
      }
      if (isShown) {
        shown.push(folder);
      } else {
        folder.stale = true;
      }
      for (const child of folder.children) {
        if (child.type === "directory") {
          visit(child, isShown && child.open);
        }
      }
    };
    visit(from, true);
    for (const folder of shown) {
      if (stopped) {
        return;
      }
      folder.stale = false;
      if (await reread(folder)) {
        refresh();
      }
    }
  }

  // Only one reload runs at a time; one asked for meanwhile runs once more,
  // right after it.
  let reloading = null;
  let again = false;
  function reload() {
    if (reloading) {
      again = true;
      return reloading;
    }
    reloading = (async () => {
      do {
        again = false;
        await reloadFrom(top);
      } while (again && !stopped);
    })().finally(() => {
      reloading = null;
    });
    return reloading;
  }

  // Adds up every folder's size in one walk, as the size command does: files
  // only, hard links once. The walk goes depth first, in order, so a folder's
  // size is final as soon as an entry outside it comes up. Sizes from an
  // earlier walk stay until the new ones replace them, and a newer walk stops
  // an older one. Only the first walk reports what it can't read, as reread()
  // does: the walks after files changed would say it again on every change,
  // anywhere, over whatever the dashboard last said. A folder that can't be
  // read any more is still reported when it's opened, by load().
  let measuring = 0;
  async function measure() {
    const generation = ++measuring;
    const report = generation === 1 ? skipped : () => {};
    const counted = new Set();
    const open = []; // the folders the walk is in, outermost first: [path, size]
    const close = (until) => {
      while (open.length > until) {
        const [path, size] = open.pop();
        sizes.set(path, size);
        if (open.length > 0) {
          open[open.length - 1][1] += size;
        }
      }
      onChange();
    };
    open.push(["", 0]);
    try {
      for await (const entry of walk(root, { ignore, onWarning: report })) {
        if (stopped || generation !== measuring) {
          return;
        }
        const parents = entry.relativePath.split("/").length - 1;
        if (open.length - 1 > parents) {
          close(parents + 1);
        }
        if (entry.type === "directory") {
          open.push([entry.relativePath, 0]);
        } else if (entry.type === "file" && !(entry.links > 1 && counted.has(entry.fileId))) {
          counted.add(entry.fileId);
          open[open.length - 1][1] += entry.size;
        }
      }
      close(0);
    } catch {
      // `root` itself can't be read; load() says so.
    }
  }

  load(top);
  measure();

  return {
    list,
    root,
    // The total size of everything shown, once it's known.
    totalSize: () => sizes.get(""),
    // Opens a closed folder (reading it the first time, or again when files
    // changed while it was closed), closes an open one.
    toggle(node) {
      if (node?.type !== "directory") {
        return;
      }
      node.open = !node.open;
      if (node.open && node.children === null) {
        load(node);
        return;
      }
      refresh();
      if (node.open && node.stale) {
        reloadFrom(node);
      }
    },
    // The folder an entry is in, or undefined at the top.
    parentOf(node) {
      return node?.parent === top ? undefined : node?.parent;
    },
    select(node) {
      list.first();
      while (list.selected() !== node && !list.isAtEnd()) {
        list.move(1);
      }
    },
    // After files changed: reads the open folders again, keeping which are
    // open, the selection and the scroll position; resolves when it's done.
    reload,
    // Adds up the folders' sizes again, after files changed.
    remeasure: () => measure(),
    // Reads a file's size again, after it was edited.
    update(node, size) {
      node.size = size;
      onChange();
    },
    stop() {
      stopped = true;
    },
  };
}
