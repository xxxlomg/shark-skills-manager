@echo off
setlocal
rem ===========================================================================
rem  shark-skills-manager portable build script (green / unzip-and-run) - Windows
rem  Output : dist-portable\shark-skills-manager_<version>_win64.zip
rem  Layout : shark-skills-manager.exe + skills/ side by side, double-click to run.
rem  ASCII-only on purpose: batch parser reads the file in the system code
rem  page, so any non-ASCII byte risks corrupting line parsing on zh-CN/GBK
rem  consoles. Keep messages English.
rem
rem  The Tauri release exe embeds the frontend; skills/ is an external
rem  resource. config.rs builtin_skills_dir() release branch prefers a
rem  skills/ folder next to the exe, so bundling the two together is enough.
rem ===========================================================================
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "EXE=%ROOT%\src-tauri\target\release\shark-skills-manager.exe"
set "OUTROOT=%ROOT%\dist-portable"
set "OUT=%OUTROOT%\shark-skills-manager"

rem --- read version (tauri.conf.json.version) ---
for /f "usebackq delims=" %%V in (`powershell -NoProfile -Command "(Get-Content -Raw '%ROOT%\src-tauri\tauri.conf.json' | ConvertFrom-Json).version"`) do set "VERSION=%%V"
if not defined VERSION (echo [ERROR] cannot read version & exit /b 1)
set "ZIP=%OUTROOT%\shark-skills-manager_%VERSION%_win64.zip"

echo === [1/3] building release exe (npx tauri build --no-bundle) ===
pushd "%ROOT%"
call npx tauri build --no-bundle
if errorlevel 1 (echo [ERROR] tauri build failed & popd & exit /b 1)
popd
if not exist "%EXE%" (echo [ERROR] artifact not found: %EXE% & exit /b 1)

echo === [2/3] assembling portable directory ===
if exist "%OUT%" rmdir /s /q "%OUT%"
if exist "%ZIP%" del /q "%ZIP%"
mkdir "%OUT%" >nul
copy /y "%EXE%" "%OUT%\shark-skills-manager.exe" >nul
robocopy "%ROOT%\skills" "%OUT%\skills" /E /NFL /NDL /NJH /NJS >nul
if errorlevel 8 (echo [ERROR] failed to copy skills/ & exit /b 1)

echo === [3/3] packing zip ===
powershell -NoProfile -Command "Compress-Archive -Path '%OUT%' -DestinationPath '%ZIP%' -Force"
if errorlevel 1 (echo [ERROR] zip failed & exit /b 1)

echo.
echo Done: %ZIP%
echo Extracted layout:
echo   shark-skills-manager\{
echo     shark-skills-manager.exe   ^<- double-click to run
echo     skills\           ^<- built-in sample skills (editable)
echo   }
echo Tip: if Windows shows "Windows protected your PC",
echo       click "More info" then "Run anyway".
endlocal
exit /b 0