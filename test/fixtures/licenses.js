// License texts for the tests of toolsmith doctor's license check: the whole
// text of the short licenses, and the start of the long ones, which is where
// they say what they are.

export const mit = `MIT License

Copyright (c) 2026 Ada Lovelace

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

export const isc = `ISC License

Copyright (c) 2026, Ada Lovelace

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
`;

export const apache = `
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.
`;

const bsdStart = `Copyright (c) 2026, Ada Lovelace

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
`;

const bsdEnd = `
THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED.
`;

const endorse = `
3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.
`;

export const bsd2 = `BSD 2-Clause License\n\n${bsdStart}${bsdEnd}`;
export const bsd3 = `BSD 3-Clause License\n\n${bsdStart}${endorse}${bsdEnd}`;
export const bsd4 = `${bsdStart}
3. All advertising materials mentioning features or use of this software
   must display the following acknowledgement:
   This product includes software developed by the organization.
${endorse.replace("3.", "4.")}${bsdEnd}`;

const fsf = `
 Copyright (C) 2007 Free Software Foundation, Inc. <https://fsf.org/>
 Everyone is permitted to copy and distribute verbatim copies
 of this license document, but changing it is not allowed.
`;

export const gpl2 = `                    GNU GENERAL PUBLIC LICENSE
                       Version 2, June 1991
${fsf}
                            Preamble

  The licenses for most software are designed to take away your
freedom to share and change it. By contrast, the GNU General Public
License is intended to guarantee your freedom to share and change free
software. (Some other Free Software Foundation software is covered by
the GNU Library General Public License instead.)
`;
export const gpl3 = `                    GNU GENERAL PUBLIC LICENSE
                       Version 3, 29 June 2007
${fsf}
                            Preamble

  The GNU General Public License is a free, copyleft license for
software and other kinds of works.
`;
export const lgpl2 = `\t\t  GNU LIBRARY GENERAL PUBLIC LICENSE\n\t\t       Version 2, June 1991\n${fsf}`;
export const lgpl21 = `                  GNU LESSER GENERAL PUBLIC LICENSE
                       Version 2.1, February 1999
${fsf}`;
export const lgpl3 = `                   GNU LESSER GENERAL PUBLIC LICENSE
                       Version 3, 29 June 2007
${fsf}
  This version of the GNU Lesser General Public License incorporates
the terms and conditions of version 3 of the GNU General Public
License, supplemented by the additional permissions listed below.
`;
export const agpl3 = `                    GNU AFFERO GENERAL PUBLIC LICENSE
                       Version 3, 19 November 2007
${fsf}`;

export const mpl2 = `Mozilla Public License Version 2.0
==================================

1. Definitions
--------------

1.1. "Contributor"
    means each individual or legal entity that creates, contributes to
    the creation of, or owns Covered Software.
`;

export const unlicense = `This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

For more information, please refer to <https://unlicense.org>
`;
