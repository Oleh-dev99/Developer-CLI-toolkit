# Roadmap

toolsmith is being built in twelve milestones. M1 is the foundation that every later milestone builds on. Tick a box when its task lands on `main`.

## Every command ships with

- `--help` text with at least one usage example
- Tests (`node:test`)
- Support for Windows, macOS and Linux
- Documentation in the README (and on the docs site once M6 is done)
- `--json` output, if the command reports data
- `--dry-run`, if the command changes files or branches
- A confirmation prompt before deleting anything (`--yes` skips it)

## M1 — Core

**Goal:** The foundation every later command builds on: a command framework, consistent output, user configuration, tests and CI.

### Command framework

- [x] Add `commander`; keep `bin/toolsmith.js` a thin entry point, with each command in its own module under `src/commands/`
- [x] `toolsmith --help` lists every command, and each command has its own `--help`
- [x] `--version` reads the version from `package.json` instead of a hard-coded string
- [x] Errors print a short message to stderr and exit with a non-zero code; `--debug` adds the stack trace
- [x] Set the minimum supported Node.js version (`engines` in `package.json`)

### Colored output

- [x] Output helpers for success, info, warning and error messages, colored with Node's built-in `util.styleText` (or `picocolors`)
- [x] Respect `NO_COLOR`, `FORCE_COLOR` and `--no-color`, and drop colors when output isn't a terminal (pipes, CI logs)

### Configuration — `~/.toolsmithrc`

- [x] Read `~/.toolsmithrc` (JSON) from the folder returned by `os.homedir()`, so it works on every OS
- [x] Merge it over built-in defaults; command-line flags override it
- [x] Invalid JSON or values give a clear error that names the file; unknown settings only warn
- [x] `TOOLSMITH_CONFIG` environment variable points to a different file (tests use it to stay out of the real home folder)
- [x] `toolsmith config` shows which file is in use and the effective settings

### Tests — `node:test`

- [x] `npm test` runs the suite with `node --test`
- [x] Test helper that runs the CLI as a child process and captures stdout, stderr and the exit code
- [x] Tests for `--help`, `--version`, unknown commands and config loading
- [x] `npm run test:coverage` using Node's built-in coverage report

### Continuous integration — GitHub Actions

- [ ] Run the tests on every push and pull request
- [ ] Test on Linux, macOS and Windows, with every supported Node.js LTS version (including 22.12, the minimum in `engines`)
- [ ] Protect `main` so pull requests can only merge when CI passes

## M2 — File tools

**Goal:** Everyday file utilities that stay fast on large folders and let you preview every change before it happens.

### Shared

- [ ] One directory walker for all file tools: ignore patterns, doesn't follow symlinks (so loops can't hang a scan), reports unreadable files as warnings instead of crashing
- [ ] Tests build their fixture folders in a temporary directory

### Bulk rename — `toolsmith rename`

- [ ] Find and replace in file names, as plain text or a regular expression with capture groups (`$1`)
- [ ] Select files with glob patterns, optionally including subfolders; toolsmith expands the patterns itself because Windows shells don't
- [ ] `--dry-run` prints an old → new table and changes nothing
- [ ] Plan every rename up front and stop before touching anything if two files would get the same name or a target already exists
- [ ] Handle case-only renames (`readme.md` → `README.md`) on case-insensitive file systems (Windows, macOS)

### Find duplicates — `toolsmith dupes`

- [ ] Find files with identical content: group by size first, then hash only same-size files, streaming so large files don't fill memory
- [ ] Report each group of duplicates and the total space they waste (report only, no deleting)
- [ ] Skip `.git` and `node_modules` by default; `--min-size` ignores small files

### Folder size report — `toolsmith size`

- [ ] List the biggest folders and files under a path, largest first
- [ ] Human-readable sizes (KB, MB, GB), `--depth <n>` and `--top <n>`
- [ ] Show progress during long scans (only when output is a terminal)

## M3 — Git helpers

**Goal:** Take care of repetitive git chores: tidying branches, summarizing recent work and writing consistent commit messages.

### Shared

- [ ] All helpers live under `toolsmith git <command>`
- [ ] Run the `git` executable without a shell (so branch names can't inject commands), with clear errors when git isn't installed or the folder isn't a repository
- [ ] Tests run against throwaway repositories created in a temporary directory

### Clean merged branches — `toolsmith git clean-branches`

- [ ] List local branches already merged into the base branch (`main` or `master`, detected automatically; `--base` to override)
- [ ] Also find squash-merged branches, which `git branch --merged` misses
- [ ] Never delete the current branch, the base branch, or protected branches listed in `~/.toolsmithrc`
- [ ] Opt-in `--remote` also deletes the merged branches on `origin`, after a separate confirmation

### Recent-commits summary — `toolsmith git recent`

- [ ] Summarize commits in a time window or since a tag (`--since "1 week ago"`, `--from v0.1.0`)
- [ ] Filter by author (`--author`, or `--mine` for your own commits)
- [ ] Group by author or by Conventional Commits type (feat, fix, docs, …)
- [ ] Plain-text or Markdown output, ready to paste into a stand-up or release notes

### Commit message templates — `toolsmith git template`

- [ ] Built-in templates (starting with Conventional Commits), plus your own templates in `~/.toolsmithrc`
- [ ] `list` and `show <name>` subcommands
- [ ] `use <name>` sets the repository's `commit.template`, so `git commit` opens the editor pre-filled; `unset` removes it

## M4 — Scaffolding

**Goal:** `toolsmith new <template>` creates a ready-to-run project in one command.

- [ ] `toolsmith new <template> [directory]` creates a project from a template
- [ ] A few built-in templates to start with (e.g. Node.js CLI, Node.js library); `toolsmith new --list` shows them with descriptions
- [ ] Placeholders such as `{{name}}`, `{{author}}` and `{{year}}`, replaced in file contents and file names
- [ ] Ask for missing values; `--yes` accepts the defaults so it can run unattended
- [ ] Refuse to write into a non-empty directory unless `--force` is given
- [ ] Finish with `git init` and `npm install` (skip with `--no-git` / `--no-install`)
- [ ] Store dotfiles such as `.gitignore` as `_gitignore` in templates and rename them while generating, because npm leaves `.gitignore` files out of published packages
- [ ] Use your own templates from a local folder or a git repository URL
- [ ] Tests generate every built-in template into a temporary directory and check the result

## M5 — Plugin system

**Goal:** Anyone can add commands to toolsmith by publishing an npm package named `toolsmith-plugin-*`.

- [ ] Plugin API: a plugin exports a `register(api)` function, and `api` lets it add commands and use toolsmith's config and output helpers
- [ ] Discover installed `toolsmith-plugin-*` and `@scope/toolsmith-plugin-*` packages (global and in the current project); turn individual plugins on or off in `~/.toolsmithrc`
- [ ] Plugins declare the toolsmith versions they support in `peerDependencies`; incompatible plugins are skipped with a warning
- [ ] A plugin that fails to load prints a warning and never breaks the rest of the CLI
- [ ] Built-in commands always win name clashes; warn when two plugins register the same command
- [ ] `toolsmith plugins` lists installed plugins, their versions and the commands they add
- [ ] Startup stays fast with many plugins installed (measure it; load plugin code only when needed)
- [ ] Example plugin (`toolsmith-plugin-example`) and a guide for plugin authors
- [ ] Document that plugins run with your full user permissions, so only install plugins you trust
- [ ] Tests load fixture plugins from a temporary `node_modules`

## M6 — Release

**Goal:** A release is one git tag away, and users have proper documentation.

### npm publish

- [ ] Check that the name `toolsmith` is free on npm; if not, publish under a scope (e.g. `@your-npm-name/toolsmith`)
- [x] Choose a license and add a `LICENSE` file
- [ ] Complete `package.json` (`description`, `license`, `repository`, `keywords`) and add a `files` list so only what's needed is published (check with `npm pack --dry-run`)
- [ ] Release workflow: pushing a `vX.Y.Z` tag runs the tests and publishes to npm with trusted publishing (no npm token stored in GitHub)
- [ ] Follow Semantic Versioning, keep a `CHANGELOG.md`, and create a GitHub Release for every version (notes drafted with `toolsmith git recent`)

### Documentation site

- [ ] Docs site (e.g. VitePress) deployed automatically to GitHub Pages from `main`
- [ ] Pages for getting started, every command, configuration and plugin authoring
- [ ] Generate the command reference from the CLI's own `--help` definitions, so it never goes out of date

## M7 — Interactive TUI

**Goal:** `toolsmith ui` opens a full-screen dashboard for running commands, browsing files and checking git status, all from the keyboard.

### Foundation

- [ ] Choose how to draw the screen (e.g. Ink, or a small renderer on `readline` keypress events) after prototyping in Windows Terminal, the classic Windows console, macOS Terminal and a Linux terminal
- [ ] Load the TUI code only when `toolsmith ui` runs, so other commands stay fast
- [ ] Full-screen layout in the terminal's alternate screen that redraws on resize, with a "terminal too small" message below a minimum size
- [ ] Always restore the terminal (cursor, raw mode, normal screen) on exit, on Ctrl+C and after a crash
- [ ] Refuse to start when input or output isn't a terminal, and point to the plain commands instead
- [ ] Respect `NO_COLOR`, `--no-color` and `"color": false`, and stay readable with only 16 colors

### Keyboard navigation

- [ ] Arrow keys or `h`/`j`/`k`/`l` to move, `Tab` to switch panels, `Enter` to open, `Esc` to go back, `q` to quit
- [ ] `/` filters the current list as you type
- [ ] `?` shows all shortcuts in an overlay

### Command menu

- [ ] Lists every command, including plugin commands, with its description, taken from the commander definitions
- [ ] Choosing a command opens a form for its arguments and options (defaults, validation) and shows the equivalent command line before running it
- [ ] Output streams into a scrollable panel, and a running command can be cancelled

### File browser

- [ ] Folder tree with sizes, using the M2 directory walker and its ignore patterns
- [ ] Preview text files, or open a file in your editor or its default app
- [ ] Run the M2 file tools on the selected folder (size report, duplicates, rename preview)

### Git status panel

- [ ] Branch, ahead/behind counts, and staged, unstaged and untracked files (from `git status --porcelain=v2`), refreshed when files change
- [ ] Shortcuts to the M3 helpers, such as recent commits and cleaning merged branches (with the usual confirmation)
- [ ] Hidden when the folder isn't a git repository

### Tests

- [ ] Drive the UI with scripted key presses at a fixed terminal size and compare screen snapshots
- [ ] Tests for resizing, a too-small terminal and restoring the terminal after a crash

## M8 — Project health

**Goal:** `toolsmith doctor` checks a project and gives one prioritized report: outdated or vulnerable dependencies, license problems, and unused or oversized files.

### Check framework

- [ ] Each check is a module that returns findings with a severity (`error`, `warning` or `info`), a location and a suggested fix
- [ ] Checks run in parallel, each with a timeout; a check that crashes is reported and the others still run
- [ ] `--only` and `--skip` choose checks; a `doctor` section in the project's `toolsmith.json` (found by walking up from the current folder) holds ignore rules and severity overrides
- [ ] Checks that need the network are skipped with a warning when offline, instead of failing the run

### Dependencies

- [ ] Outdated dependencies (from `npm outdated --json`), grouped into patch, minor and major updates
- [ ] Known vulnerabilities (from `npm audit --json`), with npm's severities mapped to the report's levels
- [ ] Unused dependencies (declared but never imported) and missing ones (imported but not declared)
- [ ] npm first; detect pnpm and Yarn projects and use their equivalents, or say clearly that they aren't supported yet

### Licenses

- [ ] Find the license of every installed dependency in its `package.json`, falling back to its LICENSE file
- [ ] Allow and deny lists in `toolsmith.json` (e.g. warn on GPL-family licenses, error on missing or unknown ones)
- [ ] Check the project itself: a LICENSE file exists and matches `license` in `package.json`
- [ ] Export the full dependency license list as JSON or Markdown, e.g. for a legal review

### Files

- [ ] Large files: tracked files over a configurable size limit (suggesting Git LFS), plus the largest files in git history
- [ ] Unused files: source files that can't be reached from the entry points (`bin`, `main`, `exports`, tests) by following imports

### Report

- [ ] Findings grouped by severity, then by check, ending with a summary such as `2 errors, 5 warnings, 3 info`
- [ ] `--json` for scripts, and a Markdown version for pull request comments
- [ ] Exit code 1 when there are errors; `--fail-on warning` makes warnings fail the run too, e.g. in CI
- [ ] `--fix` applies only safe fixes (such as patch updates), and `--dry-run` previews them

### Tests

- [ ] A fixture project for each check, with npm and the registry mocked so tests run offline

## M9 — Task runner

**Goal:** Define a project's tasks once in `toolsmith.json` and run them fast: in dependency order, in parallel, skipped when nothing changed, and again whenever files change.

### Task definitions

- [ ] A `tasks` section in `toolsmith.json`: each task has a command and optional `dependsOn`, `inputs` and `outputs` (globs), `env` and `cwd`
- [ ] Clear errors for unknown tasks, missing commands and dependency cycles, showing the cycle (e.g. `build → test → build`)
- [ ] `toolsmith run <task...>` runs tasks; `toolsmith tasks` lists them, and `--graph` prints the dependency tree
- [ ] Commands behave the same on Windows, macOS and Linux (including `.cmd` shims like `npm` on Windows, and safe argument quoting)

### Running tasks

- [ ] Tasks run in dependency order; independent tasks run in parallel, up to `--concurrency` (default: the number of CPU cores)
- [ ] Output from parallel tasks is prefixed with the task name and never mixed mid-line; a final summary shows each task's result and time
- [ ] Stop at the first failure by default; `--continue` runs everything it can and reports every failure
- [ ] Ctrl+C stops every running task, including the processes it started (on Windows, killing the whole process tree needs special handling)

### Caching

- [ ] A task's cache key is a hash of its command, environment, input file contents and the cache keys of the tasks it depends on
- [ ] On a cache hit, skip the task, replay its saved output and restore its `outputs`
- [ ] The cache lives in `.toolsmith/cache` (added to `.gitignore`), with a size limit and `toolsmith cache clean`
- [ ] `--force` ignores the cache; `--dry-run` shows what would run and why (which inputs changed)

### Watch mode

- [ ] `--watch` re-runs a task, and the tasks that depend on it, when its inputs change
- [ ] Group bursts of changes into one run, and restart a task that's still running when its inputs change again
- [ ] Use Node's recursive `fs.watch`, ignoring output and cache folders

### Tests

- [ ] Temp projects that check ordering, the concurrency limit, cycle detection, cache hits and misses, and watch re-runs

## M10 — Environment & secrets

**Goal:** Keep `.env` files complete and consistent, and catch secrets before they're committed, or find the ones already in git history.

### `.env` management — `toolsmith env`

- [ ] Parse `.env` files with Node's built-in `util.parseEnv`, so values mean the same as with `node --env-file`
- [ ] `toolsmith env list` shows keys with masked values; `get`, `set` and `unset` edit the file and keep its comments and order
- [ ] `toolsmith env diff .env .env.production` compares the keys; values appear only with `--show-values`
- [ ] Warn when `.env` isn't in `.gitignore`, or is already tracked by git

### `.env.example` validation

- [ ] `toolsmith env check` fails (non-zero exit code) when a key from `.env.example` is missing in `.env`, and warns about keys the example doesn't list
- [ ] Optional rules per key in `toolsmith.json`: required, URL, number, or one of a list of values
- [ ] `toolsmith env example` creates or updates `.env.example` from `.env`, with the values removed and comments kept

### Secret scanner — `toolsmith secrets`

- [ ] `toolsmith secrets scan [path]` finds likely secrets: known token formats (GitHub, npm, AWS, Slack, private keys, JWTs, …) and high-entropy strings
- [ ] `--history` scans every commit, including files deleted later, and reports the commit, author, file and line
- [ ] Never print a whole secret: findings show only a short, masked prefix
- [ ] Silence false positives with an inline `toolsmith-ignore-secret` comment, paths in `toolsmith.json`, or a baseline file that accepts existing findings
- [ ] Skip binary files, lockfiles and `node_modules`; stay fast on large repositories by streaming `git log -p` and scanning files in parallel
- [ ] `toolsmith secrets hook install` adds a pre-commit hook that scans staged changes (`uninstall` removes it)
- [ ] Each finding explains what to do: rotate the secret first, because removing it from git history isn't enough

### Tests

- [ ] Fixtures with fake tokens in every supported format, built at runtime so GitHub's push protection doesn't block pushing the test files
- [ ] A git repository with a secret in an old commit, and a check that no output ever contains a full secret

## M11 — Code statistics & reports

**Goal:** Understand a codebase at a glance: how much code there is in each language, who works on what, and a report you can share.

### Lines of code — `toolsmith stats`

- [ ] Count files and code, comment and blank lines per language
- [ ] Detect languages by file extension and shebang, using each language's comment syntax (line and block comments, and comment markers inside strings)
- [ ] Respect `.gitignore`, and skip binary, minified and generated files (such as `dist/` and `*.min.js`)
- [ ] Break results down by folder or file (`--by folder`, `--by file`), with sorting and `--top <n>`
- [ ] Stay fast on large repositories: benchmark against a big open-source project, and use worker threads if needed

### Git contributor stats

- [ ] Commits, lines added and removed, and active days per author in a time range (`--since`, `--until`)
- [ ] Merge the different names and emails of the same person using `.mailmap`
- [ ] Ownership per folder from `git blame`: the main authors, and how many people know each area
- [ ] Activity over time: commits per week, and the busiest days and hours

### HTML report — `toolsmith report`

- [ ] `toolsmith report --html report.html` writes one self-contained file (no external scripts, fonts or requests) with charts and sortable tables
- [ ] Combines code stats, contributor stats and, if available, `toolsmith doctor` results
- [ ] Escape everything that comes from the repository (file names, commit messages, author names), so a report can't run injected HTML
- [ ] Light and dark themes, prints cleanly, and works with a keyboard and a screen reader
- [ ] `--format md` writes a Markdown summary for a README or a pull request

### Tests

- [ ] Fixture folders with known line counts per language, a fixture repository with a known history, and a snapshot of the report's structure

## M12 — Shell integration & self-update

**Goal:** toolsmith feels at home in every shell: tab completion, painless updates and a proper manual page.

### Completions — `toolsmith completion`

- [ ] `toolsmith completion powershell|bash|zsh` prints a completion script; `--install` adds it to the shell's profile once, after asking
- [ ] Generated from the commander definitions, so commands, options and option values are always up to date
- [ ] Dynamic values: git branches for `--base`, template names for `new`, task names for `run`, and plugin commands
- [ ] Works in Windows PowerShell 5.1 and PowerShell 7 (`Register-ArgumentCompleter`), bash and zsh
- [ ] Answers within about 100 ms, e.g. by caching the command list instead of loading every plugin

### Self-update — `toolsmith update`

- [ ] Check npm for a newer version and show the changelog entries since the installed one
- [ ] Detect how toolsmith was installed (a global npm, pnpm or Yarn install, `npx`, a project's `node_modules`, a linked checkout) and run the matching update, or explain what to run
- [ ] Ask before a major-version upgrade; `--check` only reports whether an update exists, with an exit code for scripts
- [ ] Optional update notice, at most once a day: never in CI or when output isn't a terminal, and off with `"updateCheck": false` in `~/.toolsmithrc`
- [ ] `--plugins` also updates installed `toolsmith-plugin-*` packages

### Man page

- [ ] Generate `toolsmith.1` from the commander definitions at build time and ship it through the `man` field in `package.json`, so `man toolsmith` works after a global install
- [ ] One source for `--help`, the man page and the docs site's command reference (M6)
- [ ] On Windows, which has no `man`, `toolsmith help --full` shows the same content

### Tests

- [ ] Snapshot tests for every completion script and the man page
- [ ] CI runs each completion script in its real shell (PowerShell, bash, zsh) and checks the suggestions
