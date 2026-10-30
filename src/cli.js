import { createRequire } from "node:module";
import { inspect } from "node:util";
import { Command } from "commander";
import * as configCommand from "./commands/config.js";
import * as dupesCommand from "./commands/dupes.js";
import * as gitCommand from "./commands/git/index.js";
import * as helloCommand from "./commands/hello.js";
import * as newCommand from "./commands/new.js";
import * as pluginsCommand from "./commands/plugins.js";
import * as renameCommand from "./commands/rename.js";
import * as sizeCommand from "./commands/size.js";
import { loadConfig } from "./config.js";
import { disableColor, error, warn } from "./output.js";
import { loadPlugins } from "./plugins.js";

const { version } = createRequire(import.meta.url)("../package.json");

// Each command module exports register(program, context).
const commands = [
  configCommand,
  dupesCommand,
  gitCommand,
  helloCommand,
  newCommand,
  pluginsCommand,
  renameCommand,
  sizeCommand,
];

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
  // turn some of them off. Those that list their commands are imported only
  // when needed: for the command being run, or all of them for help and for
  // `toolsmith plugins`. That one lists what happened to each plugin, so it
  // doesn't need the warnings too.
  if (config) {
    const asked = readCommandLine(argv.slice(2));
    context.plugins = await loadPlugins(program, context, {
      enabled: config.settings.plugins,
      version,
      command: asked.command,
      all: asked.help || asked.command === "help" || asked.command === "plugins",
      quiet: asked.command === "plugins",
    });
  } else {
    context.plugins = [];
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

// What the arguments after "toolsmith" ask for, read the way Commander reads
// them: { command }, { help: true } for toolsmith's own help (-h or --help
// before any command, or no command at all), or { version: true }. toolsmith's
// own options take no values, so the command is the first argument that isn't
// an option ("-" alone isn't one), or the one after "--".
export function readCommandLine(args) {
  for (const [index, arg] of args.entries()) {
    if (arg === "-V" || arg === "--version") {
      return { version: true };
    }
    if (arg === "-h" || arg === "--help") {
      return { help: true };
    }
    if (arg === "--") {
      return index + 1 < args.length ? { command: args[index + 1] } : { help: true };
    }
    if (!(arg.length > 1 && arg.startsWith("-"))) {
      return { command: arg };
    }
  }
  return { help: true };
}
