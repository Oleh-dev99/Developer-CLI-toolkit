// Telling licenses apart by their text, for toolsmith doctor.

// The licenses toolsmith knows by their text. Each has the SPDX identifiers
// that can name it in package.json (the ones to suggest first), and phrases
// of its text, all of which must be there, and none of those in `without`.
// The phrases are matched against the text made plain by normalize(), so they
// are written the same way: lowercase words and numbers, one space apart.
// The GNU licenses are told apart by their title, version and date; their
// text doesn't say whether "or later" versions are allowed, so either
// identifier matches.
const known = [
  {
    name: "MIT",
    ids: ["MIT"],
    phrases: [
      /permission is hereby granted free of charge to any person obtaining a copy of this software/,
      /the above copyright notice and this permission notice shall be included in all copies or substantial portions of the software/,
    ],
  },
  {
    name: "ISC",
    ids: ["ISC"],
    phrases: [
      /permission to use copy modify and (?:or )?distribute this software for any purpose with or without fee is hereby granted provided that the above copyright notice and this permission notice appear in all copies/,
    ],
  },
  {
    name: "Apache-2.0",
    ids: ["Apache-2.0"],
    phrases: [/apache license version 2 0 january 2004/, /terms and conditions for use reproduction and distribution/],
  },
  ...bsd(),
  gnu("GPL-2.0", /gnu general public license version 2 june 1991/),
  gnu("GPL-3.0", /gnu general public license version 3 29 june 2007/),
  gnu("LGPL-2.0", /gnu library general public license version 2 june 1991/),
  gnu("LGPL-2.1", /gnu lesser general public license version 2 1 february 1999/),
  gnu("LGPL-3.0", /gnu lesser general public license version 3 29 june 2007/),
  gnu("AGPL-3.0", /gnu affero general public license version 3 19 november 2007/),
  {
    name: "MPL-2.0",
    ids: ["MPL-2.0"],
    phrases: [/mozilla public license version 2 0/],
  },
  {
    name: "Unlicense",
    ids: ["Unlicense"],
    phrases: [
      /this is free and unencumbered software released into the public domain/,
      /anyone is free to copy modify publish use compile sell or distribute this software/,
    ],
  },
];

// The BSD licenses share their first clauses; the 3-clause one adds that the
// names may not be used to endorse products, and the 4-clause one also asks
// for an acknowledgement in advertising.
function bsd() {
  const conditions = [
    /redistribution and use in source and binary forms with or without modification are permitted provided that the following conditions are met/,
    /redistributions of source code must retain the above copyright notice this list of conditions and the following disclaimer/,
  ];
  const endorse = /may be used to endorse or promote products derived from this software without specific prior written permission/;
  const advertising = /all advertising materials mentioning features or use of this software must display the following acknowledge?ment/;
  return [
    { name: "BSD-4-Clause", ids: ["BSD-4-Clause"], phrases: [...conditions, endorse, advertising] },
    { name: "BSD-3-Clause", ids: ["BSD-3-Clause"], phrases: [...conditions, endorse], without: [advertising] },
    { name: "BSD-2-Clause", ids: ["BSD-2-Clause"], phrases: conditions, without: [endorse, advertising] },
  ];
}

function gnu(name, title) {
  return { name, ids: [`${name}-only`, `${name}-or-later`, name, `${name}+`], phrases: [title] };
}

// The text as lowercase words and numbers, one space apart, so that line
// breaks, punctuation, Markdown and quotes don't matter.
function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// The licenses whose text is in `text`, in the order their texts start, each
// as { name, ids }. A LICENSE file has its own license first; after it may
// come the licenses of code it includes. Empty when no text is known: then
// it's a license toolsmith doesn't know, or a known one that was changed, and
// it doesn't guess.
export function detectLicenses(text) {
  const plain = normalize(text);
  const found = [];
  for (const license of known) {
    const starts = license.phrases.map((phrase) => plain.search(phrase));
    if (starts.every((start) => start !== -1) && !(license.without ?? []).some((phrase) => phrase.test(plain))) {
      found.push({ name: license.name, ids: license.ids, start: Math.min(...starts) });
    }
  }
  return found.sort((a, b) => a.start - b.start).map(({ name, ids }) => ({ name, ids }));
}

// The license identifiers in an SPDX expression like "MIT", "(MIT OR
// Apache-2.0)" or "GPL-2.0-only WITH Classpath-exception-2.0", without the
// exceptions.
export function expressionIds(expression) {
  return expression
    .replace(/[()]/g, " ")
    .split(/\s+(?:OR|AND)\s+/i)
    .map((part) => part.trim().split(/\s+WITH\s+/i)[0].trim())
    .filter(Boolean);
}

// Whether the SPDX `expression` names `license` (from detectLicenses), as one
// of its choices. Identifiers are compared in any case, as SPDX says.
export function namesLicense(expression, license) {
  const ids = new Set(license.ids.map((id) => id.toLowerCase()));
  return expressionIds(expression).some((id) => ids.has(id.toLowerCase()));
}

// How to name `license` in package.json: "MIT", or for the GNU licenses
// "GPL-3.0-only" or "GPL-3.0-or-later".
export function suggestedId(license) {
  const [first, second] = license.ids;
  return second?.endsWith("-or-later") ? `"${first}" or "${second}"` : `"${first}"`;
}
