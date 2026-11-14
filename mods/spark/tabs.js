// The tab row, Chrome style: a light gray strip holding the shown space's tabs.
// The selected tab is a white raised tab with rounded top corners and a stripe in
// its identity color; it joins the pane below. The others are flat, with a thin
// underline in their color and a hairline between neighbors. Each tab shows its
// two-digit number in its color, its name (names.js, rule N1), a status dot when
// not idle, and a close "x" (which asks first). Right-click for Herdr's tab menu.
// After the last tab a "+" ("+ Agent" with the layout's plus_labels switch) opens
// Herdr's new-agent menu. On the right: put-away
// (settled) tabs to bring back, then the Files and Changes panels. Names shorten
// as the row narrows so every tab stays visible; when it gets tight, only the
// selected tab keeps its "x".
//
// Dragging a tab, as in a browser (rowdrag.js, shared with the header's space
// tabs): once the pointer has moved a few pixels with the button down, a lifted
// copy of the tab follows the pointer inside the row, and each neighbor it passes
// glides into the slot it left, so the row always shows where the tab will land.
// On release the copy glides into its slot and the real order changes (tab.move).
// Leaving the strip cancels and everything glides back. All movement is native
// (.transition); nothing here runs on a timer, and the row redraws on pointer
// movement only while a drag is under way.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, run, shared, openOverlay } from "herdr";
import { P, MOD, S, M, REG, SEMI, tint, icon, label, two, dot, tabLabel, unzoom, menu, newMenu, onRight, layoutNode, plusLabels, plusWidth, plusButton, withKey } from "./kit.js";
import { tabName, labelNote, dropMove, nameCap } from "./names.js";
import { RowDrag } from "./rowdrag.js";

const TAB_HEIGHT = 34;
const STRIP_PAD = 10; // the row's left padding: where the first tab starts

/** The "x" on a tab: a confirmation first, because closing a tab ends what runs in it. */
export function openCloseTab(tab, name, lastInSpace) {
  // Herdr itself asks before closing a space's last tab (that closes the space), so it is not asked twice.
  if (lastInSpace) run("tab.close", { id: tab.id });
  else openOverlay({ mod: MOD, kind: "dialog", modal: true, width: 420, height: 196, props: { role: "end", tab: tab.id, name } });
}

export default class Tabs {
  init() {
    this.width = 0;
    this.drag = new RowDrag({ pad: STRIP_PAD, gap: 0, guess: 150, unzoom });
  }

  /** The shown space's tabs right now: all of them, and the open ones as the row a drag works on. */
  now() {
    const space = spaces().find((s) => s.active);
    const tabs = space?.tabs ?? [];
    const open = tabs.filter((t) => !t.settled);
    return { space, tabs, open, row: { ids: open.map((t) => t.id) } };
  }

  /** The button came up over the strip (drop) or the pointer left it (cancel). */
  release(cx, drop) {
    const { tabs, row } = this.now();
    const move = this.drag.release(cx, drop, row);
    if (!move) return;
    const args = dropMove(tabs, move.id, move.target); // the dragged tab takes the place its target holds
    if (args) run("tab.move", args);
  }

  render() {
    const c = P();
    const { space, tabs, open, row } = this.now();
    const all = panes();
    const away = tabs.filter((t) => t.settled);
    const ids = row.ids;

    const panel = layoutNode("panel");
    const body = layoutNode("panel-body");
    const enabledRaw = shared("workspace.panels");
    const enabled = Array.isArray(enabledRaw) ? enabledRaw : ["files", "changes"];
    const panels = panel ? ["files", "changes"].filter((x) => enabled.includes(x)) : [];

    // Room for names once the fixed controls are placed: estimate each name's width,
    // then cap the longest ones so every tab shows.
    const busy = (t) => Boolean(t.status && t.status !== "idle");
    const names = open.map((t) => String(tabLabel(t, all, tabName)));
    // The plus after the last tab: bare, or "+ Agent" when the layout's plus_labels switch is on.
    const plusWord = plusLabels() ? "Agent" : null;
    const fixed = 20 + 16 + plusWidth(plusWord) + (panels.includes("files") ? 74 : 0) + (panels.includes("changes") ? 94 : 0) + away.length * 150 + 18;
    const avail = this.width ? unzoom(this.width) - fixed : 2000;
    const MOST = 220;
    const want = open.map((t, i) => Math.ceil(names[i].length * (t.active ? 7.4 : 6.9)) + 4);
    const dotted = open.filter(busy).length * 14;
    const fullCap = nameCap(want, avail - open.length * 68 - dotted, MOST);
    const compact = fullCap < 72;
    const nameMax = Math.max(32, compact ? nameCap(want, avail - open.length * 46 - 24 - dotted, MOST) : fullCap);
    // While everything fits, a name is only held to the longest a tab may be: the width
    // estimate is then never what cuts a name short.
    const maxFor = (i) => (nameMax >= MOST ? MOST : Math.floor(Math.min(want[i] ?? nameMax, nameMax)) + 2);

    // What, if anything, is in motion: a drag, a drop waiting for Herdr, or the last glide of one.
    const moving = this.drag.frame(row);

    const chip = (t, i) => {
      const name = names[i];
      const st = t.status;
      const on = Boolean(t.active);
      const hue = c.hue(t.index);
      const prev = open[i - 1];
      const divider = !on && Boolean(prev) && !prev.active;
      const showX = on || !compact;
      // The tab shows the session's name; a hand-typed label that differs is kept in the hover tip.
      const typed = labelNote(t, all, name);
      const tip = `${name}${typed ? ` · labeled "${typed}"` : ""}${busy(t) ? " · " + String(st).replace("blocked", "waiting for you") : ""}`;
      const close = div().id(`tabx-${t.id}`).w(18).h(18).flex_none().rounded(9).flex().items_center().justify_center().cursor_pointer()
        .hover((x) => x.bg(c.selected)).tooltip("Close this tab")
        // A press on the x neither starts a drag nor selects the tab (and ends a drag that lost its release).
        .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.drag.otherPress(cx, this.now().row); })
        .on_click((_e, cx) => { cx.stop_propagation(); if (this.drag.dragging) return; openCloseTab(t, name, tabs.length <= 1); })
        .child(icon("close", 11, c.dim));
      const el = h_flex().id(`tab-${t.id}`).relative().h(TAB_HEIGHT).flex_none().pl(12).pr(showX ? 6 : 12).gap(7).items_center().rounded_t(9).cursor_pointer()
        .tooltip(tip)
        .when(on, (x) => x.bg(c.bg))
        .hover((x) => x.bg(on ? c.bg : c.hover));
      // Its size is remembered for the next drag; a neighbor of the dragged tab sits shifted and
      // glides; the dragged tab itself is unseen while its lifted copy shows.
      return this.drag.dress(el, t.id, moving)
        .on_mouse_down("left", (e) => this.drag.pressed(t.id, e))
        .on_click(() => {
          if (this.drag.swallowClick(t.id)) return; // the end of a drag is not a click
          run("tab.select", { id: t.id });
        })
        .on_mouse_down("right", onRight(() => menu("tab", { id: t.id, space: space.id })))
        // Selected: the stripe on top, and the two small curves that join the tab to the pane below.
        .when(on, (x) => x
          .child(div().absolute().top(0).left(0).right(0).h(13).rounded_t(9).border_t(3).border_color(hue))
          .child(div().absolute().left(-9).bottom(0).w(9).h(9).child(icon("flare-l", 9, c.bg)))
          .child(div().absolute().right(-9).bottom(0).w(9).h(9).child(icon("flare-r", 9, c.bg))))
        // Not selected: a thin underline in its color, and a hairline toward an unselected neighbor.
        .when(!on, (x) => x.child(div().absolute().left(12).right(12).bottom(3).h(2).rounded(1).bg(tint(hue, "8c"))))
        .when(divider, (x) => x.child(div().absolute().left(0).top(10).bottom(10).w(1).bg(c.rule)))
        .child(div().flex_none().text_size(S).font_weight(SEMI).text_color(c.hueText(t.index)).child(two(t.index)))
        .child(div().max_w(maxFor(i)).truncate().text_size(M).font_weight(on ? SEMI : REG).text_color(on ? c.fg : c.muted).child(name))
        .when(busy(t), (x) => x.child(dot(st)))
        .when(showX, (x) => x.child(close));
    };

    // The lifted copy of the dragged tab: drawn last so it is on top, with no handlers of its
    // own, so every press and release still reaches the real tabs and the strip underneath.
    const lift = () => {
      const i = ids.indexOf(moving.id);
      if (i < 0) return null;
      const t = open[i];
      const on = Boolean(t.active);
      const showX = on || !compact;
      return this.drag.lift(h_flex().id("tab-lift"), moving).h(TAB_HEIGHT).pl(12).pr(showX ? 6 : 12).gap(7).items_center()
        .rounded_t(9).bg(c.bg).shadow_md().overflow_hidden()
        .child(div().absolute().top(0).left(0).right(0).h(13).rounded_t(9).border_t(3).border_color(c.hue(t.index)))
        .child(div().flex_none().text_size(S).font_weight(SEMI).text_color(c.hueText(t.index)).child(two(t.index)))
        .child(div().max_w(maxFor(i)).truncate().text_size(M).font_weight(on ? SEMI : REG).text_color(c.fg).child(names[i]))
        .when(busy(t), (x) => x.child(dot(t.status)))
        .when(showX, (x) => x.child(div().w(18).h(18).flex_none().flex().items_center().justify_center().child(icon("close", 11, c.dim))));
    };
    const lifted = moving ? lift() : null;

    const outline = (id, ic, text, tip, act, on) => h_flex().id(id).h(26).flex_none().px(10).gap(6).items_center().rounded(7).cursor_pointer()
      .border(1).border_color(on ? c.input : c.border).bg(c.bg)
      .hover((x) => x.bg(on ? c.bg : c.hover)).tooltip(tip)
      .on_click(() => act())
      .child(icon(ic, 13, on ? c.fg : c.muted))
      .child(label(text, on ? c.fg : c.muted, Boolean(on)).max_w(120).truncate());

    const add = plusButton("tab-new", plusWord)
      .tooltip(withKey("Start an agent or a terminal", "tab.new", "for a shell"))
      .on_click(() => newMenu());

    const bringBack = (t) => outline(`back-${t.id}`, "restore", tabName(t, all) ?? `Tab ${t.index}`, "Bring this tab back",
      () => { run("tab.unsettle", { id: t.id }); run("tab.select", { id: t.id }); });

    const panelButton = (id, text) => {
      const on = Boolean(panel && !panel.hidden && body?.active === id);
      return outline(`panel-${id}`, id, text, on ? `Hide ${text.toLowerCase()}` : `Show ${text.toLowerCase()}`, () => {
        if (on) run("layout.hide", { id: "panel" });
        else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
      }, on);
    };

    return h_flex().id("tabs").size_full().items_end().bg(c.strip).rounded_t(9)
      .on_size_change((size, cx) => { if (Math.abs(size.width - this.width) > 1) { this.width = size.width; cx.notify(); } })
      .on_mouse_move((e, cx) => this.drag.pointer(e, cx, this.now().row))
      // A fresh press is never already a drag: one that is has lost its release, so it is cancelled, not dropped.
      .on_mouse_down("left", (_e, cx) => this.drag.otherPress(cx, this.now().row))
      .on_mouse_up("left", (_e, cx) => this.release(cx, true))
      .on_hover((inside, cx) => { if (!inside) this.release(cx, false); })
      .on_mouse_down("right", onRight(() => menu("global", {})))
      .child(h_flex().id("tabs-open").relative().h_full().flex_1().min_w(0).pl(STRIP_PAD).items_end().overflow_x_scrollbar()
        .children(open.map(chip))
        .child(h_flex().h(TAB_HEIGHT).flex_none().pl(8).pr(8).items_center().child(add))
        .when(Boolean(lifted), (el) => el.child(lifted)))
      .child(h_flex().h(TAB_HEIGHT).flex_none().gap(6).pl(8).pr(10).items_center()
        .children(away.map(bringBack))
        .when(panels.includes("files"), (el) => el.child(panelButton("files", "Files")))
        .when(panels.includes("changes"), (el) => el.child(panelButton("changes", "Changes"))));
  }
}
