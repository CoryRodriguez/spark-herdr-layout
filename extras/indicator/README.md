# Spark Indicator

A small always-on-top strip for Windows that shows what your Herdr agents are doing while Herdr itself is behind other windows: one dot per agent, grouped by space. Blue is working, amber is waiting for you (the strip flashes three times and keeps an amber outline), green is done and not yet looked at, a hollow ring is idle. Hover for the list of names; click a name to jump to that agent in Herdr.

`install.cmd` in the package root sets it up for you. This folder is its complete source; no ready-made program file is shipped.

## What is here

- `src/`: five C# files and `app.manifest`. A WPF program for the .NET Framework 4.8 that is part of Windows 10 and 11.
- `build.cmd`: compiles `SparkIndicator.exe` into this folder with the C# compiler that ships with Windows (`%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`). Nothing is downloaded and nothing needs installing.
- `start_indicator.cmd`, `stop_indicator.cmd` (and the `.ps1` files they run): start it, and stop it. Stopping only ever touches the copy that runs from this folder.
- `SparkIndicator.exe.config`: tells Windows which .NET Framework to use.
- `settings.json`: the starting settings. No position is saved in it, so the first start places the strip at the top right of your main screen; no light or dark choice is saved either.

To build and run by hand: double-click `build.cmd`, then `start_indicator.cmd`.

## Using it

- **Drag** it anywhere; the place is remembered.
- **Right-click** for the menu: Show as strip or Show as stack; **Light** or **Dark** (its own look, matching the day and night themes of the window; until you pick one it uses its original dark look); **Start with Windows** (off until you tick it; it adds or removes one shortcut in your Startup folder); Quit.
- It never takes keyboard focus, has no taskbar button and is not in Alt+Tab.

## What it does on your machine

- **Network: none.**
- **Programs it runs**, all part of Herdr: `hc events --json` (one long-lived stream of status changes from herdr-core, only while herdr-core is already running), `hc get <terminal> --json` after a change, `hc ls --json` once a minute as a cross-check, and `herdr-app ls` for the order of spaces and tabs (only while the Herdr window is open). When you click a name: `herdr-app do agent.focus --terminal <address>`, and it brings the Herdr window forward. It does not read the screen of any terminal and never types into one.
- **Files it writes**, all in its own folder: `settings.json` (mode, position, light or dark, optional short names), `indicator.log` (start, stop, connection and jump lines; rolled over at 512 KB) and `indicator.pid` (while it runs). With Start with Windows ticked: one shortcut named `Spark Indicator.lnk` in your Startup folder.
- It needs no administrator rights.

## Settings you can edit by hand

`settings.json`, read at start: `"mode"` (`"strip"` or `"stack"`), `"theme"` (`"light"` or `"dark"`; leave it out for the original dark look), `"greenUntilSeen"` (`true`: a finished agent stays green only until you look at it in Herdr), `"shortNames"` (for example `{ "Website": "WEB" }`, the label a space gets on the strip), `"hcPath"` and `"herdrAppPath"` (only if `hc.exe` or `herdr-app.exe` are not in their usual place or on your PATH).

## Test switches

For checking it without Herdr: `SparkIndicator.exe --instance test --fixture --dry-run` runs a separate copy with made-up agents that starts no Herdr program and has its own settings, log and pid file (`settings.test.json` and so on). `SparkIndicator.exe --instance test --send quit` closes it.

## Not tested

Windows on ARM, display scaling other than 100%, and any Herdr version other than herdr-app 0.1.14 with herdr-core 0.1.19. It has run on one Windows 11 computer.
