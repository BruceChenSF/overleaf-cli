# Overleaf CC - Pre-Test Verification Script
# Run: .\test-quick-verify.ps1

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$Pass = 0
$Fail = 0

function Write-Pass {
    param([string]$Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
    $script:Pass++
}

function Write-Fail {
    param([string]$Message)
    Write-Host "[FAIL] $Message" -ForegroundColor Red
    $script:Fail++
}

function Write-Section {
    param([string]$Message)
    Write-Host ""
    Write-Host "=== $Message ===" -ForegroundColor Cyan
}

Write-Section "Environment Check"

# Check Node.js
try {
    $nodeVersion = node --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        $versionNumber = [version]($nodeVersion -replace 'v', '')
        if ($versionNumber -ge [version]"18.0.0") {
            Write-Pass "Node.js: $nodeVersion"
        } else {
            Write-Fail "Node.js too old: $nodeVersion (need 18+)"
        }
    } else {
        Write-Fail "Node.js not found"
    }
} catch {
    Write-Fail "Node.js not found"
}

# Check npm
try {
    $npmVersion = npm --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Pass "npm: $npmVersion"
    } else {
        Write-Fail "npm not found"
    }
} catch {
    Write-Fail "npm not found"
}

Write-Section "Build Verification"

# Check bridge package
if (Test-Path "packages\bridge") {
    Write-Pass "Bridge package directory exists"

    if (Test-Path "packages\bridge\dist\cli.js") {
        Write-Pass "Bridge CLI built"
    } else {
        Write-Fail "Bridge CLI not built (run: cd packages\bridge && npm install && npm run build)"
    }

    if (Test-Path "packages\bridge\dist\index.js") {
        Write-Pass "Bridge main entry exists"
    } else {
        Write-Fail "Bridge main entry missing"
    }

    if (Test-Path "packages\bridge\dist\bridge-server.js") {
        Write-Pass "Bridge server exists"
    } else {
        Write-Fail "Bridge server missing"
    }
} else {
    Write-Fail "Bridge package directory not found"
}

# Check extension
if (Test-Path "dist\manifest.json") {
    Write-Pass "Extension manifest built"

    try {
        $manifest = Get-Content "dist\manifest.json" | ConvertFrom-Json
        Write-Pass "Extension manifest is valid JSON"
    } catch {
        Write-Fail "Extension manifest is invalid JSON"
    }

    if (Test-Path "dist\src\terminal\index.html") {
        Write-Pass "Terminal HTML exists"
    } else {
        Write-Fail "Terminal HTML missing"
    }
} else {
    Write-Fail "Extension not built (run: npm run build)"
}

Write-Section "Dependencies"

if (Test-Path "packages\bridge\node_modules") {
    Write-Pass "Bridge dependencies installed"

    if (Test-Path "packages\bridge\node_modules\ws") {
        Write-Pass "ws package installed"
    } else {
        Write-Fail "ws package missing"
    }

    if (Test-Path "packages\bridge\node_modules\chokidar") {
        Write-Pass "chokidar package installed"
    } else {
        Write-Fail "chokidar package missing"
    }
} else {
    Write-Fail "Bridge dependencies not installed (run: cd packages\bridge && npm install)"
}

if (Test-Path "node_modules") {
    Write-Pass "Extension dependencies installed"

    if (Test-Path "node_modules\xterm") {
        Write-Pass "xterm package installed"
    } else {
        Write-Fail "xterm package missing"
    }
} else {
    Write-Fail "Extension dependencies not installed (run: npm install)"
}

Write-Section "Port Check"

try {
    $portInUse = Get-NetTCPConnection -LocalPort 3456 -ErrorAction SilentlyContinue
    if ($portInUse) {
        Write-Host "[WARN] Port 3456 is in use (bridge may already be running)" -ForegroundColor Yellow
    } else {
        Write-Pass "Port 3456 is available"
    }
} catch {
    Write-Host "[WARN] Cannot check port availability" -ForegroundColor Yellow
}

Write-Section "Summary"

Write-Host "Passed: $Pass" -ForegroundColor Green
Write-Host "Failed: $Fail" -ForegroundColor Red
Write-Host ""

if ($Fail -eq 0) {
    Write-Host "[SUCCESS] All checks passed! Ready for testing." -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "1. Start bridge: cd packages\bridge && node dist\cli.js"
    Write-Host "2. Load extension in Chrome (chrome://extensions/)"
    Write-Host "3. Click Terminal button in Overleaf"
    exit 0
} else {
    Write-Host "[ERROR] Some checks failed. Please fix the issues above." -ForegroundColor Red
    Write-Host ""
    Write-Host "Quick fix:" -ForegroundColor Cyan
    Write-Host "cd packages\bridge && npm install && npm run build"
    exit 1
}
