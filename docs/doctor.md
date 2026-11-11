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

Checked the current folder with 1 check: license.
1 error, 0 warnings, 0 info
```

A location is a file, relative to the project's folder, and a line when the check knows it; a finding about the whole project has none.

`--json` prints the report for scripts: the project's folder (`root`), its `toolsmith.json` (`config`, or `null`), the `checks` that ran, those `skipped` with the reason, the `findings` (each with `check`, `severity`, `message`, and `file`, `line` and `fix` when it has them), the `summary` (`errors`, `warnings`, `info`, and the findings `ignored` by `toolsmith.json`), and whether the run `failed`. `--markdown` prints the same report as Markdown, for a pull request comment. They can't be used together.

## The checks

| Check | What it looks at |
|---|---|
| `license` | The project has a LICENSE file with the license that `"license"` in `package.json` names |

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

Some checks need the network, like those that ask npm's registry; `--list` says which. Before running one, doctor looks up the registry's name (or that of the registry in `npm_config_registry`). When that fails, or with `--offline`, those checks are skipped with a warning, and the run doesn't fail for it.

## Exit codes

| Code | When |
|---|---|
| 0 | No finding is as severe as `--fail-on`: no error, by default. |
| 1 | A finding is that severe, or doctor couldn't run, like for an unknown check name or a `toolsmith.json` that isn't valid; the report, or the error on stderr, says which. |

`--fail-on warning` makes warnings fail the run too, and `--fail-on info` every finding. Skipped checks and ignored findings never do.
