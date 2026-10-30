import { createRequire } from "node:module";
import { writeSetting } from "../config.js";
import { count } from "../lib/format.js";
import { info, success } from "../output.js";

const { version } = createRequire(import.meta.url)("../../package.json");

// How each status reads in the summary line, in this order.
const statuses = { loaded: "loaded", off: "turned off", incompatible: "incompatible", skipped: "skipped" };

export function register(program, context) {
  const plugins = program
    .command("plugins")
    .description("list the installed plugins, or turn one on or off")
    .option("--json", "print the list as JSON")
    .addHelpText(
      "after",
      `
Examples:
  $ toolsmith plugins
  $ toolsmith plugins --json
  $ toolsmith plugins disable toolsmith-plugin-deploy
  $ toolsmith plugins enable toolsmith-plugin-deploy

Plugins are npm packages named toolsmith-plugin-* or @scope/toolsmith-plugin-*,
found in the current project's node_modules and in the global one. Each is
listed with its version, where it was found and its status: loaded (with the
commands it adds), turned off, incompatible (toolsmith's version isn't in the
range its peerDependencies give) or skipped (with the reason). enable and
disable change the "plugins" setting in ~/.toolsmithrc and leave the rest of
the file as it is.`,
    )
    .action((options) => list(context.plugins, options));

  for (const [name, on] of [
    ["enable", true],
    ["disable", false],
  ]) {
    plugins
      .command(name)
      .description(`turn a plugin ${on ? "on" : "off"} in ~/.toolsmithrc`)
      .argument("<plugin>", "the plugin's package name, like toolsmith-plugin-deploy")
      .action((plugin) => turn(context, plugin, on));
  }
}

function list(plugins, { json }) {
  if (json) {
    const shown = plugins.map((plugin) => ({
      name: plugin.name,
      version: plugin.version,
      source: plugin.source,
      path: plugin.folder,
      status: plugin.status,
      reason: plugin.reason,
      toolsmithRange: plugin.toolsmithRange,
      commands: plugin.commands,
      skippedCommands: plugin.skippedCommands,
    }));
    console.log(JSON.stringify({ toolsmith: version, plugins: shown }, null, 2));
    return;
  }
  if (plugins.length === 0) {
    info('No plugins found. Plugins are npm packages named toolsmith-plugin-*; see "toolsmith plugins --help".');
    return;
  }

  const versions = plugins.map((plugin) => plugin.version ?? "-");
  const widest = (values) => Math.max(...values.map((value) => value.length));
  const nameWidth = widest(plugins.map((plugin) => plugin.name));
  const versionWidth = widest(versions);
  const sourceWidth = widest(plugins.map((plugin) => plugin.source));
  plugins.forEach((plugin, index) => {
    const columns = [
      plugin.name.padEnd(nameWidth),
      versions[index].padEnd(versionWidth),
      plugin.source.padEnd(sourceWidth),
      describe(plugin),
    ];
    console.log(columns.join("  "));
    for (const { name, reason } of plugin.skippedCommands) {
      console.log(`  its command "${name}" was skipped: ${reason}`);
    }
  });

  const tally = Object.entries(statuses)
    .map(([status, words]) => [plugins.filter((plugin) => plugin.status === status).length, words])
    .filter(([n]) => n > 0)
    .map(([n, words]) => `${n} ${words}`);
  info(`${count(plugins.length, "plugin")}: ${tally.join(", ")}.`);
}

function describe({ status, reason, commands }) {
  if (status === "loaded") {
    return commands.length > 0 ? `loaded, adds ${commands.join(", ")}` : "loaded, adds no commands";
  }
  return status === "off" ? "turned off" : `${status}: ${reason}`;
}

// Turns the plugin `name` on or off in the "plugins" setting of the config
// file, unless it already is.
function turn(context, name, on) {
  if (!context.plugins.some((plugin) => plugin.name === name)) {
    throw new Error(`there's no plugin named "${name}"; see "toolsmith plugins"`);
  }
  const { path, settings } = context.config;
  const word = on ? "on" : "off";
  if ((settings.plugins[name] !== false) === on) {
    info(`${name} is already turned ${word}.`);
    return;
  }
  writeSetting(path, "plugins", { ...settings.plugins, [name]: on });
  success(`Turned ${word} ${name} (in ${path}).`);
}
