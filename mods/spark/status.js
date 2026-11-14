// The status line. It shows a quiet "Done" badge while an agent that
// finished while you were away is still unseen, the latest activity, and a
// way into the activity log. This copy (the layout has one) also notices
// agent changes: look() compares agents() with the last look and queues what
// changed; the 800 ms timer writes the queue into the shared log. look() runs
// from that same timer, so it works while the window is minimized and nothing
// is drawn, and from render(), so a drawn bar reacts at once; both share one
// "last seen" state, so a change is noticed exactly once. Render itself still
// has no side effects beyond queueing. It runs no programs.
// Mod keys (nextCommand): spark.activity, spark.end (the focused pane).

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { agents, panes, spaces, shared, setShared, run, nextCommand, keys } from "herdr";
import { P, M, REG, icon, label, figure, two, stopPress } from "./kit.js";
import { sessionName } from "./names.js";
import { openActivity, record, readLog, doneToday, hm, TAG, tone } from "./activity.js";
import { openEnd, endName } from "./pane.js";
import { ENDING_KEY } from "./end.js";
import { Vivid } from "./vivid.js";
import { activityLine, activityName } from "./logic.js";

function snapshot(list) {
  const s = {};
  for (const a of list ?? []) {
    // name: the session name, else the program with its tab number. tab: a number, never a tab label.
    s[a.address] = { status: a.status, name: activityName(sessionName(a), a.program?.name ?? a.app, a.tab_index),
      tab: `Tab ${two(a.tab_index)}`, space: a.space_name ?? "", spaceId: a.space ?? null };
  }
  return s;
}

function detect(prev, next) {
  if (!prev) return [];
  const out = [];
  for (const [address, n] of Object.entries(next)) {
    const p = prev[address];
    const ev = { address, ...n };
    if (!p) out.push({ kind: "started", ...ev });
    else if (n.status === "blocked" && p.status !== "blocked") out.push({ kind: "waiting", ...ev });
    else if (p.status === "working" && (n.status === "done" || n.status === "idle")) out.push({ kind: n.status === "done" ? "away" : "done", ...ev });
  }
  for (const [address, p] of Object.entries(prev)) if (!next[address]) out.push({ kind: "gone", address, ...p });
  return out;
}

/** A new activity line: the agent's name once, and its space only when it is not the one on screen. */
function line(ev, ending) {
  const here = spaces().find((s) => s.active)?.id;
  const elsewhere = Boolean(ev.spaceId) && ev.spaceId !== here;
  const kind = ev.kind === "gone" ? (Date.now() - (ending[ev.address] ?? 0) < 30000 ? "ended" : "exited") : ev.kind;
  return activityLine(kind, ev.name, ev.space, elsewhere);
}

export const NOTICE_KEY = "spark.notice"; // { address, text, at }: the latest unseen "Done"

export default class Status {
  init(_p, cx) {
    this.prev = null; // the last look: what each agent was doing, and what it is called
    this.seen = null; // the same look as one short string, for the tick's cheap comparison
    this.queue = [];
    if (_p?.features) { // Vivid only: nothing below runs for a layout without this prop
      this.vivid = new Vivid();
      this.vivid.init(cx);
    }
    cx.timer.every(800, (cx) => { cx.phase(); this.publish(cx); }); // stale build: throws, so the engine stops it
    // Only when a key is bound to spark.activity or spark.end: an unbound loop waits
    // forever, and each reload would leave one more such task behind.
    const bound = (keys() ?? []).some((k) => /^spark[.:]/.test(String(k?.action ?? "")));
    if (bound) cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        cx.notify(); // the documented use after an await; throws once this build is gone, before acting
        if (c === "activity") openActivity();
        if (c === "end") {
          const p = panes().find((x) => x.focused);
          if (p) openEnd(p.pane, p.terminal, endName(p));
        }
      }
    });
  }

  /**
   * Looks at the agents and queues what changed since the last look. From the tick it compares one
   * short string (address:status for each agent) and does nothing more unless that changed; from
   * render it always takes a full look, which also keeps the agents' names fresh, as before.
   */
  look(list, full) {
    const seen = (list ?? []).map((a) => `${a.address}:${a.status}`).join("|");
    if (!full && seen === this.seen) return;
    this.seen = seen;
    const snap = snapshot(list);
    this.queue.push(...detect(this.prev, snap));
    this.prev = snap;
  }

  publish(cx) {
    this.look(agents(), false); // the window may be minimized: nothing is drawn then, but this tick still runs
    this.vivid?.tick(cx);
    if (!this.queue.length) return;
    const ending = shared(ENDING_KEY) ?? {};
    for (const ev of this.queue.splice(0)) {
      const text = line(ev, ending);
      record({ kind: ev.kind === "gone" ? "ended" : ev.kind, text, address: ev.address });
      if (ev.kind === "away") setShared(NOTICE_KEY, { address: ev.address, text, at: Date.now() });
      if (ev.kind === "waiting") this.vivid?.onWaiting(ev, cx);
      if (ev.kind === "started" && ev.status === "blocked" && this.vivid?.bornBlockedIsNews()) {
        record({ kind: "waiting", text: line({ ...ev, kind: "waiting" }, ending), address: ev.address });
        this.vivid.onWaiting(ev, cx);
      }
    }
    cx.notify();
  }

  render() {
    const c = P();
    const list = agents();
    this.look(list, true);

    const log = readLog();
    const latest = log[log.length - 1];
    const notice = shared(NOTICE_KEY);
    // The badge stays only while that agent is still unseen ("done" turns "idle" once looked at).
    const showNotice = notice && list.some((a) => a.address === notice.address && a.status === "done");

    const badge = showNotice
      ? h_flex().id("notice").h(20).flex_none().pl(8).pr(3).gap(6).items_center().rounded(10).cursor_pointer()
        .bg(c.bg).border(1).border_color(c.border).hover((s) => s.bg(c.hover))
        .tooltip("Go to it")
        .on_click(() => { run("agent.focus", { terminal: notice.address }); setShared(NOTICE_KEY, null); })
        .child(div().w(6).h(6).rounded(6).bg(c.status.done))
        .child(label("Finished while away", c.status.done, true))
        .child(div().id("notice-x").w(16).h(16).rounded(8).flex().items_center().justify_center()
          .hover((s) => s.bg(c.selected)).tooltip("Dismiss")
          .on_mouse_down("left", stopPress)
          .on_click((_e, cx) => { cx.stop_propagation(); setShared(NOTICE_KEY, null); })
          .child(icon("close", 10, c.muted)))
      : null;

    const waiting = list.filter((a) => a.status === "blocked").length;
    const counter = (id, text, n, act) => h_flex().id(id).h_full().flex_none().px(12).gap(8).items_center().border_l(1).border_color(c.border)
      .when(Boolean(act), (el) => el.cursor_pointer().hover((s) => s.bg(c.hover)).on_click(() => act()))
      .child(label(text, c.dim))
      .child(figure(two(n), c.fg));

    return h_flex().id("status").size_full().bg(c.chrome).border_t(1).border_color(c.border).items_center()
      .when(Boolean(this.vivid), (el) => el.on_size_change((size, cx) => this.vivid.sized(size, cx)))
      .child(h_flex().id("strip-label").h_full().flex_none().pl(14).pr(12).gap(7).items_center().border_r(1).border_color(c.border)
        .cursor_pointer().hover((s) => s.bg(c.hover)).tooltip("Activity log").on_click(() => openActivity())
        .child(icon("activity", 13, c.muted))
        .child(label("Activity", c.muted)))
      .child(h_flex().id("latest").flex_1().min_w(0).h_full().px(12).gap(9).items_center().cursor_pointer()
        .hover((s) => s.bg(c.hover)).tooltip("Activity log")
        .on_click(() => openActivity())
        .when(Boolean(badge), (el) => el.child(badge))
        .when(Boolean(latest), (el) => el
          .child(label(hm(latest.at), c.dim).flex_none())
          .child(label(TAG[latest.kind] ?? latest.kind, tone(latest.kind), true).flex_none())
          .child(div().flex_1().min_w(0).truncate().text_size(M).font_weight(REG).text_color(c.muted).child(latest.text)))
        .when(!latest, (el) => el.child(div().text_size(M).font_weight(REG).text_color(c.dim).child("Ready"))))
      .when(waiting > 0, (el) => el.child(h_flex().h_full().flex_none().px(12).gap(6).items_center().border_l(1).border_color(c.border)
        .child(div().w(6).h(6).rounded(6).bg(c.status.blocked).loop("opacity", { from: 0.45, to: 1, period: 1800 }))
        .child(label(`${two(waiting)} waiting`, c.status.blocked, true))))
      .child(counter("done-today", "Sessions done today", doneToday(log)))
      .child(counter("activity-btn", "Activity", log.length, () => openActivity()));
  }
}
