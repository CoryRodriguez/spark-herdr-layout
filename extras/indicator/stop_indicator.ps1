# Stops the Spark indicator, and only the indicator: a process counts only if its executable is
# exactly this folder's SparkIndicator.exe (checked against the pid file and the full path).
# It asks nicely first (the indicator closes its own Herdr event stream), then ends what is left.
$ErrorActionPreference = "SilentlyContinue"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $dir "SparkIndicator.exe"

function Get-Mine {
    $found = @{}
    foreach ($pidFile in (Get-ChildItem -Path $dir -Filter "indicator*.pid")) {
        $id = 0
        if ([int]::TryParse((Get-Content $pidFile.FullName -Raw).Trim(), [ref]$id)) {
            $p = Get-Process -Id $id
            if ($p -and $p.Path -eq $exe) { $found[$p.Id] = $p }
        }
    }
    foreach ($p in (Get-Process -Name SparkIndicator)) {
        if ($p.Path -eq $exe) { $found[$p.Id] = $p }
    }
    return @($found.Values)
}

$mine = Get-Mine
if ($mine.Count -eq 0) { Write-Host "Spark indicator is not running."; exit 0 }

# 1. Ask each copy to quit (the main one, and any named test copies).
Start-Process -FilePath $exe -ArgumentList "--send", "quit" -Wait -WindowStyle Hidden
foreach ($pidFile in (Get-ChildItem -Path $dir -Filter "indicator.*.pid")) {
    $name = $pidFile.BaseName.Substring("indicator.".Length)
    Start-Process -FilePath $exe -ArgumentList "--instance", $name, "--send", "quit" -Wait -WindowStyle Hidden
}
for ($i = 0; $i -lt 30 -and (Get-Mine).Count -gt 0; $i++) { Start-Sleep -Milliseconds 100 }

# 2. End whatever did not leave on its own.
$left = Get-Mine
foreach ($p in $left) { Stop-Process -Id $p.Id -Force }
Start-Sleep -Milliseconds 300
Get-ChildItem -Path $dir -Filter "indicator*.pid" | Remove-Item -Force

if ((Get-Mine).Count -eq 0) { Write-Host ("Spark indicator stopped (" + $mine.Count + " process" + $(if ($mine.Count -ne 1) { "es" }) + ").") }
else { Write-Host "Could not stop the Spark indicator."; exit 1 }
