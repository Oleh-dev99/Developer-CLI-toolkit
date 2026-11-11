// The fake npm's answer to "npm outdated" and "npm audit" (see the file npm
// next to this one), for the tests of toolsmith doctor. For "npm outdated",
// these environment variables say what it does (and FAKE_NPM_AUDIT... the
// same for "npm audit"):
//   FAKE_NPM_OUTDATED         a file whose contents it prints, like npm's JSON
//   FAKE_NPM_OUTDATED_EXIT    its exit code (default 0)
//   FAKE_NPM_OUTDATED_STDERR  a line it prints on stderr
//   FAKE_NPM_OUTDATED_HANG    a file it writes its process ID to, before it
//                             waits forever, until it's stopped
// FAKE_NPM_LOG names a file that gets a line with the arguments of each run.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const setting = (name) => process.env[`FAKE_NPM_${args[0].toUpperCase()}${name}`];

if (process.env.FAKE_NPM_LOG) {
  appendFileSync(process.env.FAKE_NPM_LOG, `${args.join(" ")}\n`);
}
if (setting("_HANG")) {
  writeFileSync(setting("_HANG"), String(process.pid));
  setInterval(() => {}, 60_000);
} else {
  if (setting("")) {
    process.stdout.write(readFileSync(setting("")));
  }
  if (setting("_STDERR")) {
    process.stderr.write(`${setting("_STDERR")}\n`);
  }
  process.exitCode = Number(setting("_EXIT") ?? 0);
}
