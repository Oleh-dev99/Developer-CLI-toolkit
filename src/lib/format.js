// Sizes use 1 KB = 1024 bytes, like Windows Explorer and `du -h`.
const units = ["B", "KB", "MB", "GB", "TB"];

// "1 file", "3 files".
export function count(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// 1536 → "1.5 KB", 460800 → "450 KB".
export function formatSize(bytes) {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded = value >= 10 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

// "500", "500B", "10KB", "1.5 mb" → bytes; null if the text isn't a size.
export function parseSize(text) {
  const match = /^(\d+(?:\.\d+)?)\s*([KMGT]?B)?$/i.exec(text.trim());
  if (!match) {
    return null;
  }
  const unit = match[2] ? units.indexOf(match[2].toUpperCase()) : 0;
  return Math.round(Number(match[1]) * 1024 ** unit);
}
