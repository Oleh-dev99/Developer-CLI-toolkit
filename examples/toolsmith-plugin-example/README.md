# toolsmith-plugin-example

An example [toolsmith](../../README.md) plugin, small but useful, to copy when you write your own. It adds two commands:

- `toolsmith todos [paths...]` lists the TODO, FIXME and HACK comments in your files (`--json` for scripts).
- `toolsmith guard` fails when the current git branch is protected, so a pre-commit hook can keep commits off `main`. It reads the protected branches from `"protectedBranches"` in `~/.toolsmithrc`.

```text
$ toolsmith todos
src/app.js:12  TODO  handle a missing config file
src/app.js:40  FIXME  the timeout is too short
2 comments: 1 TODO, 1 FIXME.

$ git switch main
$ toolsmith guard
error: main is a protected branch (see "protectedBranches" in /home/you/.toolsmithrc); commit on another branch
```

To use `guard` before every commit, put this in `.git/hooks/pre-commit` (and make it executable on Linux and macOS):

```sh
#!/bin/sh
exec toolsmith guard
```

## Try it

The plugin isn't on npm. Install it from this folder into a project, and toolsmith finds it there:

```sh
cd your-project
npm install --save-dev path/to/toolsmith/examples/toolsmith-plugin-example
toolsmith plugins     # toolsmith-plugin-example  1.0.0  project  loaded on demand, adds todos, guard
toolsmith todos
```

## How it's made

- [`index.js`](index.js) exports `register(api)`, which adds both commands with `api.command()`, prints with `api.output`, and reads the settings from `api.config` inside an action.
- [`package.json`](package.json) lists the commands under `"toolsmith"`, so toolsmith only imports the plugin when one of them runs, and says which toolsmith versions it works with as an optional peer dependency.
- [`test/`](test/) tests the commands without toolsmith: a Commander program stands in for it (`npm test`).

The [plugin author guide](../../docs/PLUGINS.md) explains each part.
