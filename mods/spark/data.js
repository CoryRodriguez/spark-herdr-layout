// Where this look keeps its few files, and how it reads them. The folder sits
// outside the mod, so writes there never reload the mod. It is made on demand.

import { appHome, exec, readTextFile, writeTextFile } from "herdr";
import { mkdir } from "fs/promises";
import { withAppearance } from "./logic.js";

export const DATA = () => `${appHome()}/spark-data`;
export const TOOLS = () => `${appHome()}/mods/spark/tools`;
export const TERMINAL_ID = /^t[0-9a-z]{1,12}$/;

/**
 * The one way appearance gets written, used only by the header button's click.
 * plan(current) names what to write, or null
 * for nothing; the write is guarded, so it rejects if settings.json changed since
 * this read. Answers what it wrote, or null.
 */
export async function writeAppearance(plan) {
  const path = `${appHome()}/settings.json`;
  const text = await readTextFile(path);
  if (text === null) return null;
  const want = plan(JSON.parse(text)?.appearance);
  if (!want) return null;
  const next = withAppearance(text, want);
  if (next === null) return null;
  await writeTextFile(path, next, text);
  return want;
}

/** A job file's path under spark-data/tmp; the folder is made on demand, so a clean install works. */
export async function tmpFile(name) {
  await mkdir(`${DATA()}/tmp`, { recursive: true });
  return `${DATA()}/tmp/${name}`;
}

// Python is optional: only the Windows notification uses it. It is looked for by name on the
// PATH (never at a fixed path), once per load, and the answer is kept, so a machine without
// Python is asked one time and then left alone. Windowless names come first.
const PYTHON_NAMES = ["pythonw", "pyw", "python3", "python", "py"];
const PYTHON_PROBE = "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)";
let pythonFound; // undefined until first asked; then a promise of the name that works, or of null

/** The name of a working Python (3.8 or newer) on the PATH, or null when there is none. */
export function findPython() {
  if (pythonFound === undefined) {
    pythonFound = (async () => {
      for (const name of PYTHON_NAMES) {
        try {
          const r = await exec(name, ["-c", PYTHON_PROBE], { timeout: 10000 });
          if (r?.code === 0) return name;
        } catch {
          // Not installed under that name: try the next.
        }
      }
      return null;
    })();
  }
  return pythonFound;
}

/**
 * Runs a helper with the Python that findPython() found: arguments as an array, never a shell.
 * Answers null, having run nothing, on a machine without Python.
 */
export async function runTool(name, args = []) {
  const python = await findPython();
  if (!python) return null;
  DIAG.execs++;
  return exec(python, [`${TOOLS()}/${name}`, ...args]);
}

/**
 * Counts of what this copy has done since it loaded. Every copy gets its own
 * module instance, so
 * each copy with props.features writes its own spark-data/diag_<role>.json
 * every 10 minutes. All copies still share one script engine with a fixed heap.
 */
export const DIAG = { loaded_at: Date.now(), role: null, renders: 0, timer_fires: 0, spawns: 0, reads: 0, execs: 0,
  reloads: 0, render_errors: 0, last_error: null };

/** Writes this copy's counters to spark-data/diag_<role>.json. */
export function writeDiag(cx, role) {
  DIAG.role = role;
  spawn(cx, async () => {
    try {
      await mkdir(DATA(), { recursive: true }); // made on demand, so a clean install works
      const path = `${DATA()}/diag_${role}.json`;
      const prev = await readTextFile(path).catch(() => null);
      await writeTextFile(path, JSON.stringify({ ...DIAG, written_at: Date.now(), uptime_min: Math.round((Date.now() - DIAG.loaded_at) / 60000) }), prev);
    } catch {
      // Diagnostics are best-effort.
    }
  });
}

const noteError = (where, e) => {
  DIAG.last_error = { at: Date.now(), role: where, error: e === null ? "null (the script engine is out of memory)" : String(e).slice(0, 200) };
};

/**
 * cx.timer.every, counted. A replaced or closed build's timer must stop, and the engine
 * stops a timer whose callback throws its stale-build error: so cx.phase() runs first,
 * outside the try, and only the work itself is caught.
 */
export function every(cx, ms, fn) {
  return cx.timer.every(ms, (cx) => {
    cx.phase();
    DIAG.timer_fires++;
    try {
      fn(cx);
    } catch (e) {
      noteError("timer", e);
    }
  });
}

/** cx.spawn, counted. */
export function spawn(cx, fn) {
  DIAG.spawns++;
  return cx.spawn(fn);
}

