// The activity log: what agents did, newest first, in a window that stays
// until closed. Entries live in shared state (the last 80). Also the small
// helpers the sidebar digest and the status strip use to describe entries.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { props, shared, setShared, closeOverlay, openOverlay } from "herdr";
import { P, MOD, M, REG, SEMI, icon, label, two, stopPress } from "./kit.js";
import { clock12, clockSeconds12, repeatsRecent } from "./logic.js";

export const LOG_KEY = "spark.log";
const KEEP = 80;

/** Adds a line to the log. The same line for the same agent within a few seconds is an echo and is not added again. */
export function record(entry) {
  const log = Array.isArray(shared(LOG_KEY)) ? shared(LOG_KEY) : [];
  const now = Date.now();
  if (repeatsRecent(log, entry, now)) return false;
  setShared(LOG_KEY, [...log, { at: now, ...entry }].slice(-KEEP));
  return true;
}

/** The log, keeping only well-formed entries: a bad value in shared state must never break a render. */
export function readLog() {
  const log = shared(LOG_KEY);
  if (!Array.isArray(log)) return [];
  return log.filter((e) => e && typeof e === "object" && typeof e.at === "number" && isFinite(e.at) && typeof e.text === "string" && typeof e.kind === "string");
}

export function openActivity() {
  openOverlay({ mod: MOD, kind: "window", key: "spark-activity", width: 480, height: 420, props: { role: "activity" } });
}

export const TAG = { started: "Started", waiting: "Waiting", away: "Finished", done: "Finished", ended: "Ended" };
export function tone(kind) {
  const c = P();
  return { started: c.dim, waiting: c.status.blocked, away: c.status.done, done: c.status.done, ended: c.dim }[kind] ?? c.dim;
}

/** The newest entry worth surfacing: a wait or a finish beats a start or an end. */
export function notable(log) {
  for (let i = log.length - 1; i >= 0; i--) if (["waiting", "away", "done"].includes(log[i].kind)) return log[i];
  return log[log.length - 1] ?? null;
}

/** Finished sessions since local midnight. */
export function doneToday(log) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return log.filter((e) => (e.kind === "done" || e.kind === "away") && e.at >= d.getTime()).length;
}

const time = clockSeconds12;
export const hm = clock12;

export default class Activity {
  render() {
    const c = P();
    const log = [...readLog()].reverse();
    const close = () => closeOverlay(props()?.overlay);

    const btn = (id, ic, text, tip, act) => h_flex().id(id).h(24).px(text ? 8 : 4).gap(6).items_center().rounded(6).cursor_pointer()
      .hover((s) => s.bg(c.hover)).tooltip(tip)
      .on_mouse_down("left", stopPress).on_click(() => act())
      .when(Boolean(ic), (el) => el.child(icon(ic, 13, c.muted)))
      .when(Boolean(text), (el) => el.child(label(text, c.muted)));

    const row = (e, i) => h_flex().id(`act-${i}`).w_full().px(16).py(9).gap(12).items_start().border_b(1).border_color(c.border)
      .child(div().mt(2).w(2).h(30).rounded(1).flex_none().bg(tone(e.kind)))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(h_flex().gap(8).items_center()
          .child(label(time(e.at), c.dim))
          .child(label(TAG[e.kind] ?? e.kind, tone(e.kind), true)))
        .child(div().text_size(M).font_weight(REG).line_height(1.45).text_color(c.fg).child(e.text)));

    return v_flex().id("activity").size_full().bg(c.popover)
      .child(h_flex().w_full().h(44).flex_none().pl(16).pr(8).gap(8).items_center().border_b(1).border_color(c.border)
        .child(icon("activity", 14, c.muted))
        .child(div().text_size(M).font_weight(SEMI).text_color(c.fg).child("Activity log"))
        .child(label(`${two(log.length)} ${log.length === 1 ? "entry" : "entries"}`, c.dim))
        .child(div().flex_1())
        .when(log.length > 0, (el) => el.child(btn("act-clear", null, "Clear", "Clear the log", () => setShared(LOG_KEY, []))))
        .child(btn("act-close", "close", null, "Close", close)))
      .child(v_flex().id("act-list").w_full().flex_1().overflow_y_scrollbar()
        .children(log.map(row))
        .when(log.length === 0, (el) => el.child(div().p(16).text_size(M).text_color(c.dim)
          .child("Nothing yet. Agents starting, waiting and finishing show up here."))));
  }
}
