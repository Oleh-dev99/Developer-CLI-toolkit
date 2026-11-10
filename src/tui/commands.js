// The commands toolsmith ui can run, read from the Commander program: the
// built-in ones and those plugins add, as createProgram() and loadPlugins()
// define them, so the dashboard shows what --help shows.

// Commands the dashboard doesn't offer: itself.
const left = new Set(["ui"]);

// Every command and subcommand that does something when it runs, in the order
// --help lists them. Groups like "git", which only hold subcommands, are left
// out. Each is { path, name, description, arguments, options, asks }:
//   path       the words after "toolsmith", like ["git", "recent"]
//   arguments  { label, description, required, variadic, defaultValue,
//              defaultText, choices, parse }
//   options    { label, flag, description, kind ("check", "text" or
//              "choice"), mandatory, variadic, defaultText, choices, parse,
//              attribute, conflicts }
//   asks       whether it can ask questions (it has --yes to not ask), which
//              the dashboard can't answer
export function describeCommands(program) {
  const found = [];
  const visit = (command, path) => {
    for (const sub of command.commands) {
      const subPath = [...path, sub.name()];
      if (left.has(subPath.join(" "))) {
        continue;
      }
      // Commander keeps a command's action here; a group has none.
      if (sub._actionHandler) {
        found.push(describe(sub, subPath));
      }
      visit(sub, subPath);
    }
  };
  visit(program, []);
  return found;
}

function describe(command, path) {
  const help = command.createHelp();
  const options = help
    .visibleOptions(command)
    .filter((option) => option.long !== "--help")
    .map((option) => {
      // "--since <date>", "--no-git", "-y, --yes" → "--yes"
      const value = option.flags.match(/[<[][^>\]]*[>\]]$/)?.[0];
      return {
        label: value ? `${option.long} ${value}` : option.long,
        flag: option.long,
        description: option.description,
        kind: !option.required && !option.optional ? "check" : option.argChoices ? "choice" : "text",
        mandatory: option.mandatory,
        variadic: option.variadic,
        defaultText: defaultText(option),
        choices: option.argChoices,
        parse: option.parseArg,
        defaultValue: option.defaultValue,
        attribute: option.attributeName(),
        conflicts: option.conflictsWith,
      };
    });
  return {
    path,
    name: path.join(" "),
    description: command.description(),
    arguments: command.registeredArguments.map((argument) => ({
      label: argument.required ? `<${argument.name()}${argument.variadic ? "..." : ""}>` : `[${argument.name()}${argument.variadic ? "..." : ""}]`,
      description: argument.description,
      required: argument.required,
      variadic: argument.variadic,
      defaultValue: argument.defaultValue,
      defaultText: defaultText(argument),
      choices: argument.argChoices,
      parse: argument.parseArg,
    })),
    options,
    asks: options.some((option) => option.flag === "--yes"),
  };
}

// The default as --help shows it, or "" when there's none worth showing.
function defaultText({ defaultValue, defaultValueDescription }) {
  if (defaultValueDescription) {
    return defaultValueDescription;
  }
  if (defaultValue === undefined || defaultValue === false) {
    return "";
  }
  return typeof defaultValue === "string" ? defaultValue : JSON.stringify(defaultValue);
}
