# Installs the Spark look for the Herdr app and, on Windows, the small always-on-top
# Spark Indicator that shows your agents' status. Double-click install.cmd to run it.
#
# What it does, in order:
#   1. Finds the Herdr home folder. Stops if Herdr has never been run on this computer.
#   2. Checks that nothing it would add is already there. If something is, it stops before
#      copying anything (-Force first moves what is there into a dated backup folder).
#   3. Copies the layout, the two mods and the two themes into the Herdr home.
#   4. Copies the indicator's source into its own folder, compiles it there with the C#
#      compiler that is part of Windows, and starts it. If that compiler is missing this step
#      is skipped with one line, and the look is installed all the same.
#   5. Runs "herdr-app check" on the two mods when herdr-app can be found.
#   6. Writes a record of exactly what it added (uninstall.cmd reads it) and says what to do next.
#
# It never asks for administrator rights, never changes PowerShell's execution policy, makes
# no network connection, never edits keys.json or settings.json, and never switches your layout.
#
#   -HerdrHome <path>     the Herdr home folder (default: your profile's .config\herdr-app, or the
#                         folder the HERDR_APP_HOME variable names, if you have set that)
#   -IndicatorDir <path>  where the indicator goes (default: SparkIndicator under your local app data folder)
#   -Force                move anything already there into a dated backup folder, then install
#   -NoStart              build the indicator but do not start it
#   -NoIndicator          install the look only
param(
    [string]$HerdrHome = "",
    [string]$IndicatorDir = "",
    [switch]$Force,
    [switch]$NoStart,
    [switch]$NoIndicator
)
$ErrorActionPreference = "Stop"
$slug = "spark"
$title = "Spark"
$prog = "SparkIndicator"
$indName = "Spark Indicator"
$pkg = Split-Path -Parent $MyInvocation.MyCommand.Path
$utf8 = New-Object System.Text.UTF8Encoding $false

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

# Every running copy of the indicator whose program file is exactly $exe. Nothing else counts.
function Get-IndicatorProcesses([string]$exe) {
    $found = @()
    foreach ($p in @(Get-Process -Name $prog -ErrorAction SilentlyContinue)) {
        $path = $null
        try { $path = $p.Path } catch { }
        if ($path -and ($path -ieq $exe)) { $found += $p }
    }
    return , $found
}

function Stop-Indicator([string]$dir) {
    $exe = Join-Path $dir "$prog.exe"
    if (-not (Test-Path -LiteralPath $exe)) { return }
    if ((Get-IndicatorProcesses $exe).Count -eq 0) { return }
    # Ask it to close (it only ever speaks to the copy that runs from its own folder), then end what is left.
    try { Start-Process -FilePath $exe -ArgumentList "--send", "quit" -Wait -WindowStyle Hidden } catch { }
    for ($i = 0; $i -lt 30 -and (Get-IndicatorProcesses $exe).Count -gt 0; $i++) { Start-Sleep -Milliseconds 100 }
    foreach ($p in (Get-IndicatorProcesses $exe)) { try { Stop-Process -Id $p.Id -Force } catch { } }
    Start-Sleep -Milliseconds 300
}

# ---- 1. where things are ---------------------------------------------------------------

if (-not $HerdrHome -and $env:HERDR_APP_HOME) { $HerdrHome = $env:HERDR_APP_HOME }
if (-not $HerdrHome) { $HerdrHome = Join-Path $env:USERPROFILE ".config\herdr-app" }
if (-not $IndicatorDir) { $IndicatorDir = Join-Path $env:LOCALAPPDATA $prog }
$IndicatorDir = [System.IO.Path]::GetFullPath($IndicatorDir)

Write-Host "$title for Herdr: install"
Write-Host ""

$look = @(
    @{ rel = "layouts\$slug.json"; folder = $false },
    @{ rel = "mods\$slug"; folder = $true },
    @{ rel = "mods\$slug-search"; folder = $true },
    @{ rel = "themes\$slug.json"; folder = $false },
    @{ rel = "themes\$slug-night.json"; folder = $false }
)
foreach ($item in $look) {
    if (-not (Test-Path -LiteralPath (Join-Path $pkg $item.rel))) {
        Stop-Here 4 @("This package is incomplete: $($item.rel) is missing next to install.ps1.", "Unzip the whole package again and run install.cmd from inside it. Nothing was changed.")
    }
}
if (-not (Test-Path -LiteralPath $HerdrHome -PathType Container)) {
    Stop-Here 2 @("The Herdr home folder was not found:", "  $HerdrHome", "Install the Herdr app and run it once (that creates the folder), then run install.cmd again. Nothing was changed.")
}
$HerdrHome = (Resolve-Path -LiteralPath $HerdrHome).Path
$record = Join-Path $HerdrHome "$slug-install.json"

# ---- the indicator: wanted, and possible? ------------------------------------------------

$indSource = Join-Path $pkg "extras\indicator"
$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$wantIndicator = -not $NoIndicator
$indicatorNote = ""
if ($NoIndicator) {
    $indicatorNote = "Indicator: not installed (-NoIndicator)."
} elseif (-not (Test-Path -LiteralPath (Join-Path $indSource "build.cmd"))) {
    $wantIndicator = $false
    $indicatorNote = "Indicator: skipped, its source (extras\indicator) is not in this package."
} elseif (-not (Test-Path -LiteralPath $csc)) {
    $wantIndicator = $false
    $indicatorNote = "Indicator: skipped, Windows' C# compiler was not found at $csc. The look is installed without it."
}

# ---- 2. never overwrite --------------------------------------------------------------------

$taken = @()
foreach ($item in $look) {
    if (Test-Path -LiteralPath (Join-Path $HerdrHome $item.rel)) { $taken += (Join-Path $HerdrHome $item.rel) }
}
$indicatorTaken = $wantIndicator -and (Test-Path -LiteralPath $IndicatorDir)
if ($indicatorTaken) { $taken += $IndicatorDir }

if ($taken.Count -gt 0 -and -not $Force) {
    $lines = @("Already there, so nothing was copied and nothing was changed:")
    foreach ($t in $taken) { $lines += "  $t" }
    $lines += ""
    $lines += "To keep what is there: stop here, or rename the new look as SETUP.md describes."
    $lines += "To replace it: run  install.cmd -Force  (it first moves the ones listed above into a dated backup folder)."
    $lines += "To remove an earlier install of this package first: run uninstall.cmd."
    Stop-Here 3 $lines
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = $null
$indicatorBackup = $null
if ($taken.Count -gt 0) {
    $backup = Join-Path $HerdrHome "$slug-backup-$stamp"
    foreach ($item in $look) {
        $from = Join-Path $HerdrHome $item.rel
        if (-not (Test-Path -LiteralPath $from)) { continue }
        $to = Join-Path $backup $item.rel
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null
        Move-Item -LiteralPath $from -Destination $to
    }
    if (Test-Path -LiteralPath $record) {
        New-Item -ItemType Directory -Force -Path $backup | Out-Null
        Move-Item -LiteralPath $record -Destination (Join-Path $backup "$slug-install.json")
    }
    if ($indicatorTaken) {
        Stop-Indicator $IndicatorDir
        $indicatorBackup = "$IndicatorDir-backup-$stamp"
        Move-Item -LiteralPath $IndicatorDir -Destination $indicatorBackup
    }
    if (Test-Path -LiteralPath $backup) { Write-Host "Moved what was there into: $backup" } else { $backup = $null }
    if ($indicatorBackup) { Write-Host "Moved the earlier indicator folder to: $indicatorBackup" }
}

# ---- 3. the look ----------------------------------------------------------------------------

$createdFolders = @()
$files = @()
foreach ($item in $look) {
    $from = Join-Path $pkg $item.rel
    $to = Join-Path $HerdrHome $item.rel
    $parent = Split-Path -Parent $to
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
        $createdFolders += (Split-Path -Parent $item.rel)
    }
    if ($item.folder) {
        Copy-Item -LiteralPath $from -Destination $to -Recurse
        foreach ($f in @(Get-ChildItem -LiteralPath $to -Recurse -File)) {
            $rel = $f.FullName.Substring($HerdrHome.Length).TrimStart("\")
            $files += @{ path = $rel; sha256 = (Get-Sha $f.FullName) }
        }
    } else {
        Copy-Item -LiteralPath $from -Destination $to
        $files += @{ path = $item.rel; sha256 = (Get-Sha $to) }
    }
}
Write-Host "Look: copied $($files.Count) files into $HerdrHome (layouts, mods, themes)."

# ---- 4. the indicator -----------------------------------------------------------------------

$indicatorFiles = @()
$indicatorInstalled = $false
$indicatorStarted = $false
if ($wantIndicator) {
    $exe = Join-Path $IndicatorDir "$prog.exe"
    New-Item -ItemType Directory -Force -Path $IndicatorDir | Out-Null
    foreach ($entry in @(Get-ChildItem -LiteralPath $indSource)) {
        Copy-Item -LiteralPath $entry.FullName -Destination (Join-Path $IndicatorDir $entry.Name) -Recurse
    }
    # A forced reinstall keeps your saved position and your light or dark choice.
    if ($indicatorBackup -and (Test-Path -LiteralPath (Join-Path $indicatorBackup "settings.json"))) {
        Copy-Item -LiteralPath (Join-Path $indicatorBackup "settings.json") -Destination (Join-Path $IndicatorDir "settings.json") -Force
    }
    $build = Join-Path $IndicatorDir "build.cmd"
    $built = Invoke-Hidden $env:ComSpec "/d /s /c `"`"$build`"`""
    $code = $built.code
    if ($code -eq 0 -and (Test-Path -LiteralPath $exe)) {
        foreach ($f in @(Get-ChildItem -LiteralPath $IndicatorDir -Recurse -File)) {
            $rel = $f.FullName.Substring($IndicatorDir.Length).TrimStart("\")
            $indicatorFiles += @{ path = $rel; sha256 = (Get-Sha $f.FullName) }
        }
        $indicatorInstalled = $true
        $indicatorNote = "Indicator: compiled here from the included source into $IndicatorDir"
        if (-not $NoStart) {
            try {
                & (Join-Path $IndicatorDir "start_indicator.ps1") | Out-Null
                $indicatorStarted = ((Get-IndicatorProcesses $exe).Count -gt 0)
            } catch { $indicatorStarted = $false }
            if ($indicatorStarted) { $indicatorNote += " and started." } else { $indicatorNote += ". It did not stay running; see indicator.log there." }
        } else {
            $indicatorNote += " (not started: -NoStart)."
        }
    } else {
        $said = (@($built.text | Select-Object -First 6) -join " | ")
        Remove-Item -LiteralPath $IndicatorDir -Recurse -Force -ErrorAction SilentlyContinue
        $indicatorNote = "Indicator: skipped, it did not compile on this computer (exit $code). The look is installed without it. $said"
    }
}
Write-Host $indicatorNote

# ---- 5. check the two mods --------------------------------------------------------------------

$herdr = $null
$cmd = Get-Command "herdr-app" -ErrorAction SilentlyContinue
if ($cmd) { $herdr = $cmd.Source }
$checkNote = ""
if ($herdr) {
    $failed = @()
    foreach ($m in @($slug, "$slug-search")) {
        $modPath = Join-Path $HerdrHome "mods\$m"
        $checked = Invoke-Hidden $herdr "check `"$modPath`""
        if ($checked.code -ne 0) { $failed += $m; Write-Host ("  " + $m + ": " + (@($checked.text | Select-Object -First 4) -join " | ")) }
    }
    if ($failed.Count -eq 0) { $checkNote = "Check: herdr-app check passed on both mods." }
    else { $checkNote = "Check: herdr-app check did NOT pass on: " + ($failed -join ", ") + ". The files are in place; see the lines above and SETUP.md." }
} else {
    $checkNote = "Check: herdr-app is not on your PATH, so the mods were not checked. You can run: herdr-app check <home>\mods\$slug"
}
Write-Host $checkNote

# ---- 6. the record, and what to do next ---------------------------------------------------------

$indDirValue = $null
if ($indicatorInstalled) { $indDirValue = $IndicatorDir }
$data = [ordered]@{
    package          = $slug
    installed        = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
    herdrHome        = $HerdrHome
    files            = $files
    createdFolders   = $createdFolders
    indicatorDir     = $indDirValue
    indicatorProgram = "$prog.exe"
    indicatorFiles   = $indicatorFiles
    backup           = $backup
    indicatorBackup  = $indicatorBackup
}
[System.IO.File]::WriteAllText($record, (($data | ConvertTo-Json -Depth 6) + "`n"), $utf8)

Write-Host ""
Write-Host "Installed. Your own layout and your keys were not changed. Next:"
Write-Host "  1. Switch to the look: in Herdr press Ctrl+Shift+L until it shows, or run"
Write-Host "       herdr-app do layout.switch --name $slug"
Write-Host "     Ctrl+Shift+L again switches back."
Write-Host "  2. Optional: the search bar works by click. To also open it with Ctrl+F, add this one line"
Write-Host "     to the `"global`" section of keys.json in the Herdr home (SETUP.md, `"The search key`"):"
Write-Host "       `"ctrl-f`": `"mod.open:$slug-search`""
if ($indicatorInstalled) {
    Write-Host "  3. The indicator: right-click it for Light or Dark, strip or stack, Start with Windows"
    Write-Host "     (off until you turn it on there) and Quit. Drag it anywhere."
}
Write-Host "To remove everything this added: uninstall.cmd"
exit 0
