import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Command } from "commander";
import satisfies from "semver/functions/satisfies.js";
import validRange from "semver/ranges/valid.js";
import { displayPath } from "./lib/files.js";
import { error, info, success, warn } from "./output.js";

const toolsmithFolder = fileURLToPath(new URL("..", import.meta.url));
const pluginName = /^toolsmith-plugin-./;

// Loads the installed plugins that `enabled` (the "plugins" setting) doesn't
// turn off, and adds their commands to `program`. A plugin that doesn't fit
// this toolsmith `version`, or fails to load, is skipped with a warning, so it
// can't break the rest of the CLI. Built-in commands win name clashes; between
// plugins, the one found first wins. With `quiet`, there are no warnings; the
// results say it all.
//
// Resolves to what happened to each plugin found, for `toolsmith plugins`:
//   name, version, source ("project" or "global"), folder
//   status           "loaded", "off" (turned off in the config file),
//                    "incompatible" or "skipped"
//   reason           why it's incompatible or skipped
//   toolsmithRange   the toolsmith versions it supports, from its
//                    peerDependencies (or null)
//   commands         the names of the commands it added
//   skippedCommands  { name, reason } for each command that was skipped
export async function loadPlugins(program, context, { enabled, version, quiet = false, cwd = process.cwd() }) {
  const report = quiet ? () => {} : warn;
  // Command names and aliases, and who has them: null for toolsmith itself.
  const taken = new Map([["help", null]]);
  for (const command of program.commands) {
    for (const name of [command.name(), ...command.aliases()]) {
      taken.set(name, null);
    }
  }

  const results = [];
  for (const plugin of await findPlugins(cwd)) {
    const result = {
      name: plugin.name,
      version: null,
      source: plugin.source,
      folder: plugin.folder,
      status: "skipped",
      reason: null,
      toolsmithRange: null,
      commands: [],
      skippedCommands: [],
    };
    results.push(result);
    // A broken package.json only matters for a plugin that's going to be used.
    const packageJson = await readPackage(plugin.folder).catch((err) => err);
    if (!(packageJson instanceof Error)) {
      result.version = packageJson.version ?? null;
      result.toolsmithRange = packageJson.peerDependencies?.toolsmith ?? null;
    }

    if (plugin.usedCopy) {
      result.reason = `the copy in ${displayPath(plugin.usedCopy)} is used instead`;
      continue;
    }
    if (enabled[plugin.name] === false) {
      result.status = "off";
      continue;
    }
    if (packageJson instanceof Error) {
      skipBroken(result, packageJson, report);
      continue;
    }
    const problem = compatibilityProblem(result.toolsmithRange, version);
    if (problem) {
      result.status = "incompatible";
      result.reason = problem;
      report(`plugin ${plugin.name} was skipped: ${problem}`);
      continue;
    }
    let commands;
    try {
      commands = await registerPlugin(plugin.folder, packageJson, program, context, version);
    } catch (err) {
      skipBroken(result, err, report);
      continue;
    }

    result.status = "loaded";
    for (const command of commands) {
      const names = [command.name(), ...command.aliases()];
      const clash = names.find((name) => taken.has(name));
      if (clash !== undefined) {
        const owner = taken.get(clash);
        const reason = owner
          ? `the plugin ${owner} already adds "${clash}"`
          : `toolsmith has a built-in command "${clash}"`;
        result.skippedCommands.push({ name: command.name(), reason });
        report(`plugin ${plugin.name}'s command "${command.name()}" was skipped: ${reason}`);
        continue;
      }
      for (const name of names) {
        taken.set(name, plugin.name);
      }
      program.addCommand(command);
      result.commands.push(command.name());
    }
  }
  return results;
}

function skipBroken(result, err, report) {
  result.reason = `it failed to load (${err.message})`;
  report(`plugin ${result.name} failed to load, so it was skipped (${err.message})`);
}

// Why this toolsmith `version` can't run a plugin that supports `range` (from
// its peerDependencies), or undefined if it can or there's no range. With
// includePrerelease, a prerelease of toolsmith is compared like any version;
// by default, semver lets it satisfy almost no range, not even ">=0.1.0".
function compatibilityProblem(range, version) {
  if (range === null) {
    return undefined;
  }
  if (typeof range !== "string" || validRange(range) === null) {
    return `its toolsmith version range ${JSON.stringify(range)} isn't valid`;
  }
  if (!satisfies(version, range, { includePrerelease: true })) {
    return `it needs toolsmith ${range}, and this is toolsmith ${version}`;
  }
  return undefined;
}

// The installed plugins, as { name, source, folder }: packages named
// toolsmith-plugin-* or @scope/toolsmith-plugin-*, nearest first. Only the
// nearest copy of a package is used, so one in the project comes before a
// global one; any other copy has `usedCopy`, the folder of the one used. Only
// folder names are read here.
export async function findPlugins(cwd = process.cwd()) {
  const plugins = [];
  const used = new Map();
  const seen = new Set();
  for (const { folder, source } of packageFolders(cwd)) {
    if (seen.has(folder)) {
      continue;
    }
    seen.add(folder);
    for (const name of await pluginsIn(folder)) {
      const plugin = { name, source, folder: join(folder, ...name.split("/")) };
      if (used.has(name)) {
        plugin.usedCopy = used.get(name);
      } else {
        used.set(name, plugin.folder);
      }
      plugins.push(plugin);
    }
  }
  return plugins;
}

// The node_modules folders to look in, nearest first, as { folder, source }:
// in `cwd` and every folder above it, as Node.js looks for packages, and then
// the global ones.
function packageFolders(cwd) {
  const folders = [];
  for (let folder = resolve(cwd); ; folder = dirname(folder)) {
    folders.push({ folder: join(folder, "node_modules"), source: "project" });
    if (dirname(folder) === folder) {
      break;
    }
  }
  return [...folders, ...globalFolders().map((folder) => ({ folder, source: "global" }))];
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

async function readPackage(folder) {
  let packageJson;
  try {
    packageJson = JSON.parse(await readFile(join(folder, "package.json"), "utf8"));
  } catch (err) {
    throw new Error(`can't read its package.json: ${err.message}`);
  }
  if (!isObject(packageJson)) {
    throw new Error("its package.json isn't a JSON object");
  }
  return packageJson;
}

// Imports a plugin and calls its register(api). The plugin adds its commands
// to a stand-in program first, so that none of them are used if register()
// fails halfway. Resolves to the commands it added.
async function registerPlugin(folder, packageJson, program, context, version) {
  const module = await import(pathToFileURL(entryPoint(folder, packageJson)).href);
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
function entryPoint(folder, packageJson) {
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
