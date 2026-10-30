import * as cleanBranches from "./clean-branches.js";

// Each git subcommand module exports register(gitCommand, context), like the
// top-level commands.
const subcommands = [cleanBranches];

export function register(program, context) {
  const gitCommand = program.command("git").description("git helpers, such as cleaning up merged branches");
  for (const subcommand of subcommands) {
    subcommand.register(gitCommand, context);
  }
}
