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

## Roadmap

toolsmith is being built in twelve milestones, from the core command framework (M1) to shell integration and self-update (M12). See [ROADMAP.md](ROADMAP.md) for each milestone's goal and task checklist.

## License

toolsmith is released under the [MIT License](LICENSE).
