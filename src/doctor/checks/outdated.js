import gt from "semver/functions/gt.js";
import satisfies from "semver/functions/satisfies.js";
import valid from "semver/functions/valid.js";
import { dependencyLocation } from "../package.js";
import { npmJson, npmProject, runNpm } from "../npm.js";

// Dependencies with newer versions, from npm outdated, by kind of update:
//   major  the new version is outside the current one's ^ range, so it can
//          break things (for 0.x versions, like 0.1 to 0.2, too): a warning
//   minor  inside the ^ range, but not the ~ range: info
//   patch  inside the ~ range: info
// A dependency that package.json lists but isn't installed is a warning.
// pnpm, Yarn and Bun projects aren't supported yet (see npmProject).

const severities = { major: "warning", minor: "info", patch: "info" };
const order = ["major", "minor", "patch"];

// The check, with `npm` to run npm (runNpm, or the tests' own).
export function outdatedCheck({ npm = runNpm } = {}) {
  return {
    name: "outdated",
    description: "dependencies with newer versions, by major, minor and patch update, from npm outdated",
    network: true,
    async run({ root, signal }) {
      const project = await npmProject(root, "outdated");
      if (project.findings) {
        return project.findings;
      }
      const result = await npmJson(npm, "outdated", { cwd: root, signal });
      if (result.finding) {
        return [result.finding];
      }
      const text = project.pkg.text;
      const found = [];
      // A dependency that's outdated in more than one place, like in two
      // workspaces, has a list of them.
      for (const [name, entries] of Object.entries(result.data)) {
        const many = Array.isArray(entries);
        for (const entry of many ? entries : [entries]) {
          if (entry && typeof entry === "object") {
            const finding = describe(name, entry, many);
            if (finding) {
              found.push({ ...dependencyLocation(text, name), ...finding });
            }
          }
        }
      }
      const rank = (finding) => (finding.kind ? order.indexOf(finding.kind) : -1);
      return found
        .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "en"))
        .map(({ kind, name, ...finding }) => finding);
    },
  };
}

export default outdatedCheck();

// The kind of update from `current` to `latest`: "major", "minor", "patch",
// or undefined when `latest` isn't newer (or either isn't a version).
export function updateKind(current, latest) {
  if (!valid(current) || !valid(latest) || !gt(latest, current)) {
    return undefined;
  }
  const options = { includePrerelease: true };
  return !satisfies(latest, `^${current}`, options) ? "major" : !satisfies(latest, `~${current}`, options) ? "minor" : "patch";
}

// The finding for one dependency in npm outdated's JSON, with its `kind` and
// `name` for sorting, or undefined when there's nothing to say. `dependent`
// is said when the dependency is outdated in more than one place.
function describe(name, { current, wanted, latest, dependent }, many) {
  const where = many && dependent ? ` (in ${dependent})` : "";
  if (current === undefined) {
    return {
      name,
      severity: "warning",
      message: `${name} isn't installed${where}: wanted ${wanted}, latest ${latest}`,
      fix: "Run npm install.",
    };
  }
  const kind = updateKind(current, latest);
  if (!kind) {
    if (current === wanted) {
      return undefined;
    }
    return {
      name,
      severity: "info",
      message: `${name} ${current} is installed${where}, but package.json wants ${wanted}`,
      fix: "Run npm install, to install what package.json wants.",
    };
  }
  const careful = kind === "major" ? ", after checking its changelog for breaking changes" : "";
  const fix =
    valid(wanted) && gt(wanted, current)
      ? `Run npm update ${name} for ${wanted}${wanted === latest ? "" : `; ${latest} needs npm install ${name}@${latest}${careful}`}.`
      : `Run npm install ${name}@${latest}${careful}.`;
  return {
    name,
    kind,
    severity: severities[kind],
    message: `${kind} update for ${name}${where}: current ${current}, wanted ${wanted}, latest ${latest}`,
    fix,
  };
}
