// Every keyboard shortcut of toolsmith ui, in one table. The UI looks up what
// a key does here, and the shortcuts overlay (?) and the hints at the bottom
// of the screen are made from it, so the three can't drift apart.
//
// A key is named the way keyOf() names it: "up", "down", "left", "right",
// "pageup", "pagedown", "home", "end", "enter", "escape", "backspace", "tab",
// "shift+tab", "ctrl+c", or the character typed, like "k", "Q", "/" or "?".
// Terminals send different codes for some keys, and Node's readline gives
// them all the same name: Home is ESC [ H in Windows Terminal, macOS Terminal,
// most Linux terminals and the classic Windows console with Node 26, but
// ESC [ 1 ~ in that console with Node 22; Backspace is DEL in most terminals
// and Ctrl+H there. One key can't be fixed here: with Node 22, the classic
// Windows console sends Shift+Tab as a plain Tab, so Left and h also go to the
// previous panel.

// The keys' names on screen.
const names = {
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  pageup: "PgUp",
  pagedown: "PgDn",
  home: "Home",
  end: "End",
  enter: "Enter",
  escape: "Esc",
  backspace: "Backspace",
  tab: "Tab",
  "shift+tab": "Shift+Tab",
  space: "Space",
  "ctrl+c": "Ctrl+C",
};

// For each context the UI can be in, its shortcuts: an action, the keys for
// it, and what it does. `short` is the text for the hints at the bottom of the
// screen, which show the context's `hints`, in that order.
export const sections = [
  {
    context: "panels",
    title: "Panels",
    shortcuts: [
      { action: "up", keys: ["up", "k"], description: "move up" },
      { action: "down", keys: ["down", "j"], description: "move down" },
      { action: "pageUp", keys: ["pageup"], description: "move up a page" },
      { action: "pageDown", keys: ["pagedown"], description: "move down a page" },
      { action: "first", keys: ["home"], description: "go to the first item" },
      { action: "last", keys: ["end"], description: "go to the last item" },
      { action: "nextPanel", keys: ["tab", "right", "l"], description: "go to the next panel", short: "next panel" },
      { action: "previousPanel", keys: ["shift+tab", "left", "h"], description: "go to the previous panel" },
      { action: "open", keys: ["enter"], description: "open the selected item; a command opens its form", short: "open" },
      { action: "startFilter", keys: ["/"], description: "filter the list as you type", short: "filter" },
      { action: "clearFilter", keys: ["escape"], description: "clear the filter" },
      { action: "showHelp", keys: ["?"], description: "show these shortcuts", short: "shortcuts" },
      { action: "quit", keys: ["q", "ctrl+c"], description: "quit", short: "quit" },
    ],
    hints: ["showHelp", "quit", "startFilter", "open", "nextPanel"],
  },
  {
    context: "filter",
    title: "While filtering",
    shortcuts: [
      { action: "type", keys: [], label: "Other keys", description: "type into the filter; case doesn't matter" },
      { action: "deleteCharacter", keys: ["backspace"], description: "delete the last character", short: "delete" },
      { action: "acceptFilter", keys: ["enter"], description: "stop typing and keep the filter", short: "done" },
      { action: "closeFilter", keys: ["escape"], description: "clear and close the filter", short: "clear" },
      { action: "up", keys: ["up"], description: "move up" },
      { action: "down", keys: ["down"], description: "move down" },
      { action: "nextPanel", keys: ["tab"], description: "go to the next panel" },
      { action: "previousPanel", keys: ["shift+tab"], description: "go to the previous panel" },
      { action: "quit", keys: ["ctrl+c"], description: "quit" },
    ],
    hints: ["acceptFilter", "closeFilter", "deleteCharacter"],
  },
  {
    context: "form",
    title: "In a command's form",
    shortcuts: [
      { action: "type", keys: [], label: "Other keys", description: "type into the selected text field" },
      { action: "nextField", keys: ["down", "tab"], description: "go to the next field", short: "next field" },
      { action: "previousField", keys: ["up", "shift+tab"], description: "go to the previous field" },
      { action: "eraseCharacter", keys: ["backspace"], description: "delete the last character" },
      { action: "toggleField", keys: ["space", "right"], description: "tick a checkbox, or pick the next choice", short: "tick" },
      { action: "previousChoice", keys: ["left"], description: "pick the previous choice" },
      { action: "runCommand", keys: ["enter"], description: "run the command", short: "run" },
      { action: "closeForm", keys: ["escape"], description: "go back to the panels", short: "back" },
      { action: "quit", keys: ["ctrl+c"], description: "quit" },
    ],
    hints: ["runCommand", "closeForm", "toggleField", "nextField"],
  },
  {
    context: "running",
    title: "While a command runs",
    shortcuts: [
      { action: "cancelCommand", keys: ["escape", "ctrl+c"], description: "cancel it, and the programs it started", short: "cancel" },
      { action: "up", keys: ["up", "k"], description: "scroll up" },
      { action: "down", keys: ["down", "j"], description: "scroll down", short: "scroll" },
      { action: "pageUp", keys: ["pageup"], description: "scroll up a page" },
      { action: "pageDown", keys: ["pagedown"], description: "scroll down a page" },
      { action: "first", keys: ["home"], description: "scroll to the start" },
      { action: "last", keys: ["end"], description: "scroll to the end, and follow new output" },
    ],
    hints: ["cancelCommand", "down"],
  },
  {
    context: "output",
    title: "When a command has ended",
    shortcuts: [
      { action: "closeOutput", keys: ["escape"], description: "go back to its form", short: "back" },
      { action: "up", keys: ["up", "k"], description: "scroll up" },
      { action: "down", keys: ["down", "j"], description: "scroll down", short: "scroll" },
      { action: "pageUp", keys: ["pageup"], description: "scroll up a page" },
      { action: "pageDown", keys: ["pagedown"], description: "scroll down a page" },
      { action: "first", keys: ["home"], description: "scroll to the start" },
      { action: "last", keys: ["end"], description: "scroll to the end" },
      { action: "showHelp", keys: ["?"], description: "show these shortcuts" },
      { action: "quit", keys: ["q", "ctrl+c"], description: "quit", short: "quit" },
    ],
    hints: ["closeOutput", "down", "quit"],
  },
  {
    context: "item",
    title: "In an opened item",
    shortcuts: [
      { action: "back", keys: ["escape"], description: "go back", short: "back" },
      { action: "showHelp", keys: ["?"], description: "show these shortcuts", short: "shortcuts" },
      { action: "quit", keys: ["q", "ctrl+c"], description: "quit", short: "quit" },
    ],
    hints: ["back", "showHelp", "quit"],
  },
  {
    context: "help",
    title: "In this list of shortcuts",
    shortcuts: [
      { action: "up", keys: ["up", "k"], description: "scroll up" },
      { action: "down", keys: ["down", "j"], description: "scroll down", short: "scroll" },
      { action: "pageUp", keys: ["pageup"], description: "scroll up a page" },
      { action: "pageDown", keys: ["pagedown"], description: "scroll down a page" },
      { action: "hideHelp", keys: ["escape", "?"], description: "close it", short: "close" },
      { action: "quit", keys: ["q", "ctrl+c"], description: "quit" },
    ],
    hints: ["hideHelp", "down"],
  },
];

const sectionFor = (context) => sections.find((section) => section.context === context);

// How a key or a shortcut's keys are shown: "Shift+Tab", "Tab, Right, l".
export const keyLabel = (key) => names[key] ?? key;
export const shortcutLabel = (shortcut) => shortcut.label ?? shortcut.keys.map(keyLabel).join(", ");

// The action of `key` in `context`, or undefined.
export function actionFor(context, key) {
  return sectionFor(context)?.shortcuts.find((shortcut) => shortcut.keys.includes(key))?.action;
}

// The hints for the bottom of the screen: "?: shortcuts  q: quit".
export function hintsFor(context) {
  const section = sectionFor(context);
  return section.hints
    .map((action) => section.shortcuts.find((shortcut) => shortcut.action === action))
    .map((shortcut) => `${keyLabel(shortcut.keys[0])}: ${shortcut.short ?? shortcut.description}`)
    .join("  ");
}

// The name of the key in a readline "keypress" event (`text`, `key`), as the
// table above uses it, or null for keys the UI doesn't use, like Alt+x.
export function keyOf(text, key = {}) {
  const name = key.name === "return" ? "enter" : key.name;
  // A lone Esc comes with `meta` set, as if Alt was held with it.
  if (name === "escape") {
    return "escape";
  }
  if (key.meta) {
    return null;
  }
  if (key.ctrl) {
    return name ? `ctrl+${name}` : null;
  }
  if (name === "tab" && key.shift) {
    return "shift+tab";
  }
  if (name && /^[a-z]$/.test(name)) {
    return key.shift ? name.toUpperCase() : name;
  }
  return name ?? text ?? null;
}

// Whether a key press is a character to type, like "a", "?" or a space,
// rather than a key like Enter, Backspace or an arrow.
export function isText(text, key = {}) {
  return typeof text === "string" && [...text].length === 1 && text >= " " && text !== "\x7f" && !key.ctrl && !key.meta;
}
