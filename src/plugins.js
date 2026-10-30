import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Command } from "commander";
import { error, info, success, warn } from "./output.js";

const toolsmithFolder = fileURLToPath(new URL("..", import.meta.url));
const pluginName = /^toolsmith-plugin-./;

// Loads the installed plugins that `enabled` (the "plugins" setting) doesn't
// turn off, and adds their commands to `program`. A plugin that fails to load
// is skipped with a warning, so it can't break the rest of the CLI. Built-in
// commands win name clashes; between plugins, the one found first wins.
// `version` is toolsmith's, for the plugins to see.
export async function loadPlugins(program, context, { enabled, version, cwd = process.cwd() }) {
  // Command names and aliases, and who has them: null for toolsmith itself.
  const taken = new Map([["help", null]]);
  for (const command of program.commands) {
    for (const name of [command.name(), ...command.aliases()]) {
      taken.set(name, null);
    }
  }

  for (const plugin of await findPlugins(cwd)) {
    if (enabled[plugin.name] === false) {
      continue;
    }
    let commands;
    try {
      commands = await registerPlugin(plugin, program, context, version);
    } catch (err) {
      warn(`plugin ${plugin.name} failed to load, so it was skipped (${err.message})`);
      continue;
    }
    for (const command of commands) {
      const names = [command.name(), ...command.aliases()];
      const clash = names.find((name) => taken.has(name));
      if (clash !== undefined) {
        const owner = taken.get(clash);
        const reason = owner
          ? `the plugin ${owner} already adds "${clash}"`
          : `toolsmith has a built-in command "${clash}"`;
        warn(`plugin ${plugin.name}'s command "${command.name()}" was skipped: ${reason}`);
        continue;
      }
      for (const name of names) {
        taken.set(name, plugin.name);
      }
      program.addCommand(command);
    }
  }
}

// The installed plugins, as { name, folder }: packages named toolsmith-plugin-*
// or @scope/toolsmith-plugin-*. The nearest copy of a package wins, so one in
// the project comes before a global one. Only folder names are read here.
export async function findPlugins(cwd = process.cwd()) {
  const plugins = new Map();
  for (const folder of new Set(packageFolders(cwd))) {
    for (const name of await pluginsIn(folder)) {
      if (!plugins.has(name)) {
        plugins.set(name, { name, folder: join(folder, ...name.split("/")) });
      }
    }
  }
  return [...plugins.values()];
}

// The node_modules folders to look in, nearest first: in `cwd` and every
// folder above it, as Node.js looks for packages, and then the global ones.
function packageFolders(cwd) {
  const folders = [];
  for (let folder = resolve(cwd); ; folder = dirname(folder)) {
    folders.push(join(folder, "node_modules"));
    if (dirname(folder) === folder) {
      break;
    }
  }
  return [...folders, ...globalFolders()];
}

// Where `npm install --global` puts packages. toolsmith is usually installed
// there itself, so the node_modules folder it's in comes first. Then the one
// under npm's prefix: npm_config_prefix if it's set, or else the default next
// to Node.js (on Windows, also %APPDATA%\npm).
function globalFolders() {
  const folders = [];
  if (basename(dirname(toolsmithFolder)) === "node_modules") {
    folders.push(dirname(toolsmithFolder));
  }
  const configured = process.env.npm_config_prefix || process.env.NPM_CONFIG_PREFIX;
  const windows = process.platform === "win32";
  const prefixes = configured
    ? [configured]
    : windows
      ? [dirname(process.execPath), process.env.APPDATA && join(process.env.APPDATA, "npm")]
      : [dirname(dirname(process.execPath))];
  for (const prefix of prefixes.filter((prefix) => prefix && isAbsolute(prefix))) {
    folders.push(windows ? join(prefix, "node_modules") : join(prefix, "lib", "node_modules"));
  }
  return folders;
}

// The plugin packages in a node_modules folder, sorted by name.
async function pluginsIn(folder) {
  const names = [];
  for (const entry of await readdir(folder).catch(() => [])) {
    if (pluginName.test(entry)) {
      names.push(entry);
    } else if (entry.startsWith("@")) {
      for (const scoped of await readdir(join(folder, entry)).catch(() => [])) {
        if (pluginName.test(scoped)) {
          names.push(`${entry}/${scoped}`);
        }
      }
    }
  }
  return names.sort();
}

// Imports a plugin and calls its register(api). The plugin adds its commands
// to a stand-in program first, so that none of them are used if register()
// fails halfway. Resolves to the commands it added.
async function registerPlugin(plugin, program, context, version) {
  const module = await import(pathToFileURL(await entryPoint(plugin.folder)).href);
  // A CommonJS plugin's module.exports is also the default export.
  const register = module.register ?? module.default?.register;
  if (typeof register !== "function") {
    throw new Error("it doesn't export a register function");
  }
  const standIn = new Command().copyInheritedSettings(program);
  await register(pluginApi(standIn, context, version));
  return [...standIn.commands];
}

// What a plugin's register(api) gets.
function pluginApi(standIn, context, version) {
  return {
    // toolsmith's version, like "0.1.0".
    version,
    // Adds a command, like Commander's program.command("name <arg>"), and
    // returns it to describe with .description(), .option(), .action()...
    command: (nameAndArgs) => standIn.command(nameAndArgs),
    // The settings from ~/.toolsmithrc and the command line, as `toolsmith
    // config` shows them: { path, found, settings }. Read it in an action;
    // it isn't there yet while register() runs.
    get config() {
      return context.config;
    },
    // toolsmith's output helpers, which follow its color settings.
    output: { success, info, warn, error },
  };
}

// The file to import for the package in `folder`: its "exports" for "." (the
// "import", "node" or "default" condition), or else "main", or else index.js.
async function entryPoint(folder) {
  let packageJson;
  try {
    packageJson = JSON.parse(await readFile(join(folder, "package.json"), "utf8"));
  } catch (err) {
    throw new Error(`can't read its package.json: ${err.message}`);
  }
  let target = packageJson.exports;
  if (isObject(target) && Object.keys(target).some((key) => key.startsWith("."))) {
    target = target["."];
  }
  while (isObject(target)) {
    target = target.import ?? target.node ?? target.default;
  }
  return join(folder, typeof target === "string" ? target : (packageJson.main ?? "index.js"));
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
