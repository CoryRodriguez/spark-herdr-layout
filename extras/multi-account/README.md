# Optional: more than one Claude Code login in Herdr

For people who run Claude Code under more than one account (work and personal, or a few team seats) in WSL on Windows. It is separate from the Spark look: the installer doesn't run it, and skipping it changes nothing.

## What it does

`setup.sh` looks for the Claude Code logins in your WSL distro, then:

- **Makes a launcher per login**, `~/.local/bin/claude-as-<name>` (for example `claude-as-sam`), so `claude-as-sam` in any terminal starts Claude Code as that login.
- **Adds a "Claude · <name>" entry per login** to Herdr's new-tab agent menu.
- **Optionally makes every new plain terminal start Claude** as the login you pick: new spaces, tabs and splits, from any button, menu or key. When you exit Claude, you're left at a normal shell prompt.

It asks before writing anything and shows its plan first.

| Logins found | What happens |
|---|---|
| None | Nothing. It tells you how to sign in and stops. |
| One | Launcher and menu entry for it; new terminals start Claude as that login. |
| Two or more | You pick which login new terminals start as, or **0** to keep plain terminals. All of them get a launcher and a menu entry. |
| Herdr not installed | Launchers only. |

## Where it finds logins

Claude Code keeps each login in its own config folder. The script reads `~/.claude.json` (the default login) and any folder named `~/.claude-<something>` that has a signed-in `.claude.json`, for example one made with:

```bash
CLAUDE_CONFIG_DIR=~/.claude-work claude    # sign in to a second account once
```

Names come from the part of the email before the `@`. If two folders hold the same login, the second one gets the folder's name added (`claude-as-sam-work`).

## Run it

- **Windows:** double-click `setup.cmd` in this folder. It runs `setup.sh` in your default WSL distro.
- **In WSL:** `bash extras/multi-account/setup.sh`

Options: `--dry-run` shows what it would do and writes nothing, `--yes` skips the final "Go ahead?", and `--uninstall` removes everything it added.

Run it again any time to pick a different login or to pick up a login you've added.

## The start folder

Herdr starts WSL programs in a Windows folder (`/mnt/c/...`). When that happens, the launchers move to a folder you choose instead (default: your WSL home, for example `~/projects`). Started from a Linux folder, they stay where they are.

## What it changes on your machine

| File | Change |
|---|---|
| `~/.local/bin/claude-as-<name>`, `~/.local/bin/herdr-claude-shell` | Created (they carry a marker line; the script only ever replaces or removes files with that marker) |
| `~/.config/herdr-multi-account/config` | Your start folder |
| `%USERPROFILE%\.config\herdr-app\programs.json` | Adds `claude-as-*` entries; other entries untouched |
| `%APPDATA%\herdr-core\config.toml` | Adds or removes one top-level `shell = [...]` line; other settings untouched |

Each Herdr file is backed up (`.bak-<date>`) before it's changed. Your Claude Code logins, settings and history are never touched. New terminals pick up a change right away; terminals already open don't change.

**Undo:** `bash setup.sh --uninstall` (or `setup.cmd --uninstall`). Or by hand: delete the `shell = ...` line and the comment above it from `%APPDATA%\herdr-core\config.toml`.

## Good to know

- Made on Windows 11 with herdr-app 0.1.16, herdr-core 0.1.21 and Ubuntu in WSL 2. The Herdr settings it writes were tried live there; the script itself was tested with made-up logins and a dry run on a real machine. Claude Code installed natively on Windows or macOS isn't covered.
- The default-terminal setting is herdr-core's `shell` option, so it also applies to terminals Herdr re-creates after a lost program.
- Agent entries from the menu (any agent, not just these) still start as before.
