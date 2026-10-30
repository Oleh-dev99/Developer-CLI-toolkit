import * as cleanBranches from "./clean-branches.js";
import * as recent from "./recent.js";

// Each git subcommand module exports register(gitCommand, context), like the
// top-level commands.
const subcommands = [cleanBranches, recent];

export function register(program, context) {
  const gitCommand = program
    .command("git")
    .description("git helpers: clean up merged branches, summarize recent commits");
  for (const subcommand of subcommands) {
    subcommand.register(gitCommand, context);
  }
}
