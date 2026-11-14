// A pane's header: a focus dot and a small "Session" / "Terminal" label, the
// program icon, name and folder, a status pill, then split right, split down,
// zoom and End session (which asks first). Click focuses the pane;
// right-click opens Herdr's pane menu. Narrow panes drop the label first.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, home, openOverlay } from "herdr";
import { P, MOD, M, REG, SEMI, icon, label, pill, programIcon, displayName, unzoom, menu, onRight, stopPress, withKey } from "./kit.js";
import { paneName } from "./names.js";

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  if (cwd === h) return "~";
  return cwd.startsWith(h) ? "~" + cwd.slice(h.length) : cwd;
}

export const endName = (p) => paneName(p) ?? displayName(p);

export function openEnd(pane, terminal, name) {
  openOverlay({ mod: MOD, kind: "dialog", modal: true, width: 420, height: 196,
    props: { role: "end", pane, terminal, name } });
}

export default class PaneHeader {
  init() { this.width = 0; }

  render() {
    const c = P();
    const p = panes().find((x) => x.pane === props()?.pane);
    if (!p) return div();
    const pane = p.pane;
    const st = p.status;
    const lit = p.focused;
    const session = paneName(p);
    const program = displayName(p);
    const where = [folder(p.cwd), p.branch].filter(Boolean).join("  ·  ");
    const kind = p.mod ? "Panel" : p.program?.agent || st ? "Session" : "Terminal";
    const roomy = !this.width || unzoom(this.width) > 470;

    const ctl = (id, ic, tip, act) => div().id(id).w(24).h(24).rounded(6).flex().items_center().justify_center().cursor_pointer()
      .hover((s) => s.bg(c.hover)).tooltip(tip)
      .on_mouse_down("left", stopPress)
      .on_click((_e, cx) => { cx.stop_propagation(); act(); })
      .child(icon(ic, 14, c.dim));

    const split = panes().filter((x) => x.tab === p.tab).length > 1;

    const about = roomy ? (session && session !== program ? `${program}  \u00b7  ${where}` : where) : "";

    return h_flex().id(`head-${pane}`).size_full().pl(12).pr(6).gap(8).items_center()
      .bg(lit ? c.bg : c.chrome).border_b(1).border_color(c.border)
      .on_size_change((size, cx) => { if (Math.abs(size.width - this.width) > 1) { this.width = size.width; cx.notify(); } })
      .on_click(() => run("pane.focus", { pane }))
      .on_mouse_down("right", onRight(() => menu("pane", { pane, terminal: p.terminal })))
      .child(div().w(6).h(6).rounded(6).flex_none().bg(lit ? c.accent : c.border))
      .when(roomy, (el) => el.child(div().flex_none().pr(8).border_r(1).border_color(c.border).child(label(kind, c.dim))))
      .child(programIcon(p.program, 14, lit ? c.fg : c.muted))
      .child(div().flex_none().max_w(roomy ? 240 : 150).truncate().text_size(M).font_weight(SEMI).text_color(lit ? c.fg : c.muted)
        .child(session ?? program))
      .child(div().flex_1().min_w(0).truncate().text_size(M).font_weight(REG).text_color(c.dim).child(about))
      .when(Boolean(st), (el) => el.child(pill(st)))
      .child(div().w(1).h(14).mx(2).flex_none().bg(c.border))
      .child(ctl(`sr-${pane}`, "split-right", withKey("Split right", "pane.split:right"), () => run("pane.split", { direction: "right", pane })))
      .child(ctl(`sd-${pane}`, "split-down", withKey("Split down", "pane.split:down"), () => run("pane.split", { direction: "down", pane })))
      .when(p.zoomed || split, (el) => el.child(
        ctl(`z-${pane}`, p.zoomed ? "unzoom" : "zoom", withKey(p.zoomed ? "Restore" : "Zoom", "pane.zoom"), () => run("pane.zoom", { pane }))))
      .child(ctl(`end-${pane}`, "power", p.terminal ? "End session" : "Close panel", () => openEnd(pane, p.terminal, endName(p))));
  }
}
