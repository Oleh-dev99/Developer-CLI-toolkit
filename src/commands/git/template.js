import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { ensureRepository, git } from "../../lib/git.js";
import { info, success, warn } from "../../output.js";

// Built-in templates. Lines starting with "#" are a guide only: git leaves them
// out of the message.
const builtIns = {
  conventional: `
# <type>(<scope>): <summary>
#
# type: what kind of change this is
#   feat      a new feature
#   fix       a bug fix
#   docs      documentation only
#   refactor  a code change that neither fixes a bug nor adds a feature
#   test      adding or fixing tests
#   chore     tooling, dependencies and other upkeep
# scope: optional, the part of the project, like (auth) or (cli)
# summary: what the commit does, in the imperative ("add", not "added"),
#   lowercase, no period, about 50 characters
# Add "!" before the colon for a breaking change: feat!: drop Node 20
#
# Then a blank line and, if useful, a body: what changed and why, in lines of
# up to 72 characters. End with "BREAKING CHANGE: ..." or "Refs: #123" if they
# apply.
`,
};

export function register(gitCommand, context) {
  const templateCommand = gitCommand
    .command("template")
    .description("commit message templates that git commit starts from")
    .addHelpText(
      "after",
      `
Examples:
  See the templates, and which one this repository uses:
  $ toolsmith git template list

  Start every commit in this repository from the Conventional Commits guide:
  $ toolsmith git template use conventional

Add your own templates to ~/.toolsmithrc as "templates": { "name": "text" };
one with the same name as a built-in template replaces it. "use" changes only
this repository's git config, never your global one.`,
    );

  // Built-in templates, with the user's own from ~/.toolsmithrc on top.
  const userTemplates = () => context.config.settings.templates;
  const allTemplates = () => ({ ...builtIns, ...userTemplates() });
  const find = (name) => {
    const templates = allTemplates();
    if (!Object.hasOwn(templates, name)) {
      throw new Error(`there's no template named "${name}"; see "toolsmith git template list"`);
    }
    return templates[name];
  };

  templateCommand
    .command("list")
    .description("show the templates, and which one this repository uses")
    .action(async () => {
      const inRepository = await ensureRepository().then(
        () => true,
        () => false,
      );
      const active = inRepository ? await activeTemplate() : null;
      const names = Object.keys(allTemplates()).sort();
      const width = names.reduce((max, name) => Math.max(max, name.length), 0);
      for (const name of names) {
        const source = !Object.hasOwn(userTemplates(), name)
          ? "built-in"
          : Object.hasOwn(builtIns, name)
            ? "user (replaces built-in)"
            : "user";
        console.log(`${name === active ? "*" : " "} ${name.padEnd(width)}  ${source}`);
      }
      if (inRepository) {
        info(active ? `Active in this repository: ${active}` : "No template is active in this repository.");
      }
    });

  templateCommand
    .command("show")
    .description("print a template")
    .argument("<name>", "the template to show")
    .action((name) => {
      process.stdout.write(withNewline(find(name)));
    });

  templateCommand
    .command("use")
    .description("make git commit in this repository start from a template")
    .argument("<name>", "the template to use")
    .action(async (name) => {
      await ensureRepository();
      const text = find(name);
      const path = await templatePath();
      const previous = await localConfig("commit.template");
      if (previous && !isSamePath(previous, path)) {
        warn(`replacing the commit.template that pointed to ${previous}`);
      }
      await writeFile(path, withNewline(text));
      // --local: only this repository's config. "--" keeps a value starting
      // with "-" from being read as an option.
      await git(["config", "--local", "--", "commit.template", path.split(sep).join("/")]);
      await git(["config", "--local", "--", "toolsmith.template", name]);
      success(`git commit now starts from the "${name}" template in this repository.`);
    });

  templateCommand
    .command("unset")
    .description("stop using a template in this repository")
    .action(async () => {
      await ensureRepository();
      const path = await templatePath();
      const configured = await localConfig("commit.template");
      if (configured && !isSamePath(configured, path)) {
        throw new Error(
          `commit.template points to ${configured}, which toolsmith didn't set; ` +
            "remove it with: git config --local --unset commit.template",
        );
      }
      if (!configured && !existsSync(path)) {
        info("No commit template is set in this repository.");
        return;
      }
      await unsetLocalConfig("commit.template");
      await unsetLocalConfig("toolsmith.template");
      await rm(path, { force: true });
      success("Removed the commit template from this repository.");
    });
}

// The file `use` writes: toolsmith-template in the repository's .git folder
// (the shared one, so it's the same for every worktree).
async function templatePath() {
  return join(await git(["rev-parse", "--path-format=absolute", "--git-common-dir"]), "toolsmith-template");
}

// The template `use` set up in this repository, or null.
async function activeTemplate() {
  const configured = await localConfig("commit.template");
  if (!configured || !isSamePath(configured, await templatePath())) {
    return null;
  }
  return localConfig("toolsmith.template");
}

async function localConfig(key) {
  try {
    return await git(["config", "--local", "--get", key]);
  } catch {
    return null;
  }
}

async function unsetLocalConfig(key) {
  try {
    await git(["config", "--local", "--unset", key]);
  } catch {
    // Already not set.
  }
}

function isSamePath(a, b) {
  return resolve(a) === resolve(b);
}

function withNewline(text) {
  return text.endsWith("\n") ? text : `${text}\n`;
}
