// The header, "two rows of tabs": the brand block sits exactly over the sidebar
// (same width, following it when the sidebar is resized); to its right every
// space is one large tab: its number in a box of the space's color, its name, a
// dot when an agent there is waiting (amber) or working (blue), and how many
// tabs it has. The selected space is a raised tab with a stripe in its color that
// joins the work area below; the others are plain, with a hairline between them.
// Space tabs can be dragged into a new order exactly like the agent tabs (rowdrag.js):
// the pressed tab lifts and follows the pointer, neighbors glide aside, release moves
// the space (space.move), leaving the tab area cancels. A space stays among the
// spaces of its own machine.
// Each space tab has a close "x" like the agent tabs; it asks first with the same
// "Enter to confirm · Esc to cancel" dialog (end.js);
// when the row gets tight only the selected space keeps it.
// A "+" after the last one makes a new space and asks for its name ("+ Space" when the layout's
// plus_labels switch is on). On the right: a search bar (a
// button that opens the spark-search panel over itself), the clock, the
// day/night button (props.features), settings and, where the system draws none,
// the window buttons. Dragging the header moves the window.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exists } from "fs/promises";
import { spaces, agents, run, updates, settings, notify, openOverlay, appHome, keys, shared, window as appWindow } from "herdr";
import { P, MOD, S, M, L, REG, SEMI, icon, label, numBox, dot, clock, menu, onRight, stopPress, unzoom, layoutNode, plusLabels, plusWidth, plusButton, brandMark, withKey, newSpace, TITLE, SUBTITLE } from "./kit.js";
import { spaceSignal, nameCap } from "./names.js";
import { writeAppearance, spawn } from "./data.js";
import { appearanceTip, toggledAppearance, searchPanelAt, shortcutFor } from "./logic.js";
import { RowDrag } from "./rowdrag.js";

// The search panel is another mod. It opens so that its own text field lands exactly on the bar
// (logic.js searchPanelAt), which makes the bar read as coming alive when clicked.
const SEARCH_MOD = "spark-search";
const SEARCH_PANEL_WIDTH = 520;
// The bar is the approved B1 shape: 320 by 34, 9 px radius, 1 px border, 11 px in, 15 px icon, 9 px gap,
// 13 px text. The panel's first row repeats those measures with no inset and no border of its own: the
// popup's frame is its outline. SEARCH_FRAME_BORDER is how far that frame pushes the panel's content
// in (1 px assumed; the one number to settle at the first live look). With it, the frame's border
// lands on the bar's border, and the icon and text sit exactly where they sit in the bar.
const SEARCH_FRAME_BORDER = 1;
const BAR_BORDER = 1;
const BAR_HEIGHT = 34;
const TAB_HEIGHT = 40;
const SPACE_GAP = 2; // the space between two space tabs

export default class Header {
  init(_p, cx) {
    this.now = new Date();
    const tick = (cx) => { this.now = new Date(); cx.notify(); };
    cx.timer.after(60000 - (Date.now() % 60000) + 50, (cx) => { tick(cx); cx.timer.every(60000, tick); });
    this.features = Boolean(_p?.features);
    this.width = 0; // zoomed px, from on_size_change
    this.barAt = null; // where the search bar's top left is in the window, from the last press on it
    this.opening = false;
    this.drag = new RowDrag({ pad: 0, gap: SPACE_GAP, guess: 130, unzoom });
  }

  /** The space tabs as the row a drag works on. A space may only move among the spaces of its own machine. */
  spaceRow() {
    const list = spaces();
    const group = (i) => list[i]?.machine ?? null;
    const span = (i) => {
      let lo = i;
      let hi = i;
      while (lo > 0 && group(lo - 1) === group(i)) lo--;
      while (hi < list.length - 1 && group(hi + 1) === group(i)) hi++;
      return [lo, hi];
    };
    return { ids: list.map((s) => s.id), span };
  }

  /** The button came up over the tab area (drop) or the pointer left it (cancel). */
  releaseSpace(cx, drop) {
    const move = this.drag.release(cx, drop, this.spaceRow());
    if (!move) return;
    const index = spaces().findIndex((s) => s.id === move.target); // the dragged space takes the place its target holds
    if (index >= 0) run("space.move", { id: move.id, index: index + 1 });
  }

  /** The day/night button: flips appearance now, with a guarded write. The only writer of appearance. */
  flip(cx) {
    if (this.flipping) return;
    this.flipping = true;
    cx.spawn(async (cx) => {
      const write = () => writeAppearance((current) => toggledAppearance(current, settings()?.dark));
      try {
        await write().catch(write); // settings.json changed under us: read it again once
      } catch (e) {
        notify({ title: "Could not switch the look", body: String(e).slice(0, 120), level: "warning" });
      }
      this.flipping = false;
      cx.notify();
    });
  }

  /** Remembers where the bar is from a press on it: the press's window position less its position inside the bar. */
  notePress(e) {
    const p = e?.position;
    const l = e?.local_position;
    this.barAt = p && l && isFinite(p.x - l.x) && isFinite(p.y - l.y) ? { left: unzoom(p.x - l.x), top: unzoom(p.y - l.y) } : null;
  }

  /**
   * Opens the search panel over the bar. If the spark-search mod is not installed, or
   * will not open, nothing happens and nothing is shown.
   */
  openSearch(cx, barWidth, guess, windowWidth) {
    if (this.opening) return;
    this.opening = true;
    const from = this.barAt ?? guess;
    spawn(cx, async () => {
      try {
        if (await exists(`${appHome()}/mods/${SEARCH_MOD}/main.js`)) {
          const spec = { mod: SEARCH_MOD, kind: "popup", props: { mode: "dropdown" }, width: SEARCH_PANEL_WIDTH };
          if (from) {
            const at = searchPanelAt({ left: from.left, top: from.top, width: barWidth }, windowWidth, SEARCH_PANEL_WIDTH,
              { x: SEARCH_FRAME_BORDER - BAR_BORDER, y: SEARCH_FRAME_BORDER });
            spec.at = { x: at.x, y: at.y };
          }
          openOverlay(spec);
        }
      } catch {
        // Quiet on purpose: the bar is only a way in.
      }
      this.opening = false;
    });
  }

  render() {
    const c = P();
    const w = appWindow();
    const mac = w?.platform === "macos";
    const list = spaces();
    const crew = agents();
    const total = this.width ? unzoom(this.width) : 1600;

    // The brand block is as wide as the sidebar, so its right edge continues the sidebar's.
    const side = layoutNode("sidebar");
    const sideW = side && !side.hidden && typeof side.size?.px === "number" && side.size.px > 0 ? side.size.px : null;
    const brandW = sideW ? Math.max(sideW, mac ? 250 : 180) : null;

    // The search bar gives way before the space tabs do.
    const barW = total >= 1180 ? 320 : total >= 940 ? 220 : BAR_HEIGHT;
    const buttonsW = w?.buttons ? 132 : 0;
    const tailW = 16 + barW + 16 + 1 + 16 + 66 + 16 + (this.features ? 30 + 16 : 0) + 30 + 10 + buttonsW;

    // Room for the space names once everything fixed is placed; the longest names shorten first,
    // and the "4 tabs" count goes when names would get too short.
    const signals = list.map((s) => spaceSignal(s.id, crew));
    // The plus after the last space: bare, or "+ Space" when the layout's plus_labels switch is on.
    const plusWord = plusLabels() ? "Space" : null;
    const room = total - (brandW ?? 200) - 14 - tailW - (18 + plusWidth(plusWord));
    const want = list.map((s) => Math.ceil(String(s.name ?? "").length * (s.active ? 7.4 : 6.8)) + 4);
    const dots = signals.filter(Boolean).length * 16;
    let cap = nameCap(want, room - list.length * 135 - dots);
    const compact = cap < 64;
    if (compact) cap = Math.max(28, nameCap(want, room - list.length * 63 - 27 - dots)); // only the selected space keeps its x
    cap = Math.floor(cap);

    const brand = h_flex().gap(10).items_center().flex_none()
      .child(brandMark(c))
      .child(v_flex().gap(1)
        .child(div().text_size(L).font_weight(SEMI).line_height(1.15).text_color(c.fg).child(TITLE))
        .when(Boolean(SUBTITLE), (el) => el.child(label(SUBTITLE, c.dim))));

    const brandBox = h_flex().id("brand").h_full().flex_none().items_center().overflow_hidden()
      .pl(mac ? 84 : 16).border_r(1).border_color(c.border)
      .when(Boolean(brandW), (el) => el.w(brandW))
      .when(!brandW, (el) => el.pr(16))
      .child(brand);

    // What, if anything, is in motion among the space tabs: a drag, a drop waiting for Herdr, or its last glide.
    const moving = this.drag.frame(this.spaceRow());
    // The tabs as they read right now: mid-drag the dragged one counts as sitting in the slot it is
    // headed for, and that slot is a gap (its lifted copy floats above the row).
    const reading = moving?.order ?? list.map((s) => s.id);
    const gapId = moving?.order ? moving.id : null;
    const byId = {};
    for (const s of list) byId[s.id] = s;

    const spaceTab = (s, i) => {
      const on = Boolean(s.active);
      const hue = c.hue(s.index);
      const sig = signals[i];
      const n = s.tabs.length;
      const count = `${n} ${n === 1 ? "tab" : "tabs"}`;
      // D1: a hairline on the right of each unselected space, except the one just left of the selected tab.
      // Mid-drag: none on the dragged tab, and none beside the gap it is headed for.
      const nextId = reading[reading.indexOf(s.id) + 1];
      const divider = !on && s.id !== gapId && !(nextId !== undefined && nextId === gapId) && !byId[nextId]?.active;
      const showX = on || !compact;
      // The x: our confirmation dialog (end.js) asks before closing the space and ending its terminals. A press on it neither
      // starts a drag nor selects the space, and never moves the window.
      const close = div().id(`hspx-${s.id}`).w(18).h(18).flex_none().rounded(9).flex().items_center().justify_center().cursor_pointer()
        .hover((x) => x.bg(c.selected)).tooltip("Close this space")
        .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.drag.otherPress(cx, this.spaceRow()); })
        .on_click((_e, cx) => { cx.stop_propagation(); if (this.drag.dragging) return; openOverlay({ mod: MOD, kind: "dialog", modal: true, width: 420, height: 196, props: { role: "end", space: s.id, name: String(s.name ?? "") } }); })
        .child(icon("close", 11, c.dim));
      const el = h_flex().id(`hsp-${s.id}`).relative().h(TAB_HEIGHT).flex_none().pl(10).pr(showX ? 8 : 16).gap(9).items_center().rounded_t(10).cursor_pointer()
        .tooltip(`${s.name} · ${count}${sig === "blocked" ? " · an agent is waiting for you" : sig === "working" ? " · working" : ""}`)
        .when(on, (el) => el.bg(c.canvas))
        .hover((x) => x.bg(on ? c.canvas : c.hover));
      return this.drag.dress(el, s.id, moving)
        // The press stops here, so it never moves the window; it may become a drag of this tab.
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.drag.pressed(s.id, e); })
        .on_click(() => {
          if (this.drag.swallowClick(s.id)) return; // the end of a drag is not a click
          run("space.select", { id: s.id });
        })
        .on_mouse_down("right", onRight(() => menu("space", { id: s.id })))
        .when(on, (el) => el
          .child(div().absolute().top(0).left(0).right(0).h(14).rounded_t(10).border_t(3).border_color(hue))
          .child(div().absolute().left(0).top(10).bottom(0).w(1).bg(c.border))
          .child(div().absolute().right(0).top(10).bottom(0).w(1).bg(c.border)))
        .when(divider, (el) => el.child(div().absolute().right(-2).top(10).bottom(9).w(1).bg(c.rule)))
        .child(numBox(s.index, 24, on ? "solid" : "soft"))
        .child(div().max_w(cap).truncate().text_size(M).font_weight(on ? SEMI : REG).text_color(on ? c.fg : c.muted).child(String(s.name ?? "")))
        .when(Boolean(sig), (el) => el.child(dot(sig)))
        .when(!compact, (el) => el.child(label(count, c.dim).flex_none()))
        .when(showX, (el) => el.child(close));
    };

    const addSpace = plusButton("space-new", plusWord).mb(7).ml(6).tooltip(withKey("New space", "space.new"))
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.drag.otherPress(cx, this.spaceRow()); })
      .on_click(() => newSpace());

    // The lifted copy of the dragged space tab: drawn last so it is on top, with no handlers and no divider.
    const liftSpace = () => {
      const s = byId[moving.id];
      if (!s) return null;
      const on = Boolean(s.active);
      const sig = signals[list.indexOf(s)];
      const n = s.tabs.length;
      const showX = on || !compact;
      return this.drag.lift(h_flex().id("hsp-lift"), moving).h(TAB_HEIGHT).pl(10).pr(showX ? 8 : 16).gap(9).items_center()
        .rounded_t(10).bg(c.canvas).shadow_md().overflow_hidden()
        .child(div().absolute().top(0).left(0).right(0).h(14).rounded_t(10).border_t(3).border_color(c.hue(s.index)))
        .child(numBox(s.index, 24, on ? "solid" : "soft"))
        .child(div().max_w(cap).truncate().text_size(M).font_weight(on ? SEMI : REG).text_color(c.fg).child(String(s.name ?? "")))
        .when(Boolean(sig), (el) => el.child(dot(sig)))
        .when(!compact, (el) => el.child(label(`${n} ${n === 1 ? "tab" : "tabs"}`, c.dim).flex_none()))
        .when(showX, (el) => el.child(div().w(18).h(18).flex_none().flex().items_center().justify_center().child(icon("close", 11, c.dim))));
    };
    const liftedSpace = moving ? liftSpace() : null;

    // The tab area hears the pointer for a drag. It never stops a press: a press on its empty part
    // still moves the window, as anywhere else on the header.
    const spaceTabs = h_flex().id("space-tabs").relative().h_full().flex_1().min_w(0).ml(-2).gap(SPACE_GAP).items_end().overflow_hidden()
      .on_mouse_move((e, cx) => this.drag.pointer(e, cx, this.spaceRow()))
      .on_mouse_down("left", (_e, cx) => this.drag.otherPress(cx, this.spaceRow()))
      .on_mouse_up("left", (_e, cx) => this.releaseSpace(cx, true))
      .on_hover((inside, cx) => { if (!inside) this.releaseSpace(cx, false); })
      .children(list.map(spaceTab))
      .child(addSpace)
      .when(Boolean(liftedSpace), (el) => el.child(liftedSpace));

    // If a press never told us where the bar is, work it out from what sits right of it.
    const guess = this.width ? { left: total - (tailW - 16) , top: (58 - BAR_HEIGHT) / 2 } : null;
    // The key that opens the search panel, read from the key bindings: never a retyped guess.
    const searchKey = shortcutFor(keys(), `mod.open:${SEARCH_MOD}`, shared("layout"));
    const search = h_flex().id("search").w(barW).h(BAR_HEIGHT).flex_none().gap(9).items_center().rounded(9).cursor_pointer()
      .bg(c.bg).border(BAR_BORDER).border_color(c.input).hover((x) => x.border_color(c.accent))
      .tooltip(`Search agents and projects by name, and the text on their screens${searchKey ? ` (${searchKey})` : ""}`)
      .when(barW > BAR_HEIGHT, (el) => el.pl(11).pr(8))
      .when(barW <= BAR_HEIGHT, (el) => el.justify_center())
      .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.notePress(e); })
      .on_click((_e, cx) => this.openSearch(cx, barW, guess, this.width ? total : 0))
      .child(icon("search", 15, c.dim))
      .when(barW > BAR_HEIGHT, (el) => el.child(div().flex_1().min_w(0).truncate().text_size(M).font_weight(REG).text_color(c.dim)
        .child("Search names and on-screen text")))
      .when(barW >= 320 && Boolean(searchKey), (el) => el.child(div().h(20).px(6).flex_none().flex().items_center().rounded(5).bg(c.chrome).border(1).border_color(c.border)
        .text_size(S).font_weight(REG).text_color(c.muted).child(searchKey)));

    const rule = div().w(1).h(30).flex_none().bg(c.border);

    const time = v_flex().items_end().gap(1).flex_none()
      .child(label("Local time", c.dim))
      .child(div().text_size(L).font_weight(SEMI).line_height(1.1).text_color(c.fg).child(clock(this.now)));

    const gear = div().id("settings").relative().w(30).h(30).rounded(7).flex().items_center().justify_center().flex_none()
      .cursor_pointer().hover((s) => s.bg(c.hover)).tooltip(withKey("Settings", "app.settings"))
      .on_mouse_down("left", stopPress).on_click(() => run("app.settings"))
      .child(icon("settings", 16, c.muted))
      .when(Boolean(updates()?.app?.ready), (el) => el.child(div().absolute().top(6).right(6).w(6).h(6).rounded(3).bg(c.accent)));

    const dark = Boolean(settings()?.dark);
    const look = this.features ? div().id("appearance").w(30).h(30).rounded(7).flex().items_center().justify_center().flex_none()
      .cursor_pointer().bg(c.bg).border(1).border_color(c.border).hover((s) => s.bg(c.hover))
      .tooltip(appearanceTip(dark))
      .on_mouse_down("left", stopPress).on_click((_e, cx) => this.flip(cx))
      .child(icon(dark ? "sun" : "moon", 16, c.fg)) : null;

    const btn = (id, name, cmd, danger) => div().id(id).w(44).h_full().flex().items_center().justify_center()
      .hover((s) => (danger ? s.bg("#c42b1c") : s.bg(c.hover)))
      .on_mouse_down("left", stopPress).on_click(() => run(cmd))
      .child(icon(name, 14, c.muted));
    const buttons = w?.buttons
      ? h_flex().h_full().flex_none()
        .child(btn("win-min", "win-min", "window.minimize"))
        .child(btn("win-max", w.maximized ? "win-restore" : "win-max", "window.maximize"))
        .child(btn("win-close", "win-close", "window.close", true))
      : null;

    return h_flex().id("header").relative().size_full().bg(c.chrome).items_center()
      .on_size_change((size, cx) => { if (Math.abs(size.width - this.width) > 1) { this.width = size.width; cx.notify(); } })
      .on_mouse_down("right", onRight(() => menu("global", {})))
      .child(div().absolute().left(0).right(0).bottom(0).h(1).bg(c.border)) // the bottom line; the selected tab covers its own stretch of it
      .child(h_flex().flex_1().min_w(0).h_full().items_center().gap(16).pr(10)
        .child(brandBox)
        .child(spaceTabs)
        .child(search)
        .child(rule)
        .child(time)
        .when(Boolean(look), (el) => el.child(look))
        .child(gear))
      .when(Boolean(buttons), (el) => el.child(buttons));
  }
}
