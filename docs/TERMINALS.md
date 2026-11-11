# Checking toolsmith ui in a real terminal

The tests drive `toolsmith ui` in a pretend terminal on every system, and in a real one on Linux and macOS (`test/ui-real-terminal.test.js`, through the `script` command). Windows has no such command, so Windows Terminal is checked by hand, with the list below. It takes about five minutes.

## Windows Terminal

In Windows Terminal, open PowerShell in your clone of this repository (it's a git repository, so all three panels show), and start the dashboard with `node bin\toolsmith.js ui`.

**Start**

- [ ] The dashboard fills the window, the cursor is hidden, and the panel headers are colored (cyan), the focused one inverse.

**Keys**

- [ ] Down and Up, and `j` and `k`, move the selection; Home, End, PgUp and PgDn jump.
- [ ] Tab and Shift+Tab go to the next and previous panel, and so do Right and Left (or `l` and `h`) in the Commands panel.
- [ ] In Files, Enter or Right opens a folder, Left closes it, and Enter on a file shows it; Esc goes back.
- [ ] `/` then `git` filters the Commands panel; Backspace deletes, Enter keeps the filter, Esc clears it.
- [ ] `?` shows the shortcuts; Down scrolls them; Esc (or `?`) closes them.
- [ ] Enter on `size` opens its form; type `src`, then Enter runs it and shows the output with the exit code; Esc goes back to the form, and Esc again to the panels.

**Resize**

- [ ] Drag the window bigger and smaller, and maximize and restore it: the screen is redrawn at each size, with nothing left over from the size before and no row that wraps.
- [ ] Make it smaller than 40×10 (dragging, or zooming in with Ctrl+=): it says "Terminal too small", with the size and the 40x10 it needs. Make it bigger again (or zoom out with Ctrl+-): the dashboard comes back with the same panel and selection.

**Quit**

- [ ] `q` quits: what was in the window before comes back, with the prompt under it and the cursor showing; what you type shows, and `$LASTEXITCODE` is `0`.
- [ ] Start it again, and Ctrl+C quits the same way.
- [ ] Start it again, open a command's form (Enter), and press Ctrl+C there: it quits the same way too.

To report back, write down the Windows build (`winver`), the Windows Terminal version (Settings, About), `node --version`, and any item that didn't work, with what you saw. When everything works, the first Foundation box of M7 in [ROADMAP.md](../ROADMAP.md) can be ticked.

The same list works in the classic Windows console (start `conhost.exe` from the Run dialog, Win+R), with one known difference: with Node.js 22, it sends Shift+Tab as a plain Tab, so use Left or `h` to go to the previous panel there.
