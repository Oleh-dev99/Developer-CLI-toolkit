import { readdir } from "node:fs/promises";
import { userInfo } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import { displayPath, isValidFileName } from "../lib/files.js";
import { git, insideRepository } from "../lib/git.js";
import { npm } from "../lib/npm.js";
import { createPrompt, PromptCancelled } from "../lib/prompt.js";
import { builtInTemplates, generate, openTemplate, templateDescription, templateProblem } from "../lib/templates.js";
import { info, success, warn } from "../output.js";

export function register(program) {
  program
    .command("new")
    .description("create a project from a template")
    .argument("[template]", "a built-in template like node-cli, a folder, or a git URL (add #branch or #tag)")
    .argument("[directory]", "the folder to create the project in (default: the current folder)")
    .option("--list", "show the built-in templates")
    .option("--name <name>", "the project name (default: the folder's name)")
    .option("--author <name>", "the author (default: your git user.name)")
    .option("-y, --yes", "don't ask anything, take the defaults")
    .option("--force", "write into a folder that isn't empty, replacing files with the same names")
    .option("--no-git", "don't run git init or make a first commit")
    .option("--no-install", "don't run npm install")
    .addHelpText(
      "after",
      `
Examples:
  Answer a few questions (template, name, author, npm install):
  $ toolsmith new

  Create the folder my-tool from the node-cli template:
  $ toolsmith new node-cli my-tool

  The same without any questions, for a script:
  $ toolsmith new node-cli my-tool --yes

  Only the files, without git init or npm install:
  $ toolsmith new node-lib my-lib --no-git --no-install

  Use the current folder even though it has files in it, with another author:
  $ toolsmith new node-cli --force --author "Ada Lovelace"

  Use your own template, from a folder or from a git repository's v2 tag:
  $ toolsmith new ~/templates/api my-api
  $ toolsmith new https://github.com/you/api-template.git#v2 my-api

In a terminal, toolsmith asks for whatever you didn't give on the command line;
press Enter to take the default in brackets. With --yes, or when the input
isn't a terminal (scripts, CI), it never asks. Templates can use {{name}},
{{author}} and {{year}} in file contents and in file and folder names; see the
built-in ones with --list. A built-in template's name always wins over a folder
with the same name; write ./node-cli for the folder.

After writing the files, toolsmith runs git init (unless the folder is already
in a git repository), then npm install if the template has a package.json, and
then makes the first commit.`,
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
      // --no-install answers the npm install question in advance.
      const install = options.install ? undefined : false;
      const given = { template, name: options.name, author: options.author, install };

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
      let written;
      try {
        written = await generate(chosen.template.folder, target, values);
      } finally {
        // A cloned template's temp folder goes away, after errors too.
        await chosen.template.close();
      }
      for (const { path, replaced } of written) {
        console.log(`  ${displayPath(path)}${replaced ? " (replaced)" : ""}`);
      }
      success(`Created "${values.name}" from ${chosen.template.label} in ${where}.`);

      // git init comes first and the commit last, so that the commit has the
      // package-lock.json from npm install too.
      const committing = options.git && (await initRepository(target, where));
      const npmError = chosen.install ? await installDependencies(target) : undefined;
      if (committing) {
        const files = written.map(({ path }) => path);
        if (chosen.install && !npmError) {
          files.push(join(target, "package-lock.json"));
        }
        await commitFiles(target, chosen.template.name, files, { npmFailed: Boolean(npmError) });
      }
      if (npmError) {
        const advice = `the project's files are kept, so run "npm install" in ${where} to finish`;
        throw new Error(`${npmError.message}; ${advice}`);
      }
    });
}

// Throws for a template that can't be found or an invalid name given on the
// command line, and for a missing template when there's nobody to ask for one.
function checkGivenValues({ template, name }, canAsk) {
  const problem = template === undefined ? undefined : templateProblem(template);
  if (problem) {
    throw new Error(`${problem}; see "toolsmith new --list"`);
  }
  if (name !== undefined && !isValidFileName(name)) {
    throw new Error(badName(name));
  }
  if (template === undefined && !canAsk) {
    throw new Error('choose a template, like "toolsmith new node-cli my-project"; see "toolsmith new --list"');
  }
}

// Picks the template, name and author, and whether to run npm install. Values
// from the command line are used as they are. The rest is asked with `prompt`,
// which shows the default from `defaults` and asks again after a bad answer;
// with no prompt (--yes, or input that isn't a terminal) the defaults are
// taken, and npm install runs. The template comes back opened (see
// openTemplate), so call its close() when done.
export async function chooseValues(given, { defaults, prompt }) {
  checkGivenValues(given, Boolean(prompt));
  let { name, author, install } = given;
  let template;
  try {
    template = await openTemplate(given.template ?? (await askTemplate(prompt)));
    name ??= prompt
      ? await prompt.ask("Project name", {
          defaultValue: defaults.name,
          validate: (answer) =>
            isValidFileName(answer) ? undefined : `"${answer}" can't be the project name, because it's used in file names.`,
        })
      : defaults.name;
    author ??= prompt ? await prompt.ask("Author", { defaultValue: defaults.author }) : defaults.author;
    // Only a project with a package.json has anything to install.
    if (!template.hasPackageJson) {
      install = false;
    }
    install ??= prompt ? await prompt.yesNo("Run npm install?", { defaultValue: true }) : true;
    // The folder's name may not work as a project name (a drive's root has none).
    if (!isValidFileName(name)) {
      throw new Error(badName(name));
    }
  } catch (err) {
    await template?.close();
    if (err instanceof PromptCancelled) {
      throw new Error("cancelled; nothing was created");
    }
    throw err;
  }
  return { template, name, author, install };
}

// Asks for a template: a built-in one, a folder or a git URL.
function askTemplate(prompt) {
  return prompt.ask(`Template (${builtInTemplates().join(", ")}, a folder or a git URL)`, {
    validate: (answer) => {
      const problem = templateProblem(answer);
      return problem && `${problem[0].toUpperCase()}${problem.slice(1)}.`;
    },
  });
}

function badName(name) {
  return `"${name}" can't be the project name, because it's used in file names; choose one with --name`;
}

function printTemplates() {
  const names = builtInTemplates();
  const width = names.reduce((max, name) => Math.max(max, name.length), 0);
  for (const name of names) {
    console.log(`${name.padEnd(width)}  ${templateDescription(name)}`.trimEnd());
  }
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

// Runs git init in the new project, unless it's already in a git repository,
// and resolves to whether it did. Problems are only warnings: the project is
// there either way.
async function initRepository(target, where) {
  try {
    if (await insideRepository(target)) {
      info(`Skipped git init: ${where} is already in a git repository.`);
      return false;
    }
    await git(["init", "--quiet"], { cwd: target });
  } catch (err) {
    warn(`skipped git init (${err.message})`);
    return false;
  }
  success("Initialized a git repository.");
  return true;
}

// Runs npm install in the new project, with npm's output shown. Resolves to
// the error if it failed, which is reported at the very end, after the commit.
async function installDependencies(target) {
  info("Running npm install...");
  try {
    await npm(["install"], { cwd: target });
  } catch (err) {
    return err;
  }
  success("npm install finished.");
  return undefined;
}

// Makes the first commit in the new repository, of the `files` toolsmith wrote
// (and package-lock.json, if npm install made one). Other files (with --force
// the folder may have some) are left out, and so are files .gitignore ignores.
// A failure is only a warning.
async function commitFiles(target, templateName, files, { npmFailed }) {
  try {
    // The paths are file names, not patterns.
    const options = { cwd: target, env: { GIT_LITERAL_PATHSPECS: "1" } };
    const paths = files.map((path) => relative(target, path).split(sep).join("/"));
    const toAdd = await git(["ls-files", "-z", "--others", "--exclude-standard", "--", ...paths], options);
    await git(["add", "--", ...toAdd.split("\0").filter(Boolean)], options);
    await git(["commit", "--quiet", "-m", `Initial commit from toolsmith (${templateName})`], options);
  } catch (err) {
    warn(`couldn't make the first commit (${err.message})`);
    return;
  }
  success(
    npmFailed
      ? "Made the first commit with only the template's files, since npm install failed."
      : `Made the first commit, "Initial commit from toolsmith (${templateName})".`,
  );
}
