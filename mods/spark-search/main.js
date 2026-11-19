// Spark search: find a project (a space), an agent, or a word on a terminal's screen.
//
// Two shapes, one mod:
//   no props.mode         the search window (opened by mod.open, e.g. a key):
//                         results on the left; on the right a preview of the
//                         selected one (for a text hit: the lines around it).
//   props.mode "dropdown" a compact column for the header's search bar: a text
//                         field on top, grouped results, and a "Show more" row
//                         that opens the search window with the same search.
//
// Names match as the person types, from the app's live lists: space names, agent
// names, typed tab labels and program names. Text is looked up after a short
// pause or on Enter, from one place only: what each open terminal on this
// computer shows on screen now, through herdr-core's screen read with no line
// count, ever. A line count asks for history, and a history read scrolls a
// full-screen agent. If a read ever reports it scrolled ("stitched"), screen
// reads stop for this copy. Terminals on other machines are never read.
// Nothing is read at open, no other program is run, no file is read, nothing is
// kept after the panel closes, and there are no watchers and no repeating timers.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, spaces, panes, run, hc, theme, settings, props, closeOverlay, openOverlay, shared, setShared } from "herdr";
import { buildWorld, buildRows, buildGroups, pickable, splitAround, words, countLabel, ROW_H } from "./logic.js";
import { FIXTURE } from "./fixture.js";

const MOD = "spark-search";
const ASSETS = `mods/${MOD}`;
const HANDOFF = "spark-search.handoff"; // { q, at }: the typed search, dropdown -> window
const HANDOFF_MS = 15000;
const PAUSE_MS = 350; // the typing pause before text is searched
const MIN_TEXT = 3; // shorter searches look up text only on Enter
const MAX_TERMINALS = 40; // a bound on one search, far above a normal day
const FULL = { width: 940, height: 600 };
const STATUS_WORD = { working: "Working", blocked: "Waiting", done: "Done", idle: "Idle" };

const isHex = (x) => typeof x === "string" && /^#[0-9a-f]{6}$/i.test(x);
const tint = (color, alpha) => (isHex(color) ? color + alpha : color);
const two = (n) => String(n ?? "").padStart(2, "0");

function luminance(h) {
  if (!isHex(h)) return 0;
  const ch = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Every color, read from the live theme on each render, so day and night both work. */
function palette(t) {
  const hues = [t.hue1 ?? t.ansi4, t.hue2 ?? t.ansi1, t.hue3 ?? t.ansi3, t.hue4 ?? t.ansi2, t.hue5 ?? t.ansi5];
  const hue = (n) => hues[((((Number(n) || 1) - 1) % hues.length) + hues.length) % hues.length] ?? t.accent;
  return {
    bg: t.popover ?? t.background, field: t.background, chrome: t.chrome ?? t.background,
    fg: t.foreground, muted: t.muted, dim: t.dim, border: t.border, input: t.input ?? t.border,
    accent: t.accent, accentFg: t.accent_foreground ?? "#ffffff", hover: t.hover ?? tint(t.accent, "12"),
    selected: tint(t.accent, "1c"), mark: tint(t.ansi11 ?? t.ansi3 ?? t.accent, "66"), markRow: tint(t.ansi11 ?? t.ansi3 ?? t.accent, "1a"),
    hue, hueFg: (n) => (luminance(hue(n)) > 0.4 ? "#1f2329" : "#ffffff"),
    status: { working: t.ansi4 ?? t.accent, blocked: t.ansi3 ?? t.accent, done: t.ansi2 ?? t.accent, idle: t.dim },
  };
}

export default class Search extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.fx = FIXTURE; // null in the shipped mod; check variants draw a fixed state
    this.dropdown = (this.fx?.mode ?? p.mode) === "dropdown";
    this.at = this.fx?.at ?? 0;
    this.scroll = 0;
    this.scan = this.fx?.scan ?? null;
    this.scanId = 0;
    this.lineAt = {};
    this.pause = null;
    this.noScreen = false;
    this.closing = false;
    let start = this.fx?.q ?? "";
    let handed = false;
    if (!this.fx && !this.dropdown) {
      const h = shared(HANDOFF);
      if (h && typeof h.q === "string" && h.q.trim() && Date.now() - (Number(h.at) || 0) < HANDOFF_MS) {
        start = h.q;
        handed = true;
      }
    }
    this.q = start;
    this.input = InputState.new({ placeholder: "Search agents, projects, screen", value: start });
    this.input.on("change", (_e, cx) => this.typed(cx));
    this.input.on("submit", (_e, cx) => this.enter(cx));
    this.handle = cx.focus_handle();
    this.input.focus();
    // The keyboard can still be on its way from the header bar or the key press.
    cx.timer.after(600, () => {
      this.input.focus();
      if (handed) setShared(HANDOFF, null);
    });
    if (handed) this.startScan(cx);
  }

  close() {
    if (this.closing) return;
    this.closing = true;
    this.pause?.cancel();
    this.scanId++;
    const id = props()?.overlay;
    if (id) closeOverlay(id);
  }

  world() {
    const w = this.fx?.world;
    return w ? buildWorld(w.spaces, w.agents, w.panes) : buildWorld(spaces(), agents(), panes());
  }

  rows(world) {
    return buildRows({ world, query: this.q, scan: this.scan, minText: MIN_TEXT, dropdown: this.dropdown });
  }

  typed(cx) {
    const value = this.input.value();
    if (value === this.q) return;
    this.q = value;
    this.at = 0;
    this.scroll = 0;
    this.pause?.cancel();
    this.pause = null;
    const q = value.trim();
    if (!this.fx && q.length >= MIN_TEXT) {
      this.pause = cx.timer.after(PAUSE_MS, (cx) => {
        this.pause = null;
        this.startScan(cx);
      });
    }
    cx.notify();
  }

  /** Enter: go to the selected result; with nothing found by name yet, search text now. */
  enter(cx) {
    if (this.closing) return;
    const picks = this.rows(this.world()).filter(pickable);
    const sel = picks[Math.max(0, Math.min(this.at, picks.length - 1))];
    const q = this.q.trim();
    const searched = this.scan && this.scan.q.toLowerCase() === q.toLowerCase();
    if (q.length >= 2 && !searched && (!sel || sel.kind === "more")) {
      this.pause?.cancel();
      this.pause = null;
      this.startScan(cx);
      cx.notify();
      return;
    }
    this.go(sel);
  }

  go(row) {
    if (!row || this.closing) return;
    if (row.kind === "more") return this.showMore();
    this.close();
    if (row.kind === "project") run("space.select", { id: row.space.id });
    else this.jump(row.kind === "text" ? row.group.entry : row.entry);
  }

  jump(entry) {
    if (entry.isAgent) {
      run("agent.focus", { terminal: entry.terminal });
    } else {
      run("tab.select", { id: entry.tabId });
      if (entry.pane) run("pane.focus", { pane: entry.pane });
    }
  }

  /** The dropdown hands its search to the window through shared state. */
  showMore() {
    if (this.closing) return;
    setShared(HANDOFF, { q: this.q, at: Date.now() });
    this.close();
    openOverlay({ mod: MOD, kind: "dialog", width: FULL.width, height: FULL.height });
  }

  nextLine(group, step) {
    const n = group.lines.length;
    const key = group.entry.terminal;
    this.lineAt[key] = ((this.lineAt[key] ?? 0) + step + n) % n;
  }

  lineOf(group) {
    return group.lines[Math.min(this.lineAt[group.entry.terminal] ?? 0, group.lines.length - 1)];
  }

  // ---- looking up text

  startScan(cx) {
    const q = this.q.trim();
    if (this.fx || this.closing || q.length < 2) return;
    if (this.scan?.state === "running" && this.scan.q === q) return;
    const id = ++this.scanId;
    const targets = this.world().entries.filter((e) => e.local).slice(0, MAX_TERMINALS);
    const scan = { id, q, state: "running", total: targets.length, read: 0, groups: [], searched: countLabel(targets), problem: null };
    this.scan = scan;
    cx.spawn(async (cx) => {
      const screens = {};
      await Promise.all(targets.map(async (e) => {
        try {
          const text = await this.readScreen(e.terminal);
          if (text !== null) screens[e.terminal] = text;
        } catch {
          // One terminal that can't be read doesn't stop the rest.
        }
        scan.read++;
        if (this.scanId === id) cx.notify();
      }));
      if (this.scanId !== id) return;
      scan.groups = this.noScreen ? [] : buildGroups(targets, screens, q);
      if (this.noScreen) scan.problem = "On-screen text is off: a read reported that it scrolled a terminal";
      else if (targets.length && !Object.keys(screens).length) scan.problem = "No screen could be read just now";
      scan.state = "done";
      cx.notify();
    });
  }

  /** The visible screen only: no line count, so nothing is scrolled. */
  async readScreen(terminal) {
    if (this.noScreen) return null;
    const r = await hc(["read", terminal, "--json"]);
    if (r.code !== 0) return null;
    const d = JSON.parse(r.stdout);
    if (d?.how === "stitched") {
      this.noScreen = true;
      return null;
    }
    return typeof d?.text === "string" ? d.text : null;
  }

  // ---- drawing

  key(c, label) {
    return h_flex().flex_none().h(18).px(5).items_center().rounded(4).border_1().border_color(c.input).bg(c.field)
      .text_size(12).text_color(c.muted).child(label);
  }

  square(c, index) {
    return h_flex().flex_none().w(22).h(18).rounded(4).bg(c.hue(index)).items_center().justify_center()
      .text_size(12).font_semibold().text_color(c.hueFg(index)).child(two(index));
  }

  lead(c, entry) {
    const box = h_flex().w(18).flex_none().items_center().justify_center();
    if (!entry.isAgent) return box.text_size(12).text_color(c.dim).child(">_");
    const st = entry.status;
    if (!st || st === "idle") return box.child(div().size(8).rounded(4).border(1.5).border_color(c.dim));
    return box.child(div().size(8).rounded(4).bg(c.status[st] ?? c.dim));
  }

  statusWord(c, entry) {
    if (!entry.isAgent) return div().flex_none().text_size(12).text_color(c.dim).child("Shell");
    const st = entry.status ?? "idle";
    return div().flex_none().text_size(12).text_color(c.status[st] ?? c.dim).child(STATUS_WORD[st] ?? "Idle");
  }

  /** One line with the match marked and kept in view. */
  marked(c, text, q, strong) {
    const s = splitAround(text, q);
    return h_flex().min_w(0).text_size(13).text_color(c.fg)
      .when(Boolean(strong), (el) => el.font_semibold())
      .when(Boolean(s.pre), (el) => el.child(div().flex_none().whitespace_nowrap().child(s.pre)))
      .when(Boolean(s.hit), (el) => el.child(div().flex_none().whitespace_nowrap().rounded(3).bg(c.mark).child(s.hit)))
      .when(Boolean(s.post), (el) => el.child(div().flex_1().min_w(0).truncate().child(s.post)));
  }

  where(entry) {
    const tab = `tab ${two(entry.tabIndex)}`;
    const label = entry.label && entry.label !== entry.name ? `, labeled \u201c${entry.label}\u201d` : "";
    return `${entry.space.name} \u00b7 ${tab}${label}`;
  }

  row(c, r, on, q) {
    const H = ROW_H[r.kind];
    if (r.kind === "group") {
      return h_flex().h(H).flex_none().px(14).pt(8).gap(6).items_center().text_size(12).text_color(c.muted)
        .child(div().font_semibold().child(r.label))
        .when(typeof r.count === "number", (el) => el.child(div().text_color(c.dim).child(String(r.count))))
        .when(Boolean(r.note), (el) => el.child(div().flex_1()).child(div().flex_none().text_color(c.dim).child(r.note ?? "")));
    }
    if (r.kind === "note") {
      return h_flex().h(H).flex_none().pl(42).pr(14).items_center().text_size(12).text_color(c.dim)
        .child(div().flex_1().min_w(0).truncate().child(r.text));
    }
    if (r.kind === "busy") {
      return h_flex().h(H).flex_none().px(14).gap(10).items_center().text_size(13).text_color(c.muted)
        .child(h_flex().w(18).flex_none().items_center().justify_center()
          .child(svg(`${ASSETS}/spinner.svg`).size(14).flex_none().text_color(c.accent).spin(900)))
        .child(div().flex_1().min_w(0).truncate().child(`Looking at the screens of ${r.scan.searched}\u2026`))
        .child(div().flex_none().text_size(12).text_color(c.dim).child(`${Math.min(r.scan.read, r.scan.total)} of ${r.scan.total}`));
    }
    const id = r.kind === "project" ? `ss-p-${r.space.id}` : r.kind === "agent" ? `ss-a-${r.entry.terminal}`
      : r.kind === "text" ? `ss-t-${r.group.entry.terminal}` : "ss-more";
    let body = h_flex().id(id).flex_1().min_w(0).h(H - 4).mx(6).px(8).gap(10).items_center().rounded(8).cursor_pointer()
      .when(on, (el) => el.bg(c.selected))
      .hover((s) => s.bg(on ? c.selected : c.hover))
      .on_click(() => this.go(r));
    const enter = (what) => h_flex().flex_none().gap(6).items_center().text_size(12).text_color(c.accent)
      .child(this.key(c, "Enter")).child(what);
    if (r.kind === "more") {
      body = body.child(h_flex().w(18).flex_none().items_center().justify_center().child(svg(`${ASSETS}/search.svg`).size(14).text_color(c.accent)))
        .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(c.accent).child("Show more in the search window"))
        .when(on, (el) => el.child(enter("open")));
    } else if (r.kind === "project") {
      const n = r.space.tabs;
      body = body.child(this.square(c, r.space.index))
        .child(div().flex_1().min_w(0).child(this.marked(c, r.space.name, q, true)))
        .child(div().flex_none().text_size(12).text_color(c.dim).child(`${n} tab${n === 1 ? "" : "s"}`))
        .when(on, (el) => el.child(enter("go to project")));
    } else if (r.kind === "agent") {
      const e = r.entry;
      const extra = r.field === "program" ? ` \u00b7 ${e.programName}` : "";
      body = body.child(this.lead(c, e))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(this.marked(c, e.name, r.field === "name" ? q : "", true))
          .child(h_flex().min_w(0).gap(6).items_center()
            .child(this.square(c, e.space.index))
            .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(c.muted).child(this.where(e) + extra))))
        .child(this.statusWord(c, e))
        .when(on, (el) => el.child(enter(e.isAgent ? "go to agent" : "go to shell")));
    } else {
      const g = r.group;
      const e = g.entry;
      const line = this.lineOf(g);
      const more = g.count - 1;
      body = body.child(h_flex().w(18).flex_none().items_center().justify_center().child(svg(`${ASSETS}/lines.svg`).size(14).text_color(c.dim)))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(this.marked(c, line.text, q, false))
          .child(h_flex().min_w(0).gap(6).items_center().text_size(12).text_color(c.muted)
            .child(this.square(c, e.space.index))
            .child(div().flex_1().min_w(0).truncate().child(`${e.space.name} / ${e.name}`))
            .child(this.statusWord(c, e))
            .child(div().flex_none().text_color(c.dim).child("\u00b7"))
            .child(div().flex_none().child("on screen now"))))
        .when(more > 0, (el) => el.child(h_flex().flex_none().h(18).px(7).items_center().rounded(9).bg(c.hover)
          .text_size(12).text_color(c.muted).child(`+${more} more`)));
    }
    return h_flex().h(H).flex_none().items_center().child(body);
  }

  /** The result list: fixed row heights, and a strip that only scrolls far enough to keep the selection in view. */
  list(c, rows, picks, sel, q, cap, fill) {
    const tops = [];
    let y = 0;
    rows.forEach((r) => {
      tops.push(y);
      y += ROW_H[r.kind];
    });
    const total = y;
    const height = fill ? Math.max(120, this.listHeight ?? cap) : Math.min(cap, total);
    const fixed = total > height;
    const maxScroll = Math.max(0, total - height);
    this.scroll = Math.max(0, Math.min(this.scroll, maxScroll));
    const si = sel ? rows.indexOf(sel) : -1;
    if (si >= 0) {
      const h = ROW_H[sel.kind];
      if (picks[0] === sel) this.scroll = 0;
      else if (tops[si] < this.scroll) this.scroll = tops[si];
      if (tops[si] + h > this.scroll + height) this.scroll = tops[si] + h - height;
    }
    const place = (el, i) =>
      fixed ? el.absolute().left(0).right(0).top(tops[i] - this.scroll).bottom(height - (tops[i] + ROW_H[rows[i].kind] - this.scroll)) : el;
    const visible = (i) => !fixed || (tops[i] + ROW_H[rows[i].kind] > this.scroll && tops[i] < this.scroll + height);
    const box = v_flex().id(this.dropdown ? "ss-list-drop" : "ss-list").min_h(0)
      .when(fill, (el) => el.flex_1().on_size_change((size, cx) => {
        const h = size.height / (Number(settings()?.zoom) || 1);
        if (Math.abs(h - (this.listHeight ?? 0)) < 1) return;
        this.listHeight = h;
        cx.notify();
      }))
      .when(!fill, (el) => el.h(height).flex_none())
      .when(fixed, (el) =>
        el.overflow_hidden().on_scroll_wheel((e, cx) => {
          this.scroll = Math.max(0, Math.min(this.scroll - e.delta.y, maxScroll));
          // The selection follows the wheel, so the next frame doesn't scroll back to it.
          const top = (k) => tops[rows.indexOf(picks[k])];
          while (this.at < picks.length - 1 && top(this.at) < this.scroll) this.at++;
          while (this.at > 0 && top(this.at) + ROW_H[picks[this.at].kind] > this.scroll + height) this.at--;
          cx.notify();
        }));
    return box.children(rows.map((r, i) => (visible(i) ? place(this.row(c, r, r === sel, q), i) : null)).filter(Boolean));
  }

  hints(c, sel) {
    const go = !sel ? (this.q.trim().length >= 2 ? "search on-screen text" : "go") : sel.kind === "more" ? "open the search window" : sel.kind === "project" ? "go to that project" : "go to that agent";
    const hint = (keys, what) => h_flex().flex_none().gap(5).items_center().children(keys.map((k) => this.key(c, k))).child(what);
    return [hint(["\u2191", "\u2193"], "move"), hint(["Enter"], go), hint(["Esc"], "close")];
  }

  footNote() {
    if (this.scan?.state === "done" && this.scan.q.toLowerCase() === this.q.trim().toLowerCase()) {
      return this.scan.problem ?? `Screens searched: ${this.scan.searched}`;
    }
    return "Names match as you type \u00b7 on-screen text after a short pause";
  }

  contextLine(c, line, hit, q) {
    const row = h_flex().items_start().gap(10).px(12).py(5).text_size(13);
    if (!hit) return row.text_color(c.muted).child(div().flex_1().min_w(0).child(line.text));
    return row.bg(c.markRow).text_color(c.fg)
      .child(h_flex().flex_1().min_w(0).flex_wrap().gap_x(4)
        .children(words(line.text, q).map((w) => (w.hit ? div().rounded(3).bg(c.mark).child(w.t) : div().child(w.t)))));
  }

  preview(c, sel, q, world) {
    const box = v_flex().flex_1().min_w(0).min_h(0).p(16).gap(10).overflow_hidden();
    const title = (text) => div().text_size(12).font_semibold().text_color(c.muted).child(text);
    const small = (text) => div().text_size(12).text_color(c.muted).child(text);
    const button = (id, label) => h_flex().id(id).flex_none().h(30).px(12).gap(8).items_center().rounded(7).bg(c.accent)
      .text_size(13).font_semibold().text_color(c.accentFg).cursor_pointer().on_click(() => this.go(sel))
      .child(label).child(this.key(c, "Enter"));
    if (!sel || sel.kind === "more") {
      return box
        .child(title("What this searches"))
        .child(div().text_size(13).text_color(c.fg).child("Project names, agent names, the tab labels you typed and program names: these match as you type."))
        .child(div().text_size(13).text_color(c.fg).child("Words on screen: after a short pause, or Enter, it looks at what each open terminal on this computer is showing right now."))
        .child(small("It only reads what is visible. It never reads a terminal\u2019s history, never types into an agent and never scrolls one."));
    }
    if (sel.kind === "project") {
      const s = sel.space;
      const inside = world.entries.filter((e) => e.space.id === s.id).slice(0, 8);
      return box
        .child(title("Project"))
        .child(h_flex().gap(8).items_center().min_w(0).child(this.square(c, s.index))
          .child(div().flex_1().min_w(0).truncate().text_size(15).font_semibold().text_color(c.fg).child(s.name)))
        .child(small(`${s.tabs} tab${s.tabs === 1 ? "" : "s"}`))
        .child(v_flex().gap(4).children(inside.map((e) => h_flex().gap(8).items_center().min_w(0)
          .child(this.lead(c, e))
          .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(c.fg).child(e.name))
          .child(this.statusWord(c, e)))))
        .child(h_flex().child(button("ss-go-project", "Go to this project")));
    }
    if (sel.kind === "agent") {
      const e = sel.entry;
      return box
        .child(title(e.isAgent ? "Agent" : "Shell"))
        .child(div().text_size(15).font_semibold().text_color(c.fg).child(e.name))
        .child(h_flex().gap(6).items_center().min_w(0).child(this.square(c, e.space.index))
          .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(c.muted).child(this.where(e))))
        .child(h_flex().gap(6).items_center().child(this.lead(c, e)).child(this.statusWord(c, e))
          .child(div().text_size(12).text_color(c.dim).child(`\u00b7 ${e.programName}`)))
        .child(h_flex().child(button("ss-go-agent", e.isAgent ? "Go to this agent" : "Go to this shell")));
    }
    const g = sel.group;
    const e = g.entry;
    const at = Math.min(this.lineAt[e.terminal] ?? 0, g.lines.length - 1);
    const line = g.lines[at];
    const when = "on screen now";
    const count = g.count > g.lines.length ? `hit ${at + 1} of ${g.count}, newest ${g.lines.length} shown` : `hit ${at + 1} of ${g.lines.length}`;
    return box
      .child(title("Lines around this hit"))
      .child(h_flex().gap(6).items_center().min_w(0).child(this.square(c, e.space.index))
        .child(div().flex_none().text_size(13).text_color(c.muted).child(`${e.space.name} /`))
        .child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().text_color(c.fg).child(e.name)))
      .child(h_flex().gap(6).items_center().min_w(0).child(this.statusWord(c, e))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(c.muted).child(`\u00b7 ${when} \u00b7 ${count}`)))
      .child(v_flex().id("ss-context").flex_none().max_h(300).overflow_y_scroll().rounded(8).border_1().border_color(c.border).bg(c.field).py(4)
        .children([
          ...line.before.map((l) => this.contextLine(c, l, false, q)),
          this.contextLine(c, line, true, q),
          ...line.after.map((l) => this.contextLine(c, l, false, q)),
        ]))
      .child(h_flex().gap(14).items_center()
        .child(button("ss-go-hit", e.isAgent ? "Go to this agent" : "Go to this shell"))
        .when(g.lines.length > 1, (el) => el.child(div().id("ss-next-line").text_size(13).font_semibold().text_color(c.accent).cursor_pointer()
          .on_click((_e, cx) => {
            this.nextLine(g, 1);
            this.input.focus();
            cx.notify();
          })
          .child("Next line in this agent \u203a"))))
      .child(small("This line is on that terminal\u2019s screen right now."));
  }

  render() {
    const c = palette(theme());
    const world = this.world();
    const rows = this.rows(world);
    const picks = rows.filter(pickable);
    this.at = Math.max(0, Math.min(this.at, picks.length - 1));
    const sel = picks[this.at] ?? null;
    const q = this.q.trim();
    const onKey = (e, cx) => {
      const k = e.key;
      if (k === "escape") {
        this.close();
      } else if (k === "down") {
        if (picks.length) this.at = (this.at + 1) % picks.length;
      } else if (k === "up") {
        if (picks.length) this.at = (this.at + picks.length - 1) % picks.length;
      } else if (k === "tab" && sel?.kind === "text") {
        this.nextLine(sel.group, e.modifiers?.shift ? -1 : 1);
      } else {
        return;
      }
      cx.stop_propagation();
      cx.notify();
    };
    const root = v_flex().id("spark-search").track_focus(this.handle).bg(c.bg).text_size(13).text_color(c.fg).on_key_down(onKey);

    if (this.dropdown) {
      // FROZEN by the team lead (2026-11-12): the header's search bar is 320 x 34 and opens this
      // popup with its top-left on the bar's top-left. This row repeats the bar's measures with
      // no inset (34 high, 11 px in, 15 px icon, 9 px gap, 13 px text, no border of its own), so
      // the icon and text stay where they sit in the bar and the panel grows to the right.
      return root.w_full().min_h(0)
        .child(h_flex().h(34).flex_none().px(11).gap(9).items_center().border_b(1).border_color(c.border)
          .child(svg(`${ASSETS}/search.svg`).size(15).flex_none().text_color(c.accent))
          .child(Input.new(this.input).flex_1().h_full().text_size(13).text_color(c.fg))
          .child(this.key(c, "Esc")))
        .child(this.list(c, rows, picks, sel, q, 400, false))
        .child(h_flex().h(32).flex_none().px(14).gap(14).items_center().border_t(1).border_color(c.border).text_size(12).text_color(c.muted)
          .children(this.hints(c, sel)));
    }
    return root.size_full()
      .child(h_flex().h(52).flex_none().px(16).gap(10).items_center().border_b(1).border_color(c.border)
        .child(svg(`${ASSETS}/search.svg`).size(18).flex_none().text_color(c.accent))
        .child(Input.new(this.input).flex_1().h_full().text_size(15).text_color(c.fg))
        .child(this.key(c, "Esc")))
      .child(div().flex().flex_row().flex_1().min_h(0)
        .child(v_flex().w(520).flex_none().min_h(0).border_r(1).border_color(c.border)
          .child(this.list(c, rows, picks, sel, q, FULL.height - 52 - 36, true)))
        .child(this.preview(c, sel, q, world)))
      .child(h_flex().h(36).flex_none().px(16).gap(14).items_center().border_t(1).border_color(c.border).bg(c.chrome).text_size(12).text_color(c.muted)
        .children(this.hints(c, sel))
        .child(div().flex_1())
        .child(div().flex_none().text_color(c.dim).child(this.footNote())));
  }
}
