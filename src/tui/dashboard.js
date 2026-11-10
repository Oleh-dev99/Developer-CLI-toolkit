import { actionFor, hintsFor, isText, keyOf, sections, shortcutLabel } from "./keys.js";
import { createList } from "./list.js";
import { box, center, pad, rowWidth, spread, truncateStart, width } from "./screen.js";

// What `toolsmith ui` shows: three panels side by side, an opened item, and the
// shortcuts overlay (?), and what each key does there.

// The smallest terminal the dashboard draws itself in; below it, it says so.
export const minimum = { columns: 40, rows: 10 };

// Sample items, until the command menu, file browser and git status panel are
// built.
const samples = [
  {
    title: "Commands",
    items: ["new", "rename", "dupes", "size", "git clean-branches", "git recent", "git template", "config", "plugins"],
    empty: "No commands",
  },
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

export function createDashboard({ folder = "" } = {}) {
  const panels = samples.map(({ title, items, empty }) => ({ title, list: createList(items, { empty }) }));
  const help = createList(helpLines(), { selectable: false, label: (line) => line.text, style: (line) => (line.bold ? "bold" : undefined) });
  const state = { focus: 0, typing: false, opened: null, help: false };

  const focused = () => panels[state.focus].list;
  // The list that moving acts on.
  const current = () => (state.help ? help : focused());
  const turn = (step) => {
    state.typing = false;
    state.focus = (state.focus + step + panels.length) % panels.length;
  };
  const context = () => (state.help ? "help" : state.opened ? "item" : state.typing ? "filter" : "panels");

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
      if (item !== undefined) {
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
    if (context() === "filter" && isText(text, info)) {
      focused().setFilter(focused().filter + text);
      return undefined;
    }
    const action = actionFor(context(), keyOf(text, info));
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
    const body = state.help ? helpView(columns, height, paint) : state.opened ? itemView(columns, height, paint) : panelsView(columns, height, paint);
    return [paint.bold(spread(" toolsmith ui", ` ${folder} `, columns)), ...body, paint.bar(pad(` ${hintsFor(context())}`, rowWidth(rows - 1, size)))];
  }

  return { key, render, actions, context, panels };
}
