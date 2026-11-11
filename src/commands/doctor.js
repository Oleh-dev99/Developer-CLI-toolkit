import { InvalidArgumentError, Option } from "commander";
import { paint, warn } from "../output.js";

export function register(program) {
  program
    .command("doctor")
    .description("check the project for problems, and report them by severity")
    .option("--only <checks>", "run only these checks (names, separated by commas)", checkNames)
    .option("--skip <checks>", "don't run these checks", checkNames)
    .option("--list", "show the checks")
    .addOption(
      new Option("--fail-on <severity>", "exit with code 1 for findings this severe or more").choices(["error", "warning", "info"]).default("error"),
    )
    .option("--timeout <seconds>", 'how long each check may take (default: 30, or "timeout" in toolsmith.json)', seconds)
    .option("--offline", "skip the checks that need the network")
    .option("--json", "print the report as JSON")
    .addOption(new Option("--markdown", "print the report as Markdown, like for a pull request comment").conflicts("json"))
    .addHelpText(
      "after",
      `
Examples:
  Check the project you're in:
  $ toolsmith doctor

  Only the license check, as JSON for a script:
  $ toolsmith doctor --only license --json

  In CI, failing on warnings too, with a report for the pull request:
  $ toolsmith doctor --fail-on warning --markdown > doctor.md

The project is the nearest folder, from the current one up, that has a
toolsmith.json, or else a package.json. The "doctor" section of its
toolsmith.json can ignore findings (of a check, or of a check in a file),
change the severity of a check's findings, and set the timeout.
toolsmith doctor --list shows the checks.

The checks run at the same time, each for at most 30 seconds unless you say
otherwise. A check that crashes or runs out of time is an error of its own,
and the other checks still run. A check that needs the network is skipped,
with a warning, when there's no connection, and with --offline.

Exit codes: 0 when no finding is as severe as --fail-on (an error, unless you
choose warning or info), and 1 when one is, or when doctor can't run, like
for an unknown check or a toolsmith.json that isn't valid.`,
    )
    .action(async (options) => {
      // Imported only now, so that other commands don't load doctor's code.
      const { doctor, jsonReport, listChecks, markdownReport, textReport } = await import("../doctor/index.js");
      if (options.list) {
        process.stdout.write(listChecks());
        return;
      }
      const report = await doctor({
        only: options.only,
        skip: options.skip,
        timeout: options.timeout,
        failOn: options.failOn,
        offline: options.offline,
        debug: program.opts().debug,
        onWarning: warn,
      });
      process.stdout.write(options.json ? jsonReport(report) : options.markdown ? markdownReport(report) : textReport(report, { paint }));
      if (report.failed) {
        process.exitCode = 1;
      }
    });
}

// "license,outdated" → ["license", "outdated"], added to the names of the
// option given before, so that it can be given more than once.
function checkNames(text, before = []) {
  const names = text
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length === 0) {
    throw new InvalidArgumentError("Name at least one check, like license.");
  }
  return [...before, ...names];
}

function seconds(text) {
  const number = Number(text);
  if (text.trim() === "" || !Number.isFinite(number) || number <= 0) {
    throw new InvalidArgumentError("Use a number of seconds above 0, like 30 or 2.5.");
  }
  return number;
}
