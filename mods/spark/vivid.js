// The extras that run from the layout's one status copy, so nothing fires twice:
// the waiting banner and, on Windows with Python present, a Windows notification.
// Only a layout whose status block has props.features ever creates this.

import { agents, spaces, shared, writeTextFile, openOverlay, closeOverlay, window as appWindow } from "herdr";
import { MOD, two, unzoom } from "./kit.js";
import { sessionName } from "./names.js";
import { DIAG, TERMINAL_ID, every, findPython, runTool, spawn, tmpFile } from "./data.js";
import { clock12, pastBaseline, toastAllowed, activityLine, activityName } from "./logic.js";

export const ALERT_DISMISSED_KEY = "spark.alert.dismissed"; // { id }: that banner was closed by hand

const TICK_EVERY = 3 * 1000; // banner upkeep
const BANNER = { width: 440, height: 68, top: 66 };

export class Vivid {
  init(cx) {
    this.startedAt = Date.now();
    this.width = 1600;
    this.alert = null; // { id, address }
    this.toastAt = {};
    every(cx, TICK_EVERY, (cx) => this.guard(() => this.watchAlert()));
  }

  /** A timer's work must never throw out of the timer. */
  guard(fn) {
    try {
      fn();
    } catch (e) {
      DIAG.last_error = { at: Date.now(), role: "status timer", error: e === null ? "null" : String(e).slice(0, 200) };
    }
  }

  /** Kept for status.js; the upkeep now runs on its own slower timer. */
  tick() {}

  // ---- Waiting banner + Windows notification -------------------------------

  /** A new agent already blocked is news, unless it was there before this copy was looking. */
  bornBlockedIsNews() {
    return pastBaseline(this.startedAt, Date.now());
  }

  /** Called only for a real transition into blocked (status.js detect). */
  onWaiting(ev, cx) {
    this.openBanner(ev.address);
    const now = Date.now();
    if (!toastAllowed(this.toastAt[ev.address], now)) return;
    const a = agents().find((x) => x.address === ev.address);
    if (a?.focused && appWindow()?.active) return; // already looking right at it
    this.toastAt[ev.address] = now;
    this.sendToast(ev, cx);
  }

  openBanner(address) {
    const a = agents().find((x) => x.address === address);
    if (!a) return;
    const x = Math.max(16, Math.round((this.width - BANNER.width) / 2) + 60);
    // The same wording as the activity log: the agent's name once, its space only when it is not on screen.
    const name = activityName(sessionName(a), a.program?.name ?? a.app, a.tab_index);
    const elsewhere = a.space !== spaces().find((s) => s.active)?.id;
    const id = openOverlay({ mod: MOD, kind: "window", frame: "none", key: "spark-banner", width: BANNER.width, height: BANNER.height,
      at: { x, y: BANNER.top },
      props: { role: "alert", palette: "multicolor", address, name, title: activityLine("waiting", name, a.space_name, elsewhere),
        when: clock12(Date.now()), detail: `Tab ${two(a.tab_index)}` } });
    this.alert = { id, address };
  }

  watchAlert() {
    if (!this.alert) return;
    if (shared(ALERT_DISMISSED_KEY)?.id === this.alert.id) {
      this.alert = null;
      return;
    }
    const list = agents();
    if (list.find((x) => x.address === this.alert.address)?.status === "blocked") return;
    closeOverlay(this.alert.id);
    this.alert = null;
    const next = list.find((x) => x.status === "blocked");
    if (next) this.openBanner(next.address); // still needs someone; its notification already went out
  }

  /**
   * A Windows notification, through tools/notify_toast.py. Windows only, and only when Python
   * is found; anywhere else, and whenever it cannot be sent, it quietly does nothing.
   */
  sendToast(ev, cx) {
    if (appWindow()?.platform !== "windows") return;
    spawn(cx, async () => {
      try {
        if (!(await findPython())) return;
        // Agent titles are untrusted: they travel in this file, never on a command line.
        const job = await tmpFile(`toast_${TERMINAL_ID.test(ev.address) ? ev.address : "x"}_${Date.now()}.json`);
        await writeTextFile(job, JSON.stringify({ title: `${ev.name} is waiting for you`, body: `${ev.tab} \u00b7 ${ev.space}`, terminal: ev.address }), null);
        await runTool("notify_toast.py", [job]);
      } catch {
        // Quiet on purpose: the banner and Herdr's own alert already said it.
      }
    });
  }

  // ---- Width, for placing the banner ------------------------------------------

  sized(size, cx) {
    const w = unzoom(size.width);
    if (Math.abs(w - this.width) > 1) {
      this.width = w;
      cx.notify();
    }
  }
}
