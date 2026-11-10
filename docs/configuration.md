# Configuration

toolsmith works without any configuration. To change its defaults, create a JSON file named `.toolsmithrc` in your home folder:

```json
{
  "color": false,
  "protectedBranches": ["main", "release"]
}
```

A setting you leave out keeps its default. To see which file is in use and the settings that came out of it, run:

```sh
toolsmith config
```

## Settings

### `color`

A boolean. Default: `true`.

Set it to `false` to turn colors off in every command. See [Colors](#colors).

### `greeting`

A string. Default: `"Hello"`.

What `toolsmith hello` says.

### `protectedBranches`

A list of branch names. Default: `["main", "master", "develop"]`.

The branches that `toolsmith git clean-branches` never deletes, locally or on the remote. A list you set replaces the default one.

### `templates`

A map of names to text. Default: `{}`.

Your own commit message templates for `toolsmith git template`. One with the same name as a built-in template replaces it.

```json
{
  "templates": {
    "team": "\n# Ticket: PROJ-123\n# Why is this change needed?\n"
  }
}
```

### `plugins`

A map of package names to `true` or `false`. Default: `{}`.

Every plugin is on unless it's set to `false` here. You don't need to edit this by hand: these commands change only this setting, and leave the rest of the file as it is.

```sh
toolsmith plugins disable toolsmith-plugin-example
toolsmith plugins enable toolsmith-plugin-example
```

## Use another file

The `TOOLSMITH_CONFIG` environment variable names a file to use instead of `~/.toolsmithrc`. A relative path starts from the current folder.

```sh
export TOOLSMITH_CONFIG=~/work/toolsmith.json
```

```powershell
$env:TOOLSMITH_CONFIG = "$HOME\work\toolsmith.json"
```

## Colors

toolsmith uses colors only when it writes to a terminal, so piped output and files stay plain. To turn them off in a terminal as well, use any of these:

| | |
|---|---|
| `--no-color` | For one command |
| `NO_COLOR` environment variable | For everything that follows the [NO_COLOR](https://no-color.org/) convention |
| `"color": false` in the config file | For every toolsmith command |

To keep colors when the output is piped, set `FORCE_COLOR=1`. `--no-color` and `"color": false` still win over it.

## When something is wrong with the file

- If the file isn't valid JSON, or a setting has the wrong type, the command stops with an error that names the file and the setting. `--help` and `--version` still work, so you're never locked out.
- A setting toolsmith doesn't know is ignored, with a warning.
- A file saved from Windows PowerShell 5.1 is fine: toolsmith reads UTF-8, with or without a byte order mark, and the UTF-16 that PowerShell's `>` writes.
