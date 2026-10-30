import { randomUUID } from "node:crypto";
import { lstat, readdir, rename } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import picomatch from "picomatch";
import { walk } from "../lib/walk.js";
import { info, success, warn } from "../output.js";

const skipFolders = [".git", "node_modules"];

export function register(program) {
  program
    .command("rename")
    .description("find and replace text in file names")
    .argument("<find>", "text to find (a regular expression with --regex)")
    .argument("<replace>", "replacement text; with --regex, $1, $2, … insert captured groups")
    .argument("[paths...]", "files, folders or quoted glob patterns like '*.jpg' (default: the current folder)")
    .option("-r, --recursive", "include files in subfolders", false)
    .option("--regex", "treat <find> as a regular expression")
    .option("--dry-run", "show what would be renamed, without renaming anything")
    .addHelpText(
      "after",
      `
Examples:
  Preview replacing "IMG_" with "photo_" in this folder:
  $ toolsmith rename IMG_ photo_ --dry-run

  Only .png files, in photos/ and all its subfolders:
  $ toolsmith rename IMG_ photo_ 'photos/**/*.png'

  Turn "IMG_20240501_beach.jpg" into "2024-05-01 beach.jpg", in subfolders too:
  $ toolsmith rename --regex 'IMG_(\\d{4})(\\d{2})(\\d{2})_' '$1-$2-$3 ' -r

Quote glob patterns ('*.jpg') so toolsmith expands them itself, the same way on
every system. With -r, a pattern without "/" also matches in subfolders.

Only file names change, never folder names, and every match in a name is
replaced. Case-only renames (readme.md → README.md) work everywhere. .git and
node_modules are skipped. Nothing is renamed if any new name would clash with
another file. In bash, zsh and PowerShell, put $1 in single quotes so the shell
leaves it alone.`,
    )
    .action(async (find, replace, paths, options) => {
      const newNameFor = nameReplacer(find, replace, options.regex);
      const files = await findFiles(paths.length > 0 ? paths : ["."], options.recursive);

      // Plan every rename before touching anything.
      const ignoresCase = folderCaseChecker();
      const plan = [];
      for (const from of files) {
        const name = basename(from);
        const newName = newNameFor(name);
        if (newName !== name) {
          const caseInsensitive = await ignoresCase(dirname(from), name);
          const caseOnly = caseInsensitive && newName.toLowerCase() === name.toLowerCase();
          plan.push({ from, to: join(dirname(from), newName), newName, caseInsensitive, caseOnly });
        }
      }
      if (plan.length === 0) {
        info(options.regex ? `No file names match /${find}/.` : `No file names contain "${find}".`);
        return;
      }

      const conflicts = await findConflicts(plan);
      if (conflicts.length > 0) {
        const lines = conflicts.map((conflict) => `  ${conflict}`).join("\n");
        throw new Error(`${count(conflicts.length, "conflict")}, nothing was renamed:\n${lines}`);
      }

      printTable(plan);
      if (options.dryRun) {
        info(`Dry run: ${count(plan.length, "file")} would be renamed. Nothing was changed.`);
        return;
      }
      for (const [done, { from, to, caseOnly }] of plan.entries()) {
        try {
          await (caseOnly ? renameViaTemp(from, to) : rename(from, to));
        } catch (err) {
          throw new Error(
            `couldn't rename ${show(from)} (${err.message}); ${done} of ${plan.length} were renamed before that`,
          );
        }
      }
      success(`Renamed ${count(plan.length, "file")}.`);
    });
}

function nameReplacer(find, replace, regex) {
  if (find === "") {
    throw new Error("<find> can't be empty");
  }
  if (regex) {
    const pattern = new RegExp(find, "g");
    return (name) => name.replace(pattern, replace);
  }
  // A function as the replacement keeps "$" in plain text literal.
  return (name) => name.replaceAll(find, () => replace);
}

// Each path is a file, a folder, or a glob pattern. A path that exists is used
// as it is, even if it looks like a pattern (such as "photo[1].jpg").
async function findFiles(paths, recursive) {
  const files = new Set();
  for (const path of paths) {
    const stats = await lstat(path).catch(() => null);
    if (stats?.isFile()) {
      files.add(resolve(path));
    } else if (stats?.isDirectory()) {
      for await (const entry of walk(path, { recursive, ignore: skipFolders })) {
        if (entry.type === "file") {
          files.add(entry.path);
        }
      }
    } else if (!stats && picomatch.scan(path).isGlob) {
      const matches = await expandGlob(path, recursive);
      if (matches.length === 0) {
        warn(`no files match ${path}`);
      }
      for (const match of matches) {
        files.add(match);
      }
    } else if (!stats) {
      throw new Error(`${path} not found`);
    }
  }
  return [...files];
}

// Expands a pattern like "*.jpg" or "photos/**/*.png" from the current folder.
// Shells on Windows don't do this, so toolsmith does it the same way everywhere.
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
        matches.push(entry.path);
      }
    }
  } catch {
    // The folder in front of the pattern doesn't exist, so nothing matches.
  }
  return matches;
}

// Returns a function that tells, per folder, whether the file system there
// ignores case. It checks the folder itself: on a case-insensitive file system
// a file is still found with its name's case swapped, though the folder doesn't
// list that name.
function folderCaseChecker() {
  const results = new Map();
  return (folder, sampleName) => {
    if (!results.has(folder)) {
      results.set(folder, ignoresCase(folder, sampleName));
    }
    return results.get(folder);
  };
}

async function ignoresCase(folder, sampleName) {
  const swapped = [...sampleName]
    .map((char) => (char === char.toUpperCase() ? char.toLowerCase() : char.toUpperCase()))
    .join("");
  if (swapped === sampleName) {
    // No letters to test with, so assume what the system usually does.
    return process.platform === "win32" || process.platform === "darwin";
  }
  if ((await readdir(folder)).includes(swapped)) {
    return false;
  }
  return exists(join(folder, swapped));
}

async function findConflicts(plan) {
  const byTarget = Map.groupBy(plan, ({ to, caseInsensitive }) => (caseInsensitive ? to.toLowerCase() : to));
  const conflicts = [];
  for (const group of byTarget.values()) {
    const { to, newName, caseOnly } = group[0];
    const from = group.map((step) => show(step.from)).join(", ");
    if (!isValidName(newName)) {
      conflicts.push(`${from} → "${newName}": not a valid file name`);
    } else if (group.length > 1) {
      conflicts.push(`${from} → ${show(to)}: would get the same name`);
    } else if (!caseOnly && (await exists(to))) {
      // After a case-only change the "existing" target is the file itself.
      conflicts.push(`${from} → ${show(to)}: ${show(to)} already exists`);
    }
  }
  return conflicts;
}

// A case-insensitive file system may ignore a rename that only changes case,
// so go through a temporary name, and put the old name back if that fails.
async function renameViaTemp(from, to) {
  const temp = join(dirname(from), `.toolsmith-rename-${randomUUID()}`);
  await rename(from, temp);
  try {
    await rename(temp, to);
  } catch (err) {
    try {
      await rename(temp, from);
    } catch {
      throw new Error(`${err.message}; the file is now named ${temp}`);
    }
    throw err;
  }
}

function isValidName(name) {
  if (name === "" || name === "." || name === ".." || /[/\0]/.test(name)) {
    return false;
  }
  // Windows also forbids these characters, and names ending in a dot or space.
  return process.platform !== "win32" || !/[\\<>:"|?*\x00-\x1f]|[. ]$/.test(name);
}

function exists(path) {
  return lstat(path).then(
    () => true,
    () => false,
  );
}

function printTable(plan) {
  const rows = plan.map(({ from, to }) => [show(from), show(to)]);
  const width = rows.reduce((max, [from]) => Math.max(max, from.length), 0);
  for (const [from, to] of rows) {
    console.log(`${from.padEnd(width)} → ${to}`);
  }
}

// Paths inside the current folder are shown relative to it, with "/".
function show(path) {
  const relativePath = relative(process.cwd(), path);
  return relativePath.startsWith("..") || isAbsolute(relativePath)
    ? path
    : relativePath.split(sep).join("/");
}

function count(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
