import { skipFolders } from "../lib/files.js";
import { formatSize } from "../lib/format.js";
import { walk } from "../lib/walk.js";
import { createList } from "./list.js";
import { printable, spread, width } from "./screen.js";

// The Files panel of toolsmith ui: the folder tree under `root`, read with the
// M2 directory walker and the same folders left out as the file tools (.git
// and node_modules). Symlinks are shown but never followed.
//
// Nothing here waits for the file system in a way that holds up key presses:
// a folder's entries are read when it's opened, and appear as they come; the
// folders' sizes are worked out in the background, in one pass over the whole
// tree, and each folder shows "…" until its own is known.

// `onChange` is called when there's something new to show; `onWarning` with a
// message for each entry that couldn't be read.
export function createTree(root, { onChange = () => {}, onWarning = () => {}, ignore = skipFolders } = {}) {
  const top = { name: "", relativePath: "", path: root, type: "directory", depth: -1, open: true, children: null };
  // Folder sizes: relative path → bytes, once they're known.
  const sizes = new Map();
  let stopped = false;

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

  // Reads one folder's entries, adding them as they come.
  async function load(folder) {
    folder.children = [];
    folder.loading = true;
    refresh();
    try {
      let count = 0;
      for await (const entry of walk(folder.path, { recursive: false, ignore, onWarning })) {
        if (stopped) {
          return;
        }
        folder.children.push({
          name: entry.relativePath,
          relativePath: folder.relativePath ? `${folder.relativePath}/${entry.relativePath}` : entry.relativePath,
          path: entry.path,
          type: entry.type,
          size: entry.size,
          depth: folder.depth + 1,
          open: false,
          children: null,
          parent: folder,
        });
        // Show what's there so far, now and then, in a big folder.
        if (++count % 200 === 0) {
          refresh();
        }
      }
    } catch (err) {
      folder.error = err.message;
      onWarning(err.message);
    } finally {
      folder.loading = false;
      refresh();
    }
  }

  // Adds up every folder's size in one walk, as the size command does: files
  // only, hard links once. The walk goes depth first, in order, so a folder's
  // size is final as soon as an entry outside it comes up. Sizes from an
  // earlier walk stay until the new ones replace them, and a newer walk stops
  // an older one.
  let measuring = 0;
  async function measure() {
    const generation = ++measuring;
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
      for await (const entry of walk(root, { ignore, onWarning })) {
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
    } catch (err) {
      onWarning(err.message);
    }
  }

  load(top);
  measure();

  return {
    list,
    root,
    // The total size of everything shown, once it's known.
    totalSize: () => sizes.get(""),
    // Opens a closed folder (reading it the first time), closes an open one.
    toggle(node) {
      if (node?.type !== "directory") {
        return;
      }
      node.open = !node.open;
      if (node.open && node.children === null) {
        load(node);
      } else {
        refresh();
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
