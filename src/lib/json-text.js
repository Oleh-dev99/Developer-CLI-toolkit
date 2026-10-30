// Returns `text`, which holds a JSON object, with its top-level `key` set to
// `value`. Only the text of that value changes, or, for a new key, a member is
// added at the end, so the rest keeps its exact layout. The new value follows
// the file's style: on one line in a one-line object, or else indented like the
// file, with its line endings. Throws for text that isn't a JSON object.
export function setTopLevelValue(text, key, value) {
  const data = JSON.parse(text);
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("the JSON isn't an object");
  }
  const { open, close, members } = scanObject(text);
  const multiline = members.length === 0 || text.slice(open, close).includes("\n");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const unit = /^([ \t]+)\S/m.exec(text)?.[1] ?? "  ";
  const format = (indent) =>
    multiline
      ? JSON.stringify(value, null, unit).replaceAll("\n", `${eol}${indent}`)
      : JSON.stringify(value, null, 1).replace(/\n\s*/g, " ");

  // JSON.parse uses the last of repeated keys, so that's the one to change.
  const member = members.findLast((item) => item.key === key);
  if (member) {
    return text.slice(0, member.start) + format(lineIndent(text, member.keyStart)) + text.slice(member.end);
  }
  const entry = (indent) => `${JSON.stringify(key)}: ${format(indent)}`;
  if (members.length === 0) {
    return `${text.slice(0, open + 1)}${eol}${unit}${entry(unit)}${eol}${text.slice(close)}`;
  }
  const last = members.at(-1);
  const indent = lineIndent(text, last.keyStart);
  const separator = multiline ? `,${eol}${indent}` : ", ";
  return text.slice(0, last.end) + separator + entry(indent) + text.slice(last.end);
}

// Where the top-level object in `text` (valid JSON) opens and closes, and its
// members, each with where its key starts and its value's span.
function scanObject(text) {
  const open = skipSpace(text, 0);
  const members = [];
  let i = open + 1;
  for (;;) {
    i = skipSpace(text, i);
    if (text[i] === "}") {
      return { open, close: i, members };
    }
    const keyStart = i;
    const keyEnd = skipString(text, i);
    const start = skipSpace(text, skipSpace(text, keyEnd) + 1); // past the ":"
    const end = skipValue(text, start);
    members.push({ key: JSON.parse(text.slice(keyStart, keyEnd)), keyStart, start, end });
    i = skipSpace(text, end);
    if (text[i] === ",") {
      i++;
    }
  }
}

function skipSpace(text, i) {
  while (" \t\r\n".includes(text[i]) && i < text.length) {
    i++;
  }
  return i;
}

// `i` is at a string's opening quote; returns the position after its closing one.
function skipString(text, i) {
  for (i++; text[i] !== '"'; i++) {
    if (text[i] === "\\") {
      i++;
    }
  }
  return i + 1;
}

function skipValue(text, i) {
  if (text[i] === '"') {
    return skipString(text, i);
  }
  if (text[i] === "{" || text[i] === "[") {
    let depth = 0;
    while (i < text.length) {
      if (text[i] === '"') {
        i = skipString(text, i);
        continue;
      }
      if (text[i] === "{" || text[i] === "[") {
        depth++;
      } else if ((text[i] === "}" || text[i] === "]") && --depth === 0) {
        return i + 1;
      }
      i++;
    }
  }
  // A number, true, false or null.
  while (i < text.length && !" \t\r\n,}]".includes(text[i])) {
    i++;
  }
  return i;
}

// The spaces or tabs at the start of the line that `i` is on.
function lineIndent(text, i) {
  const lineStart = text.lastIndexOf("\n", i - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart))[0];
}
