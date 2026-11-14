# Setting up Spark

These steps are for a person, or for the coding agent they ask to do it. An agent should also read `AGENTS.md` in the Herdr home folder, section "Layouts and mods other people made", and follow it.

## Quick install

**Windows:** unzip the package anywhere, open the folder and double-click `install.cmd`. That is all. It copies the look into your Herdr home, builds and starts the small status indicator, checks the two mods, and tells you the one key press that switches to the look. It does not switch your layout, does not touch your keys, needs no administrator rights and uses no network. If a file with one of its names is already in your Herdr home it stops before copying anything and says which one. `uninstall.cmd` removes exactly what it added. What both scripts do, step by step, is under "What it does on your machine" below; the by-hand steps further down do the same thing without them.

**macOS and Linux:** `sh install.sh` copies the look (no indicator). It has not been tested; the by-hand steps below are short.

Run Herdr once before installing, so its home folder exists.

## What you get

Spark is a whole-window look for the Herdr app. Your spaces become large colored tabs across the top, every agent is listed under its space in a sidebar with its status and how long it has been going, the tabs of the space you are in sit above your terminals like browser tabs, and a slim bar at the bottom shows what your agents last did. It comes with a day and a night theme, a quick search that jumps to a space or an agent by name or to the terminal that is showing a word on screen, and a small banner when an agent is waiting for you. `preview.png` shows it: that picture is a drawn rendition with made-up spaces and agents, not a screenshot of a running window.

On Windows it also comes with the **Spark Indicator**: a small always-on-top strip of colored dots, one per agent, so you can see who is working, waiting or done while Herdr is behind other windows. See "The indicator" below.

Your own layout is not changed. This adds a new layout next to it, and one key switches back.

## What you need

- **The Herdr app.** Made and tested on herdr-app 0.1.14 with herdr-core 0.1.19, on Windows 11. Other versions have not been tried.
- **Python is optional** (3.8 or newer, on your PATH). It enables exactly one thing: on Windows, a Windows notification when an agent starts waiting for you. Without Python, and on macOS and Linux, that one thing quietly does not happen; the banner inside Herdr, Herdr's own alert, the search and everything else work the same.
- **For the indicator: Windows 10 or 11.** It is compiled on your computer by the C# compiler that is already part of Windows (.NET Framework 4.8). If that compiler is not there, the installer says so in one line and installs the look without the indicator.
- Nothing else. No packages to install.

## What it does on your machine

Read this before you install; Herdr mods are trusted code.

- **Network: none.** Neither mod fetches anything, and neither do the install scripts or the indicator.
- **The install scripts** (`install.cmd` runs `install.ps1`; `uninstall.cmd` runs `uninstall.ps1`; `install.sh` on macOS and Linux). The `.cmd` files start Windows PowerShell with `-ExecutionPolicy Bypass -File` for that one script, which changes no setting on the computer. `install.ps1`, in order:
  1. looks for the Herdr home (`%USERPROFILE%\.config\herdr-app`) and stops if it is not there;
  2. stops, before copying anything, if `layouts\spark.json`, `mods\spark`, `mods\spark-search`, `themes\spark.json`, `themes\spark-night.json` or the indicator's folder already exists, and names it. With `-Force` it first moves those into `spark-backup-<date>-<time>\` in the Herdr home (the indicator's folder to `SparkIndicator-backup-<date>-<time>` beside it), closing the indicator that runs from that folder first;
  3. copies those five into the Herdr home;
  4. copies `extras\indicator\` to `%LOCALAPPDATA%\SparkIndicator\`, runs its `build.cmd` there (that runs Windows' own `csc.exe` and nothing else) and starts `SparkIndicator.exe`. It does not set it to start with Windows;
  5. runs `herdr-app check` on the two installed mods if `herdr-app` is on your PATH. The check writes two helper files of Herdr's own into each mod folder (`gpui-kit.d.ts` and `jsconfig.json`);
  6. writes `spark-install.json` into the Herdr home: the list of every file it added, with a checksum of each, for the uninstaller.

  It never edits `keys.json` or `settings.json` and never switches your layout. What the compiler and the checker print passes through two short-lived files in your temp folder, deleted right away. If you have set `HERDR_APP_HOME`, that folder is used as the Herdr home. Options: `-Force`, `-NoIndicator`, `-NoStart`, `-HerdrHome <path>`, `-IndicatorDir <path>`.

  `uninstall.ps1` reads that list and deletes exactly those files, plus the two helper files in each mod folder, the indicator's own log, pid and settings files, and the indicator's Start with Windows shortcut if you had turned that on. It closes the indicator first, found by its exact program file; it never closes any other program. A file you changed after installing is moved to `spark-changed-<date>-<time>\` in the Herdr home instead of being deleted. It runs `herdr-app status` (which only reads) while a Herdr window is open, and if Herdr is showing this layout it stops and asks you to switch first. It leaves `keys.json`, `settings.json`, `spark-data\` and any backup folder alone.
- **The indicator** (Windows only, optional) is a separate small program, `%LOCALAPPDATA%\SparkIndicator\SparkIndicator.exe`, built on your computer from the source in `extras/indicator/src/`. While it runs it uses these Herdr programs: `hc events --json` (one long-lived stream of status changes, only while herdr-core is already running), `hc get <terminal> --json` after a change, `hc ls --json` once a minute, and `herdr-app ls` while the Herdr window is open. When you click an agent's name in its list it runs `herdr-app do agent.focus --terminal <address>` and brings the Herdr window forward. It does not read the screen of any terminal and never types into one. It writes only in its own folder: `settings.json` (strip or stack, where you dragged it, light or dark), `indicator.log` and `indicator.pid`; and, only if you tick Start with Windows in its menu, one shortcut `Spark Indicator.lnk` in your Startup folder.
- **Programs the look runs** (the two mods, inside Herdr):
  - `hc get <terminal> --json` (herdr-core, already part of Herdr), once per agent, to learn when that terminal started. It reads nothing from the terminal's screen.
  - On Windows only, when an agent starts waiting and you are not looking at it: it looks for Python once (it tries `pythonw`, `pyw`, `python3`, `python`, `py`, each with a one-line version check) and, if one answers, runs `mods/spark/tools/notify_toast.py`, which starts Windows PowerShell hidden to show one Windows notification. The notification text is the agent's name, its tab number and its space's name.
  - **The search reads the visible screen text of your terminals.** Names (spaces, agents, tab labels, program names) come from the lists Herdr already has. For words, the search panel (`mods/spark-search`) runs `hc read <terminal> --json` (herdr-core again) once for each open terminal on this computer that has a pane in Herdr, agents and plain shells alike, at most 40 per search. That returns the text the terminal is showing at that moment, so anything visible there is read, including a file, a command or a secret that happens to be on screen. This happens only when you search: after you type 3 or more letters and pause for a third of a second, or press Enter with 2 or more. Opening the search reads nothing. The text is matched inside Herdr, shown to you in the results, and dropped when the panel closes; it is not written to any file and not sent anywhere. It never asks for a terminal's history (what has scrolled away), never scrolls a terminal, never types into one, and never reads terminals on other machines. If herdr-core ever reports that a read had to scroll, the panel stops reading screens until it is opened again.
  - The search panel runs no other program, and reads and writes no file.
- **Files the look reads or writes outside its own two folders**, all inside the Herdr home folder:
  - `settings.json`: only when you click the day/night button in the header. It changes the one value `appearance` to `light` or `dark` and leaves the rest as it was.
  - `spark-data/` (created the first time it is needed): `diag_header.json`, `diag_sidebar.json` and `diag_status.json` (counters of how often each panel drew and its last error message, if any; rewritten every 10 minutes), and on Windows with Python `tmp/` (a short-lived file holding the notification's text) and `toast_log.jsonl` (the result of the last 200 notifications: time, terminal id, shown or not).
  - Herdr's shared state (`shared.json`, which Herdr writes): the activity log (the last 80 lines, such as "Docs cleanup finished"), which spaces are folded, and when each agent was first seen. Keys start with `spark.`.
- The look reads your key bindings (to show the right key in tooltips) and never changes them.
- Nothing in this package types into a terminal. Nothing but the search described above reads what a terminal shows.

## The indicator

The Spark Indicator is for Windows. It sits on top of your other windows as a slim strip: a short label per space and one dot per agent. Blue is working, amber is waiting for you (the strip flashes three times, then keeps an amber outline), green is done and not yet looked at, a hollow ring is idle. Point at it for the list of names; click a name to go to that agent in Herdr.

- **Where it comes from.** No program file is shipped. `install.cmd` compiles it on your computer from the source in `extras/indicator/` with Windows' own C# compiler, into `%LOCALAPPDATA%\SparkIndicator\`, and starts it. `extras/indicator/README.md` says what each file is and how to build it by hand.
- **Light or dark.** Right-click the strip and pick **Light** or **Dark**. It changes at once and is remembered. The two looks use the colors of the day and night themes of the window. Until you pick one it uses its original dark look.
- **Start with Windows.** Off after installing. Right-click the strip and tick **Start with Windows** to turn it on, and again to turn it off. Until then, start it after a restart with `start_indicator.cmd` in its folder.
- **Move it.** Drag it anywhere. The same menu switches between a one-line strip and a small stack.
- **Stop it.** Right-click, Quit; or `stop_indicator.cmd` in its folder.
- **Remove it.** `uninstall.cmd` removes it together with the look. To remove only the indicator: Quit it, untick Start with Windows first if you had ticked it, then delete the folder `%LOCALAPPDATA%\SparkIndicator\`.
- **Install without it:** `install.cmd -NoIndicator`.

## Install on Windows by hand

`install.cmd` does these steps for you. The Herdr home folder is `%USERPROFILE%\.config\herdr-app`.

1. Copy `layouts\spark.json` into the home's `layouts\` folder.
2. Copy the two folders `mods\spark` and `mods\spark-search` into the home's `mods\` folder.
3. Copy `themes\spark.json` and `themes\spark-night.json` into the home's `themes\` folder.
4. Merge the key (see "The search key" below).
5. Leave `RECIPE.md`, `SETUP.md`, `keys.json`, the top-level `preview.png` (Herdr's Settings shows the copy inside the look's own folder), `layouts\spark-mac.json`, the install and uninstall scripts and the `extras\` folder out.
6. The indicator, if you want it: copy `extras\indicator\` to a folder of your own, double-click `build.cmd` in it, then `start_indicator.cmd`.

Never overwrite: if a file or folder with one of these names is already there, stop and rename the new one (its file or folder, the `mod` names inside the layout file, and the `mods/<name>/` paths inside the mod), or ask the person who gave you this for a copy under another name.

Fonts: this layout uses **Segoe UI** for the panels and **Consolas** for terminals, both part of Windows.

## Install on macOS

`sh install.sh` does these steps (untested; it installs the Mac layout under the plain name `spark.json`). By hand: the Herdr home folder is `~/.config/herdr-app`.

1. Copy `layouts/spark-mac.json` into the home's `layouts/` folder. You may rename it to `spark.json` there; if you keep the `-mac` name, the layout is called `spark-mac` in every command below.
2. Copy `mods/spark` and `mods/spark-search` into the home's `mods/` folder.
3. Copy `themes/spark.json` and `themes/spark-night.json` into the home's `themes/` folder.
4. Merge the key (see below).

Fonts: the Mac file uses **Lucida Grande** for the panels and **Menlo** for terminals, the closest matches that come with macOS. Lucida Grande has no semibold weight, so labels the look draws in semibold (names, numbers, the title) may come out bold and look heavier than intended. If that bothers you, change `"ui_font"` near the top of the layout file to `"Avenir Next"`, which has a real semibold. `"font"` on the next line is the terminal font; any installed font works for either.

On Linux, use the Windows file and change `ui_font` and `font` to fonts you have.

## The search key

`keys.json` in this folder holds the one key the look expects:

    "global": { "ctrl-f": "mod.open:spark-search" }

Add that one line to the `"global"` section of the `keys.json` in your Herdr home. Do not replace your file with this one.

- If `ctrl-f` is already bound to something in your file, keep yours and pick another key for the search; the search bar shows whichever key you bind, and works by click with none.
- Binding `ctrl-f` takes that key away from programs in the terminal. Programs that use it (for example "page down" in vim and less, "forward one character" in a shell) will not receive it while this binding is there. If you rely on that, choose a different key, such as `ctrl-shift-s`.
- Herdr's own find-in-terminal stays on its own key (`ctrl-shift-f`, or Cmd-F on macOS).

Any edit to `keys.json` makes the whole file yours: Herdr then stops adding new default shortcuts to it on upgrades. That is how Herdr works, not something this look does.

## Check it, then switch to it

1. Check each mod. Both must say "check passed":

       herdr-app check <home>/mods/spark
       herdr-app check <home>/mods/spark-search

2. Switch to the layout: press `ctrl-shift-l` until it shows, or pick it in Settings, Look, or run

       herdr-app do layout.switch --name spark

   The check writes two helper files of Herdr's own into each mod folder (`gpui-kit.d.ts` and `jsconfig.json`); that is normal.

3. Run `herdr-app status`: it should name the layout and list no errors. If a file was not accepted, Herdr keeps what it had and writes the reason to `layout.error` or `keys.error` in the home folder.

## Switch back, or remove it

- **Back to your own layout:** `ctrl-shift-l` cycles through your layouts. If anything ever looks stuck, `ctrl-alt-shift-escape` always returns to Herdr's default layout.
- **Remove it, if you used `install.cmd`:** switch to another layout first, then double-click `uninstall.cmd`. Afterwards remove the `ctrl-f` line from `keys.json` if you added it, and the folder `spark-data` if it exists.
- **Remove it by hand:** switch to another layout first, then delete `layouts/spark.json` (or `spark-mac.json`), the folders `mods/spark` and `mods/spark-search`, the two theme files, the folder `spark-data` if it exists, and the `ctrl-f` line you added to `keys.json`. If you used the day/night button and want your system's setting to decide again, also remove the `"appearance"` line from `settings.json`.

## Good to know

- The number and color of a space or a tab belong to its position. Drag the first space to third place and it becomes "03" in the third color.
- A tab is named after its agent's session, the same name the sidebar shows.
- The search finds text only while it is on a terminal's screen. For something that has scrolled away, go to that terminal and use Herdr's own find (`ctrl-shift-f`, or Cmd-F on macOS), which covers the scrollback.
- The Windows notification is shown under the name "Windows PowerShell" unless you create `spark-data/config.json` containing `{ "toast_app_id": "<an app id from Get-StartApps>" }`.
- The indicator and the look do not depend on each other: either works without the other, and the indicator works with any Herdr layout.

## Not tested

- **macOS and Linux: nothing has been run there.** That covers the Mac layout file and its fonts, the room left for the Mac window buttons, key names in tooltips, and how programs are found.
- **Any Herdr version other than herdr-app 0.1.14 with herdr-core 0.1.19.**
- **The Windows notification in this packaged form.** It differs from the copy it was made from only in its folder name and a few internal names, but it has only been exercised there, with that machine's own settings.
- **A machine without Python**, as a real machine: that path is covered by tests with a stand-in, not by an actual install.
- **The installer on a second computer.** `install.ps1` and `uninstall.ps1` were run on the one computer this was made on, against a stand-in Herdr home, not against a real one and not on another PC. Their double-click wrappers (`install.cmd`, `uninstall.cmd`) were not double-clicked.
- **Security prompts.** A zip that came from the internet is marked by Windows, so double-clicking `install.cmd` may first show a "Windows protected your PC" or "Open File" prompt. An antivirus program may also question a program that was compiled a moment ago on the same computer. Neither was seen during testing, because neither applies on the computer it was made on.
- **`install.sh`**: its logic was run under a Unix-style shell on Windows against a stand-in home; never on macOS or Linux.
- **The indicator** outside the one Windows 11 computer it was made on: Windows 10, Windows on ARM, display scaling other than 100%, a computer without the C# compiler (that path was tested by pointing the installer at a missing compiler, not on such a computer).
- **The on-screen text search in this packaged form.** It has been run only in tests with a stand-in for herdr-core, not inside the app.
- **The picture.** `preview.png` is a drawn rendition, not a screenshot, so small differences from the real window are possible.
