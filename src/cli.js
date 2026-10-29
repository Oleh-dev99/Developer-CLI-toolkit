import { createRequire } from "node:module";
import { Command } from "commander";
import * as hello from "./commands/hello.js";

const { version } = createRequire(import.meta.url)("../package.json");

// Each command module exports register(program).
const commands = [hello];

export async function run(argv) {
  const program = new Command()
    .name("toolsmith")
    .description("A command-line toolkit for developers")
    .version(version)
    .option("--debug", "show stack traces for errors");

  for (const command of commands) {
    command.register(program);
  }

  // Commander reports usage errors (like an unknown command) itself and exits
  // with code 1; this catches errors thrown while a command runs.
  try {
    await program.parseAsync(argv);
  } catch (error) {
    console.error(program.opts().debug ? error : `error: ${error.message}`);
    process.exitCode = 1;
  }
}
