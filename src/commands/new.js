import { readdirSync, readFileSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { displayPath, isValidFileName } from "../lib/files.js";
import { git } from "../lib/git.js";
import { createPrompt, PromptCancelled } from "../lib/prompt.js";
import { walk } from "../lib/walk.js";
import { success } from "../output.js";

const templatesFolder = fileURLToPath(new URL("../../templates/", import.meta.url));

// npm leaves files like .gitignore out of published packages, so templates
// store them under these names, and they get their real names in the project.
export const dotfiles = new Map([
  ["_editorconfig", ".editorconfig"],
  ["_gitattributes", ".gitattributes"],
  ["_gitignore", ".gitignore"],
  ["_npmrc", ".npmrc"],
]);

export function register(program) {
  program
    .command("new")
    .description("create a project from a template")
    .argument("[template]", "the template to start from, like node-cli")
    .argument("[directory]", "the folder to create the project in (default: the current folder)")
    .option("--list", "show the built-in templates")
    .option("--name <name>", "the project name (default: the folder's name)")
    .option("--author <name>", "the author (default: your git user.name)")
    .option("-y, --yes", "don't ask anything, take the defaults")
    .option("--force", "write into a folder that isn't empty, replacing files with the same names")
    .addHelpText(
      "after",
      `
Examples:
  Answer a few questions (template, name, author):
  $ toolsmith new

  Create the folder my-tool from the node-cli template:
  $ toolsmith new node-cli my-tool

  The same without any questions, for a script:
  $ toolsmith new node-cli my-tool --yes

  Use the current folder even though it has files in it, with another author:
  $ toolsmith new node-cli --force --author "Ada Lovelace"

In a terminal, toolsmith asks for whatever you didn't give on the command line;
press Enter to take the default in brackets. With --yes, or when the input
isn't a terminal (scripts, CI), it never asks. Templates can use {{name}},
{{author}} and {{year}} in file contents and in file and folder names; see them
with --list.`,
    )
    .action(async (template, directory = ".", options) => {
      if (options.list) {
        printTemplates();
        return;
      }
      const target = resolve(directory);
      const where = displayPath(target) || "the current folder";
      // Questions only when someone can answer them: in a terminal, without --yes.
      const prompt = options.yes || !process.stdin.isTTY ? null : createPrompt();
      const given = { template, name: options.name, author: options.author };

      // Mistakes on the command line first, then the folder, then questions.
      checkGivenValues(given, Boolean(prompt));
      await checkTarget(target, where, options.force);
      let chosen;
      try {
        const defaults = { name: basename(target), author: options.author ?? (await defaultAuthor()) };
        chosen = await chooseValues(given, { defaults, prompt });
      } finally {
        prompt?.close();
      }

      const values = { name: chosen.name, author: chosen.author, year: String(new Date().getFullYear()) };
      for (const { path, replaced } of await generate(templateFolder(chosen.template), target, values)) {
        console.log(`  ${displayPath(path)}${replaced ? " (replaced)" : ""}`);
      }
      success(`Created "${values.name}" from the ${chosen.template} template in ${where}.`);
    });
}

// Throws for an unknown template or an invalid name given on the command line,
// and for a missing template when there's nobody to ask for one.
function checkGivenValues({ template, name }, canAsk) {
  if (template !== undefined && !builtInTemplates().includes(template)) {
    throw new Error(`there's no template named "${template}"; see "toolsmith new --list"`);
  }
  if (name !== undefined && !isValidFileName(name)) {
    throw new Error(badName(name));
  }
  if (template === undefined && !canAsk) {
    throw new Error('choose a template, like "toolsmith new node-cli my-project"; see "toolsmith new --list"');
  }
}

// Picks the template, name and author. Values from the command line are used
// as they are. The rest is asked with `prompt`, which shows the default from
// `defaults` and asks again after a bad answer; with no prompt (--yes, or input
// that isn't a terminal) the defaults are taken.
export async function chooseValues(given, { defaults, prompt }) {
  checkGivenValues(given, Boolean(prompt));
  let { template, name, author } = given;
  try {
    if (template === undefined) {
      const templates = builtInTemplates();
      template = await prompt.ask(`Template (${templates.join(", ")})`, {
        validate: (answer) => (templates.includes(answer) ? undefined : `There's no template named "${answer}".`),
      });
    }
    name ??= prompt
      ? await prompt.ask("Project name", {
          defaultValue: defaults.name,
          validate: (answer) =>
            isValidFileName(answer) ? undefined : `"${answer}" can't be the project name, because it's used in file names.`,
        })
      : defaults.name;
    author ??= prompt ? await prompt.ask("Author", { defaultValue: defaults.author }) : defaults.author;
  } catch (err) {
    if (err instanceof PromptCancelled) {
      throw new Error("cancelled; nothing was created");
    }
    throw err;
  }
  // The folder's name may not work as a project name (a drive's root has none).
  if (!isValidFileName(name)) {
    throw new Error(badName(name));
  }
  return { template, name, author };
}

function badName(name) {
  return `"${name}" can't be the project name, because it's used in file names; choose one with --name`;
}

function builtInTemplates() {
  return readdirSync(templatesFolder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

// Each template folder has a template.json with a one-line "description". That
// file describes the template, so it isn't copied into projects.
function templateDescription(name) {
  try {
    return JSON.parse(readFileSync(join(templatesFolder, name, "template.json"), "utf8")).description ?? "";
  } catch {
    return "";
  }
}

function printTemplates() {
  const names = builtInTemplates();
  const width = names.reduce((max, name) => Math.max(max, name.length), 0);
  for (const name of names) {
    console.log(`${name.padEnd(width)}  ${templateDescription(name)}`.trimEnd());
  }
}

// Checking against the list also keeps a name like "../x" from reaching
// outside the templates folder.
function templateFolder(name) {
  if (!builtInTemplates().includes(name)) {
    throw new Error(`there's no template named "${name}"; see "toolsmith new --list"`);
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
    if ((entry.type !== "file" && entry.type !== "directory") || entry.relativePath === "template.json") {
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
