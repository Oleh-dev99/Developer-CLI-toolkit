// Loaded with --import (see terminalEnv in helpers.js): makes the CLI believe
// its input is a terminal, so it asks its questions and tests can answer them.
process.stdin.isTTY = true;
