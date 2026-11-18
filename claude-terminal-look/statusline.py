#!/usr/bin/env python3
"""A one-line status line for Claude Code.

    C:\\Work\\app main | Opus 5.5 · high · think | ctx [bar] 34% (68k/200k) | 7d 9% (reset) Fri 9:00am | $2.41 +120/-18

Claude Code runs this after each turn, hands it a JSON description of the session on
standard input, and shows whatever it prints. It reads nothing else, writes no files and
makes no network connection. Any missing field simply leaves its own segment out.

Segments, left to right: folder (and git branch), model with effort and thinking, context
window used, usage windows (5-hour and 7-day, when the plan reports them) with their reset
time, pull request number, session cost with lines added and removed, spend limit.

The cost and spend-limit segments are adapted from the status line of the GSD project
(github.com/gsd-build/get-shit-done, MIT license).
"""
import json
import os
import subprocess
import sys
from datetime import datetime

DIM = "\033[2m"
RESET = "\033[0m"
SEP = f"{DIM} │ {RESET}"

# Width of the context bar, in whole cells: solid where used, shade where free.
BAR_CELLS = 12
# The unfilled track is U+2591 LIGHT SHADE; 242 keeps it visible on dark themes.
TRACK = "\033[38;5;242m"
UP = "\033[38;5;108m"
DOWN = "\033[38;5;203m"


def color(pct):
    """Green under 60, amber from 60, red from 85."""
    if pct is None:
        return "\033[38;5;245m"
    if pct >= 85:
        return "\033[38;5;203m"
    if pct >= 60:
        return "\033[38;5;179m"
    return "\033[38;5;108m"


def bar(pct, cells=BAR_CELLS):
    """A fill gauge in whole cells: full block for used, light shade for free."""
    pct = max(0.0, min(100.0, float(pct)))
    full = int(round(pct / 100 * cells))
    # Never let a non-zero context read as an empty bar, or a sub-100 one as full.
    if full == 0 and pct > 0:
        full = 1
    if full == cells and pct < 100:
        full = cells - 1
    return f"{color(pct)}{'█' * full}{RESET}{TRACK}{'░' * (cells - full)}{RESET}"


def human(n):
    if n is None:
        return "?"
    if n >= 1000:
        return f"{n / 1000:.0f}k"
    return str(n)


def reset_label(value, weekday=True):
    """When a usage window resets, as a short local time: 'Thu 9:00am'.

    Accepts epoch seconds or an ISO-8601 string. Returns None when the value is
    missing or unreadable, so the reset is simply left off.
    """
    if value is None:
        return None
    try:
        if isinstance(value, (int, float)):
            when = datetime.fromtimestamp(value).astimezone()
        else:
            when = datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone()
    except Exception:
        return None
    hour = when.strftime("%I").lstrip("0") or "12"
    clock = f"{hour}:{when.strftime('%M')}{when.strftime('%p').lower()}"
    return f"{when.strftime('%a')} {clock}" if weekday else clock


def branch(cwd):
    try:
        out = subprocess.run(
            ["git", "-C", cwd, "branch", "--show-current"],
            capture_output=True, text=True, timeout=1,
        )
        return out.stdout.strip() or None
    except Exception:
        return None


def session_cost(d):
    """Session cost and lines touched, e.g. '$1.23 +40/-7'."""
    cost = d.get("cost") or {}
    bits = []
    usd = cost.get("total_cost_usd")
    if isinstance(usd, (int, float)) and usd > 0:
        bits.append(f"{DIM}${usd:.2f}{RESET}" if usd < 10 else f"{DIM}${usd:.0f}{RESET}")
    added = cost.get("total_lines_added") or 0
    removed = cost.get("total_lines_removed") or 0
    if added or removed:
        bits.append(f"{UP}+{added}{RESET}{DIM}/{RESET}{DOWN}-{removed}{RESET}")
    return f"{DIM} {RESET}".join(bits) or None


def spend_limit(d):
    w = (d.get("rate_limits") or {}).get("spend_limit") or {}
    p = w.get("used_percentage")
    if p is None:
        return None
    return f"{DIM}spend {RESET}{color(p)}{p:.0f}%{RESET}"


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    try:
        d = json.loads(sys.stdin.buffer.read().decode("utf-8", "replace"))
    except Exception:
        return

    parts = []

    cwd = (d.get("workspace") or {}).get("current_dir") or d.get("cwd") or ""
    if cwd:
        home = os.path.expanduser("~")
        shown = "~" + cwd[len(home):] if cwd.startswith(home) else cwd
        seg = f"\033[38;5;110m{shown}{RESET}"
        b = branch(cwd)
        if b:
            seg += f"{DIM} {RESET}\033[38;5;140m{b}{RESET}"
        parts.append(seg)

    model = (d.get("model") or {}).get("display_name")
    if model:
        seg = f"\033[38;5;252m{model}{RESET}"
        effort = (d.get("effort") or {}).get("level")
        if effort:
            seg += f"{DIM} · {effort}{RESET}"
        if (d.get("thinking") or {}).get("enabled"):
            seg += f"{DIM} · think{RESET}"
        parts.append(seg)

    ctx = d.get("context_window") or {}
    used = ctx.get("used_percentage")
    if used is not None:
        tok = ctx.get("total_input_tokens")
        size = ctx.get("context_window_size")
        c = color(used)
        seg = f"{DIM}ctx {RESET}{bar(used)}{DIM} {RESET}{c}{used:.0f}%{RESET}"
        if tok and size:
            seg += f"{DIM} ({human(tok)}/{human(size)}){RESET}"
        parts.append(seg)

    limits = d.get("rate_limits") or {}
    bits = []
    for key, label in (("five_hour", "5h"), ("seven_day", "7d")):
        w = limits.get(key)
        if w and w.get("used_percentage") is not None:
            p = w["used_percentage"]
            seg = f"{DIM}{label} {RESET}{color(p)}{p:.0f}%{RESET}"
            # The 5-hour window resets within the day, so it gets the time
            # alone; the 7-day one needs the weekday to mean anything.
            when = reset_label(w.get("resets_at"), weekday=(key == "seven_day"))
            if when:
                seg += f"{DIM} ↻ {when}{RESET}"
            bits.append(seg)
    if bits:
        parts.append(f"{DIM} {RESET}".join(bits))

    pr = d.get("pr") or {}
    if pr.get("number"):
        tag = "MR !" if pr.get("kind") == "mr" else "PR #"
        parts.append(f"\033[38;5;146m{tag}{pr['number']}{RESET}")

    parts.extend(x for x in (session_cost(d), spend_limit(d)) if x)

    sys.stdout.write(SEP.join(parts))


main()
