# Making the Claude terminal look the same on another computer

This folder gives a Claude Code terminal the same bottom status line, colors and fonts as the setup it was made on:

    C:\Work\app main │ Opus 5.5 · high · think │ ctx ████░░░░░░░░ 34% (68k/200k) │ 5h 12% ↻ 3:00pm 7d 9% ↻ Fri 9:00am │ $2.41 +120/-18

It has two files: `statusline.py` (the status line) and this note.

## The quick way: let Claude do it

Put this folder anywhere on the computer, open Claude Code in it, and paste:

    ===== START =====
    Set up my Claude Code terminal by following SETUP.md in this folder, sections 1 to 3. Use absolute paths with forward slashes in settings.json. Do not change any other setting. When done, tell me exactly what you changed and what I need to restart.
    ===== END =====

## By hand

### 1. The status line (needs Python 3.8 or newer)

1. Check Python: run `python --version`. If it is missing, install it from python.org first.
2. Copy `statusline.py` into your Claude Code settings folder. That is `%USERPROFILE%\.claude\` on Windows and `~/.claude/` on macOS and Linux, unless you have set `CLAUDE_CONFIG_DIR` to another folder.
3. Open `settings.json` in that same folder (create it with `{}` if it does not exist) and add this entry, with YOUR full paths to Python and to the script, using forward slashes:

       "statusLine": {
         "type": "command",
         "command": "\"C:/full/path/to/python.exe\" \"C:/Users/YOU/.claude/statusline.py\"",
         "padding": 0
       }

   To find Python's full path, run `where python` (Windows) or `which python3` (macOS, Linux).
4. Start a new Claude Code session. The line appears under the input box after the first reply.

What each part shows, left to right: the folder (and the git branch when there is one), the model with its effort level and "think" when thinking is on, how full the context window is, your usage windows with the time they reset, and the session's cost with lines added and removed. A part that your plan or session does not report is simply left out; for example the usage windows appear only on subscription plans.

The script only reads what Claude Code hands it. It writes no files and makes no network connection. The one program it runs is `git`, to read the branch name.

### 2. The same colors and layout inside the terminal

In the same `settings.json`, add these two entries (or set them with the `/config` command inside Claude Code):

    "tui": "fullscreen",
    "theme": "auto"

- `fullscreen` gives the fixed full-height layout with the prompt pinned at the top while you scroll.
- `auto` makes Claude Code's own text colors follow the terminal's light or dark look. Without it, Claude Code uses fixed dark-theme colors that look wrong on a light background.

If a setting is not recognized, update Claude Code first (`claude update`).

Optional, only if you see doubled or stale text in long sessions: add `"CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT": "1"` inside the `"env"` section of `settings.json`.

### 3. The same font and terminal colors (the Herdr side)

These come from the Spark layout for the Herdr app, which is the rest of this repository (see the README at its top level), not from this folder:

- Install Spark and switch to it. It sets the terminal font to **Consolas** on Windows (**Menlo** on macOS) and supplies the day and night terminal colors.
- In Herdr's Settings, keep the font size at **14** and zoom at **100%**, which are Herdr's defaults.
- Use the sun or moon button at the top right of the Herdr window to pick day or night; with `"theme": "auto"` from step 2, Claude Code follows it.

### 4. Optional: the same PowerShell prompt

To show the time before the folder in plain PowerShell terminals (`[14:05:09] PS C:\Work>`), add this line to your PowerShell profile (open it with `notepad $PROFILE`):

    function prompt { "[$(Get-Date -Format 'HH:mm:ss')] PS $($executionContext.SessionState.Path.CurrentLocation)$('>' * ($nestedPromptLevel + 1)) " }

## If Claude's logo looks pink instead of orange

Claude Code picks the color of its logo and accents from its own theme setting:

- With the theme **Auto**, **Dark** or **Light**, the logo is a fixed orange.
- With one of the two **"ANSI colors only"** themes, it borrows the terminal's bright red instead. In the Spark night palette that color is a salmon pink, so the logo turns pink.

So the usual fix is step 2 above: run `/config` in Claude Code, open Theme, and choose **Auto (match terminal)**. Do not pick a theme with "ANSI colors only" in its name.

If it is still off after that, check these two things:

1. **Is this Claude tab running inside Herdr?** Fonts and palette only apply there. A Claude opened in Windows Terminal or a plain PowerShell window uses that program's own font and colors.
2. **Does the terminal offer full color?** In a PowerShell tab inside Herdr, run `echo $env:COLORTERM`. It should print `truecolor`. If it prints nothing, Claude Code rounds its orange to the nearest of 256 colors, which also looks pinker.

## Reference: the values on the original setup

Use these to compare another computer item by item.

| What | Value |
|---|---|
| Terminal app | Herdr desktop app, Spark layout |
| Terminal font | Consolas, size 14, zoom 100% |
| Panel font | Segoe UI |
| Terminal palette | the Spark day and night themes (night background `#1c1d21`, text `#e6e8ec`) |
| Full color | `COLORTERM=truecolor` |
| Claude Code theme | Auto (match terminal) |
| Claude Code display | fullscreen |
| Status line | `statusline.py` from this folder |

## About the second line

The line under the status line, such as `accept edits on (shift+tab to cycle)`, is not part of this. Claude Code draws it itself to show the current permission mode, and Shift+Tab cycles through the modes. Which mode you run in is your choice, and on a work computer it may be a matter of company policy.

## Credit

The cost and spend-limit segments of the status line are adapted from the status line of the GSD project (github.com/gsd-build/get-shit-done), which is MIT licensed.
