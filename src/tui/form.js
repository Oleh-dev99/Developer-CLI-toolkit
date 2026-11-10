import { quoteCommandLine, splitWords } from "../lib/quote.js";
import { createList } from "./list.js";
import { pad, truncateStart, width, wrap } from "./screen.js";

// The form for running one command in toolsmith ui: a field for each of its
// arguments and options (from describeCommands() in commands.js), checked the
// way the command itself checks them, and the command line it adds up to.

// `command` is one of describeCommands(). Fields are:
//   text    typed in; an argument, or an option that takes a value
//   check   ticked or not; an option without a value, like --json or --no-git
//   choice  one of the option's choices, or none
// `values` fill in fields by label ({ "[paths...]": "src", "--dry-run": true }),
// and the fields `locked` keep their values: the rename preview of the Files
// panel always has --dry-run.
export function createForm(command, { platform = process.platform, values = {}, locked = [] } = {}) {
  const fields = [
    ...command.arguments.map((argument) => ({ ...argument, kind: argument.choices ? "choice" : "text", argument: true })),
    ...command.options.map((option) => ({ ...option, required: option.mandatory })),
  ].map((field) => ({
    ...field,
    text: typeof values[field.label] === "string" ? values[field.label] : "",
    checked: values[field.label] === true,
    choice: -1,
    locked: locked.includes(field.label),
  }));
  const labelWidth = Math.min(24, Math.max(0, ...fields.map((field) => width(field.label))));
  const list = createList(fields, { label: (field) => rowText(field), empty: "No arguments or options: Enter runs it" });
  const form = { command, fields, list, message: "" };

  const isSet = (field) => (field.kind === "check" ? field.checked : field.kind === "choice" ? field.choice >= 0 : field.text !== "");
  // The words a field adds: a variadic one splits at spaces, as a shell would.
  const words = (field) => (field.kind === "choice" ? [field.choices[field.choice]] : field.variadic ? splitWords(field.text) : [field.text]);
  const current = () => list.selected();

  function rowText(field) {
    let value;
    if (field.kind === "check") {
      value = `${field.checked ? "[x]" : "[ ]"}${field.locked ? " (always, here)" : ""}`;
    } else if (field.kind === "choice") {
      value = `< ${field.choice >= 0 ? field.choices[field.choice] : "none"} >`;
    } else {
      const cursor = field === current() ? "_" : "";
      const hint = field.defaultText ? `(default: ${field.defaultText})` : field.required ? "(required)" : "";
      value = field.text ? `${field.text}${cursor}` : `${cursor}${hint ? ` ${hint}` : ""}`.trimStart();
    }
    return `${pad(field.label, labelWidth)}  ${value}`;
  }

  const changed = () => {
    form.message = "";
  };

  // Whether the selected field can't be changed; says so if it can't.
  const isLocked = () => {
    if (current()?.locked) {
      form.message = `${current().label} can't be changed here`;
      return true;
    }
    return false;
  };

  Object.assign(form, {
    // Typing goes into the selected text field.
    acceptsText: () => current()?.kind === "text",
    type(text) {
      if (!isLocked()) {
        current().text += text;
        changed();
      }
    },
    erase() {
      const field = current();
      if (field?.kind === "text" && !isLocked()) {
        field.text = [...field.text].slice(0, -1).join("");
        changed();
      }
    },
    // Space ticks a checkbox or moves to the next choice.
    toggle(step = 1) {
      const field = current();
      if (isLocked()) {
        return;
      }
      if (field?.kind === "check") {
        field.checked = !field.checked;
      } else if (field?.kind === "choice") {
        // From none (-1) through the choices, and back to none unless one is required.
        const first = field.required ? 0 : -1;
        const count = field.choices.length - first;
        field.choice = ((((field.choice - first + step) % count) + count) % count) + first;
      }
      changed();
    },
    // The next or previous field, going round at the ends.
    moveField(step) {
      const before = current();
      list.move(step);
      if (current() === before) {
        if (step > 0) {
          list.first();
        } else {
          list.last();
        }
      }
    },
    select(field) {
      list.first();
      while (current() !== field && !list.isAtEnd()) {
        list.move(1);
      }
    },

    // What's wrong with the form, as { field, message }, checked the way the
    // command checks its arguments: required values, choices, and its own
    // checks of values (like a number for --top), with its own messages.
    problems() {
      const found = [];
      for (const field of fields) {
        if (field.required && !isSet(field)) {
          found.push({ field, message: `${field.label} is required` });
        }
      }
      // Arguments go in order, so a later one can't be given without the ones
      // before. (A missing required one is reported above already.)
      const args = fields.filter((field) => field.argument);
      args.forEach((field, index) => {
        const gap = args.slice(0, index).find((earlier) => !isSet(earlier) && !earlier.required);
        if (isSet(field) && gap) {
          found.push({ field: gap, message: `fill in ${gap.label} too, or leave ${field.label} empty` });
        }
      });
      for (const field of fields.filter((field) => isSet(field) && field.parse && field.kind !== "check")) {
        let value = field.defaultValue;
        try {
          for (const word of words(field)) {
            value = field.parse(word, value);
          }
        } catch (err) {
          found.push({ field, message: `${field.label}: ${err.message}` });
        }
      }
      const options = fields.filter((field) => !field.argument && isSet(field));
      for (const field of options) {
        for (const other of options.filter((option) => field.conflicts?.includes(option.attribute))) {
          found.push({ field, message: `${field.label} can't be used with ${other.label}` });
        }
      }
      return found;
    },

    // The words after "toolsmith". Arguments come first, unless one starts
    // with "-": then they come after "--", so that they can't be taken for
    // options.
    args() {
      const optionWords = fields
        .filter((field) => !field.argument && isSet(field))
        .flatMap((field) =>
          field.kind === "check" ? [field.flag] : words(field).flatMap((word) => (word.startsWith("-") ? [`${field.flag}=${word}`] : [field.flag, word])),
        );
      const argumentWords = fields.filter((field) => field.argument && isSet(field)).flatMap(words);
      return argumentWords.some((word) => word.startsWith("-"))
        ? [...command.path, ...optionWords, "--", ...argumentWords]
        : [...command.path, ...argumentWords, ...optionWords];
    },
    commandLine: () => `toolsmith ${quoteCommandLine(form.args(), platform)}`,
    // Whether --yes is ticked, for a command that can ask.
    saysYes: () => fields.some((field) => field.flag === "--yes" && field.checked),

    // The form in `height` rows: the fields, the selected field's
    // description, the command line, and the message, if there's one. When
    // rows are short, the blank row goes first, then the description, and
    // then the command line keeps one row, with its end in view.
    render(columns, height, paint) {
      const field = current();
      const about = field ? [field.description, field.defaultText && field.kind !== "check" ? `(default: ${field.defaultText})` : ""].filter(Boolean).join(" ") : "";
      const commandLine = `$ ${form.commandLine()}`;
      let commandRows = wrap(commandLine, columns - 2).slice(0, 3);
      const messageRows = form.message ? wrap(`! ${form.message}`, columns - 2).slice(0, 3) : [];
      const room = height - 1;
      const fieldRows = Math.min(2, Math.max(1, fields.length));
      let blank = true;
      let description = true;
      const below = () => Number(blank) + Number(description) + commandRows.length + messageRows.length;
      if (room - below() < fieldRows) {
        blank = false;
      }
      if (room - below() < fieldRows) {
        description = false;
      }
      if (room - below() < fieldRows) {
        commandRows = [truncateStart(commandLine, columns - 2)];
      }
      const bottom = [
        ...(blank ? [pad("", columns)] : []),
        ...(description ? [pad(` ${about}`, columns)] : []),
        ...commandRows.map((line) => pad(` ${line}`, columns)),
        ...messageRows.map((line) => paint.warning(pad(` ${line}`, columns))),
      ];
      const header = paint.bar(pad(` toolsmith ${command.name}  ${command.description}`, columns));
      const rows = Math.max(1, room - bottom.length);
      return [header, ...list.render(columns, rows, { focused: true, paint }), ...bottom].slice(0, height);
    },
  });
  return form;
}
