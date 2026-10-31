param(
    [Parameter(Mandatory = $true)][string]$ConfigPath,
    [string]$TaskName = 'DDS-UE2Three-Agent',
    [switch]$StartNow
)
$ErrorActionPreference = 'Stop'
$configFile = (Resolve-Path -LiteralPath $ConfigPath).Path
# Fail closed: a python.exe scheduled action can briefly show a console on Windows.
# Use pythonw.exe from the same verified interpreter installation instead.
$runner = Join-Path $PSScriptRoot 'dds_hidden_entry.py'
$python = (Get-Command python -CommandType Application | Select-Object -First 1).Source
if (-not $python) { throw 'Python executable not found' }
$pythonw = Join-Path (Split-Path -Parent $python) 'pythonw.exe'
if (-not (Test-Path -LiteralPath $pythonw -PathType Leaf)) {
    throw 'pythonw.exe not found beside python.exe; refusing a visible-console DDS task'
}
if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) {
    throw 'DDS hidden task entry point missing'
}
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    throw "Task '$TaskName' already exists. Inspect it before replacing a running supervisor."
}
$arguments = '"' + $runner + '" --config "' + $configFile + '" --once'
# pythonw.exe creates no console even when Task Scheduler launches the task.
# The entry point redirects stdout/stderr to an ignored local log.
$action = New-ScheduledTaskAction -Execute $pythonw -Argument $arguments -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'ue2three: durable bounded agent, cached replay and verified Git promotion; independent of chat streaming.' | Out-Null
if ($StartNow) { Start-ScheduledTask -TaskName $TaskName }
Get-ScheduledTaskInfo -TaskName $TaskName | Format-List LastRunTime, LastTaskResult, NextRunTime
