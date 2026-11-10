import { open } from "node:fs/promises";
import { formatSize } from "../lib/format.js";
import { plainLine } from "./screen.js";

// Reading a file for the preview in toolsmith ui's Files panel.

// The biggest file that's shown: 1 MB.
export const previewLimit = 1024 * 1024;

// Reads the file at `path` for showing: { size, lines, note }. A binary file
// (one with a NUL byte in its first 8 KB) and one bigger than previewLimit get
// a short note instead of lines. Text is read as UTF-8, or as UTF-16 when it
// starts with that byte order mark (as Windows PowerShell writes it), and each
// line loses its escape codes and other control characters.
export async function readPreview(path) {
  const file = await open(path, "r");
  try {
    const { size } = await file.stat();
    const { buffer: head, bytesRead } = await file.read(Buffer.alloc(Math.min(size, 8192)), 0, Math.min(size, 8192), 0);
    const start = head.subarray(0, bytesRead);
    const encoding = start[0] === 0xff && start[1] === 0xfe ? "utf-16le" : start[0] === 0xfe && start[1] === 0xff ? "utf-16be" : "utf-8";
    if (encoding === "utf-8" && start.includes(0)) {
      return { size, lines: [], note: `This is a binary file of ${formatSize(size)}, so it isn't shown.` };
    }
    if (size > previewLimit) {
      return { size, lines: [], note: `At ${formatSize(size)}, this file is too big to show here (the limit is ${formatSize(previewLimit)}).` };
    }
    const { buffer, bytesRead: read } = await file.read(Buffer.alloc(size), 0, size, 0);
    // TextDecoder drops the byte order mark.
    const text = new TextDecoder(encoding).decode(buffer.subarray(0, read));
    const lines = text.split(/\r\n|\r|\n/).map(plainLine);
    if (lines.length > 0 && lines.at(-1) === "") {
      lines.pop();
    }
    return { size, lines, note: lines.length === 0 ? "This file is empty." : "" };
  } finally {
    await file.close();
  }
}
