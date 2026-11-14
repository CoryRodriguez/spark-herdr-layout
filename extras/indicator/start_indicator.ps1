# Starts the Spark indicator as its own detached process with a clean environment.
# Safe to run twice: a second copy sees the first one and exits quietly.
# Extra arguments are passed through (for example: --dry-run).
$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $dir "SparkIndicator.exe"
if (-not (Test-Path $exe)) {
    Write-Host "SparkIndicator.exe is missing. Run build.cmd in $dir first."
    exit 1
}

# Nothing the indicator starts may inherit the identity of an agent session.
# (The exe also removes these from itself on startup; this is the belt to that suspenders.)
Get-ChildItem Env: |
    Where-Object { $_.Name -like "CLAUDE_*" -or $_.Name -like "CLAUDECODE*" -or $_.Name -like "HC_TERMINAL*" } |
    ForEach-Object { Remove-Item ("Env:" + $_.Name) -ErrorAction SilentlyContinue }

if ($args.Count -gt 0) {
    Start-Process -FilePath $exe -WorkingDirectory $dir -ArgumentList $args
} else {
    Start-Process -FilePath $exe -WorkingDirectory $dir
}
Start-Sleep -Milliseconds 800
$running = Get-Process -Name SparkIndicator -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe }
if ($running) { Write-Host ("Spark indicator is running (pid " + (($running | ForEach-Object { $_.Id }) -join ", ") + ").") }
else { Write-Host "Spark indicator did not stay up. See indicator.log in $dir." ; exit 1 }
