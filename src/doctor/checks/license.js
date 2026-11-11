import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { topLevelKeyLine } from "../../lib/json-text.js";
import { fsErrorReason } from "../../lib/walk.js";
import { detectLicenses, namesLicense, suggestedId } from "../licenses.js";

// The project's own license: a LICENSE file (or LICENCE, COPYING, UNLICENSE,
// with an extension like .md or a suffix like -MIT) in its folder, whose text
// is the license that "license" in package.json names.

// License files: LICENSE, LICENSE.md, LICENSE-MIT, COPYING.LESSER and the
// like, but not code like license.js.
const licenseName = /^(?:licen[cs]e|copying|unlicense)(?:[-.][a-z0-9-]+)*$/i;
const codeName = /\.(?:[cm]?[jt]sx?|json|ya?ml|sh|ps1|py|rb)$/i;

export default {
  name: "license",
  description: 'a LICENSE file with the license that "license" in package.json names',
  async run({ root }) {
    const pkg = await readPackage(root);
    if (pkg.problem) {
      return [pkg.problem];
    }
    const findings = [];
    const files = [];
    for (const file of await licenseFiles(root)) {
      try {
        files.push({ file, licenses: detectLicenses(await readFile(join(root, file), "utf8")) });
      } catch (err) {
        findings.push({ severity: "error", file, message: `can't read ${file} (${fsErrorReason(err)})` });
      }
    }

    // An empty "license" says as little as none.
    const license = typeof pkg.data?.license === "string" && pkg.data.license.trim() === "" ? undefined : pkg.data?.license;
    const at ={ file: "package.json", line: pkg.text && topLevelKeyLine(pkg.text, "license") };
    if (license !== undefined && typeof license !== "string") {
      findings.push({
        ...at,
        severity: "warning",
        message: '"license" in package.json isn\'t text like "MIT"',
        fix: 'Use an SPDX expression, like "MIT" or "(MIT OR Apache-2.0)": npm no longer reads "license" as an object.',
      });
      return findings;
    }

    // npm's way to point at a license of one's own: then any text goes.
    const seeFile = /^SEE LICEN[CS]E IN (.+)$/i.exec(license ?? "")?.[1].trim();
    if (seeFile) {
      if (!(await exists(join(root, seeFile)))) {
        findings.push({
          ...at,
          severity: "error",
          message: `"license" in package.json points to ${seeFile}, but there's no such file`,
          fix: `Add ${seeFile} with the license's terms, or correct the file name in "license".`,
        });
      }
      return findings;
    }

    // "UNLICENSED" is npm's word for code that no one else may use.
    const unlicensed = license?.toUpperCase() === "UNLICENSED";
    if (files.length === 0 && findings.length === 0) {
      if (license !== undefined && !unlicensed) {
        findings.push({
          ...at,
          severity: "error",
          message: `"license" in package.json is ${license}, but there's no LICENSE file with its text`,
          fix: `Add a LICENSE file with the ${license} license text, with the year and your name in it.`,
        });
      } else if (license === undefined && !pkg.data?.private) {
        findings.push({
          severity: "warning",
          ...(pkg.missing ? {} : { file: "package.json" }),
          message: pkg.missing ? "the project has no LICENSE file" : 'the project has no license: no LICENSE file, and no "license" in package.json',
          fix: 'Choose a license (https://choosealicense.com) and put its text in a LICENSE file, and its SPDX identifier in "license" in package.json; or set "license" to "UNLICENSED" if no one else may use the code.',
        });
      }
      return findings;
    }

    for (const { file, licenses } of files) {
      const [own] = licenses;
      if (!own && unlicensed) {
        // Terms of one's own, as UNLICENSED says.
      } else if (!own) {
        findings.push({ file, severity: "warning", message: `can't tell which license ${file} has: its text isn't one that toolsmith knows`, fix: unknownTextFix(file, license) });
      } else if (pkg.missing) {
        // Nothing to compare it with.
      } else if (license === undefined) {
        findings.push({
          file: "package.json",
          severity: "warning",
          message: `package.json has no "license", but ${file} has the ${own.name} license text`,
          fix: `Add "license": ${suggestedId(own)} to package.json.`,
        });
      } else if (unlicensed) {
        findings.push({
          ...at,
          severity: "warning",
          message: `"license" in package.json is UNLICENSED, meaning that no one else may use the code, but ${file} has the ${own.name} license text`,
          fix: `Set "license" to ${suggestedId(own)}, or remove ${file} if the code isn't open source.`,
        });
      } else if (!namesLicense(license, own)) {
        findings.push({
          ...at,
          severity: "error",
          message: `"license" in package.json is ${license}, but ${file} has the ${own.name} license text`,
          fix: `Make them agree: set "license" to ${suggestedId(own)}, or put the ${license} license text in ${file}.`,
        });
      }
    }
    return findings;
  },
};

// package.json as { data, text }, or { missing: true }, or { problem } with an
// error finding when it can't be used.
async function readPackage(root) {
  let text;
  try {
    text = (await readFile(join(root, "package.json"), "utf8")).replace(/^﻿/, "");
  } catch (err) {
    if (err.code === "ENOENT") {
      return { missing: true };
    }
    return { problem: { file: "package.json", severity: "error", message: `can't read package.json (${fsErrorReason(err)})` } };
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return {
      problem: { file: "package.json", line: errorLine(text, err), severity: "error", message: `package.json isn't valid JSON: ${err.message}`, fix: "Correct the JSON, so that npm can read it." },
    };
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return { problem: { file: "package.json", severity: "error", message: "package.json doesn't hold a JSON object", fix: "Make it an object, like npm init writes." } };
  }
  return { data, text };
}

// The line of a JSON.parse error in `text`, from its message: newer versions
// of V8 give the line, and all of them the position.
function errorLine(text, err) {
  const line = /\(line (\d+)/.exec(err.message)?.[1];
  if (line) {
    return Number(line);
  }
  const position = /at position (\d+)/.exec(err.message)?.[1];
  return position === undefined ? undefined : text.slice(0, Number(position)).split("\n").length;
}

// The names of the license files in `root`, in alphabetical order.
async function licenseFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && licenseName.test(entry.name) && !codeName.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function unknownTextFix(file, license) {
  const standard = license && !/\s/.test(license) ? `the standard ${license} text, from https://spdx.org/licenses/${license}.html` : "its standard text, from https://spdx.org/licenses/";
  return `If it's meant to be a common license, use ${standard}; if it's a license of your own, set "license" in package.json to "SEE LICENSE IN ${file}".`;
}
