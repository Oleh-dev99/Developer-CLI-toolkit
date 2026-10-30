import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTopLevelValue } from "./lib/json-text.js";

const defaults = {
  color: true,
  greeting: "Hello",
  protectedBranches: ["main", "master", "develop"],
  // Commit message templates for `toolsmith git template`, by name.
  templates: {},
  // Plugins turned on (true) or off (false), by package name; on by default.
  plugins: {},
};

// What each setting must be, in words that also work in error messages. An
// empty default like {} can't say this itself.
const kinds = {
  color: "boolean",
  greeting: "string",
  protectedBranches: "list of strings",
  templates: "map of names to text",
  plugins: "map of names to true/false",
};

// Reads ~/.toolsmithrc (or the file named by TOOLSMITH_CONFIG) and merges it
// over the defaults. A missing file means defaults; an unusable one throws.
export function loadConfig() {
  const path = process.env.TOOLSMITH_CONFIG
    ? resolve(process.env.TOOLSMITH_CONFIG)
    : join(homedir(), ".toolsmithrc");

  let buffer;
  try {
    buffer = readFileSync(path);
  } catch (err) {
    if (err.code === "ENOENT") {
      return { path, found: false, settings: { ...defaults }, warnings: [] };
    }
    throw new Error(`can't read config file ${path}: ${err.message}`);
  }

  let data;
  try {
    data = JSON.parse(decode(buffer));
  } catch (err) {
    throw new Error(`config file ${path} is not valid JSON: ${err.message}`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`config file ${path} must contain a JSON object`);
  }

  const settings = { ...defaults };
  const warnings = [];
  for (const [key, value] of Object.entries(data)) {
    if (!Object.hasOwn(defaults, key)) {
      warnings.push(`unknown setting "${key}" in config file ${path} (ignored)`);
    } else if (!isKind(value, kinds[key])) {
      throw new Error(`"${key}" in config file ${path} must be a ${kinds[key]}, got ${JSON.stringify(value)}`);
    } else {
      settings[key] = value;
    }
  }
  return { path, found: true, settings, warnings };
}

// Whether `value` is of `kind`, one of the words in `kinds`.
function isKind(value, kind) {
  const isMap = value !== null && typeof value === "object" && !Array.isArray(value);
  switch (kind) {
    case "list of strings":
      return Array.isArray(value) && value.every((item) => typeof item === "string");
    case "map of names to text":
      return isMap && Object.values(value).every((item) => typeof item === "string");
    case "map of names to true/false":
      return isMap && Object.values(value).every((item) => typeof item === "boolean");
    default:
      return typeof value === kind;
  }
}

// Sets `key` to `value` in the config file at `path`, creating the file if
// there's none. The rest of the file stays as it is: its other settings and
// their layout, and its encoding (see decode).
export function writeSetting(path, key, value) {
  let buffer;
  try {
    buffer = readFileSync(path);
  } catch (err) {
    if (err.code !== "ENOENT") {
      throw new Error(`can't read config file ${path}: ${err.message}`);
    }
  }
  let output;
  if (!buffer) {
    output = `${JSON.stringify({ [key]: value }, null, 2)}\n`;
  } else {
    const text = setTopLevelValue(decode(buffer), key, value);
    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
      output = Buffer.concat([buffer.subarray(0, 2), Buffer.from(text, "utf16le")]);
    } else {
      const hasBom = buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
      output = `${hasBom ? "﻿" : ""}${text}`;
    }
  }
  try {
    writeFileSync(path, output);
  } catch (err) {
    throw new Error(`can't write config file ${path}: ${err.message}`);
  }
}

// Windows PowerShell 5.1 saves UTF-16 with ">" and Out-File, and UTF-8 with a
// byte order mark when asked for UTF-8. Accept both.
function decode(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString("utf16le", 2);
  }
  return buffer.toString("utf8").replace(/^﻿/, "");
}
