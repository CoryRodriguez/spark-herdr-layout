// Search logic. Pure: no herdr or gpui imports, so it runs under plain node for tests.

const fold = (s) => String(s ?? "").toLowerCase();

/** A terminal title without its leading status glyph. */
export const cleanTitle = (title) => String(title ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

/** The name an agent gave its session, or null when the title only repeats the program. */
export function sessionName(title, programName) {
  const t = cleanTitle(title);
  if (!t || fold(t) === fold(programName).trim()) return null;
  return t;
}

/** A terminal on this computer that a screen read may be asked for. */
export const LOCAL_TERMINAL = /^t[0-9a-z]{1,12}$/;

/**
 * Everything that can be found by name, from the app's live lists.
 * entries: one per agent, then one per other terminal that has a pane (shells).
 */
export function buildWorld(spaces, agents, panes) {
  const tabs = new Map();
  const sp = (spaces ?? []).map((s) => {
    const space = { id: s.id, index: s.index, name: String(s.name ?? ""), status: s.status ?? null, tabs: (s.tabs ?? []).length };
    for (const t of s.tabs ?? []) tabs.set(t.id, { tab: t, space });
    return space;
  });
  const entries = [];
  const seen = new Set();
  const add = (terminal, pane, tabId, status, title, program, app, isAgent) => {
    if (!terminal || seen.has(terminal)) return;
    const where = tabs.get(tabId);
    if (!where) return;
    seen.add(terminal);
    const programName = String(program?.name ?? "");
    // A hand-typed tab label counts unless it only repeats the program's name (the automatic "Claude Code").
    const typed = where.tab.named ? String(where.tab.name ?? "").trim() : "";
    const label = typed && fold(typed) !== fold(programName).trim() ? typed : null;
    const session = isAgent ? sessionName(title, programName) : null;
    entries.push({
      terminal, pane: pane || null, isAgent, status: status ?? null,
      space: where.space, tabId, tabIndex: where.tab.index, label, session, programName,
      name: session ?? label ?? (programName || terminal),
      local: LOCAL_TERMINAL.test(terminal),
    });
  };
  for (const a of agents ?? []) add(a.address, a.pane, a.tab, a.status, a.title, a.program, a.app, true);
  for (const p of panes ?? []) add(p.terminal, p.pane, p.tab, p.status, p.title, p.program, p.app, Boolean(p.program?.agent));
  return { spaces: sp, entries };
}

/** Projects and agents whose names contain the query. An empty query lists every agent. */
export function matchNames(world, query) {
  const q = fold(query).trim();
  if (!q) return { projects: [], agents: world.entries.map((entry) => ({ entry, field: null })) };
  const projects = world.spaces.filter((s) => fold(s.name).includes(q));
  const agents = [];
  for (const entry of world.entries) {
    const field = fold(entry.name).includes(q) ? "name"
      : entry.label && fold(entry.label).includes(q) ? "label"
      : fold(entry.programName).includes(q) ? "program" : null;
    if (field) agents.push({ entry, field });
  }
  const rank = (m) => (m.field === "name" ? (fold(m.entry.name).startsWith(q) ? 0 : 1) : m.field === "label" ? 2 : 3);
  agents.sort((a, b) => rank(a) - rank(b));
  return { projects, agents };
}

const NBSP = "\u00a0";

/**
 * A line cut into the part before the match, the match and the rest, for a
 * one-line row that must keep the match in view. The spaces that touch the
 * match become non-breaking so separate text elements don't swallow them.
 */
export function splitAround(text, query, lead = 30) {
  const s = String(text ?? "");
  const q = fold(query).trim();
  const low = fold(s);
  const i = q && low.length === s.length ? low.indexOf(q) : -1;
  if (i < 0) return { pre: "", hit: "", post: s };
  let pre = s.slice(0, i);
  if (pre.length > lead) {
    pre = pre.slice(pre.length - lead);
    const cut = pre.indexOf(" ");
    if (cut >= 0 && cut < pre.length - 1) pre = pre.slice(cut + 1);
    pre = "\u2026" + pre;
  }
  pre = pre.replace(/ +$/, (m) => NBSP.repeat(m.length));
  const post = s.slice(i + q.length).replace(/^ +/, (m) => NBSP.repeat(m.length));
  return { pre, hit: s.slice(i, i + q.length), post };
}

/** A line as words, each marked when the match touches it, for wrapped text. */
export function words(text, query) {
  const s = String(text ?? "");
  const q = fold(query).trim();
  const low = fold(s);
  const ranges = [];
  if (q && low.length === s.length) {
    for (let i = low.indexOf(q); i >= 0; i = low.indexOf(q, i + q.length)) ranges.push([i, i + q.length]);
  }
  const out = [];
  const re = /\S+/g;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const a = m.index;
    const b = a + m[0].length;
    out.push({ t: m[0], hit: ranges.some(([x, y]) => a < y && b > x) });
  }
  return out;
}

const clip = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "\u2026");

/** A terminal row without frame characters, prompt marks and block glyphs. */
export function cleanScreenRow(row) {
  return String(row ?? "")
    .replace(/[\u2500-\u259f\u23a0-\u23ff\u25a0-\u25ff\u2190-\u21ff\u2700-\u27bf]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Rows of a terminal's visible screen that contain the query, lowest (newest) first. */
export function screenHits(text, query, context = 2) {
  const q = fold(query).trim();
  if (!q) return [];
  const rows = String(text ?? "").split("\n").map(cleanScreenRow).filter((r) => /[\p{L}\p{N}]/u.test(r));
  const out = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    if (!fold(rows[i]).includes(q)) continue;
    out.push({
      src: "screen", ts: null, role: null, text: clip(rows[i], 400),
      before: rows.slice(Math.max(0, i - context), i).map((t) => ({ role: null, text: clip(t, 240) })),
      after: rows.slice(i + 1, i + 1 + context).map((t) => ({ role: null, text: clip(t, 240) })),
    });
  }
  return out;
}

const norm = (s) => fold(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Text hits, one group per terminal: the rows of its visible screen that contain
 * the query, lowest (newest) first, a repeated row kept once.
 * screens: { terminal: text }.
 */
export function buildGroups(entries, screens, query) {
  const groups = [];
  for (const entry of entries) {
    const lines = [];
    for (const s of screenHits(screens?.[entry.terminal], query)) {
      const n = norm(s.text);
      if (!lines.some((l) => norm(l.text) === n)) lines.push(s);
    }
    if (lines.length) groups.push({ entry, lines, count: lines.length });
  }
  return groups;
}

/** "4 agents and 1 shell", "1 agent", "2 shells". */
export function countLabel(entries) {
  const agents = entries.filter((e) => e.isAgent).length;
  const shells = entries.length - agents;
  const part = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (agents && shells) return `${part(agents, "agent")} and ${part(shells, "shell")}`;
  return agents ? part(agents, "agent") : part(shells, "shell");
}

/** Row heights by kind, shared by the list's layout and its keyboard scrolling. */
export const ROW_H = { group: 30, note: 28, project: 38, agent: 48, text: 48, busy: 38, more: 38 };

/**
 * The flat list a search shows. scan: null, or { q, state: "running" | "done",
 * total, read, groups, searched, problem }. Rows of kind project, agent, text and more can
 * be picked.
 */
export function buildRows({ world, query, scan, minText, dropdown }) {
  const q = String(query ?? "").trim();
  const names = matchNames(world, q);
  const rows = [];
  if (!q) {
    rows.push({ kind: "group", label: "Agents", count: names.agents.length });
    if (!names.agents.length) rows.push({ kind: "note", text: "No agents are open." });
    for (const m of names.agents) rows.push({ kind: "agent", entry: m.entry, field: null });
    return rows;
  }
  rows.push({ kind: "group", label: "Projects", count: names.projects.length });
  if (!names.projects.length) rows.push({ kind: "note", text: `No project is named \u201c${q}\u201d` });
  for (const space of names.projects) rows.push({ kind: "project", space });
  rows.push({ kind: "group", label: "Agents", count: names.agents.length });
  if (!names.agents.length) rows.push({ kind: "note", text: `No agent is named \u201c${q}\u201d` });
  for (const m of names.agents) rows.push({ kind: "agent", entry: m.entry, field: m.field });
  const mine = scan && fold(scan.q) === fold(q) ? scan : null;
  if (mine?.state === "done") {
    rows.push({ kind: "group", label: "Text on screen", count: mine.groups.length, note: `${mine.searched} read` });
    if (!mine.groups.length) rows.push({ kind: "note", text: mine.problem ?? `No open terminal shows \u201c${q}\u201d on screen right now` });
    for (const group of mine.groups) rows.push({ kind: "text", group });
  } else {
    rows.push({ kind: "group", label: "Text on screen", count: null });
    if (mine?.state === "running") rows.push({ kind: "busy", scan: mine });
    else if (q.length < minText) rows.push({ kind: "note", text: `Type ${minText} or more letters to search on-screen text, or press Enter` });
    else rows.push({ kind: "note", text: "Pause typing, or press Enter, to search on-screen text" });
  }
  if (dropdown) rows.push({ kind: "more" });
  return rows;
}

export const pickable = (row) => row.kind === "project" || row.kind === "agent" || row.kind === "text" || row.kind === "more";
