#!/bin/sh
# Installs the Spark look for the Herdr app on macOS or Linux: the layout, the two mods and
# the two themes. The always-on-top indicator is a Windows program and is not installed here.
#
# NOT TESTED on macOS or Linux. Read it before you run it:   sh install.sh
#
# What it does:
#   1. Finds the Herdr home folder (~/.config/herdr-app). Stops if it is not there.
#   2. Checks that nothing it would add is already there. If something is, it stops before
#      copying anything (--force first moves what is there into a dated backup folder).
#   3. Copies the files. On macOS the layout is the Mac one (Lucida Grande and Menlo), installed
#      under the plain name spark.json so every command in SETUP.md works as written.
#   4. Runs "herdr-app check" on the two mods when herdr-app is on the PATH.
#
# It needs no administrator rights, makes no network connection, and never edits keys.json or
# settings.json or switches your layout.
#
#   --herdr-home <path>   the Herdr home folder (default: ~/.config/herdr-app, or HERDR_APP_HOME if set)
#   --force               move anything already there into a dated backup folder, then install
set -eu

slug="spark"
title="Spark"
here=$(cd "$(dirname "$0")" && pwd)
home_dir="${HERDR_APP_HOME:-${HOME}/.config/herdr-app}"
force=0

while [ $# -gt 0 ]; do
  case "$1" in
    --herdr-home)
      [ $# -ge 2 ] || { echo "--herdr-home needs a path"; exit 64; }
      home_dir="$2"; shift 2 ;;
    --force) force=1; shift ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1"; exit 64 ;;
  esac
done

echo "$title for Herdr: install"
echo

os=${LOOK_INSTALL_OS:-$(uname -s)}
if [ "$os" = "Darwin" ]; then layout_from="layouts/$slug-mac.json"; else layout_from="layouts/$slug.json"; fi

# from (in this package) and to (in the Herdr home), one pair per line
pairs="$layout_from|layouts/$slug.json
mods/$slug|mods/$slug
mods/$slug-search|mods/$slug-search
themes/$slug.json|themes/$slug.json
themes/$slug-night.json|themes/$slug-night.json"

echo "$pairs" | while IFS='|' read -r from to; do
  [ -e "$here/$from" ] || { echo "This package is incomplete: $from is missing next to install.sh. Nothing was changed."; exit 4; }
done

if [ ! -d "$home_dir" ]; then
  echo "The Herdr home folder was not found:"
  echo "  $home_dir"
  echo "Install the Herdr app and run it once (that creates the folder), then run this again. Nothing was changed."
  exit 2
fi

taken=$(echo "$pairs" | while IFS='|' read -r from to; do
  if [ -e "$home_dir/$to" ]; then echo "  $home_dir/$to"; fi
done)

if [ -n "$taken" ]; then
  if [ "$force" -ne 1 ]; then
    echo "Already there, so nothing was copied and nothing was changed:"
    echo "$taken"
    echo
    echo "To keep what is there: stop here, or rename the new look as SETUP.md describes."
    echo "To replace it: run  sh install.sh --force  (it first moves the ones listed above into a dated backup folder)."
    exit 3
  fi
  backup="$home_dir/$slug-backup-$(date +%Y%m%d-%H%M%S)"
  echo "$pairs" | while IFS='|' read -r from to; do
    if [ -e "$home_dir/$to" ]; then
      mkdir -p "$backup/$(dirname "$to")"
      mv "$home_dir/$to" "$backup/$to"
    fi
  done
  echo "Moved what was there into: $backup"
fi

echo "$pairs" | while IFS='|' read -r from to; do
  mkdir -p "$home_dir/$(dirname "$to")"
  cp -R "$here/$from" "$home_dir/$to"
done
echo "Look: copied the layout, the two mods and the two themes into $home_dir"
if [ "$os" != "Darwin" ]; then
  echo "Fonts: this layout names Segoe UI and Consolas. On Linux, change \"ui_font\" and \"font\" near the top of"
  echo "  $home_dir/layouts/$slug.json  to fonts you have."
fi

if command -v herdr-app >/dev/null 2>&1; then
  if herdr-app check "$home_dir/mods/$slug" && herdr-app check "$home_dir/mods/$slug-search"; then
    echo "Check: herdr-app check passed on both mods."
  else
    echo "Check: herdr-app check did NOT pass. The files are in place; see the lines above and SETUP.md."
  fi
else
  echo "Check: herdr-app is not on your PATH, so the mods were not checked. You can run: herdr-app check <home>/mods/$slug"
fi

echo
echo "Installed. Your own layout and your keys were not changed. Next:"
echo "  1. Switch to the look: in Herdr press ctrl-shift-l until it shows, or run"
echo "       herdr-app do layout.switch --name $slug"
echo "  2. Optional: the search bar works by click. To also open it with a key, add this one line to the"
echo "     \"global\" section of keys.json in the Herdr home (SETUP.md, \"The search key\"):"
echo "       \"ctrl-f\": \"mod.open:$slug-search\""
echo "To remove it: SETUP.md, \"Switch back, or remove it\"."
