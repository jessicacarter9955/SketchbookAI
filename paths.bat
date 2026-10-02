@echo off
:: Change directory to the folder where the script is located
cd /d "%~dp0"

:: Clear the content of paths.txt if it already exists
echo. > paths.txt

:: Search for all .d.ts files and append their relative paths to paths.txt
for /r %%f in (*.ts) do (
    set "relativePath=%%f"
    setlocal enabledelayedexpansion
    :: Remove the base directory path from the full path
    set "relativePath=!relativePath:%cd%\=!"
    echo !relativePath! >> paths.txt
    endlocal
)

echo All relative .d.ts file paths have been written to paths.txt.

for %%f in (src\examples\*.ts) do (
    :: Generate the diff and save it to a .txt file
    git log -p -n 100 -- %%f > src\examples\diffs\%%~nf.ts.txt
)