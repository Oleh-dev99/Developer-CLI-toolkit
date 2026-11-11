import { displayPath } from "../lib/files.js";
import { count } from "../lib/format.js";
import { severities } from "./config.js";

// toolsmith doctor's report (from doctor() in index.js) as text, Markdown and
// JSON. Each has the findings grouped by severity, then by check, and ends
// with the summary.

const titles = { error: "Errors", warning: "Warnings", info: "Info" };
const colors = { error: "red", warning: "yellow", info: "cyan" };
const plain = (format, text) => text;

// "1 error, 2 warnings, 0 info".
export function summaryLine({ errors, warnings, info }) {
  return `${count(errors, "error")}, ${count(warnings, "warning")}, ${info} info`;
}

// The report as text for a terminal. `paint(format, text)` colors a part of
// it, like output.js's paint(); by default nothing is colored.
export function textReport(report, { paint = plain } = {}) {
  const lines = [];
  for (const { severity, checks } of groups(report.findings)) {
    lines.push(paint(colors[severity], titles[severity]), "");
    for (const { check, findings } of checks) {
      lines.push(`  ${paint("bold", check)}`);
      for (const finding of findings) {
        const where = location(finding);
        lines.push(`    ${where ? `${where}: ` : ""}${finding.message}`);
        if (finding.fix) {
          lines.push(`      Fix: ${finding.fix}`);
        }
      }
      lines.push("");
    }
  }
  const where = displayPath(report.root) || "the current folder";
  lines.push(`${report.findings.length === 0 ? "No problems found. " : ""}Checked ${where}${checkedWith(report)}.${aside(report)}`);
  lines.push(paint(summaryColor(report.summary), summaryLine(report.summary)));
  return `${lines.join("\n")}\n`;
}

// The report as Markdown, for a pull request comment: the same content as the
// text, without the project's path, which means little there.
export function markdownReport(report) {
  const lines = ["## toolsmith doctor", ""];
  for (const { severity, checks } of groups(report.findings)) {
    lines.push(`### ${titles[severity]}`, "");
    for (const { check, findings } of checks) {
      lines.push(`**${markdown(check)}**`, "");
      for (const finding of findings) {
        const where = location(finding);
        // Two spaces end a line inside a list item.
        lines.push(`- ${where ? `${code(where)}: ` : ""}${markdown(finding.message)}${finding.fix ? "  " : ""}`);
        if (finding.fix) {
          lines.push(`  Fix: ${markdown(finding.fix)}`);
        }
      }
      lines.push("");
    }
  }
  lines.push(`${report.findings.length === 0 ? "No problems found. " : ""}Checked${checkedWith(report)}.${markdown(aside(report))}`, "");
  lines.push(`**${summaryLine(report.summary)}**`);
  return `${lines.join("\n")}\n`;
}

// The report as JSON, for scripts. A finding leaves out the location and fix
// it doesn't have.
export function jsonReport(report) {
  const { root, config, failOn, failed, checks, skipped, findings, summary } = report;
  return `${JSON.stringify({ root, config, failOn, failed, checks, skipped, findings, summary }, null, 2)}\n`;
}

// The findings by severity, most severe first, then by check, as
// [{ severity, checks: [{ check, findings }] }], leaving out what's empty.
function groups(findings) {
  return severities
    .map((severity) => {
      const ofSeverity = findings.filter((finding) => finding.severity === severity);
      const names = [...new Set(ofSeverity.map((finding) => finding.check))].sort();
      return { severity, checks: names.map((check) => ({ check, findings: ofSeverity.filter((finding) => finding.check === check) })) };
    })
    .filter((group) => group.checks.length > 0);
}

// "package.json:3", "LICENSE", or "" for a finding about the whole project.
function location({ file, line }) {
  return file === undefined ? "" : line === undefined ? file : `${file}:${line}`;
}

// " with 2 checks: license, outdated", or " with no checks".
function checkedWith({ checks }) {
  return checks.length === 0 ? " with no checks" : ` with ${count(checks.length, "check")}: ${checks.join(", ")}`;
}

// What was ignored and skipped, after the "Checked" line, or "".
function aside({ summary, skipped }) {
  const parts = [];
  if (summary.ignored > 0) {
    parts.push(` ${count(summary.ignored, "finding")} ignored by toolsmith.json.`);
  }
  if (skipped.length > 0) {
    parts.push(` Skipped: ${skipped.map(({ check, reason }) => `${check} (${reason})`).join(", ")}.`);
  }
  return parts.join("");
}

function summaryColor({ errors, warnings }) {
  return errors > 0 ? "red" : warnings > 0 ? "yellow" : "green";
}

// Text made safe for Markdown, and for the HTML that GitHub allows in it.
function markdown(text) {
  return text
    .replace(/[\\`*_[\]|#]/g, "\\$&")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// `text` as inline code, even when it has backticks in it.
function code(text) {
  const fence = "`".repeat(Math.max(0, ...Array.from(text.matchAll(/`+/g), ([ticks]) => ticks.length)) + 1);
  return fence.length > 1 ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`;
}
