// Arcade: the 8-bit chrome of the "arcade" layout. One mod, roles chosen by props().role:
//   "top"      title bar: logo, command search, credits, bell, help, settings, window buttons
//   "sidebar"  workspaces (spaces by machine) and players (agents, with their sub-agents)
//   "tabs"     the shown space's tabs as pixel buttons
//   "session"  the focused agent's run: NOW PLAYING, MOVE LIST, SCREEN
//   "status"   the score bar: machine, stage (branch), players, CPU, RAM, score, START
//   "pane"     each pane's header: program, folder, status chip, +, Files, Changes, ⋮
//   "sidetabs" the right column's SESSION / TASKS switch
//   "bell"     the MESSAGES popup;  "tasks" stands in for task-board until it is found
// Run details (model, effort, context, tokens) come from the agent's own screen
// (`hc read`): a Claude Code status line like extras/claude-statusline.sh prints.

import { View, div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import {
  agents, spaces, panes, focused, terminals, machines, layout,
  run, props, hc, exec, readTextFile, keys, window, home, appHome, openOverlay, closeOverlay,
} from "herdr";
import { A, C, F, STATUS, WORD, pt, vt, frame, button, hpBar, meter, icon, programIcon, letterTile, statusMark, chip, ago } from "./ui.js";

const stop = (_e, cx) => cx.stop_propagation();

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const f = find(child, id);
    if (f) return f;
  }
  return null;
}

function short(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}
const base = (p) => (p || "").replace(/\/+$/, "").split("/").pop();
const up = (s) => String(s ?? "").toUpperCase();

// Claude Code's status line and live progress line, the last tool calls and output lines.
function parseScreen(text) {
  const lines = (text || "").split("\n");
  const info = { commands: [], output: [] };
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (!info.model) {
      const m = l.match(/^\s*(\S[^|]*?)(?: · (low|medium|high|xhigh|max))? \|.*?ctx\s+\S*\s*%(\d+)\s+(\S+)\/(\S+)(?:.*?↑(\S+)\s+↓(\S+))?(?:.*?5s (\d+)%)?(?:.*?7g (\d+)%)?/);
      if (m) Object.assign(info, { model: m[1].trim(), effort: m[2], left: +m[3], used: m[4], size: m[5], up: m[6], down: m[7], l5: m[8], l7: m[9] });
    }
    if (!info.mode) {
      const md = l.match(/(auto mode|accept edits|plan mode|bypass permissions) on/);
      if (md) info.mode = { "auto mode": "auto", "accept edits": "accept edits", "plan mode": "plan", "bypass permissions": "bypass" }[md[1]];
    }
    if (!info.doing) {
      const d = l.match(/^\s*[✻✽✢·*✶✳]\s+(\S+…)\s+\(([^)]*)\)/);
      if (d) info.doing = { verb: d[1], detail: d[2] };
    }
  }
  for (const l of lines) {
    const b = l.match(/^\s*[●⏺]\s+Bash\((.*?)\)?\s*$/);
    if (b) info.commands.push(b[1]);
  }
  info.commands = info.commands.slice(-6).reverse();
  let sep = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (/^─{20,}/.test(lines[i])) { sep = i; break; }
  let end = sep;
  for (let i = sep - 1; i >= 0; i--) if (/^─{20,}/.test(lines[i])) { end = i; break; }
  const body = (end > 0 ? lines.slice(0, end) : lines).map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim() && !/^[─━]{10,}/.test(l) && !/Update available!/.test(l));
  info.output = body.slice(-7);
  info.outputAll = body.slice(-60);
  return info;
}

// The MESSAGES popup: agents that need you, then finished ones. Its rows have fixed heights
// because flexible children collapse to nothing inside a popup.
const BELL = { head: 44, label: 28, row: 46, empty: 70, max: 480 };
function bellItems(list, tabOf) {
  const at = (a) => tabOf(a)?.changed_at ?? 0;
  const newest = (xs) => [...xs].sort((x, y) => at(y) - at(x));
  return { needs: newest(list.filter((a) => a.status === "blocked")), done: newest(list.filter((a) => a.status === "done")) };
}
function bellHeight(list, tabOf) {
  const { needs, done } = bellItems(list, tabOf);
  const n = needs.length + done.length;
  const groups = [needs, done].filter((x) => x.length).length;
  return Math.min(BELL.max, BELL.head + (n ? groups * BELL.label + n * BELL.row + 8 : BELL.empty) + 4);
}

// The TASKS tab shows the task-board mod (github.com/PsyChaos/herdr-mods) when it is
// installed. The shipped layout names only this mod there, because a layout naming a
// missing mod is refused as a whole; once task-board is found, the block is switched to it.
const BOARD = "task-board";
function withContent(node, id, content) {
  if (node?.id === id) return { ...node, content };
  return node?.children ? { ...node, children: node.children.map((c) => withContent(c, id, content)) } : node;
}

export default class Arcade extends View {
  init(_props, cx) {
    this.role = props()?.role ?? "session";
    this.screen = {};
    this.cpu = null; this.ram = null; this.prevCpu = null;
    this.folded = new Set();
    if (this.role === "session" || this.role === "status") {
      this.refresh(cx);
      cx.timer.every(this.role === "session" ? 4000 : 5000, (cx) => this.refresh(cx));
    }
    if (this.role === "sidebar") cx.timer.every(30000, (cx) => cx.notify()); // "4m" labels
    if (this.role === "sidetabs") {
      this.ticks = 0;
      cx.spawn((cx) => this.syncBoard(cx));
      cx.timer.every(3000, (cx) => cx.spawn((cx) => this.syncBoard(cx)));
    }
  }

  target() {
    const f = focused();
    const list = agents();
    const latest = (xs) => xs.reduce((b, a) => (!b || a.seq > b.seq ? a : b), null);
    return list.find((a) => a.focused)
      ?? latest(list.filter((a) => f && a.tab === f.tab))
      ?? latest(list.filter((a) => f && a.space === f.space))
      ?? null;
  }

  // Reads only the visible screen: `hc read` with history takes seconds on a long
  // agent session and blocks the core, so every terminal lags and loses its scroll.
  refresh(cx) {
    if (this.busy) return;
    if (this.role === "session" && (find(layout(), "side-body")?.active ?? "side-session") !== "side-session") return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const a = this.target();
        if (a) {
          try {
            const r = await hc(["read", a.address, "--lines", "0"]);
            if (r.code === 0) this.screen = { address: a.address, ...parseScreen(r.stdout) };
          } catch (_) { /* unreachable machine: keep the last screen */ }
        } else this.screen = {};
        if (this.role === "status") await this.readSystem();
        cx.notify();
      } finally { this.busy = false; }
    });
  }

  async readSystem() {
    try {
      const stat = await readTextFile("/proc/stat");
      const n = stat.split("\n")[0].trim().split(/\s+/).slice(1).map(Number);
      const idle = n[3] + (n[4] || 0), total = n.reduce((s, v) => s + v, 0);
      if (this.prevCpu) {
        const dt = total - this.prevCpu.total, di = idle - this.prevCpu.idle;
        if (dt > 0) this.cpu = Math.round(100 * (1 - di / dt));
      }
      this.prevCpu = { idle, total };
      const mem = await readTextFile("/proc/meminfo");
      const kb = (k) => +(mem.match(new RegExp(`^${k}:\\s+(\\d+)`, "m"))?.[1] ?? 0);
      const tot = kb("MemTotal"), av = kb("MemAvailable");
      if (tot) this.ram = { used: (tot - av) / 1048576, total: tot / 1048576 };
    } catch (_) { /* not Linux: the meters stay hidden */ }
  }

  // The pixel font is set here, on each role's root, not as the layout's ui_font: other mods
  // (Ports, Docker, menus…) are sized for Herdr's own font and would come out too small.
  render(cx) {
    return this.draw(cx).font_family(F.body);
  }

  draw(cx) {
    switch (this.role) {
      case "top": return this.top(cx);
      case "sidebar": return this.sidebar(cx);
      case "tabs": return this.tabs(cx);
      case "status": return this.status(cx);
      case "pane": return this.pane(cx);
      case "sidetabs": return this.sidetabs(cx);
      case "bell": return this.bell(cx);
      case "tasks": return div().size_full();
      default: return this.session(cx);
    }
  }

  // ------------------------------------------------------------ title bar
  top(cx) {
    const w = window();
    const btn = (id, child, action) => div().id(id).size(34).flex_none().flex().items_center().justify_center()
      .text_color(C.muted).hover((s) => s.bg("#ffffff14").text_color(C.text))
      .on_mouse_down("left", stop).on_click(action).child(child);
    const hint = this.paletteKey();
    const list = agents();
    const needs = list.filter((a) => a.status === "blocked").length;
    const done = list.filter((a) => a.status === "done").length;
    // The wordmark: white pixel letters over a magenta copy 3px down-right.
    const word = div().relative().flex_none().h(24)
      .child(div().absolute().top(3).left(3).font_family(F.head).text_size(20).text_color(C.magenta).child("HERDR"))
      .child(div().relative().font_family(F.head).text_size(20).text_color(C.text).child("HERDR"));
    const search = h_flex().id("a-search").w_full().h(36).px(12).gap(10).items_center().cursor_pointer()
      .on_mouse_down("left", stop).on_click(() => run("app.palette"))
      .child(pt(">", 11, C.yellow))
      .child(div().flex_1().min_w(0).truncate().font_family(F.body).text_size(20).text_color(C.muted)
        .child("SEARCH WORKSPACES, AGENTS, FILES OR RUN A COMMAND"))
      .child(div().w(10).h(18).flex_none().bg(C.cyan))
      .when(Boolean(hint), (el) => el.child(div().px(7).py(3).flex_none().bg("#ffffff14").border(1).border_color(C.edge)
        .font_family(F.body).text_size(17).text_color(C.text).child(hint)));
    return h_flex().size_full().px(14).gap(16).items_center()
      .when(w?.platform === "macos" && !w?.fullscreen, (el) => el.pl(84))
      .child(h_flex().flex_1().min_w(0).gap(12).items_center()
        .child(image(`${A}/logo.svg`).size(36).flex_none())
        .child(word)
        .child(div().ml(4).px(6).py(3).flex_none().border(2).border_color(C.cyan).font_family(F.head).text_size(7).text_color(C.cyan).child("ARCADE")))
      // equal flex_1 sides keep the search field centred in the window
      .child(div().w(640).flex_none().pr(4).pb(4).child(frame("search", search, { edge: C.cyan, fill: "#0d0221f0" })))
      .child(h_flex().flex_1().min_w(0).gap(14).items_center().justify_end()
        .child(h_flex().gap(8).items_center().flex_none().mr(6)
          .child(pt("CREDIT", 9, C.yellow)).child(pt(String(list.length).padStart(2, "0"), 9, C.text)))
        .child(btn("a-bell", div().relative().size(20)
          .child(icon("bell", 20, C.muted))
          .when(needs > 0 || done > 0, (el) => el.child(div().absolute().top(0).right(0).size(6).bg(needs > 0 ? C.magenta : C.lime))),
          () => {
            const all = spaces();
            const tabOf = (a) => all.find((s) => s.id === a.space)?.tabs.find((t) => t.id === a.tab);
            const height = bellHeight(agents(), tabOf);
            openOverlay({ mod: "arcade", kind: "popup", width: 380, height, props: { role: "bell", height } });
          }))
        .child(btn("a-help", icon("help", 19, C.muted), () => run("app.help")))
        .child(btn("a-settings", icon("settings", 19, C.muted), () => run("app.settings")))
        .child(image(`${A}/coin.svg`).size(30).flex_none())
        .when(Boolean(w?.buttons), (el) => el
          .child(div().w(6))
          .child(btn("a-min", pt("_", 10, C.muted), () => run("window.minimize")))
          .child(btn("a-max", pt(w.maximized ? "=" : "#", 10, C.muted), () => run("window.maximize")))
          .child(btn("a-close", icon("close", 14, C.muted), () => run("window.close")))));
  }

  paletteKey() {
    const mac = window()?.platform === "macos";
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    if (!b) return null;
    const m = { cmd: "⌘", ctrl: mac ? "⌃" : "Ctrl", shift: mac ? "⇧" : "Shift", alt: mac ? "⌥" : "Alt" };
    return b.keys.split("-").map((p) => m[p.toLowerCase()] ?? p.toUpperCase()).join(mac ? "" : "+");
  }

  // ------------------------------------------------------------ sidebar
  sidebar(cx) {
    const all = spaces();
    const ms = [null, ...machines().map((m) => m.name).filter((n) => n !== null)];
    const head = (ic, title, right) => h_flex().h(30).px(14).gap(10).items_center()
      .child(icon(ic, 16, C.cyan)).child(div().flex_1().child(pt(title, 10, C.cyan))).child(right);
    const sub = (text, color = C.dim) => div().px(14).pt(10).pb(3).child(pt(text, 7, color));

    // The active space wears the menu cursor: a yellow ▶ in front of it.
    const spaceRow = (s) => {
      const norm = (x) => (x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const repo = s.folder && s.folder !== home() ? base(s.folder) : "";
      const right = [repo && norm(repo) !== norm(s.name) ? repo : null, s.branch].filter(Boolean).join(" · ");
      return h_flex().id(`a-sp-${s.id}`).h(28).mx(10).px(6).gap(8).items_center().cursor_pointer()
        .border(2).border_color(s.active ? C.magenta : "#00000000").when(s.active, (el) => el.bg("#ff2a6d1f"))
        .when(!s.active, (el) => el.hover((st) => st.bg("#ffffff10")))
        .on_click(() => run("space.select", { id: s.id }))
        .child(div().w(10).flex_none().child(s.active ? pt("▶", 8, C.yellow) : div()))
        .child(letterTile(s.name, 18))
        .child(div().flex_none().max_w(140).truncate().font_family(F.body).text_size(21).text_color(s.active ? "#ffffff" : C.text).child(s.name))
        .when(s.status && s.status !== "idle", (el) => el.child(statusMark(s.status, 12)))
        .child(div().flex_1().min_w(0).text_right().truncate().font_family(F.body).text_size(17).text_color(s.active ? C.muted : C.dim).child(right));
    };

    const machineRow = (m) => {
      const state = m === null ? "ready" : machines().find((x) => x.name === m)?.layout;
      return h_flex().id(`a-m-${m ?? "local"}`).h(24).px(14).gap(9).items_center()
        .child(icon(m ? "server" : "monitor", 14, C.muted))
        .child(div().flex_1().truncate().font_family(F.body).text_size(18).text_color(C.muted).child(up(m ?? "This computer")))
        .child(div().size(6).bg(state === "ready" ? C.lime : state === "loading" ? C.yellow : C.dim))
        .child(div().id(`a-m-new-${m ?? "local"}`).px(4).font_family(F.body).text_size(20).text_color(C.dim).hover((st) => st.text_color(C.text).bg("#ffffff12"))
          .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); }).child("+"));
    };

    // Players, with sub-agents (started by another agent with `hc run`) under their parent.
    // A sub-agent started with --bg has no pane, so it is only in terminals(), not agents().
    const list = agents();
    const terms = terminals();
    const qualify = (a, p) => (a.includes("/") && !p.includes("/") ? a.split("/")[0] + "/" + p : p);
    const byAddr = new Map(list.map((a) => [a.address, a]));
    const kids = new Map();
    for (const k of terms) {
      if (!k.parent || k.state !== "live") continue;
      const p = qualify(k.address, k.parent);
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(k);
    }
    // A kept sub-agent (one with a pane) is in agents() too: it shows under its parent only.
    const nested = new Set();
    const walk = (addr, seen = new Set()) => {
      for (const k of kids.get(addr) ?? []) if (!seen.has(k.address)) { seen.add(k.address); nested.add(k.address); walk(k.address, seen); }
    };
    for (const a of list) walk(a.address);
    const tops = list.filter((a) => a.pinned || !nested.has(a.address));
    // Its raw word, error counting as blocked; never done: the parent's done is the news.
    const kidStatus = (k) => {
      const st = byAddr.get(k.address)?.status ?? k.status;
      return st === "error" ? "blocked" : st === "done" ? "idle" : st;
    };
    const tabOf = (a) => all.find((s) => s.id === a.space)?.tabs.find((t) => t.id === a.tab);
    const groups = [
      ["PINNED", C.pink, tops.filter((a) => a.pinned)],
      [WORD.blocked, STATUS.blocked, tops.filter((a) => !a.pinned && a.status === "blocked")],
      [WORD.working, STATUS.working, tops.filter((a) => !a.pinned && a.status === "working")],
      [WORD.done, STATUS.done, tops.filter((a) => !a.pinned && a.status === "done")],
      [WORD.idle, C.dim, tops.filter((a) => !a.pinned && a.status === "idle")],
    ].filter(([, , xs]) => xs.length);
    // Player numbers follow the order on screen: P1, P2, …
    const order = groups.flatMap(([, , xs]) => xs).map((a) => a.address);

    const subRow = (k, depth, seen) => {
      const st = kidStatus(k);
      const subs = (kids.get(k.address) ?? []).filter((x) => !seen.has(x.address));
      const row = h_flex().id(`a-sub-${k.address}`).h(24).mx(10).px(6).gap(8).items_center().cursor_pointer()
        .hover((x) => x.bg("#ffffff10"))
        .on_click(() => (byAddr.has(k.address) ? run("pane.focus", { terminal: k.address }) : run("terminal.peek", { terminal: k.address })))
        .child(div().w(16 * depth).flex_none().text_right().font_family(F.body).text_size(18).text_color(C.dim).child("└"))
        .child(programIcon(k.program, 14) ?? icon("terminal", 14, C.muted))
        .child(div().flex_1().min_w(0).truncate().font_family(F.body).text_size(18).text_color(st === "idle" ? C.muted : C.text)
          .child(k.labels?.task || k.name || k.template || k.program?.name || k.address))
        .child(statusMark(st, 12));
      const next = new Set([...seen, ...subs.map((x) => x.address)]);
      return [row, ...subs.flatMap((x) => subRow(x, depth + 1, next))];
    };

    const agentRow = (a) => {
      const subs = kids.get(a.address) ?? [];
      const folded = this.folded.has(a.address);
      const detail = `${a.space_name}${a.tab_name && !/^\d+$/.test(a.tab_name) ? " · " + a.tab_name : ""}`;
      const color = STATUS[a.status] ?? C.dim;
      const n = order.indexOf(a.address) + 1;
      const fold = (_e, cx) => { cx.stop_propagation(); folded ? this.folded.delete(a.address) : this.folded.add(a.address); cx.notify(); };
      const row = h_flex().id(`a-ag-${a.address}`).h(28).mx(10).px(6).gap(8).items_center().cursor_pointer()
        .border(2).border_color(a.focused ? C.cyan : "#00000000").when(a.focused, (el) => el.bg("#05d9e81a"))
        .when(!a.focused, (el) => el.hover((st) => st.bg("#ffffff10")))
        .on_click(() => run("pane.focus", { pane: a.pane }))
        .child(div().w(26).flex_none().child(pt(`P${n}`, 7, color)))
        .child(div().id(`a-fold-${a.address}`).when(subs.length > 0, (el) => el.on_click(fold))
          .child(programIcon(a.program, 15) ?? icon("terminal", 15, C.muted)))
        .child(div().flex_1().min_w(0).truncate().font_family(F.body).text_size(20).text_color(a.status === "idle" && !a.focused ? C.muted : C.text).child(detail))
        .when(subs.length > 0, (el) => el.child(div().id(`a-foldc-${a.address}`).font_family(F.body).text_size(17).text_color(C.dim)
          .on_click(fold).child(folded ? `+${subs.length}` : "−")))
        .child(div().w(26).flex_none().text_right().font_family(F.body).text_size(16).text_color(C.dim).child(ago(tabOf(a)?.changed_at)))
        .child(statusMark(a.status, 13));
      return [row, ...(folded ? [] : subs.flatMap((k) => subRow(k, 1, new Set([a.address, ...subs.map((x) => x.address)]))))];
    };

    const rule = () => div().mx(14).my(8).h(2).bg(C.edge);
    const content = v_flex().size_full().py(10)
      .child(head("layers", "WORKSPACES", div().id("a-new-space").size(24).flex().items_center().justify_center()
        .font_family(F.body).text_size(24).text_color(C.muted).hover((st) => st.bg("#ffffff14").text_color(C.text))
        .on_click(() => run("space.new")).child("+")))
      .child(v_flex().id("a-spaces").flex_1().min_h(0).overflow_y_scrollbar().pb(6).gap(2)
        .children(ms.flatMap((m) => {
          const xs = all.filter((s) => (s.machine ?? null) === m);
          return m !== null && !xs.length ? [] : [machineRow(m), ...xs.map(spaceRow)];
        })))
      .child(rule())
      .child(head("agents", "PLAYERS", pt(String(tops.length), 8, C.dim)))
      .child(v_flex().id("a-agents").flex_1().min_h(0).overflow_y_scrollbar().gap(2)
        .when(!groups.length, (el) => el.child(div().px(14).pt(12).child(pt("INSERT COIN", 8, C.dim))))
        .children(groups.flatMap(([name, color, xs]) => [sub(`${name}  ${xs.length}`, color), ...xs.flatMap((a) => agentRow(a))])))
      .child(rule())
      .child(h_flex().id("a-add-machine").h(28).px(14).gap(10).items_center().cursor_pointer()
        .hover((st) => st.bg("#ffffff10")).on_click(() => run("mod.open", { name: "machine-add" }))
        .child(icon("plus", 14, C.muted)).child(pt("ADD MACHINE", 7, C.muted)));
    return div().id("a-sidebar").size_full().pr(4).pb(4).child(frame("sidebar", content, { tall: true }));
  }

  // ------------------------------------------------------------ tabs
  tabs(cx) {
    const space = spaces().find((p) => p.active);
    const shown = space?.tabs ?? [];
    const all = panes();
    const tab = (c) => {
      const program = all.find((p) => p.tab === c.id && p.program?.agent)?.program ?? all.find((p) => p.tab === c.id)?.program;
      const auto = /^\d+$/.test(c.name) || /^tb\d+$/.test(c.name);
      const agent = Boolean(program?.agent);
      const name = auto ? (agent ? program.name : String(c.index)) : c.name;
      const pic = agent ? programIcon(program, 15) : program?.shell ? icon("terminal", 15, c.active ? C.night : C.muted) : null;
      const body = h_flex().gap(8).items_center()
        .when(Boolean(pic), (el) => el.child(pic))
        .child(div().max_w(170).truncate().font_family(F.body).text_size(20).child(up(c.zoomed ? `${name} ⤢` : name)))
        .when(!c.active && c.status && c.status !== "idle", (el) => el.child(div().size(6).bg(STATUS[c.status] ?? C.dim)))
        .when(c.active, (el) => el.child(div().id(`a-tabx-${c.id}`).text_color(C.night).hover((x) => x.text_color("#ffffff"))
          .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); })
          .child(icon("close", 12, C.night))));
      return div().id(`a-tab-${c.id}`).flex_none()
        .on_mouse_down("left", (e, cx) => { if (e.click_count === 2) { cx.stop_propagation(); run("tab.rename", { id: c.id }); } })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .child(button(`a-tabb-${c.id}`, body, () => run("tab.select", { id: c.id }), { on: c.active, tone: C.magenta }));
    };
    return h_flex().id("a-tabs").size_full().min_w(0).gap(8).items_start()
      .on_scroll_wheel((e) => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(button("a-grid", icon("grid", 15, C.muted), () => run("mod.open", { name: "picker" }), { w: 30 }))
      .child(h_flex().id("a-tab-scroll").flex_1().min_w(0).h(34).items_start().gap(8).overflow_x_scrollbar().children(shown.map(tab)))
      .child(div().pr(4).child(button("a-tab-new", icon("plus", 14, C.muted), () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 }), { w: 30 })));
  }

  // ------------------------------------------------------------ session
  session(cx) {
    const a = this.target();
    const s = a && this.screen.address === a.address ? this.screen : {};
    const space = a ? spaces().find((x) => x.id === a.space) : spaces().find((x) => x.active);
    const tab = space?.tabs.find((t) => t.id === a?.tab);
    const pane = a ? panes().find((p) => p.pane === a.pane) : null;
    const working = a?.status === "working";

    const card = (id, title, ic, color, extra) => v_flex().id(id).w_full().px(12).pt(10).pb(12).gap(6)
      .child(h_flex().h(22).gap(9).items_center()
        .child(icon(ic, 15, color))
        .child(div().flex_1().child(pt(title, 9, color)))
        .when(Boolean(extra), (el) => el.child(extra)));
    const wrap = (key, el, fill = false) => div().w_full().pr(4).pb(4).when(fill, (d) => d.flex_1().min_h(0))
      .child(frame(key, fill ? el.h_full() : el, { tall: fill }));

    const row = (label, value, valueIcon) => h_flex().h(20).gap(8).items_center()
      .child(div().w(76).flex_none().font_family(F.body).text_size(18).text_color(C.dim).child(label))
      .when(Boolean(valueIcon), (el) => el.child(valueIcon))
      .child(div().flex_1().truncate().font_family(F.body).text_size(19).text_color(C.text).child(value || "—"));

    const runCard = card("a-run", "NOW PLAYING", "joystick", C.yellow, chip(a?.status))
      .when(!a, (el) => el.child(div().pt(4).child(pt("FOCUS A PLAYER'S PANE", 7, C.dim))))
      .when(Boolean(a), (el) => el
        // the score line: tokens in, big, like a high score
        .when(Boolean(s.up), (el) => el.child(h_flex().h(30).mt(2).mb(4).px(8).pt(4).gap(12).items_center().justify_center().bg("#ffd3191a").border(2).border_color("#ffd31955")
          .child(pt("SCORE", 8, C.yellow, 8)).child(pt(up(s.up), 11, C.text, 11))
          .child(pt(`↓${up(s.down)}`, 7, C.muted, 7))))
        .child(row("PLAYER", a.program?.name ?? a.app ?? "agent", programIcon(a.program, 14)))
        .child(row("STAGE", short(pane?.cwd) || space?.name, icon("folder", 14, C.cyan)))
        .child(row("WORLD", `${space?.name ?? ""} · ${space?.machine ?? "This computer"}`))
        .when(Boolean(pane?.branch), (el) => el.child(row("BRANCH", pane.branch, icon("git-branch", 14, C.pink))))
        .child(row("MODE", s.model ? s.mode ?? "default" : ""))
        .child(row("MODEL", s.model ? `${s.model}${s.effort ? ` (${s.effort})` : ""}` : ""))
        .child(row("TIME", ago(tab?.working_since ?? tab?.changed_at, true)))
        .when(s.left != null, (el) => el.child(v_flex().gap(6).pt(6)
          .child(h_flex().gap(8).items_center()
            .child(icon("heart", 14, s.left > 50 ? C.lime : s.left > 20 ? C.yellow : C.magenta))
            .child(pt("HP", 8, C.text))
            .child(hpBar(s.left))
            .child(div().w(44).flex_none().text_right().child(pt(`${s.left}%`, 8, C.text))))
          .child(div().font_family(F.body).text_size(17).text_color(C.dim)
            .child(`${up(s.used)} / ${up(s.size)}${s.l5 ? `  ·  LIMIT 5H ${s.l5}% · 7D ${s.l7}%` : ""}`)))));

    const cmds = card("a-cmds", "MOVE LIST", "terminal", C.cyan)
      .when(!s.commands?.length, (el) => el.child(div().font_family(F.body).text_size(18).text_color(C.dim).child("NO MOVES ON SCREEN YET")))
      .children((s.commands ?? []).map((c, i) => {
        const live = i === 0 && working;
        return h_flex().id(`a-cmd-${i}`).h(24).px(6).gap(8).items_center()
          .when(live, (el) => el.bg("#05d9e826"))
          .child(live ? icon("play", 12, C.cyan) : icon("check", 12, C.lime))
          .child(div().flex_1().truncate().font_family(F.body).text_size(18).text_color(i === 0 ? "#ffffff" : C.muted).child(c));
      }));

    // The corner button grows SCREEN over the whole column (more of the screen) and back.
    const big = Boolean(this.outBig);
    const lines = (big ? s.outputAll : s.output) ?? [];
    const toggle = div().id("a-out-open").px(5).py(2).border(2).border_color(C.edge).cursor_pointer()
      .hover((x) => x.border_color(C.cyan))
      .on_click((_e, cx) => { this.outBig = !big; cx.notify(); }).child(pt(big ? "-" : "+", 8, C.muted));
    const out = card("a-out", "SCREEN", "list", C.pink, toggle).overflow_hidden()
      .child(v_flex().id("a-out-lines").flex_1().min_h(0).gap(1).font_family(F.body).text_size(18)
        .when(big, (el) => el.overflow_y_scrollbar())
        .when(!lines.length, (el) => el.child(div().text_color(C.dim).child("> WAITING FOR OUTPUT_")))
        .children(lines.map((l, i) => h_flex().gap(8)
          .child(div().flex_none().text_color(C.pink).child(">"))
          .child(div().flex_1().truncate().text_color(i === lines.length - 1 ? "#ffffff" : C.muted).child(l.trim())))));

    if (big) return v_flex().size_full().child(wrap("out", out, true));
    return v_flex().size_full().gap(8)
      .child(wrap("run", runCard)).child(wrap("cmds", cmds)).child(wrap("out", out, true));
  }

  // ------------------------------------------------------------ pane header
  pane(cx) {
    const me = panes().find((p) => p.pane === props()?.pane);
    if (!me) return div();
    const pane = me.pane;
    const name = ((me.program?.agent || me.program?.shell) && me.program.name) || me.title || me.program?.name || "shell";
    const root = layout(), pnl = find(root, "panel"), body = find(root, "panel-body");
    const btn = (id, child, action, on = false) => h_flex().id(id).h(24).px(7).gap(6).flex_none().items_center()
      .bg(on ? C.cyan : "#00000000").border(2).border_color(on ? C.cyan : "#00000000")
      .text_color(on ? C.night : C.muted).hover((x) => x.border_color(C.cyan).text_color(on ? C.night : C.text))
      .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); action(); }).child(child);
    const panelBtn = (id, label, ic) => {
      const on = pnl && !pnl.hidden && body?.active === id;
      return btn(`a-ph-${id}-${pane}`, h_flex().gap(6).items_center().child(icon(ic, 13, on ? C.night : C.muted)).child(pt(label, 7, on ? C.night : C.muted)), () => {
        if (on) run("layout.hide", { id: "panel" });
        else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
      }, on);
    };
    return h_flex().id(`a-ph-${pane}`).size_full().px(12).gap(10).items_center().bg(C.raised).border_b(2).border_color(C.edge)
      .on_click(() => run("pane.focus", { pane }))
      .child(programIcon(me.program, 15) ?? icon("terminal", 15, C.muted))
      .child(div().flex_none().max_w(260).truncate().font_family(F.body).text_size(21).text_color("#ffffff").child(up(name)))
      .child(div().flex_1().min_w(0).truncate().font_family(F.body).text_size(18).text_color(C.dim).child(short(me.cwd)))
      .when(Boolean(me.status) && me.status !== "idle", (el) => el.child(chip(me.status)))
      .child(btn(`a-ph-split-${pane}`, icon("plus", 13, C.muted), () => run("pane.split", { direction: "right", pane })))
      .child(panelBtn("files", "FILES", "file"))
      .child(panelBtn("changes", "CHANGES", "changes"))
      .child(btn(`a-ph-menu-${pane}`, pt(":", 9, C.muted), () =>
        openOverlay({ mod: "menu", kind: "popup", width: 220, props: { tab: "pane", target: { pane, terminal: me.terminal } } })));
  }

  // ------------------------------------------------------------ MESSAGES popup
  bell(cx) {
    const all = spaces();
    const tabOf = (a) => all.find((s) => s.id === a.space)?.tabs.find((t) => t.id === a.tab);
    const go = (a) => { closeOverlay(props()?.overlay); run("pane.focus", { pane: a.pane }); };
    const row = (a) => {
      const machine = a.address.includes("/") ? a.address.split("/")[0] : "";
      const where = `${a.space_name}${a.tab_name && !/^\d+$/.test(a.tab_name) ? " · " + a.tab_name : ""}`;
      return h_flex().id(`a-bell-${a.address}`).h(BELL.row).flex_none().mx(8).px(8).gap(10).items_center().cursor_pointer()
        .border(2).border_color("#00000000").hover((x) => x.border_color(C.cyan)).on_click(() => go(a))
        .child(programIcon(a.program, 16) ?? icon("terminal", 16, C.muted))
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().font_family(F.body).text_size(20).text_color(C.text).child(where))
          .child(div().truncate().font_family(F.body).text_size(16).text_color(STATUS[a.status] ?? C.dim)
            .child(`${WORD[a.status] ?? up(a.status)}${machine ? " · " + machine : ""}`)))
        .child(div().flex_none().font_family(F.body).text_size(16).text_color(C.dim).child(ago(tabOf(a)?.changed_at)))
        .child(statusMark(a.status, 14));
    };
    const label = (t, color) => div().h(BELL.label).flex_none().px(16).pt(10).child(pt(t, 7, color));
    const { needs, done } = bellItems(agents(), tabOf);
    const kids = [];
    if (needs.length) kids.push(label(WORD.blocked, STATUS.blocked), ...needs.map(row));
    if (done.length) kids.push(label(WORD.done, STATUS.done), ...done.map(row));
    return v_flex().id("a-bell-pop").size_full().bg("#120733fa").border(2).border_color(C.cyan)
      .child(h_flex().h(BELL.head).flex_none().px(16).gap(10).items_center().border_b(2).border_color(C.edge)
        .child(icon("bell", 15, C.cyan)).child(div().flex_1().child(pt("MESSAGES", 9, C.cyan)))
        .when(needs.length + done.length > 0, (el) => el.child(pt(`${needs.length + done.length} NEW`, 7, C.yellow))))
      .child(kids.length
        ? v_flex().id("a-bell-list").flex_none().h((props()?.height ?? bellHeight(agents(), tabOf)) - BELL.head - 4).py(4).overflow_y_scrollbar().children(kids)
        : div().h(BELL.empty).flex_none().flex().items_center().justify_center().child(pt("NO MESSAGES", 8, C.dim)));
  }

  // Points the TASKS block at task-board once it is installed (the file is looked at every 30 s,
  // the layout every 3 s), and leaves the TASKS tab out when it is not.
  async syncBoard(cx) {
    if (this.syncing) return;
    this.syncing = true;
    try {
      if (this.board === undefined || this.ticks++ % 10 === 0)
        this.board = (await readTextFile(`${appHome()}/mods/${BOARD}/mod.json`).catch(() => null)) != null;
      const root = layout();
      const block = find(root, "side-tasks");
      if (this.board && block && block.content?.mod !== BOARD)
        await exec("herdr-app", ["do", "layout.set", JSON.stringify({ layout: withContent(root, "side-tasks", { mod: BOARD }) })]).catch(() => null);
      else if (!this.board && find(root, "side-body")?.active === "side-tasks")
        run("layout.select", { stack: "side-body", child: "side-session" });
      cx.notify();
    } finally { this.syncing = false; }
  }

  // ------------------------------------------------------------ right column switch
  sidetabs(cx) {
    const active = find(layout(), "side-body")?.active ?? "side-session";
    const tasks = find(layout(), "side-tasks")?.content?.mod === BOARD; // TASKS only with task-board installed
    const seg = (id, child, ic, label) => {
      const on = active === child;
      return div().flex_1().child(button(id, h_flex().gap(8).items_center().child(icon(ic, 13, on ? C.night : C.muted)).child(pt(label, 8, on ? C.night : C.muted)),
        () => run("layout.select", { stack: "side-body", child }), { on, tone: C.cyan }));
    };
    return h_flex().size_full().gap(8).items_start().pr(4)
      .child(seg("a-seg-session", "side-session", "activity", "SESSION"))
      .when(tasks, (el) => el.child(seg("a-seg-tasks", "side-tasks", "check", "TASKS")));
  }

  // ------------------------------------------------------------ score bar
  status(cx) {
    const space = spaces().find((x) => x.active);
    const list = agents();
    const working = list.filter((a) => a.status === "working").length;
    const needs = list.filter((a) => a.status === "blocked").length;
    const s = this.screen;
    const label = (t, color = C.dim) => pt(t, 7, color);
    const value = (t, color = C.text) => div().font_family(F.body).text_size(20).text_color(color).child(t);
    const item = (...kids) => h_flex().gap(8).items_center().flex_none().children(kids);
    const sepr = () => div().w(2).h(18).bg(C.edge);
    const content = h_flex().size_full().px(16).gap(16).items_center()
      .child(item(div().px(5).py(3).bg(C.magenta).child(pt("1P", 7, C.night)), value(up(space?.machine ?? "This computer"))))
      .when(Boolean(space?.branch), (el) => el.child(sepr()).child(item(label("STAGE"), icon("git-branch", 14, C.pink), value(space.branch))))
      .child(sepr())
      .child(item(label("PLAYERS"), value(`${list.length}`), working ? value(`· ${working} PLAYING`, C.cyan) : div()))
      .when(needs > 0, (el) => el.child(item(icon("warning", 14, C.yellow), value(`${needs} ${WORD.blocked}`, C.yellow))))
      .child(div().flex_1())
      .when(this.cpu != null, (el) => el.child(item(label("CPU"), meter(this.cpu), value(`${this.cpu}%`))))
      .when(Boolean(this.ram), (el) => el.child(item(label("RAM"), meter((100 * this.ram.used) / this.ram.total),
        value(`${this.ram.used.toFixed(1)}/${this.ram.total.toFixed(1)}G`))))
      .when(Boolean(s.up), (el) => el.child(sepr()).child(item(label("SCORE", C.yellow), value(`${up(s.up)}`, C.yellow), value(`↓${up(s.down)}`, C.muted))))
      .child(sepr())
      .child(button("a-start", pt("START", 7, C.night), () => run("app.palette"), { on: true, tone: C.yellow, h: 24 }));
    return div().id("a-status").size_full().pt(8).pr(4).pb(4).child(frame("status", content, { tall: true, fill: "#120733f0" }));
  }
}
