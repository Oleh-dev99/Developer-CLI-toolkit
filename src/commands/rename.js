import { lstat, rename } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { walk } from "../lib/walk.js";
import { info, success } from "../output.js";

// On these systems "Photo.jpg" and "photo.jpg" are usually the same file.
const caseInsensitive = process.platform === "win32" || process.platform === "darwin";

export function register(program) {
  program
    .command("rename")
    .description("find and replace text in file names")
    .argument("<find>", "text to find (a regular expression with --regex)")
    .argument("<replace>", "replacement text; with --regex, $1, $2, … insert captured groups")
    .argument("[paths...]", "files or folders to work on (default: the current folder)")
    .option("-r, --recursive", "include files in subfolders", false)
    .option("--regex", "treat <find> as a regular expression")
    .option("--dry-run", "show what would be renamed, without renaming anything")
    .addHelpText(
      "after",
      `
Examples:
  Preview replacing "IMG_" with "photo_" in this folder:
  $ toolsmith rename IMG_ photo_ --dry-run

  Turn "IMG_20240501_beach.jpg" into "2024-05-01 beach.jpg", in subfolders too:
  $ toolsmith rename --regex 'IMG_(\\d{4})(\\d{2})(\\d{2})_' '$1-$2-$3 ' -r

Only file names change, never folder names, and every match in a name is
replaced. .git and node_modules are skipped. Nothing is renamed if any new name
would clash with another file. In bash, zsh and PowerShell, put $1 in single
quotes so the shell leaves it alone.`,
    )
    .action(async (find, replace, paths, options) => {
      const newNameFor = nameReplacer(find, replace, options.regex);
      const files = await findFiles(paths.length > 0 ? paths : ["."], options.recursive);

      // Plan every rename before touching anything.
      const plan = [];
      for (const from of files) {
        const newName = newNameFor(basename(from));
        if (newName !== basename(from)) {
          plan.push({ from, to: join(dirname(from), newName), newName });
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
      for (const [done, { from, to }] of plan.entries()) {
        try {
          await rename(from, to);
        } catch (err) {
          throw new Error(
            `couldn't rename ${show(from)} (${err.message}); ${done} of ${count(plan.length, "file")} were renamed before that`,
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

async function findFiles(paths, recursive) {
  const files = new Set();
  for (const path of paths) {
    let stats;
    try {
      stats = await lstat(path);
    } catch {
      throw new Error(`${path} not found`);
    }
    if (stats.isFile()) {
      files.add(resolve(path));
    } else if (stats.isDirectory()) {
      for await (const entry of walk(path, { recursive, ignore: [".git", "node_modules"] })) {
        if (entry.type === "file") {
          files.add(entry.path);
        }
      }
    }
  }
  return [...files];
}

async function findConflicts(plan) {
  const byTarget = Map.groupBy(plan, ({ to }) => (caseInsensitive ? to.toLowerCase() : to));
  const conflicts = [];
  for (const group of byTarget.values()) {
    const { to, newName } = group[0];
    const from = group.map((step) => show(step.from)).join(", ");
    if (!isValidName(newName)) {
      conflicts.push(`${from} → "${newName}": not a valid file name`);
    } else if (group.length > 1) {
      conflicts.push(`${from} → ${show(to)}: would get the same name`);
    } else if (await exists(to)) {
      conflicts.push(`${from} → ${show(to)}: ${show(to)} already exists`);
    }
  }
  return conflicts;
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
