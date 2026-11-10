import { stat } from "node:fs/promises";
import { count, formatSize } from "../lib/format.js";
import { quoteCommandLine } from "../lib/quote.js";
import { fsErrorReason } from "../lib/walk.js";
import { createForm } from "./form.js";
import { actionFor, hintsFor, isText, keyOf, sections, shortcutLabel } from "./keys.js";
import { createList } from "./list.js";
import { editorCommand, openWithApp, runEditor } from "./open.js";
import { readPreview } from "./preview.js";
import { runCommand } from "./runner.js";
import { box, center, pad, rowWidth, spread, truncateStart, width } from "./screen.js";
import { createTree } from "./tree.js";

// What `toolsmith ui` shows: three panels side by side (commands, the files
// of the current folder, and git status), a command's form and its output, a
// file's preview, an opened item, and the shortcuts overlay (?), and what each
// key does there.

// The smallest terminal the dashboard draws itself in; below it, it says so.
export const minimum = { columns: 40, rows: 10 };

// Sample items, until the git status panel is built.
const gitSamples = { title: "Git status", items: [], empty: "Nothing here yet" };

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
// commands.js. The Files panel shows `cwd`, and commands run there with `env`;
// command lines are quoted for `platform`. `editor` is the editor's command as
// words (from VISUAL or EDITOR), and `opener` opens a path in its default app.
export function createDashboard({
  folder = "",
  commands = [],
  cwd = process.cwd(),
  env = process.env,
  platform = process.platform,
  editor = editorCommand(env),
  opener = (path) => openWithApp(path, { platform }),
} = {}) {
  // Called when the screen should be drawn again, and to hand the terminal to
  // another program; see connect().
  let redraw = () => {};
  let suspend = async (task) => task(() => {});

  const state = { focus: 0, typing: false, opened: null, help: false, form: null, run: null, runLine: "", preview: null, message: "" };
  const say = (message) => {
    state.message = message;
    redraw();
  };

  const nameWidth = Math.max(0, ...commands.map((command) => width(command.name)));
  const tree = createTree(cwd, { onChange: () => redraw(), onWarning: (message) => say(`warning: ${message}`) });
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
    { title: "Files", list: tree.list, files: true },
    { title: gitSamples.title, list: createList(gitSamples.items, { empty: gitSamples.empty }) },
  ];
  const help = createList(helpLines(), { selectable: false, label: (line) => line.text, style: (line) => (line.bold ? "bold" : undefined) });

  const focused = () => panels[state.focus].list;
  // The list that moving acts on.
  const current = () => (state.help ? help : state.run ? state.run.output : state.preview?.list ?? focused());
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
    if (state.form) {
      return "form";
    }
    if (state.preview) {
      return "preview";
    }
    if (state.opened) {
      return "item";
    }
    if (state.typing) {
      return "filter";
    }
    return panels[state.focus].files ? "files" : "panels";
  };

  // Runs the form's command, unless something in the form is wrong, or the
  // command could ask a question that nobody here can answer.
  function runForm() {
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
    start(form.args());
  }
  function start(args) {
    state.runLine = `toolsmith ${quoteCommandLine(args, platform)}`;
    state.run = runCommand(args, { cwd, env, onChange: () => redraw() });
  }

  // The Files panel's entry that keys act on: the previewed file, or the
  // selected entry.
  const entry = () => state.preview?.node ?? tree.list.selected();
  // The folder the file tools work on: the selected folder, or the folder of
  // the selected file. "." is the current folder.
  const toolFolder = () => {
    const node = tree.list.selected();
    const folderNode = node?.type === "directory" ? node : tree.parentOf(node);
    return folderNode ? folderNode.relativePath : ".";
  };

  function preview(node) {
    const shown = { node, loading: true, list: null, note: "", size: node.size };
    state.preview = shown;
    readPreview(node.path)
      .then((read) => Object.assign(shown, read, { list: createList(read.lines, { selectable: false }) }))
      .catch((err) => Object.assign(shown, { note: `This file can't be read (${fsErrorReason(err)}).` }))
      .finally(() => {
        shown.loading = false;
        redraw();
      });
  }

  // Edits the file in the terminal, with the dashboard out of the way, and
  // then shows the file as it is now.
  async function edit() {
    const node = entry();
    if (node?.type !== "file") {
      say("e edits files; o opens a folder in its default app");
      return;
    }
    if (!editor) {
      say("Set VISUAL or EDITOR to choose an editor; o opens the file in its default app");
      return;
    }
    let message = "";
    await suspend(async (write) => {
      write(`Editing ${node.relativePath} with ${editor.join(" ")}; the dashboard comes back when the editor closes.\n`);
      try {
        const { code, signal } = await runEditor(editor, node.path, { cwd, env });
        if (code !== 0) {
          message = `The editor ended with ${signal ?? `exit code ${code}`}`;
        }
      } catch (err) {
        message = `Couldn't start the editor: ${err.message}`;
      }
    });
    try {
      tree.update(node, (await stat(node.path)).size);
    } catch {
      // It's gone; the tree shows it until the folder is read again.
    }
    if (state.preview?.node === node) {
      preview(node);
    }
    say(message);
  }

  async function openApp() {
    const node = entry() ?? { path: cwd, relativePath: "." };
    try {
      await opener(node.path);
      say(`Opened ${node.relativePath} in its default app`);
    } catch (err) {
      say(`${node.relativePath} couldn't be opened: ${err.message}`);
    }
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
    toggleEntry: () => {
      const node = tree.list.selected();
      if (node?.type === "directory") {
        tree.toggle(node);
      } else if (node?.type === "file") {
        preview(node);
      }
    },
    expandEntry: () => {
      const node = tree.list.selected();
      if (node?.type === "directory" && node.open) {
        tree.list.move(1);
      } else if (node?.type === "directory") {
        tree.toggle(node);
      } else if (node?.type === "file") {
        preview(node);
      }
    },
    collapseEntry: () => {
      const node = tree.list.selected();
      if (node?.type === "directory" && node.open) {
        tree.toggle(node);
      } else if (tree.parentOf(node)) {
        tree.select(tree.parentOf(node));
      }
    },
    closePreview: () => {
      state.preview = null;
    },
    editFile: () => {
      edit();
    },
    openWithApp: () => {
      openApp();
    },
    sizeReport: () => start(["size", toolFolder()]),
    findDuplicates: () => start(["dupes", toolFolder()]),
    renamePreview: () => {
      const rename = commands.find((command) => command.name === "rename");
      if (rename) {
        // The paths field is split at spaces, as a shell would, so a folder
        // with a space in its name goes in quotes.
        const path = /\s/.test(toolFolder()) ? `"${toolFolder()}"` : toolFolder();
        state.form = createForm(rename, { platform, values: { "[paths...]": path, "--dry-run": true }, locked: ["--dry-run"] });
      } else {
        say("The rename command isn't available here");
      }
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
    runCommand: runForm,
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

  // Handles a readline "keypress" event; returns "quit" to end the UI. A
  // message from the last key goes away with the next one.
  function key(text, info) {
    state.message = "";
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

  // A file's name and size, then its lines, or a note about why they aren't
  // shown.
  function previewView(columns, height, paint) {
    const { node, loading, list, note, size } = state.preview;
    let rows;
    if (loading) {
      rows = [pad("  Reading…", columns)];
    } else if (note) {
      rows = ["", ` ${note}`].map((line) => pad(line, columns));
    } else {
      rows = list.render(columns, height - 1, { paint });
    }
    // After the lines are drawn, the list knows which are in view.
    const header = paint.bar(spread(` ${node.relativePath}`, ` ${formatSize(size ?? 0)}${list?.count() ? `  ${list.position()}` : ""} `, columns));
    return [header, ...Array.from({ length: height - 1 }, (_, row) => rows[row] ?? pad("", columns))];
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

  // What the screen shows in a terminal of `size`, one string per row. The
  // bottom row has the hints for the keys, or a message.
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
    } else if (state.preview) {
      body = previewView(columns, height, paint);
    } else if (state.opened) {
      body = itemView(columns, height, paint);
    } else {
      body = panelsView(columns, height, paint);
    }
    const bottom = state.message
      ? paint.warning(pad(` ${state.message}`, rowWidth(rows - 1, size)))
      : paint.bar(pad(` ${hintsFor(context())}`, rowWidth(rows - 1, size)));
    return [paint.bold(spread(" toolsmith ui", ` ${folder} `, columns)), ...body, bottom];
  }

  return {
    key,
    render,
    actions,
    context,
    panels,
    state,
    tree,
    // `hooks.redraw` draws the screen again; output arriving and the Files
    // panel use it. `hooks.suspend(task)` hands the terminal to another
    // program while `task` runs; editing a file uses it.
    connect(hooks) {
      redraw = hooks.redraw;
      suspend = hooks.suspend ?? suspend;
    },
    // Stops a command that's still running, and reading the files, when the
    // UI ends.
    dispose() {
      state.run?.dispose();
      tree.stop();
    },
  };
}
