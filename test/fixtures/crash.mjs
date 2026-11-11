// Loaded with --import after terminal.mjs (see ui.test.js): a moment after
// toolsmith ui starts drawing, something throws where nothing catches it, as a
// bug in the dashboard would. TOOLSMITH_TEST_CRASH says what: "exception" (an
// error thrown in a timer) or "rejection" (a promise rejected with no handler).
const write = process.stdout.write;
let armed = false;
process.stdout.write = function writeAndArm(chunk, ...rest) {
  if (!armed && String(chunk).includes("\x1b[?1049h")) {
    armed = true;
    setTimeout(() => {
      if (process.env.TOOLSMITH_TEST_CRASH === "rejection") {
        Promise.reject(new Error("a promise nobody handled"));
      } else {
        throw new Error("a bug in a timer");
      }
    }, 100);
  }
  return write.call(this, chunk, ...rest);
};
