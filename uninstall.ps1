# Removes what install.cmd added for the Spark look, and nothing else. Double-click uninstall.cmd.
#
# It reads the record install.cmd left in the Herdr home (spark-install.json) and removes exactly
# the files listed there: the layout, the two mods, the two themes and, if it was installed, the
# indicator's folder. It first closes the indicator that runs from that folder (found by its exact
# program file; no other program is ever closed). A file you changed after installing is not
# deleted: it is moved into a dated folder in the Herdr home, and the script says so.
#
# Left alone on purpose: your keys.json and settings.json, the look's own small data folder
# (spark-data), and any backup folder a forced install made.
#
# It never asks for administrator rights and makes no network connection.
#
#   -HerdrHome <path>   the Herdr home folder (default: your profile's .config\herdr-app, or the
#                       folder the HERDR_APP_HOME variable names, if you have set that)
#   -Force              remove the files even while Herdr is showing this layout
#   -ShownLayout <name> for testing: take this as the layout Herdr is showing, and do not ask Herdr
param(
    [string]$HerdrHome = "",
    [switch]$Force,
    [string]$ShownLayout = ""
)
$ErrorActionPreference = "Stop"
$slug = "spark"
$title = "Spark"
$prog = "SparkIndicator"
$indName = "Spark Indicator"

function Stop-Here([int]$code, [string[]]$lines) {
    Write-Host ""
    foreach ($l in $lines) { Write-Host $l }
    exit $code
}

function Get-Sha([string]$path) {
    return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
}

# Runs a program without a window and waits for it. Gives back its exit code and what it printed.
# (What it prints goes through two short-lived files in your temp folder, deleted right away.)
function Invoke-Hidden([string]$file, [string]$arguments) {
    $o = [System.IO.Path]::GetTempFileName()
    $e = [System.IO.Path]::GetTempFileName()
    try {
        $p = Start-Process -FilePath $file -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden -RedirectStandardOutput $o -RedirectStandardError $e
        $said = @(Get-Content -LiteralPath $o) + @(Get-Content -LiteralPath $e)
        return @{ code = $p.ExitCode; text = $said }
    } catch {
        return @{ code = -1; text = @($_.Exception.Message) }
    } finally {
        Remove-Item -LiteralPath $o, $e -Force -ErrorAction SilentlyContinue
    }
}

function Get-IndicatorProcesses([string]$exe) {
    $found = @()
    foreach ($p in @(Get-Process -Name $prog -ErrorAction SilentlyContinue)) {
        $path = $null
        try { $path = $p.Path } catch { }
        if ($path -and ($path -ieq $exe)) { $found += $p }
    }
    return , $found
}

# Deletes folders under $root that are empty, deepest first, and $root itself when it ends up empty.
function Remove-EmptyFolders([string]$root) {
    if (-not (Test-Path -LiteralPath $root -PathType Container)) { return }
    $dirs = @(Get-ChildItem -LiteralPath $root -Recurse -Directory | Sort-Object { $_.FullName.Length } -Descending)
    foreach ($d in $dirs) {
        if (@(Get-ChildItem -LiteralPath $d.FullName -Force).Count -eq 0) { Remove-Item -LiteralPath $d.FullName -Force }
    }
    if (@(Get-ChildItem -LiteralPath $root -Force).Count -eq 0) { Remove-Item -LiteralPath $root -Force }
}

if (-not $HerdrHome -and $env:HERDR_APP_HOME) { $HerdrHome = $env:HERDR_APP_HOME }
if (-not $HerdrHome) { $HerdrHome = Join-Path $env:USERPROFILE ".config\herdr-app" }
Write-Host "$title for Herdr: uninstall"
Write-Host ""
if (-not (Test-Path -LiteralPath $HerdrHome -PathType Container)) {
    Stop-Here 2 @("The Herdr home folder was not found:", "  $HerdrHome", "Nothing was removed.")
}
$HerdrHome = (Resolve-Path -LiteralPath $HerdrHome).Path
$record = Join-Path $HerdrHome "$slug-install.json"
if (-not (Test-Path -LiteralPath $record)) {
    Stop-Here 2 @("No install record was found:", "  $record", "So nothing was removed. If you copied the files in by hand, remove them by hand:", "see `"Switch back, or remove it`" in SETUP.md.")
}
$data = Get-Content -LiteralPath $record -Raw -Encoding UTF8 | ConvertFrom-Json
if ($data.package -ne $slug) { Stop-Here 2 @("The record at $record is not this package's. Nothing was removed.") }

# While Herdr is showing this layout its files should stay: ask for a switch first.
# "herdr-app status" only reads; it is asked only while a Herdr window is already open.
if (-not $Force) {
    $showing = $ShownLayout
    $cmd = Get-Command "herdr-app" -ErrorAction SilentlyContinue
    if (-not $showing -and $cmd -and @(Get-Process -Name "herdr-app" -ErrorAction SilentlyContinue).Count -gt 0) {
        $asked = Invoke-Hidden $cmd.Source "status"
        if ($asked.code -eq 0) { try { $showing = ((@($asked.text) -join "`n") | ConvertFrom-Json).layout } catch { } }
    }
    if ($showing) { Write-Host "Herdr is showing the layout: $showing" }
    if ($showing -eq $slug -or $showing -eq "$slug-mac") {
        Stop-Here 3 @("Herdr is showing the $title layout right now.", "Switch to another layout first (Ctrl+Shift+L), then run uninstall.cmd again. Nothing was removed.")
    }
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$kept = Join-Path $HerdrHome "$slug-changed-$stamp"
$removed = 0
$moved = 0
$gone = 0

# $rewritten: files the installed program rewrites by itself; those are deleted, never "kept as changed".
function Remove-Listed([string]$root, $list, [string]$keepUnder, [string[]]$rewritten = @()) {
    $inside = $root.TrimEnd("\") + "\"
    foreach ($f in @($list)) {
        if (-not $f -or -not $f.path) { continue }
        $full = Join-Path $root $f.path
        # Only ever a file inside the folder it was installed into.
        if (-not ([System.IO.Path]::GetFullPath($full)).StartsWith($inside, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
        if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { $script:gone++; continue }
        if (($rewritten -contains $f.path) -or ((Get-Sha $full) -eq $f.sha256)) {
            Remove-Item -LiteralPath $full -Force
            $script:removed++
        } else {
            $to = Join-Path $keepUnder $f.path
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null
            Move-Item -LiteralPath $full -Destination $to -Force
            $script:moved++
        }
    }
}

# ---- the indicator ---------------------------------------------------------------------------

$indDir = $data.indicatorDir
if ($indDir) {
    $exe = Join-Path $indDir "$prog.exe"
    $running = (Get-IndicatorProcesses $exe).Count
    if ($running -gt 0) {
        # Ask it to close (it only ever speaks to the copy that runs from its own folder), then end what is left.
        try { Start-Process -FilePath $exe -ArgumentList "--send", "quit" -Wait -WindowStyle Hidden } catch { }
        for ($i = 0; $i -lt 30 -and (Get-IndicatorProcesses $exe).Count -gt 0; $i++) { Start-Sleep -Milliseconds 100 }
        foreach ($p in (Get-IndicatorProcesses $exe)) { try { Stop-Process -Id $p.Id -Force } catch { } }
        Start-Sleep -Milliseconds 300
        Write-Host "Indicator: closed the one running from $indDir"
    }
    # The "Start with Windows" switch in its menu makes a shortcut in your Startup folder. Remove it
    # only when it points at the program being removed.
    try {
        $link = Join-Path ([Environment]::GetFolderPath("Startup")) "$indName.lnk"
        if (Test-Path -LiteralPath $link) {
            $shell = New-Object -ComObject WScript.Shell
            if ($shell.CreateShortcut($link).TargetPath -ieq $exe) {
                Remove-Item -LiteralPath $link -Force
                Write-Host "Indicator: removed its Start with Windows shortcut."
            }
        }
    } catch { }
    if (Test-Path -LiteralPath $indDir -PathType Container) {
        $indRoot = (Resolve-Path -LiteralPath $indDir).Path
        Remove-Listed $indRoot $data.indicatorFiles (Join-Path $kept "indicator") @("settings.json")
        # What the indicator writes beside itself while it runs.
        foreach ($name in @("indicator.log", "indicator.log.1", "indicator.pid", "settings.json.tmp", "state_dump.json", "build_output.txt")) {
            $full = Join-Path $indRoot $name
            if (Test-Path -LiteralPath $full -PathType Leaf) { Remove-Item -LiteralPath $full -Force }
        }
        Remove-EmptyFolders $indRoot
        if (Test-Path -LiteralPath $indRoot) { Write-Host "Indicator: $indRoot still holds files this did not add; they were left there." }
        else { Write-Host "Indicator: removed $indRoot" }
    }
}

# ---- the look ----------------------------------------------------------------------------------

Remove-Listed $HerdrHome $data.files $kept
foreach ($m in @($slug, "$slug-search")) {
    $modDir = Join-Path $HerdrHome "mods\$m"
    if (-not (Test-Path -LiteralPath $modDir -PathType Container)) { continue }
    # Two helper files Herdr itself writes into every mod folder it checks.
    foreach ($name in @("gpui-kit.d.ts", "jsconfig.json")) {
        $full = Join-Path $modDir $name
        if (Test-Path -LiteralPath $full -PathType Leaf) { Remove-Item -LiteralPath $full -Force }
    }
    Remove-EmptyFolders $modDir
    if (Test-Path -LiteralPath $modDir) { Write-Host "Look: $modDir still holds files this did not add; they were left there." }
}
foreach ($rel in @($data.createdFolders)) {
    if (-not $rel) { continue }
    $dir = Join-Path $HerdrHome $rel
    if ((Test-Path -LiteralPath $dir -PathType Container) -and @(Get-ChildItem -LiteralPath $dir -Force).Count -eq 0) { Remove-Item -LiteralPath $dir -Force }
}
Remove-Item -LiteralPath $record -Force

Write-Host "Removed $removed files."
if ($gone -gt 0) { Write-Host "$gone files in the record were already gone." }
if ($moved -gt 0) { Write-Host "$moved files had been changed since the install; they were moved, not deleted, to: $kept" }
Write-Host ""
Write-Host "Left alone: keys.json (remove the ctrl-f line yourself if you added it), settings.json,"
Write-Host "the folder $slug-data if the look made one, and any backup folder from a forced install."
exit 0
