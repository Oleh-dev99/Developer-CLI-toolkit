import { readdirSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { displayPath, isValidFileName } from "../lib/files.js";
import { git } from "../lib/git.js";
import { walk } from "../lib/walk.js";
import { success } from "../output.js";

const templatesFolder = fileURLToPath(new URL("../../templates/", import.meta.url));

// npm leaves files like .gitignore out of published packages, so templates
// store them under these names, and they get their real names in the project.
const dotfiles = new Map([
  ["_editorconfig", ".editorconfig"],
  ["_gitattributes", ".gitattributes"],
  ["_gitignore", ".gitignore"],
  ["_npmrc", ".npmrc"],
]);

export function register(program) {
  program
    .command("new")
    .description("create a project from a template")
    .argument("<template>", "the template to start from, like node-cli")
    .argument("[directory]", "the folder to create the project in (default: the current folder)")
    .option("--name <name>", "the project name (default: the folder's name)")
    .option("--author <name>", "the author (default: your git user.name)")
    .option("--force", "write into a folder that isn't empty, replacing files with the same names")
    .addHelpText(
      "after",
      () => `
Examples:
  Create the folder my-tool from the node-cli template:
  $ toolsmith new node-cli my-tool

  Use the current folder even though it has files in it, with another author:
  $ toolsmith new node-cli --force --author "Ada Lovelace"

Templates can use {{name}}, {{author}} and {{year}} in file contents and in
file and folder names. Built-in templates: ${builtInTemplates().join(", ")}.`,
    )
    .action(async (template, directory = ".", options) => {
      const source = templateFolder(template);
      const target = resolve(directory);
      const where = displayPath(target) || "the current folder";
      await checkTarget(target, where, options.force);

      const values = {
        name: options.name ?? basename(target),
        author: options.author ?? (await defaultAuthor()),
        year: String(new Date().getFullYear()),
      };
      if (!isValidFileName(values.name)) {
        throw new Error(`"${values.name}" can't be the project name, because it's used in file names; choose one with --name`);
      }

      for (const { path, replaced } of await generate(source, target, values)) {
        console.log(`  ${displayPath(path)}${replaced ? " (replaced)" : ""}`);
      }
      success(`Created "${values.name}" from the ${template} template in ${where}.`);
    });
}

function builtInTemplates() {
  return readdirSync(templatesFolder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

// Checking against the list also keeps a name like "../x" from reaching
// outside the templates folder.
function templateFolder(name) {
  const names = builtInTemplates();
  if (!names.includes(name)) {
    throw new Error(`there's no template named "${name}"; built-in templates: ${names.join(", ")}`);
  }
  return join(templatesFolder, name);
}

// Refuses a folder that already has something in it, unless `force`. A folder
// with only .git in it (right after git init) counts as empty.
async function checkTarget(target, where, force) {
  let names;
  try {
    names = await readdir(target);
  } catch (err) {
    if (err.code === "ENOENT") {
      return; // It gets created.
    }
    if (err.code === "ENOTDIR") {
      throw new Error(`${where} is a file, not a folder`);
    }
    throw err;
  }
  if (!force && names.some((name) => name !== ".git")) {
    throw new Error(`${where} isn't empty; add --force to write into it anyway`);
  }
}

// git's user.name, or else the name you're logged in with.
async function defaultAuthor() {
  try {
    const name = await git(["config", "user.name"]);
    if (name) {
      return name;
    }
  } catch {
    // Not set, or git isn't installed.
  }
  try {
    return userInfo().username;
  } catch {
    return "";
  }
}

// Copies the template into `target`: {{name}}, {{author}} and {{year}} are
// filled in, in file contents and in file and folder names, and dotfiles get
// their real names. Every name is checked before anything is written, so a bad
// one leaves no half-made project. Returns the files written, each with
// `replaced` if it overwrote one (only possible with --force).
async function generate(source, target, values) {
  const fill = (text) => text.replace(/\{\{(name|author|year)\}\}/g, (_, key) => values[key]);

  const plan = [];
  for await (const entry of walk(source)) {
    if (entry.type !== "file" && entry.type !== "directory") {
      continue;
    }
    const parts = entry.relativePath.split("/").map((part) => dotfiles.get(part) ?? fill(part));
    const bad = parts.find((part) => !isValidFileName(part));
    if (bad !== undefined) {
      throw new Error(`the template would create a file named "${bad}", which isn't a valid name`);
    }
    plan.push({ ...entry, to: join(target, ...parts) });
  }

  const written = [];
  for (const { type, path, to } of plan) {
    if (type === "directory") {
      await mkdir(to, { recursive: true });
      continue;
    }
    const content = await readFile(path);
    const replaced = await lstat(to).then(
      () => true,
      () => false,
    );
    await mkdir(dirname(to), { recursive: true });
    // Files that look binary (they contain a zero byte, as git checks it) are
    // copied unchanged.
    await writeFile(to, content.subarray(0, 8000).includes(0) ? content : fill(content.toString("utf8")));
    written.push({ path: to, replaced });
  }
  return written;
}
