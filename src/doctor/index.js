import { count } from "../lib/format.js";
import { checks as builtInChecks } from "./checks/index.js";
import { findProject, loadDoctorConfig, severities } from "./config.js";
import { isOnline } from "./online.js";
import { applySettings, chooseChecks, runChecks } from "./run.js";

export { jsonReport, markdownReport, textReport } from "./report.js";

// toolsmith doctor: checks the project around `cwd` and returns the report.
// Only src/commands/doctor.js imports this, when the command runs.

// How many seconds each check may take, unless --timeout or toolsmith.json
// says otherwise.
export const defaultTimeout = 30;

// Runs the checks and returns the report:
//   root, config  the project's folder, and its toolsmith.json or null
//   checks        the names of the checks that ran
//   skipped       { check, reason } for each check that didn't run, though asked
//   findings      { check, severity, message, file, line, fix }, the most
//                 severe first, then by check, each check's in its own order
//   summary       { errors, warnings, info, ignored }: how many findings of
//                 each severity, and how many toolsmith.json ignored
//   failOn        the least severity that fails the run
//   failed        whether a finding is that severe, for exit code 1
// Options, from the command line: `only` and `skip` (lists of check names),
// `timeout` (seconds), `failOn`, `offline`, and `debug`, which shows the
// stack of a check that crashes. `onWarning(message)` gets the warnings, like
// a check skipped for the network. Tests pass their own `checks`, and
// `online()` to say whether there's a connection.
export async function doctor({
  cwd = process.cwd(),
  only,
  skip,
  timeout,
  failOn = "error",
  offline = false,
  debug = false,
  onWarning = () => {},
  checks = builtInChecks,
  online = offline ? async () => false : () => isOnline(),
} = {}) {
  const project = findProject(cwd);
  const { settings, warnings } = loadDoctorConfig(
    project.config,
    checks.map((check) => check.name),
  );
  warnings.forEach((warning) => onWarning(warning));
  const chosen = chooseChecks(checks, { only, skip, ignored: settings.ignored });
  const seconds = timeout ?? settings.timeout ?? defaultTimeout;
  const { results, skipped } = await runChecks(chosen.run, { root: project.root, timeout: seconds * 1000, online, debug });
  for (const { check, reason } of skipped) {
    onWarning(`skipped the ${check} check: ${reason}`);
  }

  const { findings, ignored } = applySettings(results, settings);
  const rank = (finding) => severities.indexOf(finding.severity);
  // The sort is stable, so each check's findings stay in its own order.
  findings.sort((a, b) => rank(a) - rank(b) || (a.check < b.check ? -1 : a.check > b.check ? 1 : 0));
  const total = (severity) => findings.filter((finding) => finding.severity === severity).length;
  return {
    root: project.root,
    config: project.config,
    checks: results.map((result) => result.check),
    skipped: [...chosen.skipped, ...skipped],
    findings,
    summary: { errors: total("error"), warnings: total("warning"), info: total("info"), ignored },
    failOn,
    failed: findings.some((finding) => rank(finding) <= severities.indexOf(failOn)),
  };
}

// The checks, for toolsmith doctor --list: a line for each, with its name and
// what it looks at.
export function listChecks(checks = builtInChecks) {
  const width = Math.max(...checks.map((check) => check.name.length));
  const lines = checks.map((check) => `${check.name.padEnd(width)}  ${check.description}${check.network ? " (needs the network)" : ""}`);
  return `${lines.join("\n")}\n${count(checks.length, "check")}.\n`;
}
