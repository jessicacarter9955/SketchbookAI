param(
    [Parameter(Mandatory=$true)][string]$Project,
    [string]$Engine = 'C:\Program Files\Epic Games\UE_5.7'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot
$source = Split-Path (Resolve-Path -LiteralPath $Project).Path
if (!(Test-Path -LiteralPath (Join-Path $source 'Content'))) { throw 'Project Content folder missing.' }
$scratch = Join-Path $repo '.local\unreal-export'
New-Item -ItemType Directory -Force -Path $scratch | Out-Null
$content = Join-Path $scratch 'Content'
if (Test-Path -LiteralPath $content) {
    if ((Get-Item -LiteralPath $content).Target -ne (Join-Path $source 'Content')) { throw 'Export workspace points to another project.' }
} else { New-Item -ItemType Junction -Path $content -Target (Join-Path $source 'Content') | Out-Null }
@{FileVersion=3;EngineAssociation='5.7';Plugins=@(
    @{Name='PythonScriptPlugin';Enabled=$true},@{Name='GLTFExporter';Enabled=$true}
)} | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $scratch 'Export.uproject')
$env:DDS_EXPORT_DIR = Join-Path $repo 'build\local-scenes\dds'
$arguments = @(
    ('"' + (Join-Path $scratch 'Export.uproject') + '"'), '-run=pythonscript',
    ('-script="' + (Join-Path $PSScriptRoot 'export-dds.py') + '"'),
    '-unattended','-nosplash','-nullrhi','-nosound','-NoSourceControl','-stdout','-FullStdOutLogOutput'
)
$process = Start-Process -FilePath (Join-Path $Engine 'Engine\Binaries\Win64\UnrealEditor-Cmd.exe') `
    -ArgumentList $arguments -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $scratch 'export.log') `
    -RedirectStandardError (Join-Path $scratch 'export-error.log')
Write-Output "Export process $($process.Id); log: $scratch\export.log"
