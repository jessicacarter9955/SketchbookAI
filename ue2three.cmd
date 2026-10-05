@echo off
if "%~1"=="" (
  python "%~dp0tools\ue2three\ue2three.py" dashboard --open
) else (
  python "%~dp0tools\ue2three\ue2three.py" %*
)
