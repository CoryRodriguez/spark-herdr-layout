// This look's decisions as pure functions: no herdr or gpui imports, so
// they run and can be tested anywhere. Times come from the local clock.

const pad = (n) => String(n).padStart(2, "0");
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "7:30 PM" */
export function clock12(ms) {
  const d = new Date(ms);
  const h = d.getHours() % 12 || 12;
  return `${h}:${pad(d.getMinutes())} ${d.getHours() < 12 ? "AM" : "PM"}`;
}

/** "7:30:05 PM" */
export function clockSeconds12(ms) {
  const d = new Date(ms);
  const h = d.getHours() % 12 || 12;
  return `${h}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${d.getHours() < 12 ? "AM" : "PM"}`;
}

/** Minutes after midnight as "7:00 AM". */
export function minutesLabel(minutes) {
  const h24 = Math.floor(minutes / 60);
  return `${h24 % 12 || 12}:${pad(minutes % 60)} ${h24 < 12 ? "AM" : "PM"}`;
}

/** "7:30 PM" today, "Sat 4:52 AM" on another day. */
export function whenLabel(ms, nowMs) {
  const d = new Date(ms);
  const n = new Date(nowMs);
  const same = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return same ? clock12(ms) : `${DAYS[d.getDay()]} ${clock12(ms)}`;
}

/** "12m", "2h 05m", "<1m". */
export function duration(ms) {
  if (typeof ms !== "number" || !isFinite(ms) || ms < 0) return null;
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  return m >= 60 ? `${Math.floor(m / 60)}h ${pad(m % 60)}m` : `${m}m`;
}

/**
 * Whether this terminal was started as the agent itself, so its age is the
 * agent's age: the program is the agent ("claude ..."), or a shell's command ends
 * by running it ("...; & 'claude'", how New agent starts one). A shell someone
 * later typed "claude" into has no such command, and its age says nothing.
 */
export function launchedDirectly(argv, agent) {
  if (!Array.isArray(argv) || !argv.length) return false;
  const base = (s) => String(s ?? "").replace(/^.*[\\/]/, "").replace(/\.(exe|cmd|bat|ps1)$/i, "").toLowerCase();
  const key = base(agent?.program?.key);
  const app = String(agent?.app ?? "").toLowerCase();
  const isAgent = (token) => Boolean(token) && (token === key || token === app || app.startsWith(`${token}-`));
  if (isAgent(base(argv[0]))) return true;
  if (!/^(powershell|pwsh|cmd|bash|sh|zsh|fish)$/.test(base(argv[0]))) return false;
  const last = String(argv[argv.length - 1]).split(";").map((x) => x.trim()).filter(Boolean).pop() ?? "";
  const first = /^&?\s*(?:'([^']+)'|"([^"]+)"|(\S+))/.exec(last);
  return Boolean(first) && isAgent(base(first[1] ?? first[2] ?? first[3]));
}

/**
 * Which login an agent runs as, read from how its terminal was started: a launcher named
 * `claude-as-<name>` (extras/multi-account) or `claude-<name>` anywhere in the command line.
 * Returns "Sam" for claude-as-sam, or null when the command names no login.
 */
export function accountOf(argv) {
  if (!Array.isArray(argv)) return null;
  const words = argv.join(" ").split(/[\s'"&;]+/).map((w) => w.replace(/^.*[\\/]/, "").replace(/\.(exe|cmd|bat|ps1|sh)$/i, "").toLowerCase());
  const pick = (re) => {
    for (const w of words) { const m = re.exec(w); if (m && !NOT_ACCOUNTS.has(m[1])) return m[1]; }
    return null;
  };
  const name = pick(/^claude-as-([a-z0-9][a-z0-9-]*)$/) ?? pick(/^claude-([a-z][a-z0-9-]*)$/);
  return name ? name[0].toUpperCase() + name.slice(1) : null;
}
const NOT_ACCOUNTS = new Set(["code", "shell", "desktop", "cli", "as"]);

export const BASELINE_GRACE_MS = 15 * 1000;

/**
 * A copy's first look isn't news: agents present at start, or arriving while the
 * app is still loading its terminals, were there before it was looking.
 */
export const pastBaseline = (startedMs, nowMs, grace = BASELINE_GRACE_MS) => nowMs - startedMs >= grace;

/**
 * Update the record of when each agent was first seen. { at: null } means it was
 * already there when the mod started, so its start is unknown. Returns the same
 * object when nothing changed. An address whose terminal is new starts over.
 */
export function updateSeen(stored, live, nowMs, startedMs) {
  const prior = stored && typeof stored === "object" ? stored : {};
  const past = pastBaseline(startedMs, nowMs);
  const next = {};
  let changed = false;
  for (const { address, createdMs } of live) {
    const had = prior[address];
    if (had && (typeof createdMs !== "number" || typeof had.created_ms !== "number" || had.created_ms === createdMs)) {
      if (typeof createdMs === "number" && typeof had.created_ms !== "number") {
        next[address] = { ...had, created_ms: createdMs };
        changed = true;
      } else {
        next[address] = had;
      }
    } else {
      next[address] = { at: past ? nowMs : null, created_ms: typeof createdMs === "number" ? createdMs : null };
      changed = true;
    }
  }
  for (const address of Object.keys(prior)) {
    if (next[address]) continue;
    if (past) changed = true; // gone: forget it, so its next agent is new
    else next[address] = prior[address]; // still loading: it may just not be listed yet
  }
  return changed ? next : stored;
}

const SAME_LAUNCH_MS = 2 * 60 * 1000;

/**
 * When this agent began, as far as anyone can honestly say; null when unknown.
 * A directly launched terminal's start, unless the agent appeared long after it
 * (a second run in the shell it left behind); else when it was first seen.
 */
export function agentSince({ direct, createdMs, seenAt }) {
  if (direct && typeof createdMs === "number") return typeof seenAt === "number" && seenAt - createdMs > SAME_LAUNCH_MS ? seenAt : createdMs;
  return typeof seenAt === "number" ? seenAt : null;
}

export const TIME_TIPS = {
  terminal: "Time since this agent's terminal started",
  seen: "Time since Spark first saw this agent",
};

/**
 * An agent row's time: since the agent began (agentSince). It does not depend on the
 * agent's status, so it never resets when an agent changes state, and an unknown start
 * shows no time.
 */
export function rowStats({ createdMs, sinceMs, direct } = {}, nowMs) {
  if (typeof sinceMs !== "number") return { time: null, timeTip: null };
  const source = direct && sinceMs === createdMs ? "terminal" : "seen";
  return { time: duration(Math.max(0, nowMs - sinceMs)), timeTip: TIME_TIPS[source] };
}

// ---- Look (light or dark) -------------------------------------------------
// Only the header button changes it: nothing is scheduled.

/** The button's write: the opposite of what shows now (settings.json's appearance, else the system's). */
export function toggledAppearance(current, dark) {
  const showing = current === "light" || current === "dark" ? current : dark ? "dark" : "light";
  return showing === "dark" ? "light" : "dark";
}

/** The button's tooltip, in plain words. */
export const appearanceTip = (dark) => (dark ? "Switch to the day look" : "Switch to the night look");

/**
 * settings.json's text with appearance set; null if unusable. An existing value
 * changes in place, so every other byte stays as it was (zoom and all); a file
 * without one gets it added with every other key kept.
 */
export function withAppearance(text, appearance) {
  let o;
  try {
    o = JSON.parse(text);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const wanted = JSON.stringify({ ...o, appearance });
  const inPlace = String(text).replace(/("appearance"\s*:\s*)"[^"]*"/, `$1"${appearance}"`);
  try {
    if (JSON.stringify(JSON.parse(inPlace)) === wanted) return inPlace;
  } catch {
    // Falls through to a full rewrite.
  }
  o.appearance = appearance;
  return JSON.stringify(o, null, 2) + (String(text).endsWith("\n") ? "\n" : "");
}

// ---- Waiting alert ----------------------------------------------------------

export const TOAST_COOLDOWN_MS = 30 * 1000;

/** One Windows notification per terminal per cooldown. */
export function toastAllowed(lastAt, nowMs, cooldown = TOAST_COOLDOWN_MS) {
  return typeof lastAt !== "number" || nowMs - lastAt >= cooldown;
}

// ---- Search bar ---------------------------------------------------------------

/**
 * Where the search panel opens (its top left, in the window) so that the panel's first row
 * lands exactly on the header's search bar. `inset` { x, y } is how far the panel's row sits
 * inside the panel compared with how far the bar's own content sits inside the bar. Left edges
 * line up when the whole panel then fits inside the window; otherwise right edges line up.
 * `windowWidth` 0 or unknown: left edges. Never off the left or top of the window.
 */
export function searchPanelAt(bar, windowWidth, panelWidth, inset) {
  const margin = 4;
  const dx = Number(inset?.x) || 0;
  const dy = Number(inset?.y) || 0;
  const left = bar.left - dx;
  const fits = !(windowWidth > 0) || left + panelWidth <= windowWidth - margin;
  const x = fits ? left : bar.left + bar.width + dx - panelWidth;
  return { x: Math.max(margin, Math.round(x)), y: Math.max(0, Math.round(bar.top - dy)), side: fits ? "left" : "right" };
}

// ---- Activity wording -----------------------------------------------------------
// Tabs carry the session name now, so a line names the agent once and never quotes a tab label.

/** What an agent is called in an activity line: its session name, else its program with its tab number. */
export function activityName(session, program, tabIndex) {
  if (session) return String(session);
  const what = program || "Agent";
  return typeof tabIndex === "number" && tabIndex > 0 ? `${what} (tab ${tabIndex})` : what;
}

/**
 * One activity line. `kind`: started, waiting, away (finished unseen), done, ended (by the
 * person) or exited. The space is named only when it is not the space on screen (`elsewhere`).
 */
export function activityLine(kind, name, space, elsewhere) {
  const where = elsewhere && space ? ` in ${space}` : "";
  switch (kind) {
    case "started": return `${name} started${where}`;
    case "waiting": return `${name} is waiting for you${where}`;
    case "away": return `${name} finished${where} while you were away`;
    case "done": return `${name} finished${where}`;
    case "ended": return `${name} was ended${where}`;
    default: return `${name} exited${where}`;
  }
}

// ---- Shortcuts, as written for people ---------------------------------------------
// The key hints a panel shows come from the key bindings themselves (herdr keys()), so a hint
// can never disagree with keys.json.

const KEY_WORDS = { ctrl: "Ctrl", shift: "Shift", alt: "Alt", cmd: "Cmd", super: "Win", win: "Win", fn: "Fn",
  escape: "Esc", enter: "Enter", space: "Space", tab: "Tab", backspace: "Backspace", delete: "Del", insert: "Ins",
  pageup: "PgUp", pagedown: "PgDn", home: "Home", end: "End", up: "Up", down: "Down", left: "Left", right: "Right" };

/** "ctrl-f" -> "Ctrl+F", "ctrl-shift-s" -> "Ctrl+Shift+S", a sequence "ctrl-k ctrl-s" -> "Ctrl+K Ctrl+S". */
export function keyLabel(keys) {
  const chord = (text) => {
    const minus = text.endsWith("-") && text.length > 1; // the key is "-" itself, as in "ctrl--"
    const parts = (minus ? text.slice(0, -1) : text).split("-").filter(Boolean);
    if (minus) parts.push("-");
    return parts.map((p) => KEY_WORDS[p.toLowerCase()] ?? (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1))).join("+");
  };
  return String(keys ?? "").trim().split(/\s+/).filter(Boolean).map(chord).join(" ");
}

/**
 * The shortcut bound to `action` (for example "mod.open:spark-search"), written for people, or
 * null when nothing is bound. `bindings` is herdr's keys(): [{ section, keys, action }]. A binding
 * for the shown layout wins over a global one, and a global one over any other section.
 */
export function shortcutFor(bindings, action, layoutName) {
  const wanted = String(action).replace(/\s+/g, "");
  const same = (a) => {
    if (typeof a === "string") return a.replace(/\s+/g, "") === wanted;
    // The object form of a binding: { command, args }, where the first argument is what "name:value" fills.
    const first = a?.args && typeof a.args === "object" ? Object.values(a.args)[0] : undefined;
    return Boolean(a?.command) && (first === undefined ? a.command : `${a.command}:${first}`) === wanted;
  };
  const rank = (section) => (section === `layout:${layoutName}` ? 0 : section === "global" ? 1 : String(section ?? "").startsWith("layout:") ? 9 : 2);
  const hits = (Array.isArray(bindings) ? bindings : []).filter((b) => b && same(b.action) && rank(b.section) < 9 && b.keys);
  if (!hits.length) return null;
  hits.sort((x, y) => rank(x.section) - rank(y.section));
  return keyLabel(hits[0].keys) || null;
}

// ---- Activity log: no echo --------------------------------------------------------
// An agent's status can flicker at the end of a turn (working, idle, working, idle within a
// couple of seconds), which wrote the same "finished" line twice.

export const REPEAT_MS = 5000;

/**
 * Whether `entry` only repeats a line the log already got moments ago: the same kind, the same
 * text and the same agent within `windowMs`. The same line later on is news again, and two
 * different lines close together are both news.
 */
export function repeatsRecent(log, entry, nowMs, windowMs = REPEAT_MS) {
  if (!Array.isArray(log) || !entry) return false;
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (!e || typeof e.at !== "number") continue;
    if (nowMs - e.at >= windowMs) break; // older entries are older still
    if (e.kind === entry.kind && e.text === entry.text && (e.address ?? null) === (entry.address ?? null)) return true;
  }
  return false;
}

