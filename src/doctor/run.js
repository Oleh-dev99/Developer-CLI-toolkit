import { inspect } from "node:util";
import picomatch from "picomatch";
import { formatDuration } from "../lib/format.js";
import { severities } from "./config.js";

// Choosing, running and filtering toolsmith doctor's checks (see checks/index.js).

// The checks to run out of `checks`: those named in `only` (all of them when
// it's undefined), without those in `skip` and those that `ignored` (a Set of
// names, from toolsmith.json) ignores as a whole. Returns { run, skipped },
// with { check, reason } for each check left out by toolsmith.json. An unknown
// name in `only` or `skip` is an error.
export function chooseChecks(checks, { only, skip = [], ignored = new Set() } = {}) {
  const names = checks.map((check) => check.name);
  for (const [option, list] of [
    ["--only", only ?? []],
    ["--skip", skip],
  ]) {
    const unknown = list.find((name) => !names.includes(name));
    if (unknown !== undefined) {
      throw new Error(`unknown check "${unknown}" in ${option}; the checks are: ${names.join(", ")} (see "toolsmith doctor --list")`);
    }
  }
  const asked = checks.filter((check) => (only === undefined || only.includes(check.name)) && !skip.includes(check.name));
  return {
    run: asked.filter((check) => !ignored.has(check.name)),
    skipped: asked.filter((check) => ignored.has(check.name)).map((check) => ({ check: check.name, reason: "ignored in toolsmith.json" })),
  };
}

// Runs `checks` on the project in `root`, all at the same time, each for at
// most `timeout` milliseconds. Those that need the network wait for
// `online()`, which says whether there's a connection, and are skipped when
// there isn't (it's asked once, and only if one of them runs). Returns
// { results, skipped }:
//   results  { check, findings, failure } for each check that ran, in the
//            order of `checks`. `failure` is "crashed" or "timed out" when
//            the check didn't give its findings, and then `findings` has an
//            error that says so.
//   skipped  { check, reason } for each check skipped for the network
// With `debug`, a check's crash is shown on stderr, with its stack.
export async function runChecks(checks, { root, timeout, online, debug = false }) {
  let connected;
  const outcomes = await Promise.all(
    checks.map(async (check) => {
      if (check.network) {
        connected ??= online();
        if (!(await connected)) {
          return { skipped: { check: check.name, reason: "it needs the network, and there's no connection" } };
        }
      }
      return { result: await runCheck(check, { root, timeout, debug }) };
    }),
  );
  return {
    results: outcomes.filter((outcome) => outcome.result).map((outcome) => outcome.result),
    skipped: outcomes.filter((outcome) => outcome.skipped).map((outcome) => outcome.skipped),
  };
}

async function runCheck(check, { root, timeout, debug }) {
  const controller = new AbortController();
  const failed = (failure, message, fix) => ({ check: check.name, failure, findings: [{ severity: "error", message, fix }] });
  const late = Symbol("out of time");
  let timer;
  const outOfTime = new Promise((resolve) => {
    timer = setTimeout(() => resolve(late), timeout);
  });
  // A check that throws at once fails the same way as one that rejects.
  const running = (async () => check.run({ root, signal: controller.signal }))();
  // What it does after running out of time no longer matters.
  running.catch(() => {});
  try {
    const findings = await Promise.race([running, outOfTime]);
    if (findings === late) {
      controller.abort();
      return failed(
        "timed out",
        `the check didn't finish within ${formatDuration(timeout)}`,
        'Give the checks more time with --timeout, or "timeout" in the "doctor" section of toolsmith.json.',
      );
    }
    const problem = problemWith(findings);
    if (problem) {
      return failed("crashed", `the check returned something that isn't a list of findings: ${problem}`, "This is a bug in the check.");
    }
    return { check: check.name, findings: findings.map(({ severity, message, file, line, fix }) => ({ severity, message, file, line, fix })) };
  } catch (err) {
    if (debug) {
      console.error(`The ${check.name} check crashed:`, inspect(err));
    }
    return failed("crashed", `the check crashed: ${err?.message ?? String(err)}`, "This is a bug in the check; run toolsmith doctor --debug to see where it happened.");
  } finally {
    clearTimeout(timer);
  }
}

// What's wrong with what a check returned, or undefined when it's a list of
// findings as checks/index.js describes them.
function problemWith(findings) {
  if (!Array.isArray(findings)) {
    return `got ${inspect(findings)}`;
  }
  for (const finding of findings) {
    const shown = inspect(finding, { breakLength: Infinity });
    if (finding === null || typeof finding !== "object") {
      return `a finding is ${shown}`;
    }
    if (!severities.includes(finding.severity)) {
      return `a finding's severity isn't "error", "warning" or "info": ${shown}`;
    }
    if (typeof finding.message !== "string" || finding.message.trim() === "") {
      return `a finding has no message: ${shown}`;
    }
    if (finding.file !== undefined && (typeof finding.file !== "string" || finding.file === "")) {
      return `a finding's file isn't a path: ${shown}`;
    }
    if (finding.line !== undefined && (!Number.isInteger(finding.line) || finding.line < 1 || finding.file === undefined)) {
      return `a finding's line isn't a line number from 1, with a file: ${shown}`;
    }
    if (finding.fix !== undefined && typeof finding.fix !== "string") {
      return `a finding's fix isn't text: ${shown}`;
    }
  }
  return undefined;
}

// The findings of `results` (from runChecks) after toolsmith.json's settings
// (from loadDoctorConfig): without those its `rules` ignore, and with the
// `severity` it gives a check. A check's own failure stays an error, and is
// never ignored by location, since it has none. Returns { findings, ignored },
// each finding with the name of its `check`, and the number of findings ignored.
export function applySettings(results, { rules = [], severity = {} } = {}) {
  const matchers = rules.map((rule) => ({ ...rule, matches: picomatch(rule.file, { dot: true }) }));
  const findings = [];
  let ignored = 0;
  for (const { check, findings: found, failure } of results) {
    for (const finding of found) {
      const isIgnored = matchers.some(
        (rule) =>
          rule.check === check &&
          finding.file !== undefined &&
          (rule.file === finding.file || rule.matches(finding.file)) &&
          (rule.line === undefined || rule.line === finding.line),
      );
      if (isIgnored) {
        ignored++;
      } else {
        const { message, file, line, fix } = finding;
        findings.push({ check, severity: failure ? "error" : (severity[check] ?? finding.severity), message, file, line, fix });
      }
    }
  }
  return { findings, ignored };
}
