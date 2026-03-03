@echo off
REM Overleaf CC - Quick Verification Script for Windows
REM Double-click this file to run

echo ==================================
echo Overleaf CC - Pre-Test Verification
echo ==================================
echo.

set PASS=0
set FAIL=0

echo === Phase 1: Environment Check ===
echo.

REM Check Node.js
where node >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    for /f "delims=" %%i in ('node --version') do set NODE_VERSION=%%i
    echo [OK] Node.js version: %NODE_VERSION%
    set /a PASS+=1
) else (
    echo [FAIL] Node.js not found
    set /a FAIL+=1
)

REM Check npm
where npm >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    for /f "delims=" %%i in ('npm --version') do set NPM_VERSION=%%i
    echo [OK] npm version: %NPM_VERSION%
    set /a PASS+=1
) else (
    echo [FAIL] npm not found
    set /a FAIL+=1
)

echo.
echo === Phase 2: Build Verification ===
echo.

REM Check bridge package
if exist "packages\bridge" (
    echo [OK] Bridge package directory exists
    set /a PASS+=1

    if exist "packages\bridge\dist\cli.js" (
        echo [OK] Bridge CLI built
        set /a PASS+=1
    ) else (
        echo [FAIL] Bridge CLI not built - run: cd packages\bridge ^&^& npm run build
        set /a FAIL+=1
    )

    if exist "packages\bridge\dist\index.js" (
        echo [OK] Bridge main entry exists
        set /a PASS+=1
    ) else (
        echo [FAIL] Bridge main entry missing
        set /a FAIL+=1
    )
) else (
    echo [FAIL] Bridge package directory not found
    set /a FAIL+=1
)

REM Check extension
if exist "dist\manifest.json" (
    echo [OK] Extension manifest built
    set /a PASS+=1

    if exist "dist\src\terminal\index.html" (
        echo [OK] Terminal HTML exists
        set /a PASS+=1
    ) else (
        echo [FAIL] Terminal HTML missing
        set /a FAIL+=1
    )
) else (
    echo [FAIL] Extension not built - run: npm run build
    set /a FAIL+=1
)

echo.
echo === Phase 3: Dependency Check ===
echo.

if exist "packages\bridge\node_modules" (
    echo [OK] Bridge dependencies installed
    set /a PASS+=1

    if exist "packages\bridge\node_modules\ws" (
        echo [OK] ws package installed
        set /a PASS+=1
    ) else (
        echo [FAIL] ws package missing
        set /a FAIL+=1
    )
) else (
    echo [FAIL] Bridge dependencies not installed
    set /a FAIL+=1
)

if exist "node_modules" (
    echo [OK] Extension dependencies installed
    set /a PASS+=1

    if exist "node_modules\xterm" (
        echo [OK] xterm package installed
        set /a PASS+=1
    ) else (
        echo [FAIL] xterm package missing
        set /a FAIL+=1
    )
) else (
    echo [FAIL] Extension dependencies not installed
    set /a FAIL+=1
)

echo.
echo === Summary ===
echo.
echo Passed: %PASS%
echo Failed: %FAIL%
echo.

if %FAIL%==0 (
    echo ✓ All checks passed! Ready for testing.
    echo.
    echo Next steps:
    echo 1. Start bridge server: cd packages\bridge ^&^& node dist\cli.js
    echo 2. Load extension in Chrome (chrome://extensions/)
    echo 3. Open Overleaf project and click Terminal button
    echo.
    echo See test plan: docs\testing\systematic-test-plan.md
    pause
    exit /b 0
) else (
    echo ✗ Some checks failed. Please fix the above issues.
    echo.
    echo Common fixes:
    echo - Missing build: Run "npm run build"
    echo - Missing dependencies: Run "npm install"
    pause
    exit /b 1
)
