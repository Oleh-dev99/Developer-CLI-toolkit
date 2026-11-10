// Command lines that can be copied into a shell: each argument quoted only
// when it needs to be, for the shell people use on each system.
//
// On Windows that's PowerShell. In single quotes, PowerShell takes everything
// as it is, $ and backticks included, and a quote is written twice. (Windows
// PowerShell 5.1 still drops double quotes inside an argument when it starts a
// program, so an argument with a " in it can't be passed exactly from there.)
// Elsewhere it's sh, bash or zsh: single quotes, and ' is written as '\''.

// Arguments that no shell treats specially.
const plainArgument = /^[A-Za-z0-9_./:=+-]+$/;

export function quoteArgument(argument, platform = process.platform) {
  // In PowerShell, @ at the start splats and a comma makes an array.
  if (argument !== "" && plainArgument.test(argument)) {
    return argument;
  }
  if (platform === "win32") {
    // PowerShell also reads the typographic quotes ‘ and ’ as quotes.
    return `'${argument.replace(/['‘’]/g, "$&$&")}'`;
  }
  return `'${argument.replaceAll("'", "'\\''")}'`;
}

export function quoteCommandLine(words, platform = process.platform) {
  return words.map((word) => quoteArgument(word, platform)).join(" ");
}

// Words typed into one field, split the way a shell would at its simplest:
// at spaces, except inside double quotes. 'a "b c"' → ["a", "b c"].
export function splitWords(text) {
  const words = [];
  for (const [, quoted, plain] of text.matchAll(/"([^"]*)"?|(\S+)/g)) {
    words.push(quoted ?? plain);
  }
  return words;
}
