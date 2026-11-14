// Dragging the items of a row into a new order, the way browser tabs move. One RowDrag per
// row: the agent tab row, the header's space tabs and the sidebar's agent rows all use this, so
// they cannot drift apart. A row runs left to right (axis "x") or top to bottom (axis "y");
// everything else is the same. It owns the state of a drag and the timing of its motion; the
// row draws its own items, its own lifted copy, and runs its own move command.
//
// How a drag goes: a left press on an item is remembered (nothing redraws). Once the pointer
// has moved DRAG_START px sideways the press is a drag: the item's lifted copy follows the
// pointer inside the row, and each neighbor it passes is shifted into the slot it left, with
// a native transition. On release the row holds its pose until the app reports the new
// order, then the copy finishes its glide and swaps with the real item. Leaving the row
// cancels, and everything glides back. There are no timers here: time only matters when a
// later redraw looks at how long ago something happened.
//
// No app or toolkit imports, so the whole thing runs under node in the tests.

import { dragClamp, dragSlot, dragShifts, dragOrder } from "./names.js";

export const DRAG_START = 5; // px the pointer must travel before a press becomes a drag; less is a click
export const GLIDE = { duration: 160, easing: "ease-out" }; // a neighbor sliding over, the dropped item settling
export const SWAP = { duration: 80, delay: 170 }; // after the glide: the lifted copy fades out, the real item in
const NOW = 1; // a 1 ms transition: effectively at once
const PENDING_MS = 1200; // how long a drop waits for the app to report the new order
const SETTLE_MS = 900; // how long the last motion of a drop or a cancel is kept
const STALE_MS = 5000; // a drag that has not moved for this long has lost its release: it is cancelled

const sum = (list) => list.reduce((a, b) => a + b, 0);

export class RowDrag {
  /**
   * axis: "x" for a row of tabs, "y" for a column of rows. pad: where the first item starts inside
   * the row's box. gap: the space between items. guess: a size to assume for an item not measured
   * yet. unzoom: turns reported px into drawn px. ("width", "left" and "x" below mean the size,
   * the position and the pointer coordinate along the row's own axis.)
   */
  constructor({ axis = "x", pad = 0, gap = 0, guess = 150, unzoom = (px) => px } = {}) {
    this.axis = axis === "y" ? "y" : "x";
    this.pad = pad;
    this.gap = gap;
    this.guess = guess;
    this.unzoom = unzoom;
    this.widths = {}; // each item's real width, from its own on_size_change
    this.press = null; // { id, x, dx, active, at }: a left press on an item; active once it has become a drag
    this.pending = null; // a drop waiting for the app to report the new order
    this.settle = null; // the last motion of a drop or a cancel
    this.suppress = null; // the item whose release must not count as a click
  }

  // A "row" is { ids, span? }: the items' ids in order, and optionally span(index) -> [lo, hi],
  // the stretch of the row that item may move within (default: the whole row).

  width(id) { return this.widths[id] ?? this.guess; }

  /** The item's laid-out size along the row, from its on_size_change. Stored for the next drag; never a redraw. */
  measure(id, px) { this.widths[id] = this.unzoom(px); }

  /** The item's size along the row, when the row already knows it exactly (no measuring needed). */
  size(id, px) { this.widths[id] = px; }

  /** A left press on an item. */
  pressed(id, e) {
    this.suppress = null;
    this.press = { id, x: e?.position?.[this.axis] ?? 0, dx: 0, active: false, at: 0 };
  }

  /** A drag is under way (the pointer has moved far enough with the button down). */
  get dragging() { return Boolean(this.press?.active); }

  /** A left press somewhere else in the row. A fresh press is never already a drag: one that is has lost its release. */
  otherPress(cx, row) {
    if (this.press?.active) this.release(cx, false, row);
  }

  /** Whether a click on this item should be ignored: the end of a drag is not a click. */
  swallowClick(id) {
    if (this.press?.active) return true;
    if (this.suppress === id) {
      this.suppress = null;
      return true;
    }
    return false;
  }

  /** Pointer movement over the row. Does nothing, and redraws nothing, unless an item is pressed. */
  pointer(e, cx, row) {
    if (this.pending && Date.now() - this.pending.at > PENDING_MS) { // a drop the app never confirmed: let go of it
      this.pending = null;
      cx.notify();
    }
    const p = this.press;
    if (!p || !e?.position) return;
    if (p.active && Date.now() - p.at > STALE_MS) { // the button came up somewhere we never heard of
      this.release(cx, false, row);
      return;
    }
    const dx = Math.round(this.unzoom(e.position[this.axis] - p.x));
    if (!p.active) {
      if (Math.abs(dx) < DRAG_START) return;
      p.active = true;
      this.settle = null;
      this.pending = null;
    }
    if (dx === p.dx) return;
    p.dx = dx;
    p.at = Date.now();
    cx.notify();
  }

  /** Where everything is for a drag of `id` by `dx`: its stretch of the row, its slot, the shifts, the copy's place. */
  geometry(row, id, dx) {
    const index = row.ids.indexOf(id);
    if (index < 0) return null;
    const [lo, hi] = row.span?.(index) ?? [0, row.ids.length - 1];
    const ids = row.ids.slice(lo, hi + 1);
    const from = index - lo;
    const pitch = ids.map((x) => this.width(x) + this.gap); // an item's width plus the gap after it
    const base = this.pad + sum(row.ids.slice(0, lo).map((x) => this.width(x) + this.gap));
    const held = dragClamp(pitch, from, dx);
    const slot = dragSlot(pitch, from, held);
    const shifts = dragShifts(pitch, from, slot);
    const own = sum(pitch.slice(0, from));
    return { lo, hi, ids, from, slot, shifts, followLeft: base + own + held, landLeft: base + own + shifts[from],
      order: [...row.ids.slice(0, lo), ...dragOrder(ids, from, slot), ...row.ids.slice(hi + 1)] };
  }

  /**
   * The button came up (drop: true) or the pointer left the row (drop: false). A press that never
   * became a drag is left to on_click. Returns the move to carry out, { id, target }: the dragged
   * item takes the place `target` holds now. Null when nothing is to move.
   */
  release(cx, drop, row) {
    const p = this.press;
    this.press = null;
    if (!p?.active) return null;
    this.suppress = p.id;
    const g = this.geometry(row, p.id, drop ? p.dx : 0);
    if (!g) {
      cx.notify();
      return null;
    }
    let move = null;
    if (g.slot !== g.from) {
      const shifts = {};
      g.ids.forEach((id, j) => { shifts[id] = g.shifts[j]; });
      this.pending = { id: p.id, before: row.ids.join("|"), shifts, order: g.order, liftLeft: g.landLeft, at: Date.now() };
      this.settle = null;
      move = { id: p.id, target: g.ids[g.slot] };
    } else {
      this.settle = { id: p.id, liftLeft: g.landLeft, back: true, at: Date.now() };
    }
    cx.notify();
    return move;
  }

  /**
   * Called while the row is drawn. Says what, if anything, is in motion:
   *   id      the dragged item
   *   phase   "follow" (its copy follows the pointer), "glide" (dropped; the app has not answered
   *           yet, so the row holds its pose) or "swap" (the copy lands, then swaps with the real item)
   *   glide   neighbors are shifted, and glide when their shift changes
   *   shift   (itemId) -> how far that neighbor sits from its own place
   *   liftLeft, width   where the lifted copy is, and how wide
   *   order   the ids as the row reads right now, the dragged one in the slot it is headed for
   *           (null once the real order has caught up)
   */
  frame(row) {
    const ids = row.ids;
    const now = Date.now();
    if (Object.keys(this.widths).length > 300) { // widths of items long gone
      for (const k of Object.keys(this.widths)) if (!ids.includes(k)) delete this.widths[k];
    }
    if (this.press?.active && !ids.includes(this.press.id)) this.press = null; // the dragged item is gone
    if (this.pending && (ids.join("|") !== this.pending.before || !ids.includes(this.pending.id) || now - this.pending.at > PENDING_MS)) {
      // The order changed: the drop landed, so the copy finishes its glide. Never confirmed: just let go.
      const landed = ids.join("|") !== this.pending.before && ids.includes(this.pending.id);
      this.settle = landed ? { id: this.pending.id, liftLeft: this.pending.liftLeft, back: false, at: now } : null;
      this.pending = null;
    }
    if (this.settle && (now - this.settle.at > SETTLE_MS || !ids.includes(this.settle.id))) this.settle = null;

    if (this.press?.active) {
      const id = this.press.id;
      const g = this.geometry(row, id, this.press.dx);
      const shifts = {};
      g.ids.forEach((x, j) => { shifts[x] = g.shifts[j]; });
      return { id, phase: "follow", glide: true, shift: (x) => (x === id ? 0 : shifts[x] ?? 0), liftLeft: g.followLeft, width: this.width(id), order: g.order };
    }
    if (this.pending) {
      const held = this.pending;
      return { id: held.id, phase: "glide", glide: true, shift: (x) => (x === held.id ? 0 : held.shifts[x] ?? 0), liftLeft: held.liftLeft, width: this.width(held.id), order: held.order };
    }
    if (this.settle) {
      return { id: this.settle.id, phase: "swap", glide: Boolean(this.settle.back), shift: () => 0, liftLeft: this.settle.liftLeft, width: this.width(this.settle.id), order: null };
    }
    return null;
  }

  /**
   * Dresses one real item of the row for this frame (`moving` is what frame() returned): its size is
   * remembered; a neighbor of the dragged item sits shifted and glides; the dragged item itself is
   * unseen while its lifted copy shows, and comes back once the copy has landed.
   */
  dress(el, id, moving) {
    const lifted = moving?.id === id;
    return el
      .on_size_change((size) => this.measure(id, this.axis === "y" ? size.height : size.width))
      .when(Boolean(moving) && !lifted && moving.glide, (x) => (this.axis === "y"
        ? x.top(moving.shift(id)).transition("top", GLIDE)
        : x.left(moving.shift(id)).transition("left", GLIDE)))
      .when(lifted && moving.phase !== "swap", (x) => x.opacity(0).transition("opacity", NOW))
      .when(lifted && moving.phase === "swap", (x) => x.opacity(1).transition("opacity", SWAP));
  }

  /**
   * Places the lifted copy the row has drawn: following the pointer or gliding to its slot, and
   * fading out once it has landed. Along the row it is positioned and sized here (a row of tabs
   * also sits on the row's bottom edge); across the row the caller places it. Give it no handlers,
   * and add it to the row last so it is drawn on top.
   */
  lift(el, moving) {
    const placed = this.axis === "y"
      ? el.absolute().top(moving.liftLeft).h(moving.width)
      : el.absolute().left(moving.liftLeft).bottom(0).w(moving.width);
    return placed
      .transition(this.axis === "y" ? "top" : "left", moving.phase === "follow" ? NOW : GLIDE)
      .opacity(moving.phase === "swap" ? 0 : 1).transition("opacity", moving.phase === "swap" ? SWAP : NOW);
  }
}
