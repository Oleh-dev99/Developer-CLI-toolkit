<!-- Made by scripts/command-reference.js from toolsmith's command definitions. After changing a command, run "npm run docs:commands" instead of editing this file. -->

# Command reference

Every built-in command, with what `toolsmith <command> --help` shows for it. Each command also takes `-h, --help`, and toolsmith's own `--debug` and `--no-color` work with all of them. Commands that plugins add aren't listed here, but `toolsmith --help` shows them.

## toolsmith

A command-line toolkit for developers.

```text
toolsmith [options] [command]
```

| Option | Description |
|---|---|
| `-V, --version` | output the version number |
| `--debug` | show stack traces for errors |
| `--no-color` | disable colored output |

| Command | Description |
|---|---|
| [`config`](#toolsmith-config) | show the config file in use and the effective settings |
| [`dupes [options] [paths...]`](#toolsmith-dupes) | find files with identical content (report only, nothing is deleted) |
| [`git`](#toolsmith-git) | git helpers: clean up merged branches, summarize commits, commit message templates |
| [`hello [name]`](#toolsmith-hello) | print a friendly greeting |
| [`new [options] [template] [directory]`](#toolsmith-new) | create a project from a template |
| [`plugins [options]`](#toolsmith-plugins) | list the installed plugins, or turn one on or off |
| [`rename [options] <find> <replace> [paths...]`](#toolsmith-rename) | find and replace text in file names |
| [`size [options] [path]`](#toolsmith-size) | show the biggest folders and files under a folder |
| [`ui`](#toolsmith-ui) | open a full-screen dashboard in the terminal |

## toolsmith config

Show the config file in use and the effective settings.

```text
toolsmith config [options]
```

```text
Settings are read from ~/.toolsmithrc, or from the file named by the
TOOLSMITH_CONFIG environment variable. The file is JSON, for example:
  { "color": false, "greeting": "Hi" }

Example:
  $ toolsmith config
```

## toolsmith dupes

Find files with identical content (report only, nothing is deleted).

```text
toolsmith dupes [options] [paths...]
```

| Argument | Description |
|---|---|
| `paths` | files, folders or quoted glob patterns like '\*.jpg' (default: the current folder) |

| Option | Description |
|---|---|
| `--min-size <size>` | ignore files smaller than this, like 10KB or 5MB (default: 0) |
| `--json` | print the result as JSON |

```text
Examples:
  Find duplicates in this folder and all its subfolders:
  $ toolsmith dupes

  Only files of at least 100 KB, in two folders:
  $ toolsmith dupes --min-size 100KB Pictures Downloads

  Only .jpg files (in subfolders too), as JSON for a script:
  $ toolsmith dupes '*.jpg' --json

Files are compared by content (SHA-256), not by name. Hard links to the same
data count as one file. Empty files, .git and node_modules are skipped. Sizes
use 1 KB = 1024 bytes. Nothing is deleted.
```

## toolsmith git

Git helpers: clean up merged branches, summarize commits, commit message templates.

```text
toolsmith git [options] [command]
```

| Command | Description |
|---|---|
| [`clean-branches [options]`](#toolsmith-git-clean-branches) | delete local branches that are already merged into the base branch |
| [`recent [options]`](#toolsmith-git-recent) | summarize recent commits |
| [`template`](#toolsmith-git-template) | commit message templates that git commit starts from |

## toolsmith git clean-branches

Delete local branches that are already merged into the base branch.

```text
toolsmith git clean-branches [options]
```

| Option | Description |
|---|---|
| `--base <name>` | the branch to compare with (default: main, or else master) |
| `--remote` | also delete merged branches on origin (asks separately) |
| `-y, --yes` | delete without asking |
| `--dry-run` | only list the branches, delete nothing |

```text
Examples:
  See which branches would be deleted:
  $ toolsmith git clean-branches --dry-run

  Compare with "develop", and also clean up origin (asks separately):
  $ toolsmith git clean-branches --base develop --remote

Merged branches are deleted with "git branch -d", which refuses any branch that
isn't fully merged into the current branch. Squash-merged branches look unmerged
to git, so they're deleted with "git branch -D"; a branch counts as
squash-merged only if all of its changes are already in the base. The current
branch, the base branch and the "protectedBranches" in ~/.toolsmithrc (default:
main, master and develop) are never deleted, here or on origin. --remote runs
"git fetch --prune" first.
```

## toolsmith git recent

Summarize recent commits.

```text
toolsmith git recent [options]
```

| Option | Description |
|---|---|
| `--since <date>` | only commits after this, like "1 week ago" or 2024-03-01 (default: 7 days ago) |
| `--until <date>` | only commits before this |
| `--from <ref>` | only commits since this tag or commit, like v0.1.0 |
| `--author <name>` | only commits whose author name or email contains this |
| `--mine` | only your own commits (by your git user.email) |
| `--group <by>` | group by author or by Conventional Commits type (choices: "author", "type") |
| `--merges` | include merge commits |
| `--markdown` | print Markdown, for a stand-up or release notes |
| `--json` | print the commits as JSON |

```text
Examples:
  What happened in the last 7 days:
  $ toolsmith git recent

  Your own commits since yesterday, for a stand-up:
  $ toolsmith git recent --mine --since yesterday --markdown

  Release notes since the last tag, by type:
  $ toolsmith git recent --from v0.1.0 --group type --markdown

  Who did what this month:
  $ toolsmith git recent --since "1 month ago" --group author

Commits are newest first. --group type sorts subjects like "feat: …" or
"fix(auth): …" into feat, fix, docs, refactor, test and chore, and everything
else into "other". Merge commits are left out unless you add --merges.
```

## toolsmith git template

Commit message templates that git commit starts from.

```text
toolsmith git template [options] [command]
```

| Command | Description |
|---|---|
| [`list`](#toolsmith-git-template-list) | show the templates, and which one this repository uses |
| [`show <name>`](#toolsmith-git-template-show) | print a template |
| [`use <name>`](#toolsmith-git-template-use) | make git commit in this repository start from a template |
| [`unset`](#toolsmith-git-template-unset) | stop using a template in this repository |

```text
Examples:
  See the templates, and which one this repository uses:
  $ toolsmith git template list

  Start every commit in this repository from the Conventional Commits guide:
  $ toolsmith git template use conventional

Add your own templates to ~/.toolsmithrc as "templates": { "name": "text" };
one with the same name as a built-in template replaces it. "use" changes only
this repository's git config, never your global one.
```

## toolsmith git template list

Show the templates, and which one this repository uses.

```text
toolsmith git template list [options]
```

## toolsmith git template show

Print a template.

```text
toolsmith git template show [options] <name>
```

| Argument | Description |
|---|---|
| `name` | the template to show |

## toolsmith git template use

Make git commit in this repository start from a template.

```text
toolsmith git template use [options] <name>
```

| Argument | Description |
|---|---|
| `name` | the template to use |

## toolsmith git template unset

Stop using a template in this repository.

```text
toolsmith git template unset [options]
```

## toolsmith hello

Print a friendly greeting.

```text
toolsmith hello [options] [name]
```

| Argument | Description |
|---|---|
| `name` | who to greet (default: "world") |

```text
Examples:
  $ toolsmith hello
  Hello, world!

  $ toolsmith hello Ada
  Hello, Ada!

To change "Hello", set "greeting" in ~/.toolsmithrc.
```

## toolsmith new

Create a project from a template.

```text
toolsmith new [options] [template] [directory]
```

| Argument | Description |
|---|---|
| `template` | a built-in template like node-cli, a folder, or a git URL (add #branch or #tag) |
| `directory` | the folder to create the project in (default: the current folder) |

| Option | Description |
|---|---|
| `--list` | show the built-in templates |
| `--name <name>` | the project name (default: the folder's name) |
| `--author <name>` | the author (default: your git user.name) |
| `-y, --yes` | don't ask anything, take the defaults |
| `--force` | write into a folder that isn't empty, replacing files with the same names |
| `--no-git` | don't run git init or make a first commit |
| `--no-install` | don't run npm install |

```text
Examples:
  Answer a few questions (template, name, author, npm install):
  $ toolsmith new

  Create the folder my-tool from the node-cli template:
  $ toolsmith new node-cli my-tool

  The same without any questions, for a script:
  $ toolsmith new node-cli my-tool --yes

  Only the files, without git init or npm install:
  $ toolsmith new node-lib my-lib --no-git --no-install

  Use the current folder even though it has files in it, with another author:
  $ toolsmith new node-cli --force --author "Ada Lovelace"

  Use your own template, from a folder or from a git repository's v2 tag:
  $ toolsmith new ~/templates/api my-api
  $ toolsmith new https://github.com/you/api-template.git#v2 my-api

In a terminal, toolsmith asks for whatever you didn't give on the command line;
press Enter to take the default in brackets. With --yes, or when the input
isn't a terminal (scripts, CI), it never asks. Templates can use {{name}},
{{author}} and {{year}} in file contents and in file and folder names; see the
built-in ones with --list. A built-in template's name always wins over a folder
with the same name; write ./node-cli for the folder.

After writing the files, toolsmith runs git init (unless the folder is already
in a git repository), then npm install if the template has a package.json, and
then makes the first commit.
```

## toolsmith plugins

List the installed plugins, or turn one on or off.

```text
toolsmith plugins [options] [command]
```

| Option | Description |
|---|---|
| `--json` | print the list as JSON |

| Command | Description |
|---|---|
| [`enable <plugin>`](#toolsmith-plugins-enable) | turn a plugin on in ~/.toolsmithrc |
| [`disable <plugin>`](#toolsmith-plugins-disable) | turn a plugin off in ~/.toolsmithrc |

```text
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
the file as it is.
```

## toolsmith plugins enable

Turn a plugin on in ~/.toolsmithrc.

```text
toolsmith plugins enable [options] <plugin>
```

| Argument | Description |
|---|---|
| `plugin` | the plugin's package name, like toolsmith-plugin-deploy |

## toolsmith plugins disable

Turn a plugin off in ~/.toolsmithrc.

```text
toolsmith plugins disable [options] <plugin>
```

| Argument | Description |
|---|---|
| `plugin` | the plugin's package name, like toolsmith-plugin-deploy |

## toolsmith rename

Find and replace text in file names.

```text
toolsmith rename [options] <find> <replace> [paths...]
```

| Argument | Description |
|---|---|
| `find` | text to find (a regular expression with --regex) |
| `replace` | replacement text; with --regex, $1, $2, … insert captured groups |
| `paths` | files, folders or quoted glob patterns like '\*.jpg' (default: the current folder) |

| Option | Description |
|---|---|
| `-r, --recursive` | include files in subfolders (default: false) |
| `--regex` | treat &lt;find&gt; as a regular expression |
| `--dry-run` | show what would be renamed, without renaming anything |

```text
Examples:
  Preview replacing "IMG_" with "photo_" in this folder:
  $ toolsmith rename IMG_ photo_ --dry-run

  Only .png files, in photos/ and all its subfolders:
  $ toolsmith rename IMG_ photo_ 'photos/**/*.png'

  Turn "IMG_20240501_beach.jpg" into "2024-05-01 beach.jpg", in subfolders too:
  $ toolsmith rename --regex 'IMG_(\d{4})(\d{2})(\d{2})_' '$1-$2-$3 ' -r

Quote glob patterns ('*.jpg') so toolsmith expands them itself, the same way on
every system. With -r, a pattern without "/" also matches in subfolders.

Only file names change, never folder names, and every match in a name is
replaced. Case-only renames (readme.md → README.md) work everywhere. .git and
node_modules are skipped. Nothing is renamed if any new name would clash with
another file. In bash, zsh and PowerShell, put $1 in single quotes so the shell
leaves it alone.
```

## toolsmith size

Show the biggest folders and files under a folder.

```text
toolsmith size [options] [path]
```

| Argument | Description |
|---|---|
| `path` | the folder to measure (default: the current folder) |

| Option | Description |
|---|---|
| `--depth <n>` | how many folder levels to show, or "all" (default: 1) |
| `--top <n>` | how many entries to show (default: 10) |
| `--files-only` | show only files |
| `--folders-only` | show only folders |
| `--all` | include .git and node\_modules |
| `--json` | print the result as JSON |

```text
Examples:
  The 10 biggest files and folders right here:
  $ toolsmith size

  Two levels deep in Downloads, the top 20:
  $ toolsmith size Downloads --depth 2 --top 20

  The biggest files anywhere below this folder:
  $ toolsmith size --files-only --depth all

Folder sizes include everything inside them, and percentages are shares of the
total. Hard-linked files count once. .git and node_modules are skipped unless
you add --all. Sizes use 1 KB = 1024 bytes.
```

## toolsmith ui

Open a full-screen dashboard in the terminal.

```text
toolsmith ui [options]
```

```text
Example:
  $ toolsmith ui

The Commands panel lists every command, plugin commands included. Enter opens
a form for its arguments and options, shows the command line they add up to,
and runs it, with its output in a panel that scrolls; Esc or Ctrl+C cancels a
command that's still running. A command that can ask questions only runs with
--yes ticked; otherwise run it in a terminal of its own.

The Files panel shows the current folder as a tree, without .git and
node_modules, with sizes. Right or Enter opens a folder and Left closes it;
Enter on a file shows it. e edits a file in $VISUAL or $EDITOR, o opens a file
or folder in its default app, and s, d and r run size, dupes and a rename
preview (--dry-run) on the selected folder.

In a git repository, the Git status panel shows the branch, how far it is ahead
of and behind its upstream, and the staged, unstaged, conflicted and untracked
files; Enter on a file shows it. c shows recent commits (git recent), and b
cleans up merged branches: a --dry-run preview first, then Enter goes on to the
form, where --yes must be ticked. The folder is watched, so the Files panel
(the open folders' entries and the sizes) and the git status keep up with
changes made elsewhere; F5 or R reads the status again. Outside a repository,
or without git, the other panels share its space.

In the dashboard, ? shows every shortcut. Arrow keys or h, j, k and l move,
Tab and Shift+Tab switch panels, Enter opens, Esc goes back, / filters the list
as you type, and q or Ctrl+C quits. With Node.js 22, the classic Windows
console sends Shift+Tab as Tab; Left or h goes to the previous panel there.

The dashboard needs a terminal of at least 40x10, and says so in a smaller one
until the window is made bigger. Its colors follow --no-color, NO_COLOR and the
"color" setting, like the other commands.

It needs a terminal for both its input and its output, so it doesn't run in
scripts, in CI, or with its input or output redirected. Use the plain commands
there, like toolsmith size or toolsmith git recent.
```
