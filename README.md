# toolsmith

[![CI](https://github.com/Oleh-dev99/Developer-CLI-toolkit/actions/workflows/ci.yml/badge.svg)](https://github.com/Oleh-dev99/Developer-CLI-toolkit/actions/workflows/ci.yml)

A command-line toolkit for developers, built with Node.js.

## Usage

toolsmith needs Node.js 22.12 or later. The package has a scoped name, and the command is `toolsmith`:

```sh
npm install --global @oleh-dev99/toolsmith
toolsmith --help
```

The [documentation site](https://oleh-dev99.github.io/Developer-CLI-toolkit/) has a getting-started guide, a [reference for every command](https://oleh-dev99.github.io/Developer-CLI-toolkit/commands.html), every setting, and the plugin author guide.

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

### Dashboard

`toolsmith ui` opens a full-screen dashboard in the terminal, with three panels: commands, files and, in a git repository, git status.

```sh
toolsmith ui            # ? shows every shortcut, q quits
```

The Commands panel lists every command and subcommand, plugin commands included, with their descriptions from `--help`. Enter opens a form with a field for each argument and option: type into text fields, tick checkboxes and pick choices with Space, and see the defaults. Below the form is the command line it adds up to, quoted for PowerShell on Windows and for sh elsewhere, so you can copy it. Enter runs it, after checking the values the way the command does, with its own messages (like "Use a whole number of 1 or more." for `size --top`).

The command runs as a separate toolsmith process, without a shell, and its output streams into a panel that you can scroll; lines from stderr are bold rather than colored. Esc or Ctrl+C cancels it, along with any programs it started, and the panel shows the exit code and how long it ran. Commands that can ask questions, like `new` and `git clean-branches`, only run when `--yes` is ticked in their form, because the dashboard can't answer them; otherwise the form says so, and you can run them in a terminal of their own.

The Files panel shows the current folder as a tree, leaving out `.git` and `node_modules` like the file tools do. Folders are read when you open them, and their sizes are added up in the background: a folder shows "…" until its size is known, and keys never wait for it, however big the folder. Symlinks are shown but not followed, and entries that can't be read are reported as warnings at the bottom of the screen.

- Enter on a file shows it, in a view you can scroll. Escape codes are taken out, and a binary file or one over 1 MB gets a short note instead.
- `e` edits a file in your `VISUAL` or `EDITOR` (like `code --wait`). The dashboard steps aside while the editor runs, comes back when it closes, and shows the file as it is now.
- `o` opens a file or folder in its default app: with `start` on Windows, `open` on macOS and `xdg-open` on Linux.
- `s`, `d` and `r` run `size`, `dupes` and a rename preview on the selected folder (or the folder of the selected file). The rename preview is the `rename` form, filled in with the folder, and with `--dry-run` that can't be turned off.

None of this goes through a shell. File names are passed to programs as they are: on Windows, where `start` and `.cmd` editors need cmd.exe, they reach it in environment variables, so characters like `&` and `%` in a name can't be read as commands.

The Git status panel shows the branch, its upstream and how far it is ahead and behind (or that HEAD is detached, that there's no upstream, or that it's gone), then the conflicted, staged, unstaged and untracked files, renames as `old → new`. It's read with `git status --porcelain=v2 --branch -z`, without a shell, so names with spaces, wide characters and even newlines come through as they are. Enter on a file shows it.

- `c` shows the recent commits, with `git recent`.
- `b` cleans up merged branches with `git clean-branches`: first a `--dry-run` preview of what would go, then Enter goes on to the command's form, where `--yes` must be ticked as usual (Esc instead leaves everything as it is).
- F5 or `R` reads the status again.

The dashboard watches the folder (in a repository, the whole repository, `.git` included), leaving out `node_modules`. When files change, the git status and the Files panel are read again, in the background, once for each burst of changes, and never with two `git status` running at once. Open folders get their new entries and lose the deleted ones, while the open folders, the selection and the scroll position stay where they were; a renamed file stays selected under its new name, and a renamed folder comes back closed. Folders that were opened before but are closed now are read again when they're opened. Watching stops when the dashboard ends. On Linux, where the system watches one folder at a time, the dashboard watches each folder itself, except `node_modules` and git's objects, and leaves out a folder it can't read until it can; a very big tree can still run out of watches, and the dashboard then says so, and F5 still works. Outside a git repository, or when git isn't installed, the panel isn't shown, and the other two share its space.

| Keys | What they do |
|---|---|
| Up and Down, or `k` and `j`; PgUp, PgDn, Home, End | Move in the list, or scroll the output |
| Tab and Shift+Tab, Left and Right, or `h` and `l` | Switch panels (in the Files panel, Left and Right close and open folders, and Tab switches) |
| Enter, Esc | Open the selected item, go back |
| In the Files panel: `e`, `o`, `s`, `d`, `r` | Edit, open in its default app, size report, duplicates, rename preview |
| In the Git status panel: `c`, `b`, F5 or `R` | Recent commits, clean merged branches (a dry run first; Enter goes on), read the status again |
| `/` | Filter the list as you type, in any case; Backspace edits, Enter keeps the filter, Esc clears it |
| In a form: Tab, Up, Down, Space, Enter | Go to the next or previous field, tick or choose, run the command |
| While a command runs: Esc or Ctrl+C | Cancel it |
| `?` | Show every shortcut; Esc or `?` closes the list |
| `q` or Ctrl+C | Quit (in a filter or a form, `q` is typed and Ctrl+C quits) |

The keys work the same in Windows Terminal, the classic Windows console, macOS Terminal and Linux terminals, whichever codes they send, with one exception: with Node.js 22, the classic Windows console sends Shift+Tab as a plain Tab, so use Left or `h` to go to the previous panel there.

It needs a terminal of at least 40×10, and says so in a smaller one until the window is made bigger. Because it needs a terminal for both its input and its output, it refuses to start in scripts, in CI and with its input or output redirected; use the plain commands there. Its colors follow `--no-color`, `NO_COLOR` and the `"color"` setting, and it uses only the 16 basic colors, with inverse bars that stay readable without any. Whatever ends it, including Ctrl+C and errors, the terminal is put back as it was. Rows line up with wide characters too: Chinese, Japanese and Korean characters and emoji take the two columns terminals give them.

### Project health

`toolsmith doctor` checks the project you're in and reports what it finds, the most severe first, each finding with where it is and how to fix it:

```sh
toolsmith doctor                                # the project around the current folder
toolsmith doctor --list                         # the checks
toolsmith doctor --only license --json          # one check, as JSON for a script
toolsmith doctor --fail-on warning --markdown   # in CI, with a report for the pull request
```

```text
$ toolsmith doctor
Errors

  license
    package.json:4: "license" in package.json is MIT, but LICENSE has the ISC license text
      Fix: Make them agree: set "license" to "ISC", or put the MIT license text in LICENSE.

Checked the current folder with 3 checks: audit, license, outdated.
1 error, 0 warnings, 0 info
```

Findings are grouped by severity (error, warning, info), then by check, and the report ends with a summary. `--json` prints it for scripts and `--markdown` for a pull request comment. The checks:

| Check | What it reports |
|---|---|
| `audit` | Known vulnerabilities, from `npm audit`: critical and high ones are errors, moderate ones warnings, and low ones info, each with the advisory and whether `npm audit fix` fixes it (or only with `--force`, as a major update) |
| `license` | Whether the LICENSE file has the license that `"license"` in `package.json` names. It tells MIT, ISC, Apache-2.0, the BSD and GNU licenses and a few more apart by their text, and a text it doesn't know is a warning, not a guess |
| `outdated` | Newer versions of the dependencies, from `npm outdated`, with the current, wanted and latest versions: major updates (which can break things) are warnings, minor and patch updates info, each with the command that gets it |

`audit` and `outdated` need the network, and run npm without a shell, only in projects that use npm: in a pnpm, Yarn or Bun project (told by `"packageManager"` in `package.json`, the lockfile or `node_modules`), they say so as info and don't run anything, and with signs of two package managers, they warn and don't guess.

The project is the nearest folder, from the current one up, with a `toolsmith.json`, or else a `package.json`. The `"doctor"` section of its `toolsmith.json` can ignore findings (of a whole check, or of a check in a file or on one line), change the severity of a check's findings, and set how many seconds each check may take:

```json
{
  "doctor": {
    "ignore": [{ "check": "license", "file": "COPYING.md" }],
    "severity": { "license": "warning" },
    "timeout": 60
  }
}
```

The checks run at the same time, each with a time limit (30 seconds unless you say otherwise). One that crashes or runs out of time is an error of its own, and the others still run. A check that needs the network is skipped with a warning when there's no connection, and with `--offline`. The exit code is 0 when no finding is as severe as `--fail-on` (an error, by default), and 1 when one is, or when doctor can't run, like for an unknown check or a `toolsmith.json` that isn't valid. The [project health page](https://oleh-dev99.github.io/Developer-CLI-toolkit/doctor.html) has the details.

## Plugins

Plugins add commands to toolsmith. A plugin is an npm package named `toolsmith-plugin-<something>` or `@scope/toolsmith-plugin-<something>`, and toolsmith finds it where npm installs it, in the current project (`node_modules` here or in a folder above) or globally:

```sh
npm install --save-dev toolsmith-plugin-deploy    # for one project
npm install --global toolsmith-plugin-deploy      # for every project
toolsmith deploy --help                           # the plugin's command, like any other
```

`toolsmith plugins` lists every plugin it finds, with its version, where it's from and what happened to it (`--json` for scripts):

```text
$ toolsmith plugins
toolsmith-plugin-deploy  1.2.0  project  loaded on demand, adds deploy
toolsmith-plugin-old     0.3.0  project  incompatible: it needs toolsmith >=2.0.0, and this is toolsmith 0.1.0
toolsmith-plugin-shout   1.0.0  global   turned off
3 plugins: 1 loaded, 1 turned off, 1 incompatible.
```

`toolsmith plugins disable <name>` turns a plugin off, so it isn't loaded at all, and `toolsmith plugins enable <name>` turns it back on. They change only the `"plugins"` setting in `~/.toolsmithrc`. A plugin that fails to load, or that was made for other toolsmith versions, is skipped with a warning, and built-in commands always win name clashes; the rest of toolsmith works as usual.

> **Only install plugins you trust.** A plugin is a program that runs with your full user permissions, like anything else you install with npm: it can read and change your files and use your network. A project's plugins run whenever you use toolsmith in that project, so check what a project installs before you run toolsmith in it.

To write a plugin, see the [plugin author guide](docs/PLUGINS.md), and start from the example plugin in [`examples/toolsmith-plugin-example`](examples/toolsmith-plugin-example), which adds `toolsmith todos` and `toolsmith guard`.

## Development

To work on toolsmith, clone this repository and install its dependencies. Run it with `node bin/toolsmith.js`, or run `npm link` once to make the `toolsmith` command use your checkout:

```sh
npm install
node bin/toolsmith.js --help
```

`npm test` runs every test. The dashboard's tests drive `toolsmith ui` with the codes a terminal sends for each key. Its screens at 80×24, with colors off and on, are kept as text in [test/snapshots/](test/snapshots); when a change alters one, the test shows the lines that differ, and `npm run test:update-snapshots` writes the new screens, to check in the diff before committing. On Linux and macOS, a test also runs `toolsmith ui` in a real terminal, opened with the system's `script` command; [docs/TERMINALS.md](docs/TERMINALS.md) lists what to check by hand in Windows Terminal.

The npm package holds only what toolsmith needs to run: `bin/`, `src/` and `templates/` (the `"files"` in `package.json`), with the README and the license. `npm pack --dry-run` lists it, and a test checks that the list is exactly that, so tests, docs and the example plugin never end up in the package.

The documentation site is made from the Markdown pages in [docs/](docs) with [VitePress](https://vitepress.dev/). It has its own dependencies, so they don't add to toolsmith's install or slow down its tests. To see the site with your changes while you edit:

```sh
cd docs
npm ci
npm run dev
```

The command reference, `docs/commands.md`, is made from toolsmith's own command definitions, so it shows what `--help` shows. After changing a command's arguments, options or help text, update it with `npm run docs:commands`; until you do, a test fails.

Every push to `main` publishes the site to GitHub Pages with the [docs workflow](.github/workflows/docs.yml).

Changes are listed in the [changelog](CHANGELOG.md), and [docs/RELEASING.md](docs/RELEASING.md) explains how a version is released.

## Roadmap

toolsmith is being built in twelve milestones, from the core command framework (M1) to shell integration and self-update (M12). See [ROADMAP.md](ROADMAP.md) for each milestone's goal and task checklist.

## License

toolsmith is released under the [MIT License](LICENSE).
