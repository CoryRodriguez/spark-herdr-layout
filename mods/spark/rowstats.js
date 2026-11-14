// How long each agent has been going, for the sidebar's agent rows. Everything here
// comes from Herdr itself: a terminal's start time and command, and when this look
// first saw the agent. A time shows only if the start is really known: never a
// shell's age for an agent started later inside that shell (logic.js agentSince).

import { agents, hc, setShared, shared, terminals } from "herdr";
import { every, spawn } from "./data.js";
import { agentSince, launchedDirectly, rowStats, updateSeen } from "./logic.js";

const SEEN_KEY = "spark.agents.seen"; // { address: { at, created_ms } }: kept across reloads

export class RowStats {
  constructor(cx) {
    this.details = {};
    this.startedAt = Date.now();
    every(cx, 15 * 1000, () => this.noteSeen()); // when each agent was first seen, to within 15 s
    every(cx, 60 * 1000, (cx) => { // the minutes tick on
      this.askCreated(cx);
      cx.notify();
    });
    this.askCreated(cx);
  }

  /** A terminal's start time and command; asks herdr-core once when the live list doesn't carry them. */
  askCreated(cx) {
    const live = new Set(agents().map((a) => a.address));
    for (const address of Object.keys(this.details)) if (!live.has(address)) delete this.details[address]; // addresses can come back
    const missing = [...live].filter((address) => this.detail(address) === undefined);
    this.noteSeen();
    if (!missing.length) return;
    spawn(cx, async (cx) => {
      for (const address of missing) {
        try {
          const r = await hc(["get", address, "--json"]);
          const d = JSON.parse(r.stdout);
          this.details[address] = { created_ms: d?.created_ms ?? null, argv: d?.argv ?? null };
        } catch {
          this.details[address] = { created_ms: null, argv: null };
        }
      }
      cx.notify();
    });
  }

  detail(address) {
    const t = terminals().find((x) => x.address === address);
    if (typeof t?.created_ms === "number" && Array.isArray(t.argv)) return { created_ms: t.created_ms, argv: t.argv };
    return this.details[address];
  }

  /** Runs on a timer, not during render: writing shared state redraws every copy. */
  noteSeen() {
    const live = agents().map((a) => ({ address: a.address, createdMs: this.detail(a.address)?.created_ms }));
    const raw = shared(SEEN_KEY);
    const stored = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : undefined;
    const next = updateSeen(stored, live, Date.now(), this.startedAt);
    if (next !== stored) setShared(SEEN_KEY, next);
  }

  /** { time, timeTip } for a row; either may be null. */
  of(agent, nowMs) {
    const d = this.detail(agent.address);
    const createdMs = d?.created_ms ?? undefined;
    const direct = launchedDirectly(d?.argv, agent);
    const seenAt = shared(SEEN_KEY)?.[agent.address]?.at;
    const sinceMs = agentSince({ direct, createdMs, seenAt: typeof seenAt === "number" && isFinite(seenAt) ? seenAt : null });
    return rowStats({ createdMs, sinceMs, direct }, nowMs);
  }
}
