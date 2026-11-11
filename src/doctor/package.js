import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { keyLine } from "../lib/json-text.js";
import { fsErrorReason } from "../lib/walk.js";

// The project's package.json, for doctor's checks.

// The sections of package.json that list dependencies.
export const dependencySections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

// package.json in `root` as { data, text }, or { missing: true }, or
// { problem } with an error finding when it can't be used.
export async function readPackage(root) {
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

// Whether package.json's `data` lists any dependencies.
export function hasDependencies(data) {
  return dependencySections.some((section) => data?.[section] && typeof data[section] === "object" && Object.keys(data[section]).length > 0);
}

// Where package.json's `text` lists the dependency `name`, as { file, line },
// in the first section that has it; just the file when none does.
export function dependencyLocation(text, name) {
  for (const section of dependencySections) {
    const line = keyLine(text, section, name);
    if (line) {
      return { file: "package.json", line };
    }
  }
  return { file: "package.json" };
}

export async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
