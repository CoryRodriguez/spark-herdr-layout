#!/bin/bash
# Multi-account Claude Code for the Herdr desktop app (Windows + WSL).
#
# Finds the Claude Code logins in this WSL distro, makes a launcher for each,
# adds a "Claude · <name>" entry per login to Herdr's agent menu, and (optionally)
# makes every new plain terminal in Herdr start Claude as the login you pick.
#
#   bash setup.sh             set up or change (asks before writing anything)
#   bash setup.sh --dry-run   show what it would do; writes nothing
#   bash setup.sh --yes       don't ask to confirm (still asks which login, if several)
#   bash setup.sh --uninstall remove everything this script added
#
# Run it inside WSL (or double-click setup.cmd). Run it again any time to switch.
set -euo pipefail

MARK="spark-herdr-layout multi-account"
PREFIX="claude-as-"
BIN="$HOME/.local/bin"
CONF_DIR="$HOME/.config/herdr-multi-account"
CONF="$CONF_DIR/config"
WRAPPER="$BIN/herdr-claude-shell"

DRY=0; YES=0; UNINSTALL=0
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --yes|-y) YES=1 ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $a (try --help)" >&2; exit 2 ;;
  esac
done

say()  { printf '%s\n' "$*"; }
die()  { printf 'Stopped: %s\n' "$*" >&2; exit 1; }
run()  { if [ "$DRY" = 1 ]; then say "  (dry run) $*"; else "$@"; fi; }
stamp() { date +%Y%m%d-%H%M%S; }

command -v python3 >/dev/null || die "python3 is needed (sudo apt install python3)."

# ---- Where Herdr keeps its files on Windows (overridable for testing) ------------------
win_env() { cmd.exe /c "echo %$1%" 2>/dev/null | tr -d '\r'; }
if [ -z "${MA_APPDATA:-}" ] || [ -z "${MA_HERDR_APP_HOME:-}" ]; then
  grep -qi microsoft /proc/version 2>/dev/null || die "this is for Herdr on Windows with Claude Code in WSL. Run it inside WSL."
  command -v wslpath >/dev/null || die "wslpath not found; run this inside WSL."
fi
APPDATA_DIR="${MA_APPDATA:-$(wslpath "$(win_env APPDATA)")}"
HERDR_APP_HOME="${MA_HERDR_APP_HOME:-${HERDR_APP_HOME:-$(wslpath "$(win_env USERPROFILE)")/.config/herdr-app}}"
CORE_CONF="$APPDATA_DIR/herdr-core/config.toml"
PROGRAMS="$HERDR_APP_HOME/programs.json"
DISTRO="${MA_DISTRO:-${WSL_DISTRO_NAME:-}}"
[ -n "$DISTRO" ] || die "can't tell which WSL distro this is (WSL_DISTRO_NAME is empty)."
HAVE_HERDR=0; [ -d "$HERDR_APP_HOME" ] && HAVE_HERDR=1

# ---- Herdr file edits (python, so JSON and TOML stay intact) ----------------------------
# set_shell <wrapper> <launcher> | "": put our `shell = [...]` at the top of herdr-core's config, or remove it.
# The launcher goes on the command line so the login shows in it (Spark's sidebar reads it from there).
set_shell() {
  python3 -I - "$CORE_CONF" "$MARK" "$DISTRO" "$1" "$DRY" "${2:-}" <<'PY'
import os, sys, shutil, time
path, mark, distro, target, dry, launcher = sys.argv[1:7]
lines = open(path, encoding="utf-8").read().splitlines() if os.path.exists(path) else []
out, in_table = [], False
for l in lines:
    s = l.strip()
    if s.startswith("["): in_table = True
    if not in_table and (s == "# " + mark or (s.startswith("shell") and s[5:].lstrip().startswith("="))):
        continue                      # our marker, or any earlier top-level shell line
    out.append(l)
if target:
    out = ["# " + mark, 'shell = ["wsl.exe", "-d", "%s", "-e", "%s", "%s"]' % (distro, target, launcher)] + out
if out == lines:
    print("  herdr-core config: no change"); sys.exit()
if dry == "1":
    print("  (dry run) would write %s:" % path); [print("      " + l) for l in out[:3]]; sys.exit()
if os.path.exists(path):
    shutil.copy2(path, path + ".bak-" + time.strftime("%Y%m%d-%H%M%S"))
os.makedirs(os.path.dirname(path), exist_ok=True)
if any(l.strip() for l in out):
    open(path, "w", encoding="utf-8", newline="\n").write("\n".join(out) + "\n")
elif os.path.exists(path):
    os.remove(path)                   # nothing left: Herdr goes back to its own default
print("  herdr-core config: updated (%s)" % ("new terminals start " + os.path.basename(launcher) if target else "default shell restored"))
PY
}

# set_programs <json list of {key,name,run}>: replace our entries in programs.json with these.
set_programs() {
  python3 -I - "$PROGRAMS" "$PREFIX" "$DRY" "$1" <<'PY'
import json, os, sys, shutil, time
path, prefix, dry, want = sys.argv[1], sys.argv[2], sys.argv[3], json.loads(sys.argv[4])
data = {}
if os.path.exists(path):
    try: data = json.load(open(path, encoding="utf-8"))
    except ValueError: sys.exit("Stopped: %s isn't valid JSON; fix it first." % path)
progs = data.setdefault("programs", {})
before = json.dumps(data, sort_keys=True)
for k in [k for k in progs if k.startswith(prefix)]:
    del progs[k]
for p in want:
    progs[p["key"]] = {"name": p["name"], "icon": "icons/claude.svg", "tint": False,
                       "tile": "#1c1d21", "color": "#ffffff", "run": p["run"]}
if json.dumps(data, sort_keys=True) == before:
    print("  Herdr agent menu: no change"); sys.exit()
if dry == "1":
    print("  (dry run) Herdr agent menu would list: " + (", ".join(p["name"] for p in want) or "no entries from this script")); sys.exit()
if os.path.exists(path):
    shutil.copy2(path, path + ".bak-" + time.strftime("%Y%m%d-%H%M%S"))
open(path, "w", encoding="utf-8", newline="\n").write(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
print("  Herdr agent menu: " + (", ".join(p["name"] for p in want) or "entries removed"))
PY
}

remove_ours() {   # launchers and wrapper this script made (identified by the marker line)
  local f
  for f in "$BIN/$PREFIX"* "$WRAPPER"; do
    [ -f "$f" ] && grep -q "$MARK" "$f" && run rm -f "$f"
  done
  return 0
}

# ---- Uninstall --------------------------------------------------------------------------
if [ "$UNINSTALL" = 1 ]; then
  say "Removing the multi-account setup:"
  if [ "$HAVE_HERDR" = 1 ]; then set_programs '[]'; fi
  [ -f "$CORE_CONF" ] && set_shell ""
  remove_ours
  [ -d "$CONF_DIR" ] && run rm -rf "$CONF_DIR"
  say "Done. Your Claude logins themselves are untouched."
  exit 0
fi

# ---- Find the logins -------------------------------------------------------------------
CLAUDE_BIN="$(command -v claude || true)"
[ -n "$CLAUDE_BIN" ] || { [ -x "$BIN/claude" ] && CLAUDE_BIN="$BIN/claude"; }
[ -n "$CLAUDE_BIN" ] || die "Claude Code isn't installed in this WSL distro (no 'claude' command)."

# One line per login: <config dir or "default">|<email>|<short name>
mapfile -t ACCTS < <(python3 -I - "$HOME" <<'PY'
import glob, json, os, re, sys
home = sys.argv[1]
cands = [("default", os.path.join(home, ".claude.json"))]
for d in sorted(glob.glob(os.path.join(home, ".claude-*"))):
    if os.path.isdir(d):
        cands.append((d, os.path.join(d, ".claude.json")))
seen, rows = set(), []
for cfg, f in cands:
    try: email = (json.load(open(f)).get("oauthAccount") or {}).get("emailAddress")
    except Exception: continue
    if not email or (cfg, email) in seen: continue
    seen.add((cfg, email))
    rows.append([cfg, email, re.sub(r"[^a-z0-9]+", "-", email.split("@")[0].lower()).strip("-") or "account"])
def slug(s): return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
# Same short name twice: a second folder signed in to the same login (~/.claude-work) gets the
# folder's name added; the same name at two companies (sam@a.com, sam@b.com) gets the domain.
names = [r[2] for r in rows]
for r in rows:
    if names.count(r[2]) > 1 and r[0] != "default":
        r[2] += "-" + (slug(os.path.basename(r[0])[len(".claude-"):]) or "x")
names = [r[2] for r in rows]
for r in rows:
    if names.count(r[2]) > 1:
        r[2] += "-" + slug(r[1].split("@")[1].split(".")[0])
names, used = [r[2] for r in rows], {}
for r in rows:   # still equal: number them
    if names.count(r[2]) > 1:
        used[r[2]] = used.get(r[2], 0) + 1; r[2] += str(used[r[2]])
for r in rows: print("|".join(r))
PY
)

if [ "${#ACCTS[@]}" -eq 0 ]; then
  say "No signed-in Claude Code login found in this WSL distro, so there's nothing to set up."
  say "Sign in with 'claude' first (or 'CLAUDE_CONFIG_DIR=~/.claude-<name> claude' for a second login), then run this again."
  exit 0
fi

say "Claude Code logins found:"
i=0; for a in "${ACCTS[@]}"; do i=$((i+1)); IFS='|' read -r cfg email name <<<"$a"
  say "  $i) $email   (launcher: $PREFIX$name)"; done
[ "$HAVE_HERDR" = 1 ] || say "Herdr desktop app not found at $HERDR_APP_HOME: making the launchers only."

# ---- Choose the default for new Herdr terminals ------------------------------------------
PICK=""
if [ "$HAVE_HERDR" = 1 ]; then
  if [ "${#ACCTS[@]}" -eq 1 ]; then
    PICK=1    # one login: use it (run with --uninstall to go back to a plain terminal)
  else
    say ""; say "Which login should new Herdr spaces, tabs and splits start Claude as?"
    say "  0) none: plain terminal (Herdr's own default)"
    while :; do
      if [ -n "${MA_PICK:-}" ]; then PICK="$MA_PICK"; MA_PICK=""; else   # MA_PICK: answer for scripts/tests
        read -r -p "Pick 0-${#ACCTS[@]}: " PICK </dev/tty || die "no answer."; fi
      [[ "$PICK" =~ ^[0-9]+$ ]] && [ "$PICK" -le "${#ACCTS[@]}" ] && break
    done
  fi
fi
CHOSEN=""; CHOSEN_EMAIL=""
if [ -n "$PICK" ] && [ "$PICK" != 0 ]; then
  CHOSEN="${ACCTS[$((PICK-1))]}"; IFS='|' read -r _ CHOSEN_EMAIL _ <<<"$CHOSEN"
fi

START_DIR="~"
if [ -f "$CONF" ]; then START_DIR="$(sed -n 's/^START_DIR=//p' "$CONF" | head -1)"; START_DIR="${START_DIR:-~}"; fi
if [ "$YES" != 1 ]; then
  read -r -p "Folder Claude starts in when Herdr opens it on a Windows folder [$START_DIR]: " ans </dev/tty || ans=""
  START_DIR="${ans:-$START_DIR}"
fi
case "$START_DIR" in "~") START_ABS="$HOME" ;; "~/"*) START_ABS="$HOME/${START_DIR#\~/}" ;; *) START_ABS="$START_DIR" ;; esac
[ -d "$START_ABS" ] || die "folder $START_ABS doesn't exist."

for a in "${ACCTS[@]}"; do IFS='|' read -r _ _ n <<<"$a"; f="$BIN/$PREFIX$n"   # check before writing anything
  if [ -e "$f" ] && ! grep -q "$MARK" "$f"; then die "$f exists and wasn't made by this script; move it and run again. Nothing changed."; fi
done

say ""; say "Plan:"
say "  - launchers in $BIN: $(for a in "${ACCTS[@]}"; do IFS='|' read -r _ _ n <<<"$a"; printf '%s ' "$PREFIX$n"; done)"
[ "$HAVE_HERDR" = 1 ] && say "  - Herdr agent menu: one 'Claude · <name>' entry per login"
DEFAULT_DESC="Herdr's default shell"; [ -n "$CHOSEN_EMAIL" ] && DEFAULT_DESC="Claude as $CHOSEN_EMAIL"
[ "$HAVE_HERDR" = 1 ] && say "  - new plain Herdr terminals: $DEFAULT_DESC"
say "  - Claude starts in $START_ABS when Herdr hands it a Windows folder"
if [ "$DRY" != 1 ] && [ "$YES" != 1 ]; then
  read -r -p "Go ahead? [Y/n] " ok </dev/tty || ok=n
  case "$ok" in ""|y|Y|yes) ;; *) say "Nothing changed."; exit 0 ;; esac
fi

# ---- Write --------------------------------------------------------------------------------
say ""; say "Setting up:"
run mkdir -p "$BIN" "$CONF_DIR"
if [ "$DRY" != 1 ]; then printf 'START_DIR=%s\n' "$START_DIR" > "$CONF"; fi
remove_ours
PROGS_JSON="["
for a in "${ACCTS[@]}"; do IFS='|' read -r cfg email name <<<"$a"
  f="$BIN/$PREFIX$name"
  if [ -e "$f" ] && ! grep -q "$MARK" "$f"; then die "$f exists and wasn't made by this script; move it and run again."; fi
  if [ "$DRY" = 1 ]; then say "  (dry run) would write $f"; else
    {
      echo '#!/bin/bash'
      echo "# $MARK: Claude Code as $email. Made by setup.sh; run it again to change, --uninstall to remove."
      echo 'export PATH="$HOME/.local/bin:$PATH"'
      [ "$cfg" != default ] && printf 'export CLAUDE_CONFIG_DIR=%q\n' "$cfg"
      echo '# Herdr starts WSL in a Windows folder (/mnt/...): start in the chosen folder instead.'
      echo 'if [[ "$PWD" == /mnt/* ]]; then d=$(sed -n "s/^START_DIR=//p" "$HOME/.config/herdr-multi-account/config" 2>/dev/null); d=${d:-~}; d=${d/#\~/$HOME}; cd "$d" 2>/dev/null || cd "$HOME"; fi'
      printf 'exec %q "$@"\n' "$CLAUDE_BIN"
    } > "$f"
    chmod +x "$f"; say "  launcher: $f"
  fi
  label="$(python3 -I -c 'import sys;print(sys.argv[1][:1].upper()+sys.argv[1][1:])' "$name")"
  PROGS_JSON+="{\"key\":\"$PREFIX$name\",\"name\":\"Claude · $label\",\"run\":[\"wsl.exe\",\"-d\",\"$DISTRO\",\"-e\",\"$f\"]},"
done
PROGS_JSON="${PROGS_JSON%,}]"

if [ "$HAVE_HERDR" = 1 ]; then
  set_programs "$PROGS_JSON"
  if [ -n "$CHOSEN" ]; then
    IFS='|' read -r _ _ cname <<<"$CHOSEN"
    if [ "$DRY" = 1 ]; then say "  (dry run) would write $WRAPPER"; else
      {
        echo '#!/bin/bash'
        echo "# $MARK: what new plain Herdr terminals run. Starts Claude, then leaves a shell when Claude exits."
        echo 'if [[ "$PWD" == /mnt/* ]]; then d=$(sed -n "s/^START_DIR=//p" "$HOME/.config/herdr-multi-account/config" 2>/dev/null); d=${d:-~}; d=${d/#\~/$HOME}; cd "$d" 2>/dev/null || cd "$HOME"; fi'
        printf '"${1:-%s}"\n' "$BIN/$PREFIX$cname"   # the launcher herdr-core passes, else this one
        echo 'exec "${SHELL:-/bin/bash}" -l'
      } > "$WRAPPER"
      chmod +x "$WRAPPER"; say "  default terminal: $WRAPPER"
    fi
    set_shell "$WRAPPER" "$BIN/$PREFIX$cname"
  else
    [ -f "$CORE_CONF" ] && set_shell ""
  fi
fi

say ""
if [ "$DRY" = 1 ]; then say "Dry run: nothing was written."; else
  say "Done. New Herdr terminals pick this up right away; already-open ones don't change."
  say "Run this again to switch logins, or with --uninstall to remove it all."
fi
