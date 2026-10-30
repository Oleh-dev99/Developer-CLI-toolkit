import { createRequire } from "node:module";
import { inspect } from "node:util";
import { Command } from "commander";
import * as configCommand from "./commands/config.js";
import * as dupesCommand from "./commands/dupes.js";
import * as gitCommand from "./commands/git/index.js";
import * as helloCommand from "./commands/hello.js";
import * as newCommand from "./commands/new.js";
import * as renameCommand from "./commands/rename.js";
import * as sizeCommand from "./commands/size.js";
import { loadConfig } from "./config.js";
import { disableColor, error, warn } from "./output.js";
import { loadPlugins } from "./plugins.js";

const { version } = createRequire(import.meta.url)("../package.json");

// Each command module exports register(program, context).
const commands = [configCommand, dupesCommand, gitCommand, helloCommand, newCommand, renameCommand, sizeCommand];

export async function run(argv) {
  // Read the config file before parsing, so "color": false also covers usage
  // errors. Problems with the file are reported only when a command runs, so
  // --help and --version still work and --no-color is already known.
  let config;
  let configError;
  try {
    config = loadConfig();
    if (!config.settings.color) {
      disableColor();
    }
  } catch (err) {
    configError = err;
  }

  // Commands read context.config, which is set just before they run.
  const context = {};

  const program = new Command()
    .name("toolsmith")
    .description("A command-line toolkit for developers")
    .version(version)
    .option("--debug", "show stack traces for errors")
    .option("--no-color", "disable colored output")
    .configureOutput({
      // Commander's messages already start with "error: ".
      outputError: (message) => error(message.replace(/^error: /, "").trimEnd()),
    })
    .hook("preAction", () => {
      if (configError) {
        throw configError;
      }
      for (const warning of config.warnings) {
        warn(warning);
      }
      // Command-line flags override the config file.
      const settings = { ...config.settings };
      if (!program.opts().color) {
        settings.color = false;
      }
      context.config = { path: config.path, found: config.found, settings };
    });

  // Runs as soon as the flag is parsed, so it also covers usage errors that
  // Commander reports before any command runs.
  program.on("option:no-color", disableColor);

  for (const command of commands) {
    command.register(program, context);
  }
  // Plugins load only with a config file that could be read, because it may
  // turn some of them off.
  if (config) {
    await loadPlugins(program, context, { enabled: config.settings.plugins, version });
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
