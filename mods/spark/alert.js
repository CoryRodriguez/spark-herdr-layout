// The "waiting for you" banner: a small window the status copy opens when an
// agent becomes blocked, and closes when it no longer is.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { props, run, closeOverlay, setShared } from "herdr";
import { P, S, M, REG, SEMI, label, icon, tint, stopPress } from "./kit.js";
import { ALERT_DISMISSED_KEY } from "./vivid.js";

export default class Alert {
  render() {
    const c = P();
    const p = props() ?? {};
    const amber = c.status.blocked;
    const close = () => {
      setShared(ALERT_DISMISSED_KEY, { id: p.overlay });
      closeOverlay(p.overlay);
    };
    return h_flex().id("alert").size_full().bg(c.bg).rounded(12).border(1).border_color(tint(amber, "80")).overflow_hidden().shadow_lg()
      .child(div().w(5).h_full().flex_none().bg(amber))
      .child(div().ml(14).w(34).h(34).flex_none().rounded(17).flex().items_center().justify_center().bg(tint(amber, "26"))
        .child(div().w(10).h(10).rounded(10).bg(amber).loop("opacity", { from: 0.4, to: 1, period: 1600 })))
      .child(v_flex().flex_1().min_w(0).px(12).gap(3)
        .child(h_flex().gap(8).items_center().child(label("Waiting for you", amber, true)).child(label(p.when ?? "", c.dim)))
        .child(div().truncate().text_size(M).font_weight(SEMI).text_color(c.fg).child(p.title ?? `${p.name ?? "An agent"} is waiting for you`))
        .child(div().truncate().text_size(S).font_weight(REG).text_color(c.muted).child(p.detail ?? "")))
      .child(div().id("alert-open").flex_none().h(30).px(14).mr(6).flex().items_center().rounded(8).cursor_pointer()
        .bg(c.solid).hover((s) => s.opacity(0.88)).on_mouse_down("left", stopPress)
        .on_click(() => { if (p.address) run("agent.focus", { terminal: p.address }); close(); })
        .child(div().text_size(M).font_weight(SEMI).text_color(c.solidFg).child("Open")))
      .child(div().id("alert-x").flex_none().w(26).h(26).mr(10).rounded(13).flex().items_center().justify_center().cursor_pointer()
        .hover((s) => s.bg(c.hover)).tooltip("Dismiss").on_mouse_down("left", stopPress).on_click(() => close())
        .child(icon("close", 11, c.muted)));
  }
}
