import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { InvalidArgumentError } from "commander";
import { displayPath, findFiles } from "../lib/files.js";
import { count, formatSize, parseSize } from "../lib/format.js";
import { fsErrorReason } from "../lib/walk.js";
import { info, warn } from "../output.js";

export function register(program) {
  program
    .command("dupes")
    .description("find files with identical content (report only, nothing is deleted)")
    .argument("[paths...]", "files, folders or quoted glob patterns like '*.jpg' (default: the current folder)")
    .option("--min-size <size>", "ignore files smaller than this, like 10KB or 5MB", sizeOption, 0)
    .option("--json", "print the result as JSON")
    .addHelpText(
      "after",
      `
Examples:
  Find duplicates in this folder and all its subfolders:
  $ toolsmith dupes

  Only files of at least 100 KB, in two folders:
  $ toolsmith dupes --min-size 100KB Pictures Downloads

  Only .jpg files (in subfolders too), as JSON for a script:
  $ toolsmith dupes '*.jpg' --json

Files are compared by content (SHA-256), not by name. Empty files, .git and
node_modules are skipped. Sizes use 1 KB = 1024 bytes. Nothing is deleted.`,
    )
    .action(async (paths, options) => {
      const files = (await findFiles(paths.length > 0 ? paths : ["."], { recursive: true })).filter(
        ({ size }) => size > 0 && size >= options.minSize,
      );
      const groups = await findDuplicates(files);
      const summary = {
        checkedFiles: files.length,
        groups: groups.length,
        duplicateFiles: groups.reduce((sum, group) => sum + group.files.length - 1, 0),
        wasted: groups.reduce((sum, group) => sum + group.wasted, 0),
      };

      if (options.json) {
        const shown = groups.map((group) => ({ ...group, files: group.files.map(displayPath) }));
        console.log(JSON.stringify({ groups: shown, summary }, null, 2));
        return;
      }
      if (groups.length === 0) {
        info(`No duplicate files found among ${count(files.length, "file")}.`);
        return;
      }
      for (const { size, wasted, files: copies } of groups) {
        console.log(`${count(copies.length, "identical file")}, ${formatSize(size)} each (${formatSize(wasted)} wasted):`);
        for (const path of copies) {
          console.log(`  ${displayPath(path)}`);
        }
        console.log("");
      }
      info(
        `Found ${count(summary.groups, "group")} of identical files: ` +
          `${count(summary.duplicateFiles, "duplicate")}, ${formatSize(summary.wasted)} wasted.`,
      );
    });
}

function sizeOption(text) {
  const bytes = parseSize(text);
  if (bytes === null) {
    throw new InvalidArgumentError("Use a number with an optional unit, like 500KB or 5MB.");
  }
  return bytes;
}

// Only files of the same size can be identical, so only those get hashed.
// Returns { size, sha256, wasted, files } groups, most wasted space first.
async function findDuplicates(files) {
  const groups = [];
  for (const sameSize of Map.groupBy(files, ({ size }) => size).values()) {
    if (sameSize.length < 2) {
      continue;
    }
    const hashed = [];
    for (const { path } of sameSize) {
      try {
        hashed.push({ path, hash: await sha256(path) });
      } catch (err) {
        warn(`skipped ${displayPath(path)} (${fsErrorReason(err)})`);
      }
    }
    for (const [hash, copies] of Map.groupBy(hashed, ({ hash }) => hash)) {
      if (copies.length > 1) {
        const size = sameSize[0].size;
        const paths = copies.map(({ path }) => path);
        groups.push({ size, sha256: hash, wasted: size * (paths.length - 1), files: paths });
      }
    }
  }
  return groups.sort((a, b) => b.wasted - a.wasted || b.size - a.size || (a.files[0] < b.files[0] ? -1 : 1));
}

// Reads the file in chunks, so even a huge file never has to fit in memory.
async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}
