import { styleText } from "node:util";

// Messages for the user: success() and info() go to stdout, warn() and
// error() go to stderr.

let colorEnabled = true;

// Called for --no-color.
export function disableColor() {
  colorEnabled = false;
}

// styleText checks the stream: no colors when it isn't a terminal or NO_COLOR
// is set, unless FORCE_COLOR is set. Keep to single formats like "green" —
// on Node 22.12, an array of formats skips these checks.
function paint(format, text, stream) {
  return colorEnabled ? styleText(format, text, { stream }) : text;
}

export function success(message) {
  console.log(paint("green", message, process.stdout));
}

export function info(message) {
  console.log(paint("cyan", message, process.stdout));
}

export function warn(message) {
  console.error(paint("yellow", `warning: ${message}`, process.stderr));
}

export function error(message) {
  console.error(paint("red", `error: ${message}`, process.stderr));
}
