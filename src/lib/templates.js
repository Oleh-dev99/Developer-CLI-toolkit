import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidFileName, skipFolders } from "./files.js";
import { git } from "./git.js";
import { walk } from "./walk.js";

const builtInFolder = fileURLToPath(new URL("../../templates/", import.meta.url));

// npm leaves files like .gitignore out of published packages, so templates
// store them under these names, and they get their real names in the project.
export const dotfiles = new Map([
  ["_editorconfig", ".editorconfig"],
  ["_gitattributes", ".gitattributes"],
  ["_gitignore", ".gitignore"],
  ["_npmrc", ".npmrc"],
]);

// The built-in templates: the folders in templates/, sorted by name.
export function builtInTemplates() {
  return readdirSync(builtInFolder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

// Each built-in template has a template.json with a one-line "description".
// That file describes the template, so it isn't copied into projects; your own
// templates may have one too, but don't need it.
export function templateDescription(name) {
  try {
    return JSON.parse(readFileSync(join(builtInFolder, name, "template.json"), "utf8")).description ?? "";
  } catch {
    return "";
  }
}

// https://, ssh:// or file:// (a repository on this computer), or ssh's short
// form user@host:path.
const gitUrl = /^(?:(?:https|ssh|file):\/\/|\w[\w.-]*@[\w.-]+:)/;

// What a template `spec` names: a built-in template, whose name always wins; a
// git repository, maybe with a branch or tag after a "#"; or else a folder.
function parse(spec) {
  if (builtInTemplates().includes(spec)) {
    return { kind: "built-in", folder: join(builtInFolder, spec) };
  }
  if (gitUrl.test(spec)) {
    const [url, ref] = spec.split(/#(?=[^#]*$)/);
    return { kind: "git", url, ref: ref || undefined };
  }
  return { kind: "folder", folder: resolve(expandHome(spec)) };
}

// "~" is your home folder, as in a shell. PowerShell and cmd.exe don't expand
// it for other programs, so toolsmith does, on every OS.
function expandHome(path) {
  return path === "~" || path.startsWith("~/") || path.startsWith(`~${sep}`) ? join(homedir(), path.slice(1)) : path;
}

// What's wrong with a template `spec`, as far as can be told without cloning
// anything: a folder that doesn't exist, or a file. Undefined if it looks fine.
export function templateProblem(spec) {
  const { kind, folder } = parse(spec);
  if (kind !== "folder") {
    return undefined;
  }
  const stats = spec.trim() === "" ? undefined : statOrUndefined(folder);
  if (!stats) {
    // A bare name was most likely meant as a built-in template.
    const looksLikePath = /[\\/]/.test(spec) || /^[.~]/.test(spec);
    return looksLikePath
      ? `the template folder ${spec} doesn't exist`
      : `there's no template or folder named "${spec}"`;
  }
  return stats.isDirectory() ? undefined : `${spec} is a file, not a template folder`;
}

function statOrUndefined(path) {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

// Gets the template that `spec` names ready to copy, and resolves to:
//   name            the name, folder or URL it was given as (a URL without
//                   its password, if it has one)
//   label           for messages: "the node-cli template", or else `name`
//   folder          where its files are
//   hasPackageJson  whether it has a package.json, for npm install
//   close()         deletes the temp folder of a cloned template; call it when
//                   done, after errors too
// A git repository is cloned into a temp folder, with only its latest commit.
// Throws for a missing folder, a failed clone or an empty template.
export async function openTemplate(spec) {
  const problem = templateProblem(spec);
  if (problem) {
    throw new Error(problem);
  }
  const { kind, folder: localFolder, url, ref } = parse(spec);
  const name = kind === "git" ? spec.replace(/^(https:\/\/)[^@/]*@/, "$1") : spec;
  const folder = kind === "git" ? await clone(url, ref) : localFolder;
  const close = kind === "git" ? () => rm(folder, { recursive: true, force: true }) : async () => {};
  try {
    if (!(await hasFiles(folder))) {
      throw new Error(`the template ${name} is empty`);
    }
  } catch (err) {
    await close();
    throw err;
  }
  const label = kind === "built-in" ? `the ${name} template` : name;
  return { name, label, folder, hasPackageJson: existsSync(join(folder, "package.json")), close };
}

// Clones the repository at `url`, at the branch or tag `ref` if given, into a
// new temp folder and returns the folder. git isn't allowed to ask for a
// password, which would hang where nobody can type one: private repositories
// need ssh or a credential helper.
async function clone(url, ref) {
  const folder = await mkdtemp(join(tmpdir(), "toolsmith-template-"));
  try {
    const branch = ref ? [`--branch=${ref}`] : [];
    await git(["clone", "--quiet", "--depth=1", ...branch, "--", url, folder], { env: { GIT_TERMINAL_PROMPT: "0" } });
    return folder;
  } catch (err) {
    await rm(folder, { recursive: true, force: true });
    throw new Error(`couldn't clone the template (${err.message})`);
  }
}

// Whether the template in `folder` has a file to copy.
async function hasFiles(folder) {
  for await (const entry of walk(folder, { ignore: skipFolders })) {
    if (entry.type === "file" && entry.relativePath !== "template.json") {
      return true;
    }
  }
  return false;
}

// Copies the template in `source` into `target`: {{name}}, {{author}} and
// {{year}} are filled in, in file contents and in file and folder names, and
// dotfiles get their real names. .git and node_modules folders are left out,
// and so is template.json. Every name is checked before anything is written,
// so a bad one leaves no half-made project. Returns the files written, each
// with `replaced` if it overwrote one (only possible with --force).
export async function generate(source, target, values) {
  const fill = (text) => text.replace(/\{\{(name|author|year)\}\}/g, (_, key) => values[key]);

  const plan = [];
  for await (const entry of walk(source, { ignore: skipFolders })) {
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
