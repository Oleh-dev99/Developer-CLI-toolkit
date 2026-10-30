import { resolve } from "node:path";
import { clearLine, cursorTo } from "node:readline";
import { InvalidArgumentError, Option } from "commander";
import { skipFolders } from "../lib/files.js";
import { count, formatSize } from "../lib/format.js";
import { walk } from "../lib/walk.js";
import { info } from "../output.js";

export function register(program) {
  program
    .command("size")
    .description("show the biggest folders and files under a folder")
    .argument("[path]", "the folder to measure (default: the current folder)")
    .option("--depth <n>", 'how many folder levels to show, or "all"', depthOption, 1)
    .option("--top <n>", "how many entries to show", positiveInteger, 10)
    .addOption(new Option("--files-only", "show only files").conflicts("foldersOnly"))
    .addOption(new Option("--folders-only", "show only folders"))
    .option("--all", "include .git and node_modules")
    .option("--json", "print the result as JSON")
    .addHelpText(
      "after",
      `
Examples:
  The 10 biggest files and folders right here:
  $ toolsmith size

  Two levels deep in Downloads, the top 20:
  $ toolsmith size Downloads --depth 2 --top 20

  The biggest files anywhere below this folder:
  $ toolsmith size --files-only --depth all

Folder sizes include everything inside them, and percentages are shares of the
total. Hard-linked files count once. .git and node_modules are skipped unless
you add --all. Sizes use 1 KB = 1024 bytes.`,
    )
    .action(async (path = ".", options) => {
      const { total, files, entries } = await measure(path, options);
      const shown = entries
        .filter(({ type }) => (options.filesOnly ? type === "file" : options.foldersOnly ? type === "directory" : true))
        .sort((a, b) => b.size - a.size || (a.path < b.path ? -1 : 1));
      const top = shown.slice(0, options.top);

      if (options.json) {
        const items = top.map((entry) => ({ ...entry, percent: percentOf(entry.size, total) }));
        console.log(JSON.stringify({ root: resolve(path), total, files, items }, null, 2));
        return;
      }

      const sizes = top.map(({ size }) => formatSize(size));
      const width = sizes.reduce((max, size) => Math.max(max, size.length), 0);
      for (const [i, entry] of top.entries()) {
        const name = entry.type === "directory" ? `${entry.path}/` : entry.path;
        console.log(`${sizes[i].padStart(width)}  ${percentText(entry.size, total).padStart(4)}  ${name}`);
      }
      const hidden = shown.length - top.length;
      info(
        `Total: ${formatSize(total)} in ${count(files, "file")}.` +
          (hidden > 0 ? ` Showing the ${top.length} largest of ${shown.length} items.` : ""),
      );
    });
}

// Walks the whole tree once. Every file's size is added to all the folders it
// is in, so folder sizes include everything inside them. Returns the total and
// the files and folders down to `options.depth`.
async function measure(path, options) {
  const folderSizes = new Map();
  const entries = [];
  const counted = new Set();
  const progress = progressLine();
  let total = 0;
  let files = 0;

  try {
    for await (const entry of walk(path, { ignore: options.all ? [] : skipFolders })) {
      const depth = entry.relativePath.split("/").length;
      if (entry.type === "directory") {
        folderSizes.set(entry.relativePath, 0);
        if (depth <= options.depth) {
          entries.push({ path: entry.relativePath, type: "directory" });
        }
        continue;
      }
      // Hard links share their data, so it's counted the first time only.
      if (entry.type !== "file" || (entry.links > 1 && counted.has(entry.fileId))) {
        continue;
      }
      counted.add(entry.fileId);
      total += entry.size;
      files++;
      for (let i = entry.relativePath.indexOf("/"); i !== -1; i = entry.relativePath.indexOf("/", i + 1)) {
        const folder = entry.relativePath.slice(0, i);
        folderSizes.set(folder, folderSizes.get(folder) + entry.size);
      }
      if (depth <= options.depth) {
        entries.push({ path: entry.relativePath, type: "file", size: entry.size });
      }
      progress.update(files, total);
    }
  } finally {
    progress.done();
  }

  for (const entry of entries) {
    entry.size ??= folderSizes.get(entry.path);
  }
  return { total, files, entries };
}

function percentOf(size, total) {
  return total === 0 ? 0 : Math.round((size / total) * 1000) / 10;
}

function percentText(size, total) {
  const percent = total === 0 ? 0 : (size / total) * 100;
  return size > 0 && percent < 0.5 ? "<1%" : `${Math.round(percent)}%`;
}

// A "Scanning…" line on stderr while a scan takes a while, only when stderr is
// a terminal. done() clears it so it doesn't end up in front of the report.
function progressLine() {
  const stream = process.stderr;
  const start = Date.now();
  let lastUpdate = 0;
  let shown = false;
  return {
    update(files, bytes) {
      const now = Date.now();
      if (!stream.isTTY || now - start < 300 || now - lastUpdate < 100) {
        return;
      }
      lastUpdate = now;
      shown = true;
      cursorTo(stream, 0);
      stream.write(`Scanning… ${count(files, "file")}, ${formatSize(bytes)}`);
      clearLine(stream, 1);
    },
    done() {
      if (shown) {
        cursorTo(stream, 0);
        clearLine(stream, 0);
      }
    },
  };
}

function positiveInteger(text) {
  const number = Number(text);
  if (!Number.isInteger(number) || number < 1) {
    throw new InvalidArgumentError("Use a whole number of 1 or more.");
  }
  return number;
}

function depthOption(text) {
  return text === "all" ? Infinity : positiveInteger(text);
}
