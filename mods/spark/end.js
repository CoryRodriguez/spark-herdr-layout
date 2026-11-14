// End session: a confirmation, opened either for one pane (from its header or
// the spark.end key) with props { pane, terminal, name }, or for one tab (the
// "x" on a tab) with props { tab, name }. Enter ends it, Esc keeps it. It only
// ever closes what it was opened for, and does nothing if that is gone or, for a
// pane, now shows another terminal.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { props, panes, spaces, run, shared, setShared, closeOverlay } from "herdr";
import { P, S, M, L, REG, SEMI } from "./kit.js";

export const ENDING_KEY = "spark.ending"; // { address: ms }, so the log says "ended" not "exited"

export default class EndSession {
  init(_p, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  /** The pane this was opened for, if it is still there with the same terminal. */
  target() {
    const p = props() ?? {};
    const pane = panes().find((x) => x.pane === p.pane);
    if (!pane || (p.terminal && pane.terminal !== p.terminal)) return null;
    return pane;
  }

  /** The tab this was opened for, if it is still there. */
  targetTab() {
    const id = props()?.tab;
    if (!id) return null;
    for (const s of spaces()) {
      const t = (s.tabs ?? []).find((x) => x.id === id);
      if (t) return t;
    }
    return null;
  }

  close() { closeOverlay(props()?.overlay); }

  end() {
    const now = Date.now();
    if (props()?.tab) {
      const tab = this.targetTab();
      if (tab) {
        const ending = { ...(shared(ENDING_KEY) ?? {}) };
        let any = false;
        for (const p of panes()) if (p.tab === tab.id && p.terminal) { ending[p.terminal] = now; any = true; }
        if (any) setShared(ENDING_KEY, ending);
        run("tab.close", { id: tab.id });
      }
      this.close();
      return;
    }
    const pane = this.target();
    if (pane) {
      if (pane.terminal) setShared(ENDING_KEY, { ...(shared(ENDING_KEY) ?? {}), [pane.terminal]: now });
      run("pane.close", { pane: pane.pane });
    }
    this.close();
  }

  render() {
    const c = P();
    const p = props() ?? {};
    const forTab = Boolean(p.tab);
    const there = forTab ? this.targetTab() : this.target();
    const term = Boolean(p.terminal);
    const title = forTab ? "Close this tab?" : term ? "End this session?" : "Close this panel?";
    const body = !there
      ? (forTab ? "This tab is already closed." : "This pane is already closed.")
      : forTab
        ? `${p.name ?? "This tab"} will close and everything running in it will stop.`
        : term
          ? `${p.name ?? "This session"} will stop and its pane will close. Anything still running in it ends too.`
          : `${p.name ?? "This panel"} will close. You can open it again later.`;
    const yes = forTab ? "Close tab" : term ? "End session" : "Close panel";

    const button = (id, text, primary, act) => h_flex().id(id).h(32).px(14).items_center().rounded(6).cursor_pointer()
      .bg(primary ? c.danger : c.raised).border(1).border_color(primary ? c.danger : c.border)
      .hover((s) => s.opacity(0.88))
      .on_click(() => act())
      .child(div().text_size(M).font_weight(primary ? SEMI : REG).text_color(primary ? "#ffffff" : c.fg).child(text));

    return v_flex().id("end").size_full().p(20).gap(10).bg(c.popover)
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") this.close();
        else if (e.key === "enter") this.end();
        else return;
        cx.stop_propagation();
      })
      .child(div().text_size(L).font_weight(SEMI).text_color(c.fg).child(title))
      .child(div().flex_1().text_size(M).line_height(1.5).text_color(c.muted).child(body))
      .child(h_flex().w_full().gap(8).items_center()
        .child(div().flex_1().text_size(S).text_color(c.dim).child("Enter to confirm · Esc to cancel"))
        .child(button("keep", there ? "Cancel" : "Close", false, () => this.close()))
        .when(Boolean(there), (el) => el.child(button("confirm", yes, true, () => this.end()))));
  }
}
