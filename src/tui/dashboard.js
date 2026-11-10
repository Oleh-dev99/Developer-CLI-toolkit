import { count } from "../lib/format.js";
import { createForm } from "./form.js";
import { actionFor, hintsFor, isText, keyOf, sections, shortcutLabel } from "./keys.js";
import { createList } from "./list.js";
import { runCommand } from "./runner.js";
import { box, center, pad, rowWidth, spread, truncateStart, width } from "./screen.js";

// What `toolsmith ui` shows: three panels side by side, a command's form and
// its output, an opened item, and the shortcuts overlay (?), and what each
// key does there.

// The smallest terminal the dashboard draws itself in; below it, it says so.
export const minimum = { columns: 40, rows: 10 };

// Sample items, until the file browser and git status panel are built.
const samples = [
  {
    title: "Files",
    items: Array.from({ length: 24 }, (_, index) => `file${String(index + 1).padStart(2, "0")}.txt`),
    empty: "No files",
  },
  { title: "Git status", items: [], empty: "Nothing here yet" },
];

// The lines of the shortcuts overlay, made from the key table.
function helpLines() {
  const shortcuts = sections.flatMap((section) => section.shortcuts);
  const labelWidth = Math.max(...shortcuts.map((shortcut) => width(shortcutLabel(shortcut))));
  return sections.flatMap((section, index) => [
    ...(index > 0 ? [{ text: "" }] : []),
    { text: section.title, bold: true },
    ...section.shortcuts.map((shortcut) => ({ text: `  ${shortcutLabel(shortcut).padEnd(labelWidth)}  ${shortcut.description}` })),
  ]);
}

// `commands` are the commands to offer, from describeCommands() in
// commands.js. They run in `cwd` with `env`, and their command lines are
// quoted for `platform`.
export function createDashboard({ folder = "", commands = [], cwd = process.cwd(), env = process.env, platform = process.platform } = {}) {
  const nameWidth = Math.max(0, ...commands.map((command) => width(command.name)));
  const panels = [
    {
      title: "Commands",
      // The name, and the description where there's room for some of it. The
      // filter looks in both.
      list: createList(commands, {
        label: (command, room = Infinity) => (room < nameWidth + 12 ? command.name : `${command.name.padEnd(nameWidth)}  ${command.description}`),
        empty: "No commands",
      }),
    },
    ...samples.map(({ title, items, empty }) => ({ title, list: createList(items, { empty }) })),
  ];
  const help = createList(helpLines(), { selectable: false, label: (line) => line.text, style: (line) => (line.bold ? "bold" : undefined) });
  // The form being filled in, and the command it started, if any.
  const state = { focus: 0, typing: false, opened: null, help: false, form: null, run: null, runLine: "" };
  // Called when the screen should be drawn again, like when output arrives.
  let redraw = () => {};

  const focused = () => panels[state.focus].list;
  // The list that moving acts on.
  const current = () => (state.help ? help : state.run ? state.run.output : focused());
  const turn = (step) => {
    state.typing = false;
    state.focus = (state.focus + step + panels.length) % panels.length;
  };
  const context = () => {
    if (state.help) {
      return "help";
    }
    if (state.run) {
      return state.run.running ? "running" : "output";
    }
    return state.form ? "form" : state.opened ? "item" : state.typing ? "filter" : "panels";
  };

  // Runs the form's command, unless something in the form is wrong, or the
  // command could ask a question that nobody here can answer.
  function run() {
    const { form } = state;
    const [problem, ...more] = form.problems();
    if (problem) {
      form.message = more.length ? `${problem.message} (and ${count(more.length, "more problem")})` : problem.message;
      form.select(problem.field);
      return;
    }
    if (form.command.asks && !form.saysYes()) {
      form.message = `toolsmith ${form.command.name} can ask questions before it acts, and the dashboard can't answer them. Tick --yes to run it without asking, or run it in a terminal of its own.`;
      return;
    }
    state.runLine = form.commandLine();
    state.run = runCommand(form.args(), { cwd, env, onChange: () => redraw() });
  }

  // What each action in the key table does. An action returns "quit" to end
  // the UI.
  const actions = {
    up: () => current().move(-1),
    down: () => current().move(1),
    pageUp: () => current().page(-1),
    pageDown: () => current().page(1),
    first: () => current().first(),
    last: () => current().last(),
    nextPanel: () => turn(1),
    previousPanel: () => turn(-1),
    open: () => {
      const item = focused().selected();
      if (item === undefined) {
        return;
      }
      if (panels[state.focus].title === "Commands") {
        state.form = createForm(item, { platform });
      } else {
        state.opened = { title: panels[state.focus].title, item };
      }
    },
    back: () => {
      state.opened = null;
    },
    startFilter: () => {
      state.typing = true;
    },
    clearFilter: () => focused().setFilter(""),
    deleteCharacter: () => focused().setFilter([...focused().filter].slice(0, -1).join("")),
    acceptFilter: () => {
      state.typing = false;
    },
    closeFilter: () => {
      focused().setFilter("");
      state.typing = false;
    },
    nextField: () => state.form.moveField(1),
    previousField: () => state.form.moveField(-1),
    eraseCharacter: () => state.form.erase(),
    toggleField: () => state.form.toggle(1),
    previousChoice: () => state.form.toggle(-1),
    runCommand: run,
    closeForm: () => {
      state.form = null;
    },
    cancelCommand: () => state.run.cancel(),
    closeOutput: () => {
      state.run.dispose();
      state.run = null;
    },
    showHelp: () => {
      state.help = true;
      help.first();
    },
    hideHelp: () => {
      state.help = false;
    },
    quit: () => "quit",
  };

  // Handles a readline "keypress" event; returns "quit" to end the UI.
  function key(text, info) {
    const where = context();
    if (where === "filter" && isText(text, info)) {
      focused().setFilter(focused().filter + text);
      return undefined;
    }
    if (where === "form" && state.form.acceptsText() && isText(text, info)) {
      state.form.type(text);
      return undefined;
    }
    const action = actionFor(where, keyOf(text, info));
    return action ? actions[action]() : undefined;
  }

  // The three panels side by side, `height` rows. The focused panel's header
  // and selected row are inverse, so it stands out without colors too; the
  // other headers are colored, when there are colors.
  function panelsView(columns, height, paint) {
    const third = Math.floor((columns - 2) / 3);
    const widths = [third, third, columns - 2 - 2 * third];
    const drawn = panels.map(({ title, list }, index) => {
      const isFocused = index === state.focus;
      const typing = isFocused && state.typing;
      // The filter as typed, with a cursor while typing. When the header is too
      // narrow, the filter takes the title's place, and keeps its end in view.
      const filter = list.filter || typing ? `/${list.filter}${typing ? "_" : ""}` : "";
      let left = filter ? ` ${title} ${filter}` : ` ${title}`;
      if (width(left) > widths[index]) {
        left = filter ? ` ${truncateStart(filter, widths[index] - 1)}` : left;
      }
      const position = list.position();
      const right = width(left) + width(position) + 2 <= widths[index] ? `${position} ` : "";
      const header = spread(left, right, widths[index]);
      return [isFocused ? paint.bar(header) : paint.accent(header), ...list.render(widths[index], height - 1, { focused: isFocused, paint })];
    });
    return Array.from({ length: height }, (_, row) => drawn.map((lines) => lines[row]).join("│"));
  }

  function itemView(columns, height, paint) {
    const { title, item } = state.opened;
    const lines = ["", `  This is where "${item}" will open.`, "  That part of toolsmith ui isn't built yet."];
    return [paint.bar(pad(` ${title}: ${item}`, columns)), ...Array.from({ length: height - 1 }, (_, row) => pad(lines[row] ?? "", columns))];
  }

  // The command line and how the command is doing, then its output.
  function runView(columns, height, paint) {
    const header = paint.bar(spread(` $ ${state.runLine}`, ` ${state.run.status()} `, columns));
    return [header, ...state.run.output.render(columns, height - 1, { paint })];
  }

  // The shortcuts in a box in the middle, scrolling when they don't fit.
  function helpView(columns, height, paint) {
    const boxWidth = Math.min(columns, Math.max(...helpLines().map((line) => width(line.text))) + 4);
    const inside = help.render(boxWidth - 4, height - 2, { paint }).map((row) => ` ${row} `);
    const left = Math.floor((columns - boxWidth) / 2);
    return box(inside, boxWidth, { title: "Shortcuts", note: help.position() }).map((row) => " ".repeat(left) + row + " ".repeat(columns - left - boxWidth));
  }

  function tooSmall(size, paint) {
    const { columns, rows } = size;
    const message = ["Terminal too small", `${columns}x${rows}, needs at least ${minimum.columns}x${minimum.rows}`, "q: quit"];
    const top = Math.max(0, Math.floor((rows - message.length) / 2));
    return Array.from({ length: rows }, (_, row) => {
      const text = center(message[row - top] ?? "", rowWidth(row, size));
      return row === top ? paint.warning(text) : text;
    });
  }

  // What the screen shows in a terminal of `size`, one string per row.
  function render(size, paint) {
    const { columns, rows } = size;
    if (columns < minimum.columns || rows < minimum.rows) {
      return tooSmall(size, paint);
    }
    const height = rows - 2;
    let body;
    if (state.help) {
      body = helpView(columns, height, paint);
    } else if (state.run) {
      body = runView(columns, height, paint);
    } else if (state.form) {
      body = state.form.render(columns, height, paint);
    } else if (state.opened) {
      body = itemView(columns, height, paint);
    } else {
      body = panelsView(columns, height, paint);
    }
    return [paint.bold(spread(" toolsmith ui", ` ${folder} `, columns)), ...body, paint.bar(pad(` ${hintsFor(context())}`, rowWidth(rows - 1, size)))];
  }

  return {
    key,
    render,
    actions,
    context,
    panels,
    state,
    // `callback` draws the screen again; output arriving uses it.
    connect(callback) {
      redraw = callback;
    },
    // Stops a command that's still running, when the UI ends.
    dispose() {
      state.run?.dispose();
    },
  };
}
