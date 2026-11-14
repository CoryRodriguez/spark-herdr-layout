#!/usr/bin/env python3
"""Raise one real Windows toast for the "waiting for you" alert.

Run by pythonw.exe from the status copy, with one argument: a JSON job file the
mod wrote under spark-data/tmp ({"title", "body", "terminal"}). Agent titles
are untrusted (programs set them with escape sequences), so nothing from the job
ever reaches a command line: the text is cleaned, XML-escaped and handed to a
fixed PowerShell script through environment variables only.

Exit codes: 0 delivered and seen in the notification history; 2 handed to Windows
but not seen in the history (notifications off or suppressed); 3 could not send.
"""
import json
import os
import re
import subprocess
import sys
import time
from xml.sax.saxutils import escape

# The app id toasts are sent as comes from spark-data/config.json (toast_app_id):
# the id Get-StartApps lists for Herdr's existing Start menu shortcut, so no registry
# entry or new shortcut is needed. If sending that way definitely failed (Windows never
# took the toast), it goes out once more as this id, which Windows always knows; its
# toasts name "Windows PowerShell" as the source. Anything ambiguous is never resent,
# so a toast can't double up.
FALLBACK_APP_ID = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe"
CREATE_NO_WINDOW = 0x08000000
LOG_KEEP = 200

# Fixed text: no value from a job is ever formatted into it.
SCRIPT = (
    "$ErrorActionPreference='Stop';"
    "[void][Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime];"
    "[void][Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom,ContentType=WindowsRuntime];"
    "$x=New-Object Windows.Data.Xml.Dom.XmlDocument;"
    "$x.LoadXml($env:LOOK_TOAST_XML);"
    "$t=[Windows.UI.Notifications.ToastNotification]::new($x);"
    "$t.Tag=$env:LOOK_TOAST_TAG;"
    "$t.Group='herdr-look';"
    "$n=[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($env:LOOK_TOAST_AUMID);"
    "$n.Show($t);"
    "'SHOWN';"  # from here on the toast is out: nothing below may count as a failed send
    "$ErrorActionPreference='Continue';"
    "Start-Sleep -Milliseconds 500;"
    "$seen=$false;"
    "try{foreach($i in [Windows.UI.Notifications.ToastNotificationManager]::History.GetHistory($env:LOOK_TOAST_AUMID))"
    "{if($i.Tag -eq $env:LOOK_TOAST_TAG){$seen=$true}}}catch{};"
    "@{seen=$seen;setting=[string]$n.Setting}|ConvertTo-Json -Compress"
)


def home():
    return os.environ.get("HERDR_APP_HOME") or os.path.join(os.path.expanduser("~"), ".config", "herdr-app")


def clean(text, limit):
    """Plain single-line text: no control, bidi-override or XML-illegal characters."""
    text = re.sub(r"[\x00-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069\ud800-\udfff\ufffe\uffff]", " ", str(text or ""))
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


def toast_xml(title, body):
    return ('<toast><visual><binding template="ToastGeneric">'
            f"<text>{escape(clean(title, 120) or 'An agent is waiting for you')}</text>"
            f"<text>{escape(clean(body, 200))}</text>"
            "</binding></visual>"
            '<audio silent="true"/>'  # Herdr plays its own sound; no Windows chime on top
            "</toast>")


def powershell():
    root = os.environ.get("SystemRoot") or r"C:\Windows"
    return os.path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")


def app_id():
    try:
        with open(os.path.join(home(), "spark-data", "config.json"), encoding="utf-8") as fh:
            value = json.load(fh).get("toast_app_id")
        return value if isinstance(value, str) and value.strip() else FALLBACK_APP_ID
    except Exception:
        return FALLBACK_APP_ID


def send(xml, tag, aumid):
    env = dict(os.environ, LOOK_TOAST_XML=xml, LOOK_TOAST_TAG=tag, LOOK_TOAST_AUMID=aumid)
    try:
        out = subprocess.run([powershell(), "-NoProfile", "-NonInteractive", "-Command", SCRIPT], env=env,
                             stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=25,
                             creationflags=CREATE_NO_WINDOW)
    except OSError as exc:  # PowerShell never started
        return {"seen": False, "error": str(exc)[:300], "definite_failure": True}
    lines = (out.stdout or "").strip().splitlines()
    if "SHOWN" not in lines:
        if out.returncode != 0:  # it stopped before Show returned
            return {"seen": False, "error": (out.stderr or "").strip()[:300], "definite_failure": True}
        return {"seen": False, "error": "no confirmation from PowerShell"}
    try:
        return json.loads(lines[-1])
    except ValueError:
        return {"seen": False, "shown": True}


def log(entry):
    path = os.path.join(home(), "spark-data", "toast_log.jsonl")
    try:
        lines = []
        if os.path.exists(path):
            with open(path, encoding="utf-8") as fh:
                lines = fh.readlines()[-(LOG_KEEP - 1):]
        lines.append(json.dumps(entry, ensure_ascii=True) + "\n")
        tmp = f"{path}.{os.getpid()}.tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.writelines(lines)
        os.replace(tmp, path)
    except Exception:
        pass


def main(argv):
    job = {}
    try:
        with open(argv[1], encoding="utf-8") as fh:
            job = json.load(fh)
    except Exception as exc:
        log({"at": int(time.time()), "error": f"bad job: {exc}"[:200]})
        return 3
    finally:
        try:
            os.remove(argv[1])
        except Exception:
            pass
    terminal = clean(job.get("terminal"), 16)
    tag = f"s{time.time_ns() % 10**12}"
    xml = toast_xml(job.get("title"), job.get("body"))
    aumid = app_id()

    def attempt(which):
        try:
            return send(xml, tag, which)
        except Exception as exc:  # a timeout, say: the toast may be out, so this never counts as definite
            return {"seen": False, "error": str(exc)[:300]}

    res = attempt(aumid)
    res["app_id"] = aumid
    if res.get("definite_failure") and aumid != FALLBACK_APP_ID and not job.get("no_fallback"):
        res = {**attempt(FALLBACK_APP_ID), "app_id": FALLBACK_APP_ID, "fell_back_from": aumid, "first_try": res}
    log({"at": int(time.time()), "terminal": terminal, "tag": tag, **res})
    if res.get("error"):
        return 3
    return 0 if res.get("seen") else 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
