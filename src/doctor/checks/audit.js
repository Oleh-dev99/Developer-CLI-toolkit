import { dependencyLocation } from "../package.js";
import { npmJson, npmProject, runNpm } from "../npm.js";

// Known vulnerabilities in the dependencies, from npm audit: a finding for
// each advisory, with the package, the vulnerable versions, the advisory's
// title and address, and whether a fix is available. npm's severities become
// the report's: critical and high are errors, moderate is a warning, and low
// and info are info. npm audit needs a package-lock.json. pnpm, Yarn and Bun
// projects aren't supported yet (see npmProject).

const severities = { critical: "error", high: "error", moderate: "warning", low: "info", info: "info" };
const order = Object.keys(severities);

// The check, with `npm` to run npm (runNpm, or the tests' own).
export function auditCheck({ npm = runNpm } = {}) {
  return {
    name: "audit",
    description: "known vulnerabilities in the dependencies, from npm audit",
    network: true,
    async run({ root, signal }) {
      const project = await npmProject(root, "audit", { lockfile: true });
      if (project.findings) {
        return project.findings;
      }
      const result = await npmJson(npm, "audit", { cwd: root, signal });
      if (result.finding) {
        return [result.finding];
      }
      const { auditReportVersion, vulnerabilities } = result.data;
      if (auditReportVersion !== 2 || !vulnerabilities || typeof vulnerabilities !== "object") {
        return [
          {
            severity: "error",
            message: `npm audit's report isn't one that toolsmith can read (auditReportVersion ${JSON.stringify(auditReportVersion)})`,
            fix: "Use npm 7 or later, which comes with Node.js 15 and later.",
          },
        ];
      }

      const found = [];
      const seen = new Set();
      for (const vulnerability of Object.values(vulnerabilities)) {
        // An advisory is an object in "via"; a name there means that the
        // package is vulnerable through that one, which has the advisory.
        for (const advisory of Array.isArray(vulnerability?.via) ? vulnerability.via : []) {
          if (!advisory || typeof advisory !== "object") {
            continue;
          }
          const key = advisory.source ?? advisory.url ?? `${advisory.name} ${advisory.title}`;
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          found.push(describe(vulnerability, advisory, project));
        }
      }
      const rank = (finding) => order.indexOf(finding.level);
      return found
        .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "en") || a.message.localeCompare(b.message, "en"))
        .map(({ level, name, ...finding }) => finding);
    },
  };
}

export default auditCheck();

function describe(vulnerability, advisory, { pkg, manager }) {
  const name = advisory.name ?? vulnerability.name;
  const level = advisory.severity in severities ? advisory.severity : "moderate";
  const versions = advisory.range ? ` ${advisory.range}` : "";
  const address = advisory.url ? ` (${advisory.url})` : "";
  const effects = Array.isArray(vulnerability.effects) ? vulnerability.effects : [];
  const through = !vulnerability.isDirect && effects.length > 0 ? `; it's a dependency of ${effects.join(", ")}` : "";
  // A dependency in package.json is shown there, and others in the lockfile.
  const location = vulnerability.isDirect ? dependencyLocation(pkg.text, name) : { file: manager.lockfile };
  return {
    name,
    level,
    ...location,
    severity: severities[level],
    message: `${advisory.severity ?? "unknown"} vulnerability in ${name}${versions}: ${advisory.title ?? "no title"}${address}${through}`,
    fix: fixFor(vulnerability.fixAvailable),
  };
}

// What npm says about a fix: true when npm audit fix does it, false when
// there's none, or the package and version a fix needs, and whether that's a
// major update, which npm audit fix only makes with --force.
function fixFor(available) {
  if (available === true) {
    return "Run npm audit fix.";
  }
  if (available && typeof available === "object" && available.name) {
    const target = `${available.name}@${available.version}`;
    return available.isSemVerMajor
      ? `The fix is ${target}, a major update that can break things: check its changelog, then run npm audit fix --force (or npm install ${target}).`
      : `Run npm audit fix, which installs ${target}.`;
  }
  return "No fix is available yet: see the advisory for a workaround, or replace the package.";
}
