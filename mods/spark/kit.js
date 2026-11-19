// Shared look and helpers for every role. Every color comes from
// theme(), so the frame follows the person's light or dark palette.
//
// Type ("F2"): one family for the whole frame, the layout's ui_font,
// so nothing here names a font. Three sizes only (S, M, L) and two weights only
// (REG, SEMI). Labels are plain sentence case with no letter spacing. Every role
// takes its sizes and weights from here; none sets its own.

import { div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { openOverlay, theme, settings, props, layout, keys, shared, run } from "herdr";
import { clock12, shortcutFor } from "./logic.js";

export const ASSETS = "mods/spark";
export const MOD = "spark"; // the name this mod opens its own overlays under

/** The three text sizes: small (labels, numbers in boxes), medium (names, body), large (titles, the clock). */
export const S = 12;
export const M = 13;
export const L = 15;
/** The two weights. */
export const REG = 400;
export const SEMI = 600;

/** Mix a #rrggbb color toward another (0..1); other inputs pass through. */
export function mix(a, b, w) {
  const ok = (x) => typeof x === "string" && /^#[0-9a-f]{6}$/i.test(x);
  if (!ok(a) || !ok(b)) return a;
  const n = (x, i) => parseInt(x.slice(1 + i * 2, 3 + i * 2), 16);
  return "#" + [0, 1, 2].map((i) => Math.round(n(a, i) * (1 - w) + n(b, i) * w).toString(16).padStart(2, "0")).join("");
}

/** Relative luminance of #rrggbb (0..1), for picking readable text on a color. */
export function lum(h) {
  if (typeof h !== "string" || !/^#[0-9a-f]{6}$/i.test(h)) return 0;
  const ch = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => m - n); return (y + 0.05) / (x + 0.05); };

// Variants, switched only by props a layout gives this mod's blocks:
//   palette: "multicolor"  each tab and space gets a rotating identity hue
//   wash: true             (with multicolor) soft hue-tinted chips and rows
//   <role>: "dark"         e.g. sidebar: "dark", header: "dark": that copy draws
//                          on a dark surface with light text and hairlines
// Extra colors come from the theme file's "colors" (hue1..hue5, dark_*) or
// the same names in props.colors; without these props nothing changes.
function variantColors(t, pr) {
  const own = pr.colors ?? {};
  return (k, fallback) => own[k] ?? t[k] ?? fallback;
}

function darkSurface(base, t, pr) {
  const v = variantColors(t, pr);
  const chrome = v("dark_chrome", t.foreground);
  const fg = v("dark_foreground", t.background);
  const accent = v("dark_accent", t.accent);
  return {
    ...base,
    canvas: chrome, chrome, surface: v("dark_raised", mix(chrome, fg, 0.08)), raised: v("dark_raised", mix(chrome, fg, 0.08)),
    bg: v("dark_raised", mix(chrome, fg, 0.08)), popover: base.popover,
    hover: v("dark_hover", mix(chrome, fg, 0.05)), selected: v("dark_raised", mix(chrome, fg, 0.1)),
    border: v("dark_border", mix(chrome, fg, 0.16)), input: v("dark_input", mix(chrome, fg, 0.28)),
    fg, muted: v("dark_muted", mix(fg, chrome, 0.2)), dim: v("dark_dim", mix(fg, chrome, 0.38)),
    accent, accentFg: v("dark_accent_foreground", chrome),
    solid: v("dark_solid", accent), solidFg: v("dark_solid_foreground", chrome),
    danger: v("dark_danger", t.ansi9 ?? base.danger),
    status: {
      working: v("dark_working", t.ansi12 ?? base.status.working), blocked: v("dark_waiting", t.ansi11 ?? base.status.blocked),
      done: v("dark_done", t.ansi10 ?? base.status.done), idle: v("dark_dim", mix(fg, chrome, 0.38)),
    },
    dark: true,
  };
}

/** The palette, read from the live theme on each render. hue / hueText / hueFg always exist. */
export function P() {
  const t = theme() ?? {};
  const pr = props() ?? {};
  const base = {
    canvas: t.canvas, chrome: t.chrome, surface: t.surface, raised: t.raised, hover: t.hover,
    selected: t.selected, border: t.border, input: t.input, fg: t.foreground, muted: t.muted,
    dim: t.dim, accent: t.accent, accentFg: t.accent_foreground ?? "#ffffff", bg: t.background,
    popover: t.popover, solid: t.solid ?? t.foreground, solidFg: t.solid_foreground ?? t.background,
    danger: t.ansi1,
    status: { working: t.ansi4, blocked: t.ansi3, done: t.ansi2, idle: t.dim },
  };
  let c = base;
  if (pr.role && pr[pr.role] === "dark") c = darkSurface(base, t, pr);
  // The tab strip's gray: a step darker than the bars, from the theme's own colors.
  c = { ...c, strip: mix(c.chrome, c.border, 0.75), rule: c.input };
  if (pr.palette === "multicolor") {
    const v = variantColors(t, pr);
    const hues = [v("hue1", t.ansi4), v("hue2", t.ansi1), v("hue3", t.ansi3), v("hue4", t.ansi2), v("hue5", t.ansi5)];
    const ink = c.dark ? c.fg : t.foreground;
    c = { ...c, multi: true, wash: Boolean(pr.wash), hues,
      /** The identity hue for a 1-based tab or space number. */
      hue: (n) => hues[(((Number(n) || 1) - 1) % hues.length + hues.length) % hues.length],
      /** The same hue deepened for text on a light background (lightened on dark). */
      hueText: (n) => (c.dark ? mix(c.hue(n), "#ffffff", 0.35) : mix(c.hue(n), ink, lum(c.hue(n)) > 0.3 ? 0.45 : 0.28)),
      /** Text on a solid hue: white or ink, whichever reads better. */
      hueFg: (n) => { const w = v("hue_foreground", "#ffffff"); return contrast(w, c.hue(n)) >= contrast(ink, c.hue(n)) ? w : ink; } };
  } else {
    const accent = c.accent;
    const accentFg = c.accentFg;
    c = { ...c, multi: false, wash: false, hues: [accent], hue: () => accent, hueText: () => accent, hueFg: () => accentFg };
  }
  return c;
}

export const WORD = { working: "Working", blocked: "Waiting for you", done: "Done", idle: "Idle" };
export const SHORT = { working: "Working", blocked: "Waiting", done: "Done", idle: "Idle" };

/** A theme color with an alpha byte, for soft tints (pills, washes). */
export function tint(color, alpha = "1f") {
  return typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color) ? color + alpha : color;
}

export const two = (n) => String(n ?? 0).padStart(2, "0");

/** A small label: sentence case, size S, regular (semibold when `strong`). */
export function label(text, color, strong = false) {
  return div().text_size(S).font_weight(strong ? SEMI : REG).text_color(color ?? P().dim).child(String(text ?? ""));
}

/** A number that should stand out a little: semibold, size M unless told otherwise. */
export function figure(text, color, size = M) {
  return div().flex_none().text_size(size).font_weight(SEMI).text_color(color ?? P().fg).child(String(text ?? ""));
}

/**
 * A boxed two-digit number in its identity color. `fill`: "solid" (the color itself,
 * as the sidebar's space boxes and a selected space tab), "soft" (a pale tint, as an
 * unselected space tab) or "outline" (a pale tint with a hairline, as an agent's tab box).
 */
export function numBox(n, size, fill = "solid") {
  const c = P();
  const h = c.hue(n);
  const box = div().w(size).h(size).flex_none().flex().items_center().justify_center().rounded(size >= 28 ? 7 : 6)
    .text_size(size >= 28 ? M : S).font_weight(SEMI);
  if (fill === "solid") return box.bg(h).text_color(c.hueFg(n)).child(two(n));
  if (fill === "outline") return box.bg(tint(h, "24")).border(1).border_color(tint(h, "73")).text_color(c.hueText(n)).child(two(n));
  return box.bg(tint(h, "29")).text_color(c.hueText(n)).child(two(n));
}

export function icon(name, size, color) {
  return svg(`${ASSETS}/icons/${name}.svg`).size(size).flex_none().text_color(color);
}

/** A program's icon from Herdr's program table. */
export function programIcon(program, size, fallback) {
  if (!program?.icon) return icon("program", size, fallback);
  return program.tint ? svg(program.icon).size(size).flex_none().text_color(program.color ?? fallback) : image(program.icon).w(size).h(size).flex_none();
}

/** A soft status dot; waiting breathes gently. */
export function dot(status, size = 7) {
  const c = P().status[status] ?? P().dim;
  return div().w(size).h(size).rounded(size).flex_none().bg(c)
    .when(status === "blocked", (el) => el.loop("opacity", { from: 0.45, to: 1, period: 1800 }));
}

/** A status pill: tinted background, the status word in the status color. */
export function pill(status) {
  const c = P();
  const col = c.status[status] ?? c.dim;
  return div().flex_none().h(20).px(8).flex().items_center().gap(5).rounded(10).bg(tint(col, "1c"))
    .border(1).border_color(tint(col, "40"))
    .child(div().w(5).h(5).rounded(5).flex_none().bg(col)
      .when(status === "blocked", (el) => el.loop("opacity", { from: 0.45, to: 1, period: 1800 })))
    .child(label(SHORT[status] ?? status, col, true));
}

/** A small square badge with a word or a count in it. */
export function chip(text, color, fill) {
  const c = P();
  const col = color ?? c.muted;
  return div().h(18).px(6).flex_none().flex().items_center().rounded(5)
    .bg(fill ?? tint(col, "1f")).border(1).border_color(fill ? c.border : tint(col, "55"))
    .text_size(S).font_weight(SEMI).text_color(col).child(String(text ?? ""));
}

export function displayName(p) {
  if (!p) return "Session";
  if (p.mod) return p.title || p.mod;
  return ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "Shell";
}

export const menu = (tab, target) => openOverlay({ mod: "menu", kind: "popup", width: 220, height: 260, props: { tab, target } });
export const newMenu = () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 });
/** The "+" for spaces: makes a space (it is shown at once), then Herdr asks for its name.
 *  Cancelling the name keeps Herdr's automatic name (where its first terminal is). */
export const newSpace = () => { run("space.new", {}); run("space.rename", {}); };
export const onRight = (open) => (_e, cx) => { cx.stop_propagation(); open(); };
export const stopPress = (_e, cx) => cx.stop_propagation();

/** A size from on_size_change in the units mods draw in (it reports zoomed pixels). */
export function unzoom(px) {
  const z = Number(settings()?.zoom) || 1;
  return px / z;
}

export const clock = (d) => clock12(d.getTime());

/** A node of the shown layout by its id, or null. */
export function layoutNode(id) {
  const find = (node) => {
    if (!node || typeof node !== "object") return null;
    if (node.id === id) return node;
    for (const child of node.children ?? []) {
      const found = find(child);
      if (found) return found;
    }
    return null;
  };
  return find(layout());
}

/**
 * The trial "words beside the plus buttons" switch. It is ONE prop, plus_labels, on the header block
 * in the layout file; the tab row reads the same prop through the layout, so one line turns both on
 * or off. A block that has the prop itself uses its own value.
 */
export function plusLabels() {
  const own = props()?.plus_labels;
  if (typeof own === "boolean") return own;
  return layoutNode("header")?.content?.props?.plus_labels === true;
}

/** Roughly how wide a plus button is: the bare round one, or the one with a word. For fitting names. */
export const plusWidth = (word) => (word ? 34 + Math.ceil(String(word).length * 7.2) : 26);

/**
 * A plus button without its handlers: the bare round "+", or with a word a quiet text button that
 * belongs to its row ("+ Agent", "+ Space"): muted text at the size of an unselected tab, a hover background.
 */
export function plusButton(id, word) {
  const c = P();
  if (!word) {
    return div().id(id).w(26).h(26).flex_none().rounded(13).flex().items_center().justify_center().cursor_pointer()
      .hover((x) => x.bg(c.hover)).child(icon("plus", 14, c.muted));
  }
  return h_flex().id(id).h(26).flex_none().pl(7).pr(9).gap(5).items_center().rounded(7).cursor_pointer()
    .hover((x) => x.bg(c.hover))
    .child(icon("plus", 13, c.muted))
    .child(div().flex_none().text_size(M).font_weight(REG).text_color(c.muted).child(word));
}

/** What a tab is called on screen: its name, else what its lead pane shows. */
export function tabLabel(tab, all, tabName) {
  const own = tabName(tab, all);
  if (own) return own;
  const mine = (all ?? []).filter((p) => p.tab === tab?.id);
  const lead = mine.find((p) => p.focused) ?? mine[0];
  return lead ? displayName(lead) : `Tab ${tab?.index ?? ""}`;
}

// ---- Set when this copy was generated (make_share.py) ---------------------------------

/** The words in the brand block. */
export const TITLE = "Spark";
export const SUBTITLE = "Agent workspace";

/** The brand block's icon: icons/brand.svg as a bare one-color glyph, Carbon by day and Steel by night. */
export function brandMark(c) {
  return icon("brand", 30, lum(c.chrome) < 0.5 ? "#a9bccd" : "#161616");
}

/**
 * A tooltip with the key that runs `action` in brackets, read from the key bindings
 * (so it is right on any system and after any rebinding). Nothing bound: no brackets.
 */
export function withKey(text, action, note) {
  const key = shortcutFor(keys(), action, shared("layout"));
  return key ? `${text} (${key}${note ? ` ${note}` : ""})` : text;
}
