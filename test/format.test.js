import assert from "node:assert/strict";
import { test } from "node:test";
import { count, formatSize, parseSize } from "../src/lib/format.js";

test("count adds an s for anything but one", () => {
  assert.equal(count(1, "file"), "1 file");
  assert.equal(count(0, "file"), "0 files");
  assert.equal(count(3, "file"), "3 files");
});

test("formatSize uses B, KB, MB, … with 1 KB = 1024 bytes", () => {
  assert.equal(formatSize(0), "0 B");
  assert.equal(formatSize(1023), "1023 B");
  assert.equal(formatSize(1536), "1.5 KB");
  assert.equal(formatSize(450 * 1024), "450 KB");
  assert.equal(formatSize(5 * 1024 ** 3), "5 GB");
});

test("parseSize reads a number with an optional unit", () => {
  assert.equal(parseSize("500"), 500);
  assert.equal(parseSize("500B"), 500);
  assert.equal(parseSize("10KB"), 10240);
  assert.equal(parseSize("1.5 mb"), 1572864);
  assert.equal(parseSize("5XB"), null);
  assert.equal(parseSize("KB"), null);
});
