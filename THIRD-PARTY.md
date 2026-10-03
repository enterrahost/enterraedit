# Third-party software

EnterraEdit is built on [ProseMirror](https://prosemirror.net), by
[Marijn Haverbeke](https://marijnhaverbeke.nl) and contributors. ProseMirror is
MIT licensed, which means it can be used, modified and redistributed freely,
including commercially, as long as its copyright notice and permission notice
travel with it.

EnterraEdit itself is free. Nothing here is sold, and there is no paid tier. The
attribution below is here because the licence asks for it, because it is the
honest thing to do, and because a file that contains someone else's code should
say so.

## Bundled

These are compiled into `dist/enterraedit.min.js`. The editor cannot function
without them, which is why the built file carries their notice at the top.

| Package | Version | Licence |
| --- | --- | --- |
| [prosemirror-model](https://github.com/ProseMirror/prosemirror-model) | 1.25.12 | MIT |
| [prosemirror-view](https://github.com/ProseMirror/prosemirror-view) | 1.42.6 | MIT |
| [prosemirror-state](https://github.com/ProseMirror/prosemirror-state) | 1.4.4 | MIT |
| [prosemirror-tables](https://github.com/ProseMirror/prosemirror-tables) | 1.8.5 | MIT |
| [prosemirror-commands](https://github.com/ProseMirror/prosemirror-commands) | 1.7.2 | MIT |
| [prosemirror-history](https://github.com/ProseMirror/prosemirror-history) | 1.5.1 | MIT |
| [prosemirror-keymap](https://github.com/ProseMirror/prosemirror-keymap) | 1.2.3 | MIT |
| [prosemirror-schema-basic](https://github.com/ProseMirror/prosemirror-schema-basic) | 1.2.5 | MIT |
| [prosemirror-schema-list](https://github.com/ProseMirror/prosemirror-schema-list) | 1.5.1 | MIT |

## Not bundled

EnterraEdit has no runtime dependencies beyond the above. Nothing is fetched at
runtime: no fonts, no icon sets, no analytics, no network requests of any kind
once the file has loaded.

Development-only packages (esbuild, puppeteer-core) are not distributed and are
not covered here.

## The MIT licence

The following applies to every package listed under "Bundled".

```
Copyright (C) 2015-2017 by Marijn Haverbeke <marijn@haverbeke.berlin> and others

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## EnterraEdit's own licence

The code EnterraEdit adds on top of ProseMirror is MIT licensed too, and is
covered by the [LICENSE](LICENSE) file in this repository. See the README for
what that means in practice.
