import { currentBranch } from "./lib/git.js";
import { findTodos } from "./lib/todos.js";

// toolsmith calls register(api) to add this plugin's commands. Each command
// added here is also listed under "toolsmith" in package.json, so toolsmith
// only imports this file when one of them runs (or for help).
export function register(api) {
  api
    .command("todos")
    .description("list the TODO, FIXME and HACK comments in your files")
    .argument("[paths...]", "files and folders to search (default: the current folder)")
    .option("--json", "print the comments as JSON")
    .addHelpText(
      "after",
      `
Examples:
  $ toolsmith todos
  $ toolsmith todos src test --json

.git and node_modules folders, and files that look binary, are skipped.`,
    )
    .action(async (paths, options) => {
      const todos = await findTodos(paths.length > 0 ? paths : ["."]);
      if (options.json) {
        console.log(JSON.stringify({ todos }, null, 2));
        return;
      }
      for (const { path, line, tag, text } of todos) {
        console.log(`${path}:${line}  ${tag}  ${text}`);
      }
      api.output.info(summary(todos));
    });

  api
    .command("guard")
    .description("fail on a protected git branch, to keep commits off it")
    .addHelpText(
      "after",
      `
Example, as a git pre-commit hook (in .git/hooks/pre-commit):
  #!/bin/sh
  exec toolsmith guard

The protected branches are "protectedBranches" in ~/.toolsmithrc (by default
main, master and develop).`,
    )
    .action(async () => {
      // The settings are there when a command runs, not yet in register().
      const { path, settings } = api.config;
      const branch = await currentBranch();
      if (branch === null) {
        api.output.info("Not on a branch (HEAD is detached), so there's nothing to guard.");
        return;
      }
      if (settings.protectedBranches.includes(branch)) {
        // An error ends toolsmith with exit code 1, which stops the commit.
        const where = `see "protectedBranches" in ${path}`;
        throw new Error(`${branch} is a protected branch (${where}); commit on another branch`);
      }
      api.output.success(`${branch} isn't a protected branch.`);
    });
}

// "3 comments: 2 TODO, 1 FIXME."
function summary(todos) {
  if (todos.length === 0) {
    return "No TODO, FIXME or HACK comments found.";
  }
  const counts = new Map();
  for (const { tag } of todos) {
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const parts = [...counts].map(([tag, count]) => `${count} ${tag}`);
  return `${todos.length} ${todos.length === 1 ? "comment" : "comments"}: ${parts.join(", ")}.`;
}
