import { readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createProgram } from "../src/cli.js";
import { error, success } from "../src/output.js";

// Writes the docs site's command reference, docs/commands.md, from toolsmith's
// own command definitions: every built-in command and subcommand, with what its
// --help shows. Plugins aren't included.
//
//   npm run docs:commands
//     Writes docs/commands.md. Run it after changing a command.
//
//   node scripts/command-reference.js --check
//     Fails if docs/commands.md isn't what this script would write. A test
//     runs this, so a reference that's out of date fails the tests.
//
// Both take another file to use instead, for the tests.

const defaultFile = fileURLToPath(new URL("../docs/commands.md", import.meta.url));

function main(args) {
  const check = args[0] === "--check";
  const file = (check ? args[1] : args[0]) ?? defaultFile;
  const shown = relative(process.cwd(), file) || file;
  const program = createProgram();
  const text = reference(program);

  if (check) {
    let current = null;
    try {
      current = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
    } catch (err) {
      if (err.code !== "ENOENT") {
        throw err;
      }
    }
    if (current !== text) {
      throw new Error(`${shown} is out of date; run "npm run docs:commands" to update it`);
    }
  } else {
    writeFileSync(file, text);
    success(`Wrote the reference for ${commandsIn(program).length} commands to ${shown}.`);
  }
}

// The Markdown page: an introduction, then a section for each command, in the
// order --help lists them, each followed by its own subcommands.
function reference(program) {
  const commonOptions = visibleOptions(program)
    .filter((option) => option.long !== "--version")
    .map((option) => `\`${option.flags}\``);
  const intro = [
    "<!-- Made by scripts/command-reference.js from toolsmith's command definitions. After changing a command, run \"npm run docs:commands\" instead of editing this file. -->",
    "# Command reference",
    "Every built-in command, with what `toolsmith <command> --help` shows for it. Each command also takes `-h, --help`, and " +
      `toolsmith's own ${list(commonOptions)} work with all of them. Commands that plugins add aren't listed here, but \`toolsmith --help\` shows them.`,
  ];
  const sections = commandsIn(program).map(({ command, names }) => section(command, names));
  return `${[...intro, ...sections].join("\n\n")}\n`;
}

// The command and all of its subcommands, with the names that lead to each,
// like ["toolsmith", "git", "recent"].
function commandsIn(command, names = [command.name()]) {
  return [{ command, names }, ...subcommands(command).flatMap((sub) => commandsIn(sub, [...names, sub.name()]))];
}

function section(command, names) {
  const help = command.createHelp();
  const { before, after } = addedHelpText(command);
  const parts = [`## ${names.join(" ")}`, prose(sentence(help.commandDescription(command)))];
  parts.push(codeBlock(help.commandUsage(command)));
  if (before) {
    parts.push(codeBlock(before));
  }

  const rows = (title, items, term, description) =>
    items.length === 0
      ? []
      : [[`| ${title} | Description |`, "|---|---|", ...items.map((item) => `| ${term(item)} | ${prose(description(item))} |`)].join("\n")];
  parts.push(
    ...rows("Argument", help.visibleArguments(command), (arg) => `\`${help.argumentTerm(arg)}\``, (arg) => help.argumentDescription(arg)),
    ...rows("Option", visibleOptions(command), (option) => `\`${help.optionTerm(option)}\``, (option) => help.optionDescription(option)),
    ...rows(
      "Command",
      subcommands(command),
      (sub) => `[\`${help.subcommandTerm(sub)}\`](#${[...names, sub.name()].join("-")})`,
      (sub) => help.subcommandDescription(sub),
    ),
  );

  if (after) {
    parts.push(codeBlock(after));
  }
  return parts.join("\n\n");
}

// A command's options, without -h, --help, which every command has.
function visibleOptions(command) {
  return command.createHelp().visibleOptions(command).filter((option) => option.long !== "--help");
}

// A command's own subcommands, without the "help" command Commander adds.
function subcommands(command) {
  return command.createHelp().visibleCommands(command).filter((sub) => command.commands.includes(sub));
}

// The text a command adds to its help with addHelpText(), like its examples:
// Commander writes it before and after the help it makes itself.
function addedHelpText(command) {
  let written = "";
  command.configureOutput({
    writeOut: (text) => (written += text),
    getOutHasColors: () => false,
    getOutHelpWidth: () => 80,
  });
  command.outputHelp();
  const own = command.helpInformation();
  const at = written.indexOf(own);
  if (at === -1) {
    throw new Error(`can't tell the help of "${command.name()}" apart from its added text`);
  }
  const tidy = (text) => text.replace(/^\n+/, "").trimEnd();
  return { before: tidy(written.slice(0, at)), after: tidy(written.slice(at + own.length)) };
}

const codeBlock = (text) => `\`\`\`text\n${text}\n\`\`\``;

// "find files" → "Find files."
const sentence = (text) => `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? "" : "."}`;

const list = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

// Text from a description, made safe for Markdown and for VitePress, which
// would otherwise read <find> as an HTML tag and {{ }} as a Vue expression.
function prose(text) {
  const escaped = text
    .replace(/[\\`*_[\]|]/g, "\\$&")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return escaped.includes("{{") ? `<span v-pre>${escaped}</span>` : escaped;
}

try {
  main(process.argv.slice(2));
} catch (err) {
  error(err.message);
  process.exitCode = 1;
}
