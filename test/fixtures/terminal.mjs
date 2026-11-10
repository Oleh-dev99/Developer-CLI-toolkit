// Loaded with --import (see screenTerminalEnv in helpers.js): makes toolsmith
// believe that both its input and its output are a 60x15 terminal, so that
// `toolsmith ui` runs in tests, with pipes. Raw mode changes are written to the
// output as <raw on> and <raw off>, so tests can see when they happen compared
// with what's drawn.
import { WriteStream } from "node:tty";

process.stdin.isTTY = true;
process.stdin.setRawMode = function setRawMode(on) {
  process.stdout.write(on ? "<raw on>" : "<raw off>");
  this.isRaw = on;
  return this;
};
Object.assign(process.stdout, {
  isTTY: true,
  columns: 60,
  rows: 15,
  // Node's own color checks for terminals, which read NO_COLOR, FORCE_COLOR
  // and TERM.
  getColorDepth: WriteStream.prototype.getColorDepth,
  hasColors: WriteStream.prototype.hasColors,
});
