// Drawing for the full-screen UI (`toolsmith ui`): rows of text fitted to the
// terminal's width, painted with the 16 basic colors, and written so that only
// the rows that changed are redrawn. Later parts of the UI build their panels
// from these helpers.
//
// Known limit: every character counts as one column. Most terminals show wide
// characters, like Chinese, Japanese and Korean ones and most emoji, in two
// columns, so a row that has them comes out too long and its end is cut off.

const CSI = "\x1b[";

// The control sequences the UI uses. Windows Terminal, the classic Windows
// console (Windows 10 and later), macOS Terminal and Linux terminals all
// understand them.
export const terminal = {
  enterAlternateScreen: `${CSI}?1049h`,
  leaveAlternateScreen: `${CSI}?1049l`,
  hideCursor: `${CSI}?25l`,
  showCursor: `${CSI}?25h`,
  clear: `${CSI}2J`,
  // Rows and columns count from 0 here, and from 1 in the sequence.
  moveTo: (row, column = 0) => `${CSI}${row + 1};${column + 1}H`,
};

// How many columns `text` takes: one per character (see the known limit).
export function width(text) {
  return [...text].length;
}

// `text` cut to at most `columns` columns, ending in "…" when it was cut.
export function truncate(text, columns) {
  const characters = [...text];
  if (characters.length <= columns) {
    return text;
  }
  return columns > 0 ? `${characters.slice(0, columns - 1).join("")}…` : "";
}

// `text` cut to at most `columns` columns from the start, beginning with "…"
// when it was cut, so that its end stays in view: for what's being typed, or
// a path.
export function truncateStart(text, columns) {
  const characters = [...text];
  if (characters.length <= columns) {
    return text;
  }
  return columns > 0 ? `…${characters.slice(characters.length - columns + 1).join("")}` : "";
}

// `text` made exactly `columns` wide: cut when longer, padded with spaces when
// shorter.
export function pad(text, columns) {
  const cut = truncate(text, columns);
  return cut + " ".repeat(Math.max(0, columns - width(cut)));
}

// `text` in the middle of a row `columns` wide.
export function center(text, columns) {
  const cut = truncate(text, columns);
  return pad(" ".repeat(Math.floor((columns - width(cut)) / 2)) + cut, columns);
}

// `left` and `right` at the two ends of a row `columns` wide. When they don't
// both fit, `left` is cut first, and then `right`.
export function spread(left, right, columns) {
  const room = columns - width(right);
  return room > 0 ? pad(left, room) + right : pad(right, columns);
}

// `rows` inside a box drawn with lines, `columns` wide in all, so each row must
// be `columns - 2` wide. `title` goes in the top line and `note` in the bottom
// one.
export function box(rows, columns, { title = "", note = "" } = {}) {
  const inner = Math.max(0, columns - 2);
  const line = (text) => {
    const label = text ? truncate(` ${text} `, inner) : "";
    return label + "─".repeat(Math.max(0, inner - width(label)));
  };
  return [`┌${line(title)}┐`, ...rows.map((row) => `│${row}│`), `└${line(note)}┘`];
}

// How wide the text of row `row` may be in a terminal of `size`. The last row
// stops one column short: writing the bottom-right corner makes some
// terminals scroll the whole screen up.
export function rowWidth(row, { columns, rows }) {
  return row === rows - 1 ? columns - 1 : columns;
}

// Functions that paint text, using only the 16 basic colors that every color
// terminal has, or no colors when `color` is false. Inverse and bold aren't
// colors, so they stay without colors and keep the screen readable. Colors are
// only ever extras: Windows PowerShell's console turns dark yellow into its
// near-white text color and dark magenta into its blue background, so don't
// use magenta, and don't let anything depend on yellow looking yellow.
export function paints(color) {
  const sgr = (on, off) => (text) => `${CSI}${on}m${text}${CSI}${off}m`;
  const plain = (text) => text;
  return {
    bar: sgr(7, 27),
    bold: sgr(1, 22),
    accent: color ? sgr(36, 39) : plain,
    warning: color ? sgr(33, 39) : plain,
  };
}

// Draws frames on `output`. A frame is one string per row, each already as
// wide as rowWidth() says. Only the rows that changed since the last frame
// are written.
export function createScreen(output) {
  let shown = [];
  return {
    draw(rows) {
      let text = "";
      rows.forEach((row, index) => {
        if (row !== shown[index]) {
          text += terminal.moveTo(index) + row;
        }
      });
      shown = [...rows];
      if (text) {
        output.write(text);
      }
    },
    // Clears the screen and forgets what was on it, so the next frame is
    // drawn in full, as after a resize.
    clear() {
      shown = [];
      output.write(terminal.clear);
    },
    // The last frame drawn.
    rows: () => shown,
  };
}
