// The sidebar ("2A"): one nested tree. For each space a header row (its number
// in a box of the space's color, its name, "1 waiting" when someone there needs
// you, how many rows it has, and a fold arrow), then its agents indented under
// it on a thin line in the space's color, then the next space. The space you are
// in gets the white boxed header; the focused agent keeps its highlighted row. A
// tab with no agent (a plain shell) shows as one quiet row so no space looks
// empty. Click a header to go to that space; click its arrow to fold or unfold
// it. A folded space still says who is waiting or working. Folded or open is
// remembered per space in shared state, so it survives restarts. Folding and
// unfolding is a quick native height animation (no timer): the rows slide shut
// or open and the spaces below move with them. Only a click on the arrow
// animates; the first draw, a restart, and rows coming and going do not.
// An agent's row can be dragged up and down inside its space (rowdrag.js, the same
// drag as the tab rows, turned vertical): it lifts, follows the pointer, the rows
// it passes glide aside, and release moves its tab (tab.move), so the tab row
// ends up in the same order. A tab cannot move to another space (Herdr has no
// command for it), so the drag is held at the edges of its own space. A dim
// "New space" row closes the list; the list scrolls. The Activity card (the latest
// notable event and a way into the log) is pinned at the bottom only when the
// layout gives this block props.activity_card: true; without it the tree has
// that room, and the log is opened from the status bar.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, agents, panes, props, run, shared, setShared, setAgentOrder } from "herdr";
import { P, WORD, SHORT, S, M, REG, SEMI, tint, icon, label, numBox, two, tabLabel, menu, onRight, stopPress, unzoom, withKey, newSpace } from "./kit.js";
import { sessionName, tabName, sidebarTree, dropMove } from "./names.js";
import { RowDrag } from "./rowdrag.js";
import { readLog, notable, openActivity, hm, TAG, tone } from "./activity.js";
import { RowStats } from "./rowstats.js";

export const FOLD_KEY = "spark.folded"; // { spaceId: true } for each folded space
const TIME_COLUMN = 56; // the time sits in a fixed column so rows line up
const AGENT_ROW = 40; // row heights: the fold animation needs a group's exact open height
const SHELL_ROW = 36;
const NEST_TOP = 2; // space above a group's rows, and below them
const NEST_BOTTOM = 6;
const FOLD = { duration: 140, easing: "ease-out" }; // snappy, no bounce
const FOLD_WINDOW_MS = 600; // how long after a click on the arrow a height change counts as that fold
const NOW = 1; // a 1 ms transition: effectively at once

/** A space's rows fully open: their exact height, with the space above and below them. */
export const nestHeight = (rows) => (rows.length ? NEST_TOP + rows.reduce((h, r) => h + (r.kind === "agent" ? AGENT_ROW : SHELL_ROW), 0) + NEST_BOTTOM : 0);

const readFolded = () => {
  const v = shared(FOLD_KEY);
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
};

/** Folds or unfolds one space. Spaces that no longer exist are forgotten once the record grows. */
function toggleFold(id, liveIds) {
  const next = { ...readFolded() };
  if (next[id]) delete next[id];
  else next[id] = true;
  const keys = Object.keys(next);
  if (keys.length > 60) for (const k of keys) if (!liveIds.includes(k)) delete next[k];
  setShared(FOLD_KEY, next);
}

export default class Sidebar {
  init(pr, cx) {
    if (pr?.features) this.stats = new RowStats(cx); // how long each agent has been going
    this.foldAt = null; // { id, at }: the space whose arrow was just clicked, so only that change animates
    this.drag = new RowDrag({ axis: "y", pad: 0, gap: 0, guess: AGENT_ROW, unzoom });
    this.dragSpace = null; // the space whose rows the current (or last) drag belongs to
  }

  /** The rows a drag works on: the tabs of the space it started in, top to bottom. Each tab is one item. */
  dragRow() {
    const space = spaces().find((s) => s.id === this.dragSpace);
    return { space, row: { ids: (space?.tabs ?? []).map((t) => t.id) } };
  }

  /** The button came up over the list (drop) or the pointer left it (cancel). */
  releaseRow(cx, drop) {
    const { space, row } = this.dragRow();
    const move = this.drag.release(cx, drop, row);
    if (!move || !space) return;
    const args = dropMove(space.tabs, move.id, move.target); // the same move as dragging its tab in the tab row
    if (args) run("tab.move", args);
  }

  /** The arrow was clicked: fold or unfold that space, and let its height change animate. */
  fold(id, liveIds) {
    this.foldAt = { id, at: Date.now() };
    toggleFold(id, liveIds);
  }

  render() {
    const c = P();
    const list = spaces();
    const crew = agents();
    const allPanes = panes();
    const { tree, order, stray } = sidebarTree(list, crew, allPanes);
    setAgentOrder(order); // agent.next / agent.prev walk the tree top to bottom
    const folded = readFolded();
    const liveIds = list.map((s) => s.id);
    const now = Date.now();
    // The motion for a space's fold: the quick slide right after its arrow was clicked, otherwise at
    // once. The transition is always declared, so the engine always knows where a change starts from.
    const foldMotion = (id) => (this.foldAt && this.foldAt.id === id && now - this.foldAt.at < FOLD_WINDOW_MS ? FOLD : NOW);

    const head = (node) => {
      const s = node.space;
      const on = Boolean(s.active);
      const shut = Boolean(folded[s.id]);
      const n = node.rows.length;
      const shells = n - node.agents;
      const tip = `${s.name} · ${node.agents} ${node.agents === 1 ? "agent" : "agents"}${shells ? ` · ${shells} without an agent` : ""}${s.machine ? " · " + s.machine : ""}`;
      return h_flex().id(`sp-${s.id}`).w_full().h(42).flex_none().pl(8).pr(6).gap(9).items_center().rounded(8).cursor_pointer()
        .border(1).border_color(on ? c.border : c.chrome)
        .when(on, (el) => el.bg(c.bg))
        .hover((x) => x.bg(on ? c.bg : c.hover))
        .tooltip(tip)
        .on_click(() => run("space.select", { id: s.id }))
        .on_mouse_down("right", onRight(() => menu("space", { id: s.id })))
        .child(numBox(s.index, 28, "solid"))
        .child(div().flex_1().min_w(0).truncate().text_size(M).font_weight(SEMI).text_color(c.fg).child(String(s.name ?? "")))
        .when(node.waiting > 0, (el) => el.child(label(`${node.waiting} waiting`, c.status.blocked, true).flex_none()
          .loop("opacity", { from: 0.55, to: 1, period: 1800 })))
        .when(shut && node.working > 0, (el) => el.child(label(`${node.working} working`, c.status.working, true).flex_none()))
        .child(label(String(n), c.dim).flex_none())
        .child(div().id(`fold-${s.id}`).w(22).h(22).flex_none().rounded(6).flex().items_center().justify_center()
          .hover((x) => x.bg(c.selected)).tooltip(shut ? "Unfold" : "Fold")
          .on_mouse_down("left", stopPress) // the arrow folds; it never also selects the space
          .on_click((_e, cx) => { cx.stop_propagation(); this.fold(s.id, liveIds); })
          // The toolkit animates opacity, size and position but not rotation, so the two arrows cross-fade.
          .child(div().relative().w(12).h(12).flex_none()
            .child(div().id(`fold-down-${s.id}`).absolute().top(0).left(0).opacity(shut ? 0 : 1).transition("opacity", foldMotion(s.id)).child(icon("chevron-down", 12, c.dim)))
            .child(div().id(`fold-right-${s.id}`).absolute().top(0).left(0).opacity(shut ? 1 : 0).transition("opacity", foldMotion(s.id)).child(icon("chevron-right", 12, c.dim)))));
    };

    // inert: the row's space is folded, so it is drawn (clipped away) but takes no pointer at all.
    // lift: this is the copy drawn for a drag (inert too, and with an id of its own).
    const agentRow = (a, inert = false, lift = false) => {
      const program = a.program?.name ?? a.app ?? "Agent";
      const session = sessionName(a);
      const st = a.status;
      const col = c.status[st] ?? c.dim;
      const on = Boolean(a.focused);
      const stats = this.stats?.of(a, now);
      const timed = Boolean(stats && stats.time);
      const small = (text) => div().flex_none().text_size(S).font_weight(REG).line_height(1.25).text_color(c.muted).child(text);
      const tipped = (el, id, tip) => (inert ? el : el.id(id).tooltip(tip));
      const second = timed
        ? h_flex().min_w(0).overflow_hidden().gap(6).items_center()
          .child(stats.time ? tipped(small(stats.time).min_w(TIME_COLUMN), `ag-time-${a.address}`, stats.timeTip ?? "Time") : small("").min_w(TIME_COLUMN))
        : label(session ? program : `Tab ${two(a.tab_index)}`, c.dim).truncate();
      return h_flex().id(`${lift ? "lift-" : ""}ag-${a.address}`).relative().w_full().h(AGENT_ROW).flex_none().pl(8).pr(10).gap(10).items_center().rounded(8)
        .border(1).border_color(on ? c.border : c.chrome)
        .when(on, (el) => el.bg(c.bg))
        .when(on, (el) => el.child(div().absolute().left(-1).top(10).bottom(10).w(3).rounded(2).bg(c.hue(a.tab_index))))
        .when(!inert, (el) => el.cursor_pointer()
          .hover((x) => x.bg(on ? c.bg : c.hover))
          .tooltip(`${session ? session + " · " : ""}${program} · ${a.space_name} · tab ${a.tab_index} · ${WORD[st] ?? st}`)
          // A press may become a drag of this row's tab; a plain click still focuses the agent.
          .on_mouse_down("left", (e) => { if (list.some((s) => s.id === a.space)) { this.dragSpace = a.space; this.drag.pressed(a.tab, e); } })
          .on_click(() => { if (this.drag.swallowClick(a.tab)) return; run("agent.focus", { terminal: a.address }); })
          .on_mouse_down("right", onRight(() => menu("pane", { pane: a.pane, terminal: a.address }))))
        .child(numBox(a.tab_index, 24, "outline"))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().truncate().text_size(M).line_height(1.25).font_weight(on ? SEMI : REG).text_color(on ? c.fg : c.muted).child(session ?? program))
          .child(second))
        .child(label(SHORT[st] ?? st, col, true).flex_none()
          .when(st === "blocked", (d) => d.loop("opacity", { from: 0.5, to: 1, period: 1800 })));
    };

    // A tab with no agent in it: one dim row, so the space never looks empty.
    const shellRow = (r, s, inert = false, lift = false) => {
      const t = r.tab;
      const name = String(tabLabel(t, allPanes, tabName));
      const kind = r.pane && !r.pane.terminal ? "Panel" : "Shell";
      const on = Boolean(s.active && t.active);
      return h_flex().id(`${lift ? "lift-" : ""}sh-${t.id}`).w_full().h(SHELL_ROW).flex_none().pl(8).pr(10).gap(10).items_center().rounded(8)
        .border(1).border_color(on ? c.border : c.chrome)
        .when(on, (el) => el.bg(c.bg))
        .when(!inert, (el) => el.cursor_pointer()
          .hover((x) => x.bg(on ? c.bg : c.hover))
          .tooltip(`${name} · ${s.name} · tab ${t.index} · no agent here`)
          .on_mouse_down("left", (e) => { this.dragSpace = s.id; this.drag.pressed(t.id, e); })
          .on_click(() => { if (this.drag.swallowClick(t.id)) return; run("space.select", { id: s.id }); run("tab.select", { id: t.id }); })
          .on_mouse_down("right", onRight(() => menu("tab", { id: t.id, space: s.id }))))
        .child(div().w(24).h(24).flex_none().flex().items_center().justify_center().rounded(6).bg(c.bg).border(1).border_color(c.border)
          .child(icon("terminal", 13, c.dim)))
        .child(div().flex_1().min_w(0).truncate().text_size(M).font_weight(REG).text_color(c.dim).child(name))
        .child(label(kind, c.dim, true).flex_none());
    };

    // A space's rows live in a box whose height is the animated thing: its full height when open,
    // nothing when folded. The rows keep their own size inside and are clipped by the box, so they
    // slide out of sight rather than squash. Folded, the box takes no room and its rows take no pointer.
    // What, if anything, is in motion in the space a drag belongs to. Each tab is one item of the
    // drag: usually one row, more when a tab holds several agents, which then move together.
    const rowHeight = (r) => (r.kind === "agent" ? AGENT_ROW : SHELL_ROW);
    for (const node of tree) {
      for (const t of node.space.tabs ?? []) this.drag.size(t.id, node.rows.filter((r) => r.tab.id === t.id).reduce((h, r) => h + rowHeight(r), 0));
    }
    const moving = this.drag.frame(this.dragRow().row);
    const drawRow = (r, s, inert, lift = false) => (r.kind === "agent" ? agentRow(r.agent, inert, lift) : shellRow(r, s, inert, lift));

    const nest = (node) => {
      const id = node.space.id;
      const shut = Boolean(folded[id]);
      const here = moving && id === this.dragSpace ? moving : null; // only the dragged row's own space moves
      // One block per tab, holding that tab's rows. A neighbor of the dragged tab sits shifted and
      // glides; the dragged tab itself is unseen while its lifted copy shows.
      const tabBlock = (t) => this.drag.dress(v_flex().id(`tabrows-${t.id}`).relative().w_full().flex_none(), t.id, here)
        .children(node.rows.filter((r) => r.tab.id === t.id).map((r) => drawRow(r, node.space, shut)));
      // The lifted copy of the dragged tab's rows: drawn last so it is on top, with no handlers.
      const liftRows = here ? node.rows.filter((r) => r.tab.id === here.id) : [];
      const lifted = liftRows.length
        ? this.drag.lift(v_flex().id("row-lift"), here).left(7).right(0).rounded(8).bg(c.bg).shadow_md().overflow_hidden()
          .children(liftRows.map((r) => drawRow(r, node.space, true, true)))
        : null;
      return div().id(`nest-${id}`).w_full().flex_none().overflow_hidden()
        .h(shut ? 0 : nestHeight(node.rows)).transition("height", foldMotion(id))
        .child(div().w_full().flex_none().pt(NEST_TOP).pl(21).pb(NEST_BOTTOM)
          .child(v_flex().relative().w_full().pl(7).border_l(2).border_color(tint(c.hue(node.space.index), "59"))
            .children((node.space.tabs ?? []).map(tabBlock))
            .when(Boolean(lifted), (el) => el.child(lifted))));
    };

    // One block per space: its header, then its rows' box directly under it (no gap of their own),
    // so a folded space is exactly as tall as its header.
    const blocks = tree.map((node) => v_flex().w_full().flex_none().child(head(node)).child(nest(node)));
    for (const a of stray) blocks.push(agentRow(a)); // agents whose space is not listed yet

    const addRow = h_flex().id("sp-new").w_full().h(42).flex_none().mt(4).pl(8).pr(10).gap(9).items_center().rounded(8).cursor_pointer().opacity(0.6)
      .hover((x) => x.bg(c.hover)).tooltip(withKey("New space", "space.new"))
      .on_click(() => newSpace())
      .child(div().w(28).h(28).flex_none().flex().items_center().justify_center().rounded(7).bg(c.bg).border(1).border_dashed().border_color(c.input)
        .child(icon("plus", 13, c.muted)))
      .child(div().text_size(M).font_weight(REG).text_color(c.muted).child("New space"));

    // The Activity card: one switch in the layout's sidebar props turns it on.
    const showCard = props()?.activity_card === true;
    const log = showCard ? readLog() : [];
    const latest = notable(log);
    const card = !showCard ? null : v_flex().id("digest").mx(10).mb(10).mt(4).flex_none().px(12).py(10).gap(7).rounded(8)
      .bg(c.bg).border(1).border_color(c.border)
      .child(h_flex().gap(8).items_center()
        .child(div().w(24).h(24).flex_none().rounded(6).flex().items_center().justify_center().bg(c.chrome).border(1).border_color(c.border)
          .child(icon("activity", 13, latest ? tone(latest.kind) : c.dim)))
        .child(label("Activity", c.muted))
        .child(div().flex_1())
        .when(Boolean(latest), (el) => el.child(label(`${TAG[latest.kind] ?? ""} · ${hm(latest.at)}`, tone(latest.kind), true))))
      .child(div().text_size(M).line_height(1.4).text_color(latest ? c.fg : c.dim)
        .child(latest?.text ?? "Quiet so far. Agents starting, waiting and finishing collect here."))
      .child(div().h(1).bg(c.border))
      .child(h_flex().id("open-log").gap(6).items_center().cursor_pointer().hover((x) => x.opacity(0.75))
        .on_click(() => openActivity())
        .child(div().text_size(M).font_weight(REG).text_color(c.accent).child("Activity log"))
        .child(icon("open", 11, c.accent))
        .child(div().flex_1())
        .child(label(`${two(log.length)} ${log.length === 1 ? "entry" : "entries"}`, c.dim)));

    return v_flex().id("sidebar").size_full().bg(c.chrome).border_r(1).border_color(c.border)
      .on_mouse_down("right", onRight(() => menu("global", {})))
      .child(v_flex().id("tree").w_full().flex_1().min_h(0).px(8).pt(8).pb(6).gap(2).overflow_y_scrollbar()
        // The list hears the pointer for a row drag: it moves the lifted row, drops it, or cancels on leaving.
        .on_mouse_move((e, cx) => this.drag.pointer(e, cx, this.dragRow().row))
        .on_mouse_down("left", (_e, cx) => this.drag.otherPress(cx, this.dragRow().row))
        .on_mouse_up("left", (_e, cx) => this.releaseRow(cx, true))
        .on_hover((inside, cx) => { if (!inside) this.releaseRow(cx, false); })
        .children(blocks)
        .when(list.length === 0, (el) => el.child(div().px(10).py(6).text_size(M).text_color(c.dim).child("No spaces yet.")))
        .child(addRow))
      .when(Boolean(card), (el) => el.child(card));
  }
}
