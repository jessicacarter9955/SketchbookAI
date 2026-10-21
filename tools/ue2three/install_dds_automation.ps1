param(
    [Parameter(Mandatory = $true)][string]$ConfigPath,
    [string]$TaskName = 'DDS-UE2Three-Agent',
    [switch]$StartNow
)
$ErrorActionPreference = 'Stop'
$configFile = (Resolve-Path -LiteralPath $ConfigPath).Path
$runner = Join-Path $PSScriptRoot 'dds_automation.py'
$python = (Get-Command python -CommandType Application | Select-Object -First 1).Source
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    throw "Task '$TaskName' already exists. Inspect it before replacing a running supervisor."
}
$arguments = '"' + $runner + '" --config "' + $configFile + '" --once'
$action = New-ScheduledTaskAction -Execute $python -Argument $arguments -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'ue2three: durable bounded agent, cached replay and verified Git promotion; independent of chat streaming.' | Out-Null
if ($StartNow) { Start-ScheduledTask -TaskName $TaskName }
Get-ScheduledTaskInfo -TaskName $TaskName | Format-List LastRunTime, LastTaskResult, NextRunTime
