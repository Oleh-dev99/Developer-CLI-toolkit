# Changelog

All notable changes to toolsmith are written down here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and toolsmith follows [Semantic Versioning](https://semver.org/); see [docs/RELEASING.md](docs/RELEASING.md).

## [Unreleased]

The first release.

### Added

- `toolsmith new` creates a project from a built-in template (`node-cli`, `node-lib`, `web-static`), a local folder or a git URL. It asks for what's missing, runs `git init` and `npm install`, and makes the first commit.
- `toolsmith rename` finds and replaces text in file names, with `--regex`, globs, case-only renames, `--dry-run` and a check for conflicts.
- `toolsmith dupes` finds files with identical content, and reports them without deleting anything.
- `toolsmith size` shows the biggest folders and files under a folder.
- `toolsmith git clean-branches` deletes branches that were merged or squash-merged, also on the remote with `--remote`.
- `toolsmith git recent` summarizes recent commits as text, Markdown or JSON.
- `toolsmith git template` makes `git commit` start from a ready-made message, one repository at a time.
- `toolsmith config` shows the settings from `~/.toolsmithrc`.
- Plugins: npm packages named `toolsmith-plugin-*` add commands, and `toolsmith plugins` lists them and turns them on or off. See the [plugin author guide](docs/PLUGINS.md).
- Colored output that follows `--no-color`, `NO_COLOR` and the `color` setting.
