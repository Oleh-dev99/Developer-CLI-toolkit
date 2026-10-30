# toolsmith

[![CI](https://github.com/Oleh-dev99/Developer-CLI-toolkit/actions/workflows/ci.yml/badge.svg)](https://github.com/Oleh-dev99/Developer-CLI-toolkit/actions/workflows/ci.yml)

A command-line toolkit for developers, built with Node.js.

## Usage

Install the dependencies first:

```sh
npm install
```

Then run it straight from the repository:

```sh
node bin/toolsmith.js --help
```

Or make the `toolsmith` command available globally from your local checkout:

```sh
npm link
toolsmith --help
```

### Create a project from a template

`toolsmith new` copies a template into a folder and fills in `{{name}}`, `{{author}}` and `{{year}}`, in file contents and file names. Then it runs `git init`, runs `npm install` if the template has a `package.json`, and commits the new files:

```sh
toolsmith new --list                               # the built-in templates
toolsmith new node-cli my-tool                     # creates my-tool/
toolsmith new node-lib my-lib --author "Ada Lovelace"
toolsmith new web-static --force                   # into the current folder, even if it has files
toolsmith new node-lib my-lib --no-git --no-install
```

| Template | What you get |
|---|---|
| `node-cli` | A command-line tool for Node.js, with a bin entry |
| `node-lib` | A JavaScript library for Node.js (ESM), with `node:test` tests |
| `web-static` | A static web page with HTML, CSS and JavaScript, no build step |

In a terminal, `toolsmith new` asks for whatever you didn't give on the command line. Press Enter to take the default in brackets:

```text
$ toolsmith new
Template (node-cli, node-lib, web-static, a folder or a git URL): node-lib
Project name [my-project]:
Author [Ada Lovelace]:
Run npm install? [Y/n]
```

The name defaults to the folder's name and the author to your git `user.name`. `--yes` (`-y`) takes the defaults without asking, and in scripts or CI, where the input isn't a terminal, it never asks. A folder that isn't empty is left alone unless you add `--force`.

The first commit, "Initial commit from toolsmith (node-lib)", holds the files from the template and the `package-lock.json` from `npm install`. If the folder is already inside a git repository, `git init` is skipped, and if git isn't installed you get a warning and the rest carries on. npm's output is shown as it runs; if `npm install` fails, toolsmith still commits the template's files, says so, and exits with an error. `--no-git` and `--no-install` skip either step.

#### Your own templates

Instead of a built-in name, give `toolsmith new` a folder or a git repository:

```sh
toolsmith new ../templates/api my-api                         # a folder: relative, absolute, or from ~
toolsmith new ~/templates/api my-api
toolsmith new https://github.com/you/api-template.git my-api
toolsmith new git@github.com:you/api-template.git#v2 my-api   # a branch or tag after #
```

A template is just a folder of files, with the same `{{name}}`, `{{author}}` and `{{year}}` placeholders and `_gitignore`-style dotfiles as the built-in ones; a `template.json` is optional. Git URLs can be `https://`, `ssh://` or `user@host:path`, or `file://` for a repository on your computer. toolsmith clones only the latest commit, into a temp folder that it deletes afterwards, and never copies `.git` or `node_modules` folders into your project. git isn't allowed to stop and ask for a password, so a private repository needs ssh or a git credential helper. A built-in name always wins over a folder with the same name: write `./node-cli` for the folder.

### Commit message templates

`toolsmith git template` makes `git commit` start from a ready-made message, one repository at a time:

```sh
toolsmith git template list               # built-in and your own templates
toolsmith git template show conventional  # print one
toolsmith git template use conventional   # use it in this repository
toolsmith git template unset              # stop using it
```

`use` only changes the repository's own git config, never your global one. To add your own templates, put them in `~/.toolsmithrc`; one with the same name as a built-in template replaces it:

```json
{
  "templates": {
    "team": "\n# Ticket: PROJ-123\n# Why is this change needed?\n"
  }
}
```

## Plugins

Plugins add commands to toolsmith. A plugin is an npm package named `toolsmith-plugin-<something>` or `@scope/toolsmith-plugin-<something>`, and toolsmith finds it where npm installs it:

```sh
npm install --save-dev toolsmith-plugin-deploy    # for one project
npm install --global toolsmith-plugin-deploy      # for every project
toolsmith deploy --help                           # the plugin's command, like any other
```

Project plugins are found in the `node_modules` folder of the current folder or any folder above it, as Node.js finds packages. Global plugins are found in the `node_modules` folder that toolsmith itself is installed in, and in npm's global folder (from `npm_config_prefix`, or else the default next to Node.js). When a plugin is installed in both places, the project's copy is used.

`toolsmith plugins` lists every plugin it finds, with its version, where it's from and what happened to it, and `--json` gives the same for scripts:

```text
$ toolsmith plugins
toolsmith-plugin-deploy  1.2.0  project  loaded, adds deploy
toolsmith-plugin-old     0.3.0  project  incompatible: it needs toolsmith >=2.0.0, and this is toolsmith 0.1.0
toolsmith-plugin-shout   1.0.0  global   turned off
3 plugins: 1 loaded, 1 turned off, 1 incompatible.
```

To turn a plugin off or back on, use `toolsmith plugins disable <name>` and `toolsmith plugins enable <name>`. They set the plugin to `false` or `true` in the `"plugins"` setting of `~/.toolsmithrc`, and leave the rest of the file exactly as it is. A plugin that's turned off isn't loaded at all.

```json
{
  "plugins": {
    "toolsmith-plugin-shout": false
  }
}
```

A plugin that fails to load is skipped with a warning, and the rest of toolsmith works as usual. So is a plugin made for other versions of toolsmith (see below). Built-in commands always win: a plugin command with the same name as one of them, or as a command another plugin already added, is skipped with a warning. `toolsmith plugins` shows all of this too.

> **Only install plugins you trust.** A plugin is a program that runs with your full user permissions, like anything else you install with npm: it can read and change your files and use your network. A project's plugins run whenever you use toolsmith in that project, so check what a project installs before you run toolsmith in it.

### Writing a plugin

A plugin's main file exports a `register(api)` function, where `api.command()` adds a command and returns a [Commander](https://github.com/tj/commander.js) command to describe:

```js
// index.js of the package toolsmith-plugin-shout
export function register(api) {
  api
    .command("shout")
    .description("print a greeting in capitals")
    .argument("[name]", "who to greet", "world")
    .action((name) => {
      const { greeting } = api.config.settings;
      api.output.success(`${greeting}, ${name}!`.toUpperCase());
    });
}
```

`api.config` holds the settings from `~/.toolsmithrc`, as `toolsmith config` shows them; read it inside an action. `api.output` has toolsmith's `success`, `info`, `warn` and `error` helpers, which follow its color settings, and `api.version` is toolsmith's version. Both ES modules and CommonJS (`module.exports = { register }`) work.

Say which versions of toolsmith your plugin works with in its `package.json`. toolsmith skips the plugin, with a warning that names both versions, when its own version isn't in that range. Without a range, the plugin always loads.

```json
{
  "name": "toolsmith-plugin-shout",
  "version": "1.0.0",
  "type": "module",
  "peerDependencies": {
    "toolsmith": "^0.1.0"
  },
  "peerDependenciesMeta": {
    "toolsmith": { "optional": true }
  }
}
```

Mark the peer dependency optional, as above. npm installs peer dependencies by itself, and the name `toolsmith` on npm belongs to an unrelated package, which `npm install` would otherwise fetch.

## Roadmap

toolsmith is being built in twelve milestones, from the core command framework (M1) to shell integration and self-update (M12). See [ROADMAP.md](ROADMAP.md) for each milestone's goal and task checklist.

## License

toolsmith is released under the [MIT License](LICENSE).
