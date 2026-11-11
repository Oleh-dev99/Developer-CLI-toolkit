import { runProgram } from "../lib/program.js";
import { detectPackageManager, managerNames } from "./package-manager.js";
import { hasDependencies, readPackage } from "./package.js";

// What doctor's checks that run npm (outdated and audit) share.

// Runs npm with `args` in `cwd`, without a shell (npm.cmd on Windows goes
// through cmd.exe safely, see startProgram), and returns { code, signal,
// stdout, stderr }. When `signal` is aborted, npm is stopped, with everything
// it started. npm doesn't look for a newer version of itself meanwhile.
export function runNpm(args, { cwd, signal }) {
  return runProgram("npm", args, { cwd, signal, env: { ...process.env, npm_config_update_notifier: "false" } });
}

// The commands that pnpm, Yarn and Bun have instead, by check.
const instead = {
  outdated: { pnpm: "pnpm outdated", yarn: "yarn outdated (Yarn 1) or yarn upgrade-interactive (Yarn 2 and later)" },
  audit: { pnpm: "pnpm audit", yarn: "yarn audit (Yarn 1) or yarn npm audit (Yarn 2 and later)" },
};

// Whether the `check` ("outdated" or "audit") can run npm in the project at
// `root`. Returns { pkg, manager } when it can, with package.json (from
// readPackage) and what detectPackageManager() found; or else { findings },
// which say why not, or nothing when there's nothing to check:
//   - no package.json, or one without dependencies: nothing
//   - a package.json that can't be read: an error
//   - signs of more than one package manager: a warning, since running the
//     wrong one could change the project
//   - pnpm, Yarn, Bun or another manager: info, since only npm is supported
//   - nothing installed (no lockfile, no node_modules): a warning
//   - with `lockfile`, an npm project without package-lock.json: a warning
export async function npmProject(root, check, { lockfile = false } = {}) {
  const pkg = await readPackage(root);
  if (pkg.problem) {
    return { findings: [pkg.problem] };
  }
  if (pkg.missing || !hasDependencies(pkg.data)) {
    return { findings: [] };
  }
  const found = await detectPackageManager(root, pkg.data);
  if (found.conflict) {
    return {
      findings: [
        {
          severity: "warning",
          message: `can't tell which package manager the project uses, so the ${check} check didn't run: ${found.conflict}`,
          fix: 'Remove the lockfiles of the package managers the project doesn\'t use, or correct "packageManager" in package.json.',
        },
      ],
    };
  }
  if (found.manager === undefined) {
    return {
      findings: [
        {
          severity: "warning",
          message: `the ${check} check has nothing to look at: the dependencies aren't installed (there's no lockfile and no node_modules folder)`,
          fix: "Install them with npm install, then run toolsmith doctor again.",
        },
      ],
    };
  }
  if (found.manager !== "npm") {
    const name = managerNames[found.manager] ?? found.manager;
    const command = instead[check][found.manager];
    return {
      findings: [
        {
          severity: "info",
          message: `the ${check} check works only with npm so far, and this project uses ${name} (${found.because}), so it didn't run`,
          fix: command ? `Run ${command} instead.` : `Check it with ${name}'s own commands instead.`,
        },
      ],
    };
  }
  if (lockfile && !found.lockfile) {
    return {
      findings: [
        {
          severity: "warning",
          message: `npm ${check} needs a package-lock.json, and the project has none, so the ${check} check didn't run`,
          fix: "Make one with npm install --package-lock-only, then run toolsmith doctor again.",
        },
      ],
    };
  }
  return { pkg, manager: found };
}

// Runs `npm <command> --json` with `npm` (runNpm, or the tests' own) and
// returns { data }, the JSON object it printed, or { finding }, an error that
// says why there's none: npm isn't there, it gave no JSON, or it reported an
// error, like one from the registry. npm exits with code 1 both when it finds
// something and when it fails, so the code doesn't tell; the JSON does. A run
// stopped by `signal` throws.
export async function npmJson(npm, command, { cwd, signal }) {
  const args = [command, "--json"];
  let result;
  try {
    result = await npm(args, { cwd, signal });
  } catch (err) {
    if (signal?.aborted) {
      throw err;
    }
    if (err.code === "ENOENT") {
      return {
        finding: {
          severity: "error",
          message: `npm isn't installed, or isn't on your PATH, so the ${command} check couldn't run`,
          fix: "Install Node.js with npm (https://nodejs.org), or add npm's folder to your PATH.",
        },
      };
    }
    return { finding: { severity: "error", message: `couldn't run npm ${command}: ${err.message}` } };
  }

  const text = result.stdout.trim();
  let data;
  try {
    data = text === "" && result.code === 0 ? {} : JSON.parse(text);
  } catch {
    data = undefined;
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    const ended = result.signal ? `ended by ${result.signal}` : `exit code ${result.code}`;
    const said = firstErrorLine(result.stderr);
    return {
      finding: {
        severity: "error",
        message: `npm ${command} --json gave no JSON object (${ended})${said ? `: ${said}` : ""}`,
        fix: `Run npm ${command} yourself to see what went wrong.`,
      },
    };
  }
  // npm's errors in JSON: { "error": { code, summary, detail } }, with a
  // "message" of its own when the audit server failed.
  if (data.error && typeof data.error === "object") {
    const { code, summary, detail } = data.error;
    const reason = (typeof summary === "string" && summary.trim()) || (typeof data.message === "string" && data.message.trim()) || "it gave no reason";
    const advice = typeof detail === "string" ? detail.trim().split("\n")[0] : "";
    return {
      finding: {
        severity: "error",
        message: `npm ${command} failed: ${reason}${code ? ` (${code})` : ""}`,
        fix: advice || `Run npm ${command} yourself to see npm's whole message.`,
      },
    };
  }
  return { data };
}

// npm's first error line on stderr ("npm error ..."), or else its first line.
function firstErrorLine(stderr) {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return (lines.find((line) => /^npm (error|ERR!)/.test(line)) ?? lines[0] ?? "").replace(/^npm (error|ERR!)\s*/, "");
}
