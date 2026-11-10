import { stripVTControlCharacters } from "node:util";

// Drawing for the full-screen UI (`toolsmith ui`): rows of text fitted to the
// terminal's width, painted with the 16 basic colors, and written so that only
// the rows that changed are redrawn. Later parts of the UI build their panels
// from these helpers.
//
// Widths are what terminals show, not string lengths: Chinese, Japanese and
// Korean characters and most emoji take two columns, accents added to a
// letter take none, and an emoji made of several (like a family, or a flag)
// is one, two columns wide.

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

// What's seen as one character: a letter with its accents, an emoji with its
// modifiers, a flag.
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const characters = (text) => Array.from(segmenter.segment(text), ({ segment }) => segment);

// Code points that East Asian terminals show two columns wide (Unicode's East
// Asian Width "W" and "F"), as [first, last] ranges.
const wide = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x231a, 0x231b], // watch, hourglass
  [0x2329, 0x232a], // angle brackets
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x2e80, 0x303e], // CJK radicals, punctuation
  [0x3041, 0x33ff], // Hiragana, Katakana, CJK symbols
  [0x3400, 0x4dbf], // CJK extension A
  [0x4e00, 0x9fff], // CJK ideographs
  [0xa000, 0xa4cf], // Yi
  [0xa960, 0xa97f], // Hangul Jamo extended
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe10, 0xfe19], // vertical forms
  [0xfe30, 0xfe6f], // CJK compatibility forms, small forms
  [0xff00, 0xff60], // fullwidth forms
  [0xffe0, 0xffe6],
  [0x16fe0, 0x16fe4],
  [0x17000, 0x18cff], // Tangut, Khitan
  [0x1aff0, 0x1b2ff], // Kana supplements
  [0x1f200, 0x1f2ff], // enclosed ideographs
  [0x20000, 0x3fffd], // CJK extensions B and later
];
const isWide = (code) => wide.some(([first, last]) => code >= first && code <= last);
// Shown as emoji, two columns: emoji by default, ones turned into emoji by
// the variation selector U+FE0F, and flags (regional indicators).
const emoji = /\p{Emoji_Presentation}|\p{Extended_Pictographic}️|\p{Regional_Indicator}/u;
// Nothing on their own: accents and other combining marks, joiners and
// variation selectors.
const zeroWidth = /^[\p{Mn}\p{Me}​-‏⁠︀-️]+$/u;

// How many columns one character (see characters()) takes.
function characterWidth(character) {
  const code = character.codePointAt(0);
  if (code < 0x20 || (code >= 0x7f && code < 0xa0) || zeroWidth.test(character)) {
    return 0;
  }
  return emoji.test(character) || isWide(code) ? 2 : 1;
}

// How many columns `text` takes in a terminal.
export function width(text) {
  if (/^[\x20-\x7e]*$/.test(text)) {
    return text.length;
  }
  return characters(text).reduce((sum, character) => sum + characterWidth(character), 0);
}

// The longest start of `parts` (characters) that fits in `columns`.
function fitting(parts, columns) {
  let used = 0;
  let count = 0;
  for (const part of parts) {
    const size = characterWidth(part);
    if (used + size > columns) {
      break;
    }
    used += size;
    count++;
  }
  return parts.slice(0, count).join("");
}

// `text` cut to at most `columns` columns, ending in "…" when it was cut. A
// two-column character that doesn't fit is left out whole.
export function truncate(text, columns) {
  if (width(text) <= columns) {
    return text;
  }
  return columns > 0 ? `${fitting(characters(text), columns - 1)}…` : "";
}

// `text` cut to at most `columns` columns from the start, beginning with "…"
// when it was cut, so that its end stays in view: for what's being typed, or
// a path.
export function truncateStart(text, columns) {
  if (width(text) <= columns) {
    return text;
  }
  return columns > 0 ? `…${[...fitting(characters(text).reverse(), columns - 1)].reverse().join("")}` : "";
}

// `text` made exactly `columns` wide: cut when longer, padded with spaces when
// shorter.
export function pad(text, columns) {
  const cut = truncate(text, columns);
  return cut + " ".repeat(Math.max(0, columns - width(cut)));
}

// `text` broken into lines of at most `columns` columns, at spaces where it
// can be, and inside words that are longer than a line.
export function wrap(text, columns) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    let rest = word;
    while (width(rest) > columns && columns > 0) {
      if (line) {
        lines.push(line);
        line = "";
      }
      // At least one character per line, even a wide one in one column.
      const start = fitting(characters(rest), columns) || characters(rest)[0];
      lines.push(start);
      rest = rest.slice(start.length);
    }
    if (!line) {
      line = rest;
    } else if (width(line) + 1 + width(rest) <= columns) {
      line += ` ${rest}`;
    } else {
      lines.push(line);
      line = rest;
    }
  }
  lines.push(line);
  return lines;
}

// A line of text from a program or a file, ready to show: what's left after
// the last carriage return (progress that rewrites its line), without escape
// codes or other control characters, and with tabs turned into spaces up to
// the next multiple of 8 columns.
export function plainLine(line) {
  const text = stripVTControlCharacters(line.split("\r").findLast((part) => part !== "") ?? "");
  let result = "";
  for (const character of characters(text)) {
    if (character === "\t") {
      result += " ".repeat(8 - (width(result) % 8));
    } else if (characterWidth(character) > 0 || zeroWidth.test(character)) {
      result += character;
    }
  }
  return result;
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
