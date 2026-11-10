# Getting started

toolsmith is one command with a set of everyday developer tools. It creates projects from templates, tidies up git branches, summarizes commits, and finds, measures and renames files. Plugins can add more commands.

## Install

You need [Node.js](https://nodejs.org/) 22.12 or later. The `git` commands also need [git](https://git-scm.com/).

```sh
npm install --global @oleh-dev99/toolsmith
toolsmith --version
```

The package has a scoped name, but the command you run is `toolsmith`.

To update, install it again with `@latest` after the name. To remove it, run `npm uninstall --global @oleh-dev99/toolsmith`.

## Find your way around

Every command explains itself, with examples:

```sh
toolsmith --help
toolsmith new --help
toolsmith git recent --help
```

The [command reference](./commands.md) has the same help for every command on one page.

Commands that report data, like `size`, `dupes`, `git recent` and `plugins`, can print it as JSON with `--json`. Two options work with every command: `--no-color` turns colors off, and `--debug` shows the stack trace of an error.

## Create a project

```sh
toolsmith new --list
toolsmith new node-cli my-tool
```

`toolsmith new` copies a template into a new folder and fills in the project's name, author and year. Then it runs `git init`, runs `npm install` if the template has a `package.json`, and makes the first commit. Add `--no-git` or `--no-install` to skip those steps.

| Template | What you get |
|---|---|
| `node-cli` | A command-line tool for Node.js, with a bin entry |
| `node-lib` | A JavaScript library for Node.js (ESM), with `node:test` tests |
| `web-static` | A static web page with HTML, CSS and JavaScript, no build step |

With no arguments, it asks for what it needs. A template can also be a folder of your own, or a git repository:

```sh
toolsmith new
toolsmith new ~/templates/api my-api
toolsmith new https://github.com/you/api-template.git my-api
```

A folder that isn't empty is left alone unless you add `--force`.

## Tidy up git branches

```sh
toolsmith git clean-branches --dry-run
toolsmith git clean-branches
```

The first command lists the branches that are already merged, and the second asks before deleting them. Squash-merged branches count too. The current branch, the base branch and your [protected branches](./configuration.md#protectedbranches) are never deleted.

## See what changed recently

```sh
toolsmith git recent
toolsmith git recent --mine --since yesterday --markdown
toolsmith git recent --from v0.1.0 --group type --markdown
```

Without options, it shows the commits of the last 7 days. `--markdown` is handy for a stand-up or for release notes.

## Start commits from a template

```sh
toolsmith git template list
toolsmith git template use conventional
```

After `use`, `git commit` in that repository starts from the template's text. It changes only that repository's git config, never your global one, and `toolsmith git template unset` undoes it. You can add [templates of your own](./configuration.md#templates).

## Work with files

```sh
toolsmith size
toolsmith dupes
toolsmith rename IMG_ photo_ --dry-run
toolsmith rename IMG_ photo_
```

- `size` shows the biggest files and folders under the current folder.
- `dupes` finds files with identical content. It only reports them, and never deletes anything.
- `rename` replaces text in file names. It renames straight away, so use `--dry-run` first to see the new names. If any new name would clash with another file, nothing is renamed.

All three skip `.git` and `node_modules`. `dupes` and `rename` also take files, folders or quoted patterns like `'*.jpg'`; see [dupes](./commands.md#toolsmith-dupes) and [rename](./commands.md#toolsmith-rename) in the command reference for the details.

## Add plugins

A plugin is an npm package named `toolsmith-plugin-<something>` that adds commands to toolsmith. Install it like any other package, for one project or for all of them, and `toolsmith plugins` shows what it found:

```sh
npm install --global toolsmith-plugin-<something>
toolsmith plugins
```

::: warning Only install plugins you trust
A plugin is a program that runs with your full user permissions: it can read and change your files and use your network. A project's plugins run whenever you use toolsmith in that project, so check what a project installs before you run toolsmith in it.
:::

## Next steps

- [Command reference](./commands.md): every command, with its arguments and options.
- [Configuration](./configuration.md): every setting in `~/.toolsmithrc`.
- [Writing plugins](./plugins.md): add your own commands.
