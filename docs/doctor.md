# Project health

`toolsmith doctor` checks the project you're in and gives one report of the problems it finds, the most severe first, each with where it is and how to fix it.

```sh
toolsmith doctor                                   # check the project
toolsmith doctor --list                            # the checks there are
toolsmith doctor --only license --json             # one check, as JSON for a script
toolsmith doctor --fail-on warning --markdown      # for CI, with a report for the pull request
```

The project is the nearest folder, from the current one up, that has a `toolsmith.json`, or else a `package.json`; without either, it's the current folder. So `toolsmith doctor` checks the same project from any of its subfolders.

## The report

Each finding is an **error**, a **warning** or **info**. The report groups them by severity, then by check, and ends with a summary:

```text
$ toolsmith doctor
Errors

  license
    package.json:4: "license" in package.json is MIT, but LICENSE has the ISC license text
      Fix: Make them agree: set "license" to "ISC", or put the MIT license text in LICENSE.

Checked the current folder with 3 checks: audit, license, outdated.
1 error, 0 warnings, 0 info
```

A location is a file, relative to the project's folder, and a line when the check knows it; a finding about the whole project has none.

`--json` prints the report for scripts: the project's folder (`root`), its `toolsmith.json` (`config`, or `null`), the `checks` that ran, those `skipped` with the reason, the `findings` (each with `check`, `severity`, `message`, and `file`, `line` and `fix` when it has them), the `summary` (`errors`, `warnings`, `info`, and the findings `ignored` by `toolsmith.json`), and whether the run `failed`. `--markdown` prints the same report as Markdown, for a pull request comment. They can't be used together.

## The checks

| Check | What it looks at |
|---|---|
| `audit` | Known vulnerabilities in the dependencies, from `npm audit` (needs the network) |
| `license` | The project has a LICENSE file with the license that `"license"` in `package.json` names |
| `outdated` | Dependencies with newer versions, by major, minor and patch update, from `npm outdated` (needs the network) |

`--only` runs only the checks you name, and `--skip` leaves some out; give names separated by commas, or the option more than once. An unknown name is an error, and `toolsmith doctor --list` shows the names.

### license

A license file is one in the project's folder named LICENSE, LICENCE, COPYING or UNLICENSE, in any case, with or without an extension like `.md` or `.txt` or a suffix like `-MIT`. toolsmith reads its text to tell which license it is: MIT, ISC, Apache-2.0, the BSD licenses with 2, 3 and 4 clauses, the GNU GPL, LGPL and AGPL, MPL-2.0 and the Unlicense. It goes by the license whose text comes first, since a file may go on with the licenses of code it includes. A text it doesn't know, or a known one that was changed, is a warning: toolsmith never guesses.

| Finding | Severity |
|---|---|
| The LICENSE file has another license than `"license"` names | error |
| `"license"` names a license, but there's no LICENSE file | error |
| `"license"` is `SEE LICENSE IN <file>`, but there's no such file | error |
| `package.json` can't be read, or isn't valid JSON | error |
| No license at all: no LICENSE file and no `"license"` (except in a `"private"` package) | warning |
| A LICENSE file, but no `"license"` in `package.json` | warning |
| `"license"` is `UNLICENSED`, but the LICENSE file has an open source license | warning |
| A LICENSE file whose text toolsmith doesn't know | warning |
| `"license"` isn't text, like the old `{ "type": "MIT" }` | warning |

`"license"` can be any SPDX expression, like `"(MIT OR Apache-2.0)"`: each license file's license must be one of those it names, so a project with two licenses can have a file for each, like `LICENSE-MIT` and `LICENSE-APACHE`. The GNU licenses match either form, like `GPL-3.0-only` or `GPL-3.0-or-later`, since their text doesn't say which. `UNLICENSED` needs no LICENSE file, and `SEE LICENSE IN <file>` takes any text in that file.

### outdated

Runs `npm outdated --json` in the project, and gives a finding for each dependency with a newer version, with its current, wanted and latest versions: *current* is the one installed, *wanted* the newest that the range in `package.json` allows, and *latest* the newest there is. The fix is the command that gets the update: `npm update <name>` for the wanted version, or `npm install <name>@<version>` for one outside the range.

| Finding | Severity |
|---|---|
| A **major** update: the latest version is outside the `^` range of the current one, so it can break things. Below 1.0.0, that's also an update like 0.1 to 0.2 | warning |
| A **minor** update: inside the `^` range, but not the `~` range | info |
| A **patch** update: inside the `~` range | info |
| A dependency in `package.json` that isn't installed | warning |

npm exits with code 1 whenever something is outdated, so toolsmith goes by its JSON, not its exit code.

### audit

Runs `npm audit --json` in the project, and gives a finding for each advisory: the package and its vulnerable versions, the advisory's title and address, and whether npm has a fix. A dependency of the project is shown at its line in `package.json`, and one that comes with another package in `package-lock.json`, with the package that brings it.

| npm's severity | Severity in the report |
|---|---|
| critical, high | error |
| moderate | warning |
| low, info | info |

The fix says to run `npm audit fix` when that fixes it; when the fix is a major update of a package, which `npm audit fix` only makes with `--force`, it says so, since that can break things; and when there's no fix yet, it says that too. `npm audit` needs a `package-lock.json`.

### Package managers

The `outdated` and `audit` checks run npm, so they first make sure that the project uses npm. They go by `"packageManager"` in `package.json` (as Corepack uses it), then by the lockfile (`package-lock.json` or `npm-shrinkwrap.json` for npm, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`), then by what the package manager left in `node_modules`. They never run npm in a project that uses another one:

| The project | What the checks do |
|---|---|
| Uses npm | Run npm |
| Uses pnpm, Yarn or Bun | Nothing yet: an info finding says so, with the command to run instead, like `pnpm outdated` |
| Has signs of two, like a `package-lock.json` and a `yarn.lock` | Nothing: a warning says which, so that you can remove the one that's left over |
| Has dependencies, but no lockfile and no `node_modules` | Nothing: a warning says to install them first |
| Has no dependencies, or no `package.json` | Nothing, without a finding |

When npm can't do its part, that's an error finding of the check: npm isn't installed or isn't on the PATH, it gives something that isn't JSON, or it reports an error, like one from the registry, with npm's own reason. A check that runs out of time stops npm, with everything it started.

## Settings in toolsmith.json

The `"doctor"` section of the project's `toolsmith.json` can ignore findings, change their severity and set the time limit:

```json
{
  "doctor": {
    "ignore": [
      "license",
      { "check": "license", "file": "COPYING.md" },
      { "check": "license", "file": "package.json", "line": 4 },
      { "check": "license", "file": "vendor/**" }
    ],
    "severity": { "license": "warning" },
    "timeout": 60
  }
}
```

| Setting | What it does |
|---|---|
| `ignore` | A list of rules. A check's name ignores the whole check, so it doesn't run. `{ "check", "file" }` ignores that check's findings in a file, where `file` is a path relative to the project's folder, with `/`, or a glob pattern like `vendor/**`; add `"line"` to ignore only the finding on that line. The report says how many findings were ignored. |
| `severity` | The severity of a check's findings, by check: `"error"`, `"warning"` or `"info"`. |
| `timeout` | How many seconds each check may take. Default: 30. `--timeout` overrides it. |

Like `~/.toolsmithrc`, a `toolsmith.json` that isn't valid JSON, or a setting of the wrong kind, stops doctor with an error that names the file and the setting, like `"doctor.severity.license" in config file …/toolsmith.json must be "error", "warning" or "info", got "fatal"`. A setting or check name that doctor doesn't know only gives a warning.

## Time limits, crashes and the network

The checks run at the same time, each for at most 30 seconds, or what `--timeout` or `"timeout"` says. A check that runs out of time, or crashes, is reported as an error of its own, and the other checks still run; `--debug` shows where a check crashed. Changing a check's severity in `toolsmith.json` doesn't change these errors, since they're about the check, not the project.

Some checks need the network, like `outdated` and `audit`, which ask npm's registry; `--list` says which. Before running one, doctor looks up the registry's name (or that of the registry in `npm_config_registry`; one given by its IP address needs no lookup). When that fails, or with `--offline`, those checks are skipped with a warning, and the run doesn't fail for it.

## Exit codes

| Code | When |
|---|---|
| 0 | No finding is as severe as `--fail-on`: no error, by default. |
| 1 | A finding is that severe, or doctor couldn't run, like for an unknown check name or a `toolsmith.json` that isn't valid; the report, or the error on stderr, says which. |

`--fail-on warning` makes warnings fail the run too, and `--fail-on info` every finding. Skipped checks and ignored findings never do.
