import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readJsonObject } from "../config.js";

// The project that toolsmith doctor checks, and its settings in toolsmith.json.

export const severities = ["error", "warning", "info"];

// The project around `folder`: the nearest folder, from `folder` up, that has
// a toolsmith.json, or else a package.json, or else `folder` itself. Returns
// { root, config }, where `config` is the path of its toolsmith.json, or null.
export function findProject(folder) {
  const start = resolve(folder);
  const nearestWith = (name) => {
    for (let dir = start; ; dir = dirname(dir)) {
      if (existsSync(join(dir, name))) {
        return dir;
      }
      if (dirname(dir) === dir) {
        return null;
      }
    }
  };
  const withConfig = nearestWith("toolsmith.json");
  if (withConfig) {
    return { root: withConfig, config: join(withConfig, "toolsmith.json") };
  }
  return { root: nearestWith("package.json") ?? start, config: null };
}

// The "doctor" section of the toolsmith.json at `path` (none when it's null),
// for the checks named in `checkNames`, as { settings, warnings }. Settings:
//   ignored   the checks ignored as a whole, from "ignore": a Set of names
//   rules     the findings ignored by location, from "ignore": a list of
//             { check, file, line }, where `file` is a path or a glob
//             pattern, and `line` is optional
//   severity  the severity of each check's findings, from "severity", by name
//   timeout   seconds each check may take, from "timeout", or undefined
// Like ~/.toolsmithrc, a file that isn't valid throws an error that names the
// file and the key, and what toolsmith doesn't know (an unknown key or check
// name) only gives a warning.
export function loadDoctorConfig(path, checkNames) {
  const settings = { ignored: new Set(), rules: [], severity: {}, timeout: undefined };
  const warnings = [];
  const data = path ? readJsonObject(path) : null;
  if (data === null) {
    return { settings, warnings };
  }

  const wrong = (key, kind, value) => new Error(`"${key}" in config file ${path} must be ${kind}, got ${JSON.stringify(value)}`);
  const known = (key, name) => {
    if (checkNames.includes(name)) {
      return true;
    }
    warnings.push(`unknown check "${name}" in "${key}" in config file ${path} (ignored); the checks are: ${checkNames.join(", ")}`);
    return false;
  };

  for (const key of Object.keys(data)) {
    if (key !== "doctor") {
      warnings.push(`unknown setting "${key}" in config file ${path} (ignored)`);
    }
  }
  const doctor = data.doctor;
  if (doctor === undefined) {
    return { settings, warnings };
  }
  if (!isMap(doctor)) {
    throw wrong("doctor", "an object", doctor);
  }
  for (const [key, value] of Object.entries(doctor)) {
    if (key === "ignore") {
      if (!Array.isArray(value)) {
        throw wrong("doctor.ignore", 'a list of check names and { "check", "file" } objects', value);
      }
      for (const [index, rule] of value.entries()) {
        const where = `doctor.ignore[${index}]`;
        if (typeof rule === "string") {
          if (known(where, rule)) {
            settings.ignored.add(rule);
          }
          continue;
        }
        const extra = isMap(rule) ? Object.keys(rule).filter((name) => !["check", "file", "line"].includes(name)) : [];
        if (!isMap(rule) || typeof rule.check !== "string" || typeof rule.file !== "string" || rule.file === "" || extra.length > 0) {
          throw wrong(where, 'a check name, or an object with "check", "file" and an optional "line"', rule);
        }
        if (rule.line !== undefined && !(Number.isInteger(rule.line) && rule.line >= 1)) {
          throw wrong(`${where}.line`, "a line number from 1", rule.line);
        }
        if (known(where, rule.check)) {
          settings.rules.push({ check: rule.check, file: rule.file, line: rule.line });
        }
      }
    } else if (key === "severity") {
      if (!isMap(value)) {
        throw wrong("doctor.severity", 'a map of check names to "error", "warning" or "info"', value);
      }
      for (const [name, severity] of Object.entries(value)) {
        if (!severities.includes(severity)) {
          throw wrong(`doctor.severity.${name}`, '"error", "warning" or "info"', severity);
        }
        if (known("doctor.severity", name)) {
          settings.severity[name] = severity;
        }
      }
    } else if (key === "timeout") {
      if (typeof value !== "number" || !(value > 0) || !Number.isFinite(value)) {
        throw wrong("doctor.timeout", "a number of seconds above 0", value);
      }
      settings.timeout = value;
    } else {
      warnings.push(`unknown setting "doctor.${key}" in config file ${path} (ignored)`);
    }
  }
  return { settings, warnings };
}

function isMap(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
