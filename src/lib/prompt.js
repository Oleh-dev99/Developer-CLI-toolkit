import { createInterface } from "node:readline/promises";

// Thrown by ask() when Ctrl+C is pressed or the input ends before an answer.
export class PromptCancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "PromptCancelled";
  }
}

// Asks questions on `output` (stderr) and reads the answers from `input`
// (stdin); tests pass their own streams. The reader opens at the first question
// and keeps every line, so answers piped in all at once ("y\nn\n") still reach
// the right questions. Call close() when done: an open reader keeps the program
// running.
export function createPrompt({ input = process.stdin, output = process.stderr, terminal } = {}) {
  const lines = [];
  let reader = null;
  let ended = false;
  let waiting = null;

  function open() {
    reader = createInterface({
      input,
      output,
      terminal: terminal ?? Boolean(input.isTTY && output.isTTY),
      crlfDelay: Infinity,
    });
    reader.on("line", (line) => {
      if (waiting) {
        const { resolve } = waiting;
        waiting = null;
        resolve(line);
      } else {
        lines.push(line);
      }
    });
    reader.on("close", () => {
      ended = true;
      if (waiting) {
        const { reject } = waiting;
        waiting = null;
        output.write("\n");
        reject(new PromptCancelled());
      }
    });
    // In a terminal, readline reports Ctrl+C here instead of ending the program.
    reader.on("SIGINT", () => reader.close());
  }

  // Shows `question` and returns the next line of input. The question goes
  // through readline, so editing the answer in a terminal redraws it properly.
  function nextLine(question) {
    if (!reader) {
      open();
    }
    if (ended) {
      // A closed reader can't show the question, so write it directly.
      if (lines.length > 0) {
        output.write(question);
        return Promise.resolve(lines.shift());
      }
      output.write(`${question}\n`);
      return Promise.reject(new PromptCancelled());
    }
    reader.setPrompt(question);
    reader.prompt();
    if (lines.length > 0) {
      return Promise.resolve(lines.shift());
    }
    return new Promise((resolve, reject) => {
      waiting = { resolve, reject };
    });
  }

  return {
    // Asks until the answer passes `validate`, which returns a problem to
    // explain (then the question is asked again) or nothing. An empty answer
    // takes `defaultValue`, which is shown in brackets.
    async ask(question, { defaultValue = "", validate = () => undefined } = {}) {
      const shown = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
      for (;;) {
        const answer = (await nextLine(shown)).trim() || defaultValue;
        const problem = answer === "" ? "Please enter a value." : validate(answer);
        if (!problem) {
          return answer;
        }
        output.write(`  ${problem}\n`);
      }
    },

    // A yes/no question: only "y" or "yes" means yes. No answer at all (the
    // input ends, or Ctrl+C) is a no.
    async confirm(question) {
      try {
        return /^y(es)?$/i.test((await nextLine(question)).trim());
      } catch (err) {
        if (err instanceof PromptCancelled) {
          return false;
        }
        throw err;
      }
    },

    close() {
      if (reader && !ended) {
        reader.close();
      }
    },
  };
}
