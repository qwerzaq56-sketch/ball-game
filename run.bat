@echo off
setlocal
cd /d "%~dp0"

set PORT=8000
set URL=http://localhost:%PORT%

where python >nul 2>nul
if %errorlevel%==0 (
    echo Starting local server on %URL% ...
    start "Ball Game Server" /min cmd /c "python -m http.server %PORT%"
    goto :waitAndOpen
)

where py >nul 2>nul
if %errorlevel%==0 (
    echo Starting local server on %URL% ...
    start "Ball Game Server" /min cmd /c "py -m http.server %PORT%"
    goto :waitAndOpen
)

where npx >nul 2>nul
if %errorlevel%==0 (
    echo Python was not found, but Node.js is available.
    echo Starting local server with "npx serve" ...
    start "Ball Game Server" /min cmd /c "npx --yes serve -l %PORT% ."
    goto :waitAndOpen
)

echo.
echo Neither Python nor Node.js was found on this PC.
echo Install Python from https://www.python.org/downloads/ ^(check "Add to PATH" during setup^)
echo and run this script again, or open this folder with any other local static file server.
echo.
pause
exit /b 1

:waitAndOpen
REM Give the server a moment to actually start listening before we open the browser
REM (a plain static server binds almost instantly, so a short fixed delay is reliable enough).
timeout /t 2 /nobreak >nul
start "" %URL%
echo.
echo If the browser did not open automatically, go to %URL%
echo Close the "Ball Game Server" window to stop the server.
echo.
pause
