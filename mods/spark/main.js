// Spark: a calm, professional frame around your terminals. One mod in
// roles; the layout and overlays give each copy props { role }:
//   header    brand over the sidebar, the spaces as large tabs, search bar, clock, settings, window buttons
//   sidebar   every space with its agents nested under it
//   tabs      the shown space's tabs (Chrome style), +, Files and Changes
//   pane      each pane's header: status, split, zoom, End session
//   status    the status line; also notices agent changes for the activity log
//   end       the End session / Close tab confirmation dialog
//   activity  the activity log window
//   alert     the "waiting for you" banner window
//
// The day/night button, the time on agent rows and the waiting banner run only
// where the layout gives a block props.features.

import { View, div } from "gpui-kit";
import { props } from "herdr";
import { DIAG, every, writeDiag } from "./data.js";
import { S } from "./kit.js";

const DIAG_ROLES = new Set(["header", "sidebar", "status"]);
import Header from "./header.js";
import Sidebar from "./sidebar.js";
import Tabs from "./tabs.js";
import PaneHeader from "./pane.js";
import Status from "./status.js";
import EndSession from "./end.js";
import Activity from "./activity.js";
import Alert from "./alert.js";

const ROLES = { header: Header, sidebar: Sidebar, tabs: Tabs, pane: PaneHeader, status: Status, end: EndSession, activity: Activity, alert: Alert };

export default class Look extends View {
  init(p, cx) {
    const pr = props() ?? p ?? {};
    const R = ROLES[pr.role];
    this.role = R ? new R() : null;
    this.role?.init?.(pr, cx);
    if (pr.features && DIAG_ROLES.has(pr.role)) { // Vivid only: each copy reports its own counters
      cx.timer.after(60 * 1000, (cx) => writeDiag(cx, pr.role));
      every(cx, 10 * 60 * 1000, (cx) => writeDiag(cx, pr.role));
    }
  }

  render(cx) {
    if (!this.role) return div().p(8).text_size(S).child(`spark: no role "${props()?.role ?? ""}"`);
    DIAG.renders++;
    try {
      return this.role.render(cx);
    } catch (e) {
      // One panel failing must not look like the whole frame failing.
      DIAG.render_errors++;
      DIAG.last_error = { at: Date.now(), role: props()?.role ?? null, error: e === null ? "null (the script engine is out of memory)" : String(e).slice(0, 200) };
      return div().p(8).text_size(S).child("Spark: this panel could not draw just now.");
    }
  }
}
