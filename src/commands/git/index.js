import * as cleanBranches from "./clean-branches.js";
import * as recent from "./recent.js";
import * as template from "./template.js";

// Each git subcommand module exports register(gitCommand, context), like the
// top-level commands.
const subcommands = [cleanBranches, recent, template];

export function register(program, context) {
  const gitCommand = program
    .command("git")
    .description("git helpers: clean up merged branches, summarize commits, commit message templates");
  for (const subcommand of subcommands) {
    subcommand.register(gitCommand, context);
  }
}
