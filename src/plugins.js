import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Command } from "commander";
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
// A plugin that lists its commands in its package.json ("toolsmith":
// { "commands": [...] }) is only imported when it's needed: when `command` is
// one of them, or with `all` (for help and `toolsmith plugins`). Otherwise its
// commands are stand-ins, which make their names known. Name clashes are
// settled with the names it lists, so they come out the same either way.
//
// Resolves to what happened to each plugin found, for `toolsmith plugins`:
//   name, version, source ("project" or "global"), folder
//   status           "loaded", "off" (turned off in the config file),
//                    "incompatible" or "skipped"
//   reason           why it's incompatible or skipped
//   toolsmithRange   the toolsmith versions it supports, from its
//                    peerDependencies (or null)
//   onDemand         whether it lists its commands, so it's imported only
//                    when needed
//   commands         the names of the commands it added
//   skippedCommands  { name, reason } for each command that was skipped
export async function loadPlugins(program, context, options) {
  const { enabled, version, quiet = false, command, all = false, cwd = process.cwd() } = options;
  const report = quiet ? () => {} : warn;
  // Command names and aliases, and who has them: null for toolsmith itself.
  const taken = new Map([["help", null]]);
  for (const builtIn of program.commands) {
    for (const name of [builtIn.name(), ...builtIn.aliases()]) {
      taken.set(name, null);
    }
  }

  const results = [];
  const plugins = await findPlugins(cwd);
  // All package.json files are read at once, which is faster than one by one.
  const packages = await Promise.all(plugins.map((plugin) => readPackage(plugin.folder).catch((err) => err)));
  for (const [index, plugin] of plugins.entries()) {
    const result = {
      name: plugin.name,
      version: null,
      source: plugin.source,
      folder: plugin.folder,
      status: "skipped",
      reason: null,
      toolsmithRange: null,
      onDemand: false,
      commands: [],
      skippedCommands: [],
    };
    results.push(result);
    // Takes the names of a command for this plugin, unless one of them is
    // taken already, which is reported. Returns whether it could.
    const claim = (name, names) => {
      const clash = names.find((each) => taken.has(each));
      if (clash !== undefined) {
        const owner = taken.get(clash);
        const reason = owner
          ? `the plugin ${owner} already adds "${clash}"`
          : `toolsmith has a built-in command "${clash}"`;
        skipCommand(result, name, reason, report);
        return false;
      }
      for (const each of names) {
        taken.set(each, plugin.name);
      }
      return true;
    };

    // A broken package.json only matters for a plugin that's going to be used.
    const packageJson = packages[index];
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
    const problem = await compatibilityProblem(result.toolsmithRange, version);
    if (problem) {
      result.status = "incompatible";
      result.reason = problem;
      report(`plugin ${plugin.name} was skipped: ${problem}`);
      continue;
    }
    let listed;
    try {
      listed = listedCommands(packageJson);
    } catch (err) {
      skipBroken(result, err, report);
      continue;
    }

    // A plugin that lists its commands gets their names now, whether or not
    // it's imported, and is imported only when one of them is needed.
    let claimed;
    if (listed) {
      result.onDemand = true;
      claimed = listed.filter(({ name, aliases }) => claim(name, [name, ...aliases]));
      const needed = all || claimed.some(({ name, aliases }) => command === name || aliases.includes(command));
      if (!needed) {
        result.status = "loaded";
        for (const { name, aliases } of claimed) {
          addStandIn(program, plugin.name, name, aliases);
          result.commands.push(name);
        }
        continue;
      }
    }

    let commands;
    try {
      commands = await registerPlugin(plugin.folder, packageJson, program, context, version);
    } catch (err) {
      skipBroken(result, err, report);
      continue;
    }
    result.status = "loaded";
    for (const added of commands) {
      if (listed) {
        // Its names were claimed from the list; it has to match the list.
        const entry = listed.find(({ name }) => name === added.name());
        if (!entry) {
          skipCommand(result, added.name(), 'its package.json doesn\'t list it under "toolsmith"', report);
          continue;
        }
        if (!claimed.includes(entry)) {
          continue; // Its name was taken; that's been reported.
        }
        if (entry.aliases.join("\n") !== added.aliases().join("\n")) {
          skipCommand(result, added.name(), "its aliases aren't the ones its package.json lists", report);
          continue;
        }
      } else if (!claim(added.name(), [added.name(), ...added.aliases()])) {
        continue;
      }
      program.addCommand(added);
      result.commands.push(added.name());
    }
    for (const { name } of claimed ?? []) {
      if (!commands.some((added) => added.name() === name)) {
        skipCommand(result, name, "the plugin lists it in its package.json, but doesn't add it", report);
      }
    }
  }
  return results;
}

function skipBroken(result, err, report) {
  result.reason = `it failed to load (${err.message})`;
  report(`plugin ${result.name} failed to load, so it was skipped (${err.message})`);
}

function skipCommand(result, name, reason, report) {
  result.skippedCommands.push({ name, reason });
  report(`plugin ${result.name}'s command "${name}" was skipped: ${reason}`);
}

// The commands a plugin lists in its package.json, so that it can be imported
// only when one of them runs: { "toolsmith": { "commands": [...] } }, with a
// name for each command, or { "name": ..., "aliases": [...] } for one with
// aliases. Resolves to { name, aliases } for each, or undefined if there's no
// list. Throws for a list toolsmith can't use.
function listedCommands(packageJson) {
  const listed = packageJson.toolsmith?.commands;
  if (listed === undefined) {
    return undefined;
  }
  const isText = (value) => typeof value === "string";
  const isTextList = (value) => Array.isArray(value) && value.every(isText);
  const isEntry = (entry) =>
    isText(entry) ||
    (isObject(entry) && isText(entry.name) && (entry.aliases === undefined || isTextList(entry.aliases)));
  if (!Array.isArray(listed) || !listed.every(isEntry)) {
    throw new Error('"commands" under "toolsmith" in its package.json must list command names');
  }
  return listed.map((entry) =>
    isText(entry) ? { name: entry, aliases: [] } : { name: entry.name, aliases: entry.aliases ?? [] },
  );
}

// A stand-in for a command of a plugin that isn't imported, so that its name
// is known (for suggestions after a typo). It never runs: when its name is on
// the command line, the plugin is imported before the command line is parsed,
// and the real command takes its place.
function addStandIn(program, pluginName, name, aliases) {
  program
    .command(name)
    .aliases(aliases)
    .action(() => {
      throw new Error(`the plugin ${pluginName} wasn't imported for its command "${name}"; this is a bug in toolsmith`);
    });
}

// Why this toolsmith `version` can't run a plugin that supports `range` (from
// its peerDependencies), or undefined if it can or there's no range. semver is
// only imported when there's a range to check. With includePrerelease, a
// prerelease of toolsmith is compared like any version; by default, semver
// lets it satisfy almost no range, not even ">=0.1.0".
async function compatibilityProblem(range, version) {
  if (range === null) {
    return undefined;
  }
  const [{ default: validRange }, { default: satisfies }] = await Promise.all([
    import("semver/ranges/valid.js"),
    import("semver/functions/satisfies.js"),
  ]);
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
  // Each folder once, nearest first; all of them are read at once.
  const folders = packageFolders(cwd).filter(
    ({ folder }, index, all) => all.findIndex((other) => other.folder === folder) === index,
  );
  const names = await Promise.all(folders.map(({ folder }) => pluginsIn(folder)));
  for (const [index, { folder, source }] of folders.entries()) {
    for (const name of names[index]) {
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
