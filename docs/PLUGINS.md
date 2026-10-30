# Writing toolsmith plugins

A plugin adds commands to toolsmith. It's an ordinary npm package with a name that starts with `toolsmith-plugin-`, and toolsmith finds it where npm installs it. This guide covers everything a plugin can do and how toolsmith treats it.

The quickest start is the example plugin in [`examples/toolsmith-plugin-example`](../examples/toolsmith-plugin-example): a small but complete plugin with two commands and its own tests. Copy it, and change what you need.

## A plugin in short

```json
{
  "name": "toolsmith-plugin-hello-world",
  "version": "1.0.0",
  "type": "module",
  "exports": "./index.js",
  "keywords": ["toolsmith-plugin"],
  "toolsmith": {
    "commands": ["hi"]
  },
  "peerDependencies": {
    "toolsmith": "^0.1.0"
  },
  "peerDependenciesMeta": {
    "toolsmith": { "optional": true }
  }
}
```

```js
// index.js
export function register(api) {
  api
    .command("hi")
    .description("say hi")
    .argument("[name]", "who to greet", "world")
    .action((name) => api.output.success(`${api.config.settings.greeting}, ${name}, from a plugin!`));
}
```

That's all: the package name makes it a plugin, `register(api)` adds its commands, the `"toolsmith"` list lets toolsmith start without importing it, and the peer dependency says which toolsmith versions it works with. The rest of this guide explains each part.

## Naming

toolsmith loads packages named `toolsmith-plugin-<something>` or `@scope/toolsmith-plugin-<something>`, and nothing else. The part after `toolsmith-plugin-` is up to you; it doesn't have to match your command names. Adding the keyword `toolsmith-plugin` helps people find your plugin on npm.

## The `register(api)` function

The package's main file exports a function named `register`. toolsmith finds that file the way Node.js does for an `import`: from `"exports"` (the `"."` entry, with the `import`, `node` or `default` condition), or else from `"main"`, or else `index.js`. Give the full file name; toolsmith doesn't try extensions. Both ES modules and CommonJS work (`module.exports = { register }`).

toolsmith calls `register(api)` once per run, before it runs the command, and waits for it if it returns a promise. (A plugin that lists its commands is only imported, and `register()` only called, when it's needed; see below.) `register()` should only add commands; leave the real work to the commands' actions, so that toolsmith stays fast and a problem in your plugin shows up only when its command runs.

`api` has:

| | |
|---|---|
| `api.command("name <arg> [optional]")` | Adds a command and returns it, as [Commander](https://github.com/tj/commander.js)'s `program.command()` does. Describe it with `.description()`, `.argument()`, `.option()`, `.alias()`, `.addHelpText()` and `.action()`. It comes from toolsmith's own copy of Commander (version 15), so your plugin doesn't need Commander as a dependency. |
| `api.config` | The settings from `~/.toolsmithrc`, with command-line flags applied, as `toolsmith config` shows them: `{ path, found, settings }`. It's set just before a command runs, so read it inside an action, not in `register()`. |
| `api.output` | toolsmith's `success` and `info` (to stdout), and `warn` and `error` (to stderr, as `warning: ...` and `error: ...`). They follow toolsmith's color settings: `--no-color`, `NO_COLOR` and `"color": false`. Print plain results, like a list, with `console.log`. |
| `api.version` | toolsmith's version, like `"0.1.0"`. |

The settings are `color`, `greeting`, `protectedBranches`, `templates` and `plugins`; see the main [README](../README.md). A plugin can't have settings of its own in `~/.toolsmithrc` yet: toolsmith warns about any setting it doesn't know. Use options or environment variables for now.

To report a problem from a command, throw an `Error`. toolsmith prints `error: <message>`, sets exit code 1, and shows the stack trace only with `--debug`. Don't call `process.exit()`.

Every toolsmith command has `--help` text with at least one example, and `--json` output when it reports data. Plugin commands look the same to users, so follow that convention too: the example plugin shows how.

## List your commands, for a fast startup

Without a list, toolsmith imports your plugin every time it runs, for every command, which adds up when people have many plugins. With a list under `"toolsmith"` in `package.json`, toolsmith imports your plugin only when it needs it:

```json
{
  "toolsmith": {
    "commands": ["todos", { "name": "guard", "aliases": ["g"] }]
  }
}
```

Each entry is a command name, or `{ "name", "aliases" }` for a command with aliases. toolsmith then imports your plugin:

- when one of its commands (or aliases) runs, including `toolsmith <command> --help`,
- for toolsmith's own help (`toolsmith --help` and `toolsmith help`), which describes every command,
- for `toolsmith plugins`, which shows what each plugin added.

For every other command, it only adds stand-ins with your command names, so that a typo still gets "Did you mean ...?". On a test machine, ten plugins of about 20 KB each made every toolsmith command about 27 ms slower without a list, and at most about 10 ms with one.

The list has to match what `register()` adds. When toolsmith imports your plugin, it compares the two, and skips with a warning a command that isn't listed, a listed command that isn't added, and a command whose aliases differ from the list. A test that keeps them in sync is short; see `test/commands.test.js` in the example plugin. One more difference: a listed plugin that fails to import can only say so when toolsmith imports it, not on every run.

`toolsmith plugins` shows `loaded on demand` for a plugin with a list.

## Say which toolsmith versions you support

Give the range of toolsmith versions your plugin works with as a peer dependency, and mark it optional:

```json
{
  "peerDependencies": {
    "toolsmith": "^0.1.0"
  },
  "peerDependenciesMeta": {
    "toolsmith": { "optional": true }
  }
}
```

When toolsmith's version isn't in that range, it skips your plugin, before importing anything, with one warning that names both versions:

```text
warning: plugin toolsmith-plugin-hello-world was skipped: it needs toolsmith ^2.0.0, and this is toolsmith 0.1.0
```

- Without a range, the plugin always loads.
- toolsmith checks the range with [semver](https://github.com/npm/node-semver), the library npm uses. A range it can't read, like `"latest"`, also skips the plugin.
- A prerelease of toolsmith, like `1.0.0-beta.1`, is compared like any other version, so a range like `>=0.1.0` includes it.

Mark the peer dependency optional. npm installs peer dependencies by itself, and the name `toolsmith` on npm belongs to an unrelated package (see [Publishing](#publishing)), which `npm install` would otherwise fetch into your users' projects.

## Name clashes

Every command name and alias belongs to one command:

- Built-in commands always win, and so does `help`. A plugin command with one of their names is skipped with a warning:

  ```text
  warning: plugin toolsmith-plugin-x's command "hello" was skipped: toolsmith has a built-in command "hello"
  ```

- Between plugins, the one found first wins: plugins in the project before global ones, the nearest `node_modules` folder first, and then by package name. The other command is skipped with a warning that names the plugin that has it.
- A clash on an alias skips the whole command.

`toolsmith plugins` lists the skipped commands of every plugin, with the reason. Avoid clashes by choosing specific names: `deploy` is likely to clash with another plugin, `acme-deploy` isn't.

## Where toolsmith finds plugins

- **In a project:** in the `node_modules` folder of the current folder and of every folder above it, the way Node.js finds packages. Plugins installed with `npm install --save-dev` go there.
- **Globally:** in the `node_modules` folder that toolsmith itself is installed in, and in npm's global folder, under `npm_config_prefix` if that's set or else next to Node.js (and in `%APPDATA%\npm` on Windows). Plugins installed with `npm install --global` go there.

When a plugin is in more than one place, the nearest copy is used, so a project can have its own version of a plugin that's also installed globally. `toolsmith plugins` lists the other copies as skipped.

## Turning plugins on and off

Users turn a plugin off with `toolsmith plugins disable <name>` and back on with `toolsmith plugins enable <name>`. They set `"plugins": { "<name>": false }` (or `true`) in `~/.toolsmithrc` and leave the rest of the file as it is. A plugin that's turned off isn't imported at all, so turning it off also helps when a broken plugin keeps printing warnings.

## Testing your plugin

**Unit tests** don't need toolsmith. Call `register()` with a stand-in for `api`: Commander as a dev dependency (`npm install --save-dev commander@15`) gives you a real `program.command()`, so your commands parse their arguments and options exactly as they will in toolsmith:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { Command } from "commander";
import { register } from "../index.js";

function withPlugin(settings = {}) {
  const program = new Command().exitOverride();
  const messages = [];
  const say = (kind) => (message) => messages.push(`${kind}: ${message}`);
  register({
    version: "0.1.0",
    command: (nameAndArgs) => program.command(nameAndArgs),
    config: { path: "/home/you/.toolsmithrc", found: false, settings: { greeting: "Hello", ...settings } },
    output: { success: say("success"), info: say("info"), warn: say("warning"), error: say("error") },
  });
  return { messages, run: (...args) => program.parseAsync(args, { from: "user" }) };
}

test("hi greets with the configured greeting", async () => {
  const { messages, run } = withPlugin({ greeting: "Hi" });
  await run("hi", "Ada");
  assert.deepEqual(messages, ["success: Hi, Ada, from a plugin!"]);
});
```

**Try it for real** by installing your plugin's folder into a project:

```sh
cd some-project
npm install --save-dev ../toolsmith-plugin-hello-world
toolsmith plugins          # is it there, loaded on demand, with the commands you expect?
toolsmith hi --help
toolsmith hi Ada
```

npm links the folder instead of copying it, so your changes show up in toolsmith right away, without installing again. `npm install --global ../toolsmith-plugin-hello-world` does the same for every project. If something's wrong, toolsmith's warnings and `toolsmith plugins` (or `toolsmith plugins --json`) say what: a skipped command, an incompatible version range, or the error your plugin threw while loading.

## Publishing

> **toolsmith's npm package name will change before it's published.** toolsmith isn't on npm yet, and the name `toolsmith` there belongs to an unrelated package. When toolsmith is published under its own name, that name replaces `toolsmith` in the peer dependency above, and this guide and the example plugin will be updated. Until then, keep the peer dependency optional, as shown.

Publish a plugin like any npm package (`npm publish`). Before you do:

- check that the package name starts with `toolsmith-plugin-` (or `@scope/toolsmith-plugin-`),
- list your commands under `"toolsmith"`, and give a version range,
- keep `register()` light, and your dependencies few,
- don't add install scripts (`preinstall`, `postinstall`): your users shouldn't have to run your code just to install it.

## Security

A plugin runs with the full permissions of the person using toolsmith: it can read and change their files, run programs, and use the network. The README tells users to install only plugins they trust, and that a project's plugins run whenever they use toolsmith in that project. Earn that trust:

- Do what your commands say, and nothing else; in particular, nothing in `register()` or at import time.
- Run programs without a shell (`execFile` or `spawn` with an array of arguments, as the example's `lib/git.js` does), so that file names and other input can't turn into commands.
- Explain in your README what your plugin reads, changes and sends anywhere.
