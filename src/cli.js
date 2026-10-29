import { createRequire } from "node:module";
import { inspect } from "node:util";
import { Command } from "commander";
import * as hello from "./commands/hello.js";
import { disableColor, error } from "./output.js";

const { version } = createRequire(import.meta.url)("../package.json");

// Each command module exports register(program).
const commands = [hello];

export async function run(argv) {
  const program = new Command()
    .name("toolsmith")
    .description("A command-line toolkit for developers")
    .version(version)
    .option("--debug", "show stack traces for errors")
    .option("--no-color", "disable colored output")
    .configureOutput({
      // Commander's messages already start with "error: ".
      outputError: (message) => error(message.replace(/^error: /, "").trimEnd()),
    });

  // Runs as soon as the flag is parsed, so it also covers usage errors that
  // Commander reports before any command runs.
  program.on("option:no-color", disableColor);

  for (const command of commands) {
    command.register(program);
  }

  // Commander reports usage errors (like an unknown command) itself and exits
  // with code 1; this catches errors thrown while a command runs.
  try {
    await program.parseAsync(argv);
  } catch (err) {
    error(err.message);
    if (program.opts().debug) {
      console.error(inspect(err));
    }
    process.exitCode = 1;
  }
}
