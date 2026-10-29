import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const defaults = { color: true, greeting: "Hello" };

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
    } else if (typeof value !== typeof defaults[key]) {
      throw new Error(
        `"${key}" in config file ${path} must be a ${typeof defaults[key]}, got ${JSON.stringify(value)}`,
      );
    } else {
      settings[key] = value;
    }
  }
  return { path, found: true, settings, warnings };
}

// Windows PowerShell 5.1 saves UTF-16 with ">" and Out-File, and UTF-8 with a
// byte order mark when asked for UTF-8. Accept both.
function decode(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString("utf16le", 2);
  }
  return buffer.toString("utf8").replace(/^﻿/, "");
}
