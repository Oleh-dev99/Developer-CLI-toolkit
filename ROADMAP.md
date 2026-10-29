# Roadmap

toolsmith is being built in six milestones. M1 is the foundation that every later milestone builds on. Tick a box when its task lands on `main`.

## Every command ships with

- `--help` text with at least one usage example
- Tests (`node:test`)
- Support for Windows, macOS and Linux
- Documentation in the README (and on the docs site once M6 is done)
- `--json` output, if the command reports data
- `--dry-run`, if the command changes files or branches
- A confirmation prompt before deleting anything (`--yes` skips it)

## M1 — Core

**Goal:** The foundation every later command builds on: a command framework, consistent output, user configuration and tests.

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

- [ ] `npm test` runs the suite with `node --test`
- [ ] Test helper that runs the CLI as a child process and captures stdout, stderr and the exit code
- [ ] Tests for `--help`, `--version`, unknown commands and config loading
- [ ] `npm run test:coverage` using Node's built-in coverage report

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

**Goal:** Every change is tested automatically, a release is one git tag away, and users have proper documentation.

### Continuous integration — GitHub Actions

- [ ] Run the tests on every push and pull request
- [ ] Test on Linux, macOS and Windows, with every supported Node.js LTS version
- [ ] Protect `main` so pull requests can only merge when CI passes

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
