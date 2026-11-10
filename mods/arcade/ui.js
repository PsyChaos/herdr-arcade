// Shared look for the Arcade mod: pixel fonts, the neon palette, chunky frames with a hard
// drop shadow, pixel buttons, the HP bar and the arcade words for each agent status.

import { div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";

export const A = "mods/arcade";
// Pixel fonts shipped in mods/arcade/fonts (SIL OFL): headings in Press Start 2P, text in VT323.
export const F = { head: "Press Start 2P", body: "VT323" };
export const C = {
  night: "#0d0221",
  deep: "#1a0b3d",
  panel: "#120733e8",
  raised: "#1e0f4e",
  edge: "#7b2cbf",
  cyan: "#05d9e8",
  magenta: "#ff2a6d",
  pink: "#ff6ec7",
  yellow: "#ffd319",
  lime: "#9cff57",
  orange: "#ff8c42",
  violet: "#9d5cff",
  text: "#f6f1ff",
  muted: "#bba9f0",
  dim: "#7d6bb3",
  shadow: "#000000b8",
};

// One set of status colours and words, used everywhere.
export const STATUS = { working: C.cyan, blocked: C.yellow, done: C.lime, idle: C.dim };
export const WORD = { working: "PLAYING", blocked: "CONTINUE?", done: "STAGE CLEAR", idle: "READY" };

// Text in the heading font (caps, small sizes) and in the body font.
export const pt = (text, size = 10, color = C.text) =>
  div().flex_none().font_family(F.head).text_size(size).line_height(`${Math.round(size * 1.5)}px`).text_color(color).child(text);
export const vt = (text, size = 19, color = C.text) => div().font_family(F.body).text_size(size).text_color(color).child(text);

// A hard pixel shadow under the element that follows it (both in a relative parent).
const shade = (depth) => div().absolute().top(depth).left(depth).size_full().bg(C.shadow);

// `el` in a 2px pixel frame with a hard shadow `depth` px down-right. The shadow is drawn
// outside the box: leave that much room at the right and bottom.
export function frame(key, el, { edge = C.edge, fill = C.panel, shadow = true, tall = false, depth = 4 } = {}) {
  return div().id(`fr-${key}`).relative().w_full().when(tall, (d) => d.h_full())
    .when(shadow, (d) => d.child(shade(depth)))
    .child(div().relative().size_full().bg(fill).border(2).border_color(edge).child(el));
}

// A pixel button over a 3px hard shadow; `on` lights it in `tone` with dark text.
export function button(id, child, action, { on = false, tone = C.magenta, h = 30, w } = {}) {
  const face = h_flex().id(`${id}-face`).relative().h(h).when(w != null, (d) => d.w(w).justify_center()).when(w == null, (d) => d.px(10))
    .gap(8).items_center().border(2)
    .border_color(on ? tone : C.edge).bg(on ? tone : C.raised).text_color(on ? C.night : C.muted)
    .hover((x) => x.border_color(on ? tone : C.cyan).text_color(on ? C.night : C.text))
    .child(child);
  return div().id(id).relative().flex_none().cursor_pointer()
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => { cx.stop_propagation(); action(); })
    .child(shade(3)).child(face);
}

// The HP bar: chunky blocks with 2px gaps, green when healthy, yellow when low, pink at the end.
export function hpBar(pct, { blocks = 20, h = 12 } = {}) {
  const v = Math.max(0, Math.min(100, pct));
  const filled = Math.round((v / 100) * blocks);
  const color = v > 50 ? C.lime : v > 20 ? C.yellow : C.magenta;
  return h_flex().flex_1().min_w(0).h(h).gap(2).children(
    Array.from({ length: blocks }, (_, i) => div().h_full().flex_1().bg(i < filled ? color : "#ffffff14")));
}

// A small meter (CPU, RAM): 10 blocks, cyan, then yellow and pink as it fills.
export function meter(pct, { blocks = 10, w = 60, h = 10 } = {}) {
  const v = Math.max(0, Math.min(100, pct)), filled = Math.round((v / 100) * blocks);
  const color = v > 85 ? C.magenta : v > 60 ? C.yellow : C.cyan;
  return h_flex().w(w).flex_none().h(h).gap(1).children(
    Array.from({ length: blocks }, (_, i) => div().h_full().flex_1().bg(i < filled ? color : "#ffffff18")));
}

export function icon(name, size, color) {
  return svg(`${A}/${name}.svg`).size(size).flex_none().text_color(color);
}

export function programIcon(p, size, color = C.text) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(p.color ?? color) : image(p.icon).w(size).h(size).flex_none();
}

const TILES = [C.magenta, C.cyan, C.yellow, C.lime, C.orange, C.pink, C.violet];
function tileColor(name) {
  let h = 0;
  for (const ch of name || "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TILES[h % TILES.length];
}

// A square tile with the name's first letter in the pixel font.
export function letterTile(name, size = 20) {
  const ch = (name || "?").replace(/^[^\p{L}\p{N}]+/u, "").charAt(0).toUpperCase() || "?";
  return div().size(size).flex_none().bg(tileColor(name)).flex().items_center().justify_center()
    .font_family(F.head).text_size(Math.round(size * 0.45)).text_color(C.night).child(ch);
}

// The status mark: a play arrow while working, a ! while it needs you, a star when done, a ring idle.
export function statusMark(status, size = 14) {
  const name = { working: "play", blocked: "warning", done: "star" }[status] ?? "ring";
  return icon(name, size, STATUS[status] ?? C.dim);
}

// A status chip in the heading font: the arcade word on the status colour.
export function chip(status, size = 7) {
  const lit = status && status !== "idle";
  return div().flex_none().px(6).py(4).bg(lit ? STATUS[status] : "#ffffff14")
    .font_family(F.head).text_size(size).text_color(lit ? C.night : C.muted).child(WORD[status] ?? "NO PLAYER");
}

export function ago(ms, long = false) {
  if (!ms) return "";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return long ? `${s}s ago` : `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return long ? `${m}m ${s % 60}s ago` : `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return long ? `${h}h ${m % 60}m ago` : `${h}h`;
  return long ? `${Math.floor(h / 24)}d ago` : `${Math.floor(h / 24)}d`;
}
