# Overleaf CC - Pre-Test Verification Script for Windows
# Run: .\test-quick-verify.ps1

# 设置控制台编码为 UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# 设置控制台代码页为 UTF-8 (忽略错误)
chcp 65001 | Out-Null

$ErrorActionPreference = "Stop"

Write-Host "==================================" -ForegroundColor Cyan
Write-Host "Overleaf CC - Pre-Test Verification" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

$Pass = 0
$Fail = 0

function Check-Pass {
    param([string]$Message)
    Write-Host "✓ PASS: $Message" -ForegroundColor Green
    $script:Pass++
}

function Check-Fail {
    param([string]$Message)
    Write-Host "✗ FAIL: $Message" -ForegroundColor Red
    $script:Fail++
}

function Check-Warn {
    param([string]$Message)
    Write-Host "⚠ WARN: $Message" -ForegroundColor Yellow
}

Write-Host "=== Phase 1: Environment Check ===" -ForegroundColor Cyan
Write-Host ""

# Check Node.js
try {
    $nodeVersion = node --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        $versionNumber = [version]($nodeVersion -replace 'v', '')
        if ($versionNumber -ge [version]"18.0.0") {
            Check-Pass "Node.js version: $nodeVersion"
        } else {
            Check-Fail "Node.js version too old: $nodeVersion (need 18+)"
        }
    } else {
        Check-Fail "Node.js not found"
    }
} catch {
    Check-Fail "Node.js not found"
}

# Check npm
try {
    $npmVersion = npm --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Check-Pass "npm version: $npmVersion"
    } else {
        Check-Fail "npm not found"
    }
} catch {
    Check-Fail "npm not found"
}

Write-Host ""
Write-Host "=== Phase 2: Build Verification ===" -ForegroundColor Cyan
Write-Host ""

# Check if bridge package exists
if (Test-Path "packages\bridge") {
    Check-Pass "Bridge package directory exists"

    # Check if bridge is built
    if (Test-Path "packages\bridge\dist\cli.js") {
        Check-Pass "Bridge CLI built (dist\cli.js)"
    } else {
        Check-Fail "Bridge CLI not built - run: cd packages\bridge; npm run build"
    }

    # Check main files
    if (Test-Path "packages\bridge\dist\index.js") {
        Check-Pass "Bridge main entry exists"
    } else {
        Check-Fail "Bridge main entry missing"
    }

    if (Test-Path "packages\bridge\dist\bridge-server.js") {
        Check-Pass "Bridge server exists"
    } else {
        Check-Fail "Bridge server missing"
    }
} else {
    Check-Fail "Bridge package directory not found"
}

# Check if extension is built
if (Test-Path "dist\manifest.json") {
    Check-Pass "Extension manifest built"

    # Verify manifest is valid JSON
    try {
        $manifest = Get-Content "dist\manifest.json" | ConvertFrom-Json
        Check-Pass "Extension manifest is valid JSON"
    } catch {
        Check-Fail "Extension manifest is invalid JSON"
    }

    # Check terminal files
    if (Test-Path "dist\src\terminal\index.html") {
        Check-Pass "Terminal HTML exists"
    } else {
        Check-Fail "Terminal HTML missing"
    }
} else {
    Check-Fail "Extension not built - run: npm run build"
}

Write-Host ""
Write-Host "=== Phase 3: Dependency Check ===" -ForegroundColor Cyan
Write-Host ""

# Check bridge dependencies
if (Test-Path "packages\bridge\node_modules") {
    Check-Pass "Bridge dependencies installed"

    # Check specific packages
    if (Test-Path "packages\bridge\node_modules\ws") {
        Check-Pass "ws package installed"
    } else {
        Check-Fail "ws package missing"
    }

    if (Test-Path "packages\bridge\node_modules\chokidar") {
        Check-Pass "chokidar package installed"
    } else {
        Check-Fail "chokidar package missing"
    }
} else {
    Check-Fail "Bridge dependencies not installed - run: cd packages\bridge; npm install"
}

# Check extension dependencies
if (Test-Path "node_modules") {
    Check-Pass "Extension dependencies installed"

    if (Test-Path "node_modules\xterm") {
        Check-Pass "xterm package installed"
    } else {
        Check-Fail "xterm package missing"
    }
} else {
    Check-Fail "Extension dependencies not installed - run: npm install"
}

Write-Host ""
Write-Host "=== Phase 4: Port Availability ===" -ForegroundColor Cyan
Write-Host ""

# Check if port 3456 is in use
try {
    $portInUse = Get-NetTCPConnection -LocalPort 3456 -ErrorAction SilentlyContinue
    if ($portInUse) {
        Check-Warn "Port 3456 is in use - bridge server may already be running"
        Write-Host "  Process ID: $($portInUse.OwningProcess)" -ForegroundColor Gray
    } else {
        Check-Pass "Port 3456 is available"
    }
} catch {
    Check-Warn "Cannot check port availability"
}

Write-Host ""
Write-Host "=== Phase 5: Workspace Check ===" -ForegroundColor Cyan
Write-Host ""

# Check workspace directory
if (Test-Path "packages\bridge\overleaf-workspace") {
    Check-Pass "Workspace directory exists"

    $projectCount = (Get-ChildItem "packages\bridge\overleaf-workspace" -Directory -ErrorAction SilentlyContinue).Count
    if ($projectCount -gt 0) {
        Check-Warn "Workspace has $projectCount project(s) - consider cleaning for fresh test"
    }
} else {
    Check-Pass "Workspace directory not created yet (expected for first run)"
}

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Passed: $Pass" -ForegroundColor Green
Write-Host "Failed: $Fail" -ForegroundColor Red
Write-Host ""

if ($Fail -eq 0) {
    Write-Host "✓ All checks passed! Ready for testing." -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "1. Start bridge server: cd packages\bridge; node dist\cli.js"
    Write-Host "2. Load extension in Chrome (chrome://extensions/)"
    Write-Host "3. Open Overleaf project and click Terminal button"
    Write-Host ""
    Write-Host "See test plan: docs\testing\WINDOWS-TEST-GUIDE.md"
    exit 0
} else {
    Write-Host "✗ Some checks failed. Please fix the above issues before testing." -ForegroundColor Red
    Write-Host ""
    Write-Host "Common fixes:" -ForegroundColor Cyan
    Write-Host "- Missing build: Run 'npm run build' (root) and 'cd packages\bridge; npm run build'"
    Write-Host "- Missing dependencies: Run 'npm install' in respective directories"
    Write-Host "- Port in use: Kill existing bridge server or use different port"
    exit 1
}
