// What a session and a tab are called. Pure: no herdr or gpui imports.
// Agents put their session name in the terminal title, sometimes after a
// status glyph; a title that only repeats the program name is no name.
//
// Tab names follow rule "N1": a tab always shows the name the sidebar shows
// for its lead agent, the session's summary name. Only a tab with no session
// name falls back: first to a label typed by hand, then to what its shell
// pane is called, then to its automatic label. A hand-typed label that is not
// what the tab shows goes into the tab's hover tip (labelNote). A label that
// only repeats a program's own name ("Claude Code", what the New agent menu
// gives a tab) was not typed by hand and is never shown as one.

const clean = (title) => String(title ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
const same = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

export function sessionName(agent) {
  if (!agent?.program?.agent) return null;
  const title = clean(agent.title);
  return !title || same(title, agent.program.name) ? null : title;
}

export function paneName(pane) {
  if (!pane?.terminal) return null;
  if (pane.program?.agent) return sessionName(pane);
  if (/[\/]/.test(String(pane.title ?? ""))) return null;
  const title = clean(pane.title);
  if (!title || same(title, pane.program?.name) || same(title, pane.terminal)) return null;
  return title;
}

/** The tab has a label, and it is one somebody typed: not just the name of a program running in it. */
export function handLabel(tab, panes) {
  if (!tab?.named) return false;
  const name = String(tab.name ?? "").trim();
  if (!name) return false;
  return !(panes ?? []).some((p) => p.tab === tab.id && p.program?.name && same(name, p.program.name));
}

/**
 * A tab's name. Its lead agent's session name always wins (the focused agent with one, else
 * the first); with no session name, a hand-typed label; else a shell pane's title that names
 * something; else its automatic label; else null (the caller then shows the program or "Tab N").
 */
export function tabName(tab, panes) {
  const mine = (panes ?? []).filter((p) => p.tab === tab?.id);
  const sessions = mine.filter((p) => sessionName(p));
  const agent = sessions.find((p) => p.focused) ?? sessions[0];
  if (agent) return sessionName(agent);
  if (handLabel(tab, panes)) return tab.name;
  const titled = mine.filter((p) => paneName(p));
  const lead = titled.find((p) => p.focused) ?? titled[0];
  if (lead) return paneName(lead);
  return tab?.named && String(tab.name ?? "").trim() ? tab.name : null;
}

/**
 * The hand-typed label to mention in a tab's hover tip: the label, when the tab has one and it
 * is not already the name the tab shows; else null. An automatic label is never mentioned.
 */
export function labelNote(tab, panes, shown) {
  if (!handLabel(tab, panes)) return null;
  const label = String(tab.name).trim();
  return same(label, shown) ? null : label;
}

/** Where a dragged tab lands: tab.move args (1-based index), or null. */
export function dropMove(tabs, fromId, toId) {
  if (!fromId || fromId === toId) return null;
  const to = (tabs ?? []).findIndex((t) => t.id === toId);
  if (to < 0 || !(tabs ?? []).some((t) => t.id === fromId)) return null;
  return { id: fromId, index: to + 1 };
}

/**
 * The sidebar tree: every space in order, each with its rows in tab order. A tab
 * with agents gives one row per agent; a tab without any (a plain shell, a panel)
 * gives one quiet row, so no space looks empty. `order` is every agent address in
 * the order the tree shows them, for agent.next / agent.prev. Agents whose space
 * is not listed (still loading) come last in `stray`.
 */
export function sidebarTree(spaces, agents, panes) {
  const crew = agents ?? [];
  const placed = new Set();
  const order = [];
  const tree = (spaces ?? []).map((space) => {
    const rows = [];
    let waiting = 0;
    let working = 0;
    let count = 0;
    for (const tab of space.tabs ?? []) {
      const mine = crew.filter((a) => a.space === space.id && a.tab === tab.id);
      if (!mine.length) {
        const lead = (panes ?? []).find((p) => p.tab === tab.id && p.focused) ?? (panes ?? []).find((p) => p.tab === tab.id);
        rows.push({ kind: "shell", tab, pane: lead ?? null });
        continue;
      }
      for (const agent of mine) {
        rows.push({ kind: "agent", tab, agent });
        placed.add(agent.address);
        order.push(agent.address);
        count++;
        if (agent.status === "blocked") waiting++;
        else if (agent.status === "working") working++;
      }
    }
    return { space, rows, waiting, working, agents: count };
  });
  const stray = crew.filter((a) => !placed.has(a.address));
  for (const a of stray) order.push(a.address);
  return { tree, order, stray };
}

/** The dot on a space's header tab: someone waiting beats someone working; else none. */
export function spaceSignal(spaceId, agents) {
  const mine = (agents ?? []).filter((a) => a.space === spaceId);
  if (mine.some((a) => a.status === "blocked")) return "blocked";
  if (mine.some((a) => a.status === "working")) return "working";
  return null;
}

/**
 * Shortens names so every tab fits: the widest allowed name, given each name's
 * wanted width and the room left for all of them. Names that already fit keep
 * their width; only the longest are cut.
 */
export function nameCap(want, budget, most = 220) {
  if (want.reduce((a, b) => a + b, 0) <= budget) return most;
  let lo = 0;
  let hi = most;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (want.reduce((a, w) => a + Math.min(w, mid), 0) <= budget) lo = mid;
    else hi = mid;
  }
  return lo;
}

// ---- Dragging a tab along its row (Chrome style) -----------------------------------
// Pure slot math. `widths` are the row's tab widths in order, `from` is the dragged tab's
// place in that order, and `dx` is how far it has been dragged sideways from its own slot.

const leftEdges = (widths) => {
  let x = 0;
  return widths.map((w) => {
    const at = x;
    x += w;
    return at;
  });
};

/** The drag distance held inside the row: the dragged tab never leaves the strip of tabs. */
export function dragClamp(widths, from, dx) {
  if (!(from >= 0 && from < widths.length)) return 0;
  const at = leftEdges(widths)[from];
  const total = widths.reduce((a, b) => a + b, 0);
  return Math.min(Math.max(Number(dx) || 0, -at), total - at - widths[from]) + 0; // + 0: never a negative zero
}

/**
 * The slot the dragged tab would land in. A neighbor gives way once the dragged tab's leading
 * edge passes that neighbor's midpoint, as browser tabs do.
 */
export function dragSlot(widths, from, dx) {
  if (!(from >= 0 && from < widths.length)) return -1;
  const edges = leftEdges(widths);
  const left = edges[from] + dragClamp(widths, from, dx);
  const right = left + widths[from];
  let slot = from;
  for (let j = from + 1; j < widths.length && right > edges[j] + widths[j] / 2; j++) slot = j;
  for (let j = from - 1; j >= 0 && left < edges[j] + widths[j] / 2; j--) slot = j;
  return slot;
}

/**
 * How far each tab sits from its own place while the dragged tab is headed for `slot`: the
 * neighbors it has passed move over by its width, the rest stay, and the entry for the dragged
 * tab itself is where it lands (the distance from its old slot to its new one).
 */
export function dragShifts(widths, from, slot) {
  const w = widths[from] ?? 0;
  return widths.map((_w, j) => {
    if (j === from) {
      let d = 0;
      for (let k = from + 1; k <= slot; k++) d += widths[k];
      for (let k = slot; k < from; k++) d -= widths[k];
      return d;
    }
    if (j > from && j <= slot) return -w;
    if (j < from && j >= slot) return w;
    return 0;
  });
}

/** The row's order once the dragged tab is dropped in `slot`. */
export function dragOrder(ids, from, slot) {
  const next = ids.filter((_id, j) => j !== from);
  next.splice(slot, 0, ids[from]);
  return next;
}
