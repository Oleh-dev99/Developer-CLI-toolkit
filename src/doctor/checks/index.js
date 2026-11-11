import license from "./license.js";

// toolsmith doctor's checks. Each is a module in this folder whose default
// export is an object like this:
//
//   export default {
//     name: "license",
//     description: 'a LICENSE file that matches "license" in package.json',
//     network: false,
//     async run({ root, signal }) {
//       return [{ severity: "error", message: "…", file: "package.json", line: 4, fix: "…" }];
//     },
//   };
//
// name         What --only, --skip and toolsmith.json call the check: lowercase
//              words joined by "-".
// description  One line for toolsmith doctor --list, after the name.
// network      Optional. true when the check needs the network: then it's
//              skipped, with a warning, when there's no connection or with
//              --offline, instead of failing.
// run(project) Looks at the project and returns its findings: an array, empty
//              when all is well. `project` has:
//                root    the project's folder, an absolute path
//                signal  an AbortSignal, aborted when the check runs out of
//                        time: pass it on to child processes and fetch(), and
//                        stop when it's aborted. Doctor reports the timeout
//                        either way, but only the check can stop its own work.
//              Each finding is an object with:
//                severity  "error", "warning" or "info"
//                message   what's wrong, as one sentence
//                file      optional: where, as a path relative to `root`, with "/"
//                line      optional, with `file`: the line, from 1
//                fix       optional: what to do about it
//
// Doctor runs the checks at the same time, so a check works asynchronously
// and never blocks for long. A check that throws, doesn't finish in time or
// returns something that isn't a list of findings becomes an error finding of
// its own, and the other checks still run. toolsmith.json can ignore findings
// and change their severity (see src/doctor/config.js), so a check reports
// everything it finds, at the severity it thinks right. Keep a check's own
// imports light, or import inside run(): every check is loaded for each run.
//
// To add a check, write its module and add it to this list, which keeps them
// in alphabetical order.
export const checks = [license];
