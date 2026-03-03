#!/bin/bash
# Quick Verification Script for Overleaf CC
# Run this before starting manual testing

set -e  # Exit on error

echo "=================================="
echo "Overleaf CC - Pre-Test Verification"
echo "=================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
PASS=0
FAIL=0

check_pass() {
    echo -e "${GREEN}✓ PASS${NC}: $1"
    ((PASS++))
}

check_fail() {
    echo -e "${RED}✗ FAIL${NC}: $1"
    ((FAIL++))
}

check_warn() {
    echo -e "${YELLOW}⚠ WARN${NC}: $1"
}

echo "=== Phase 1: Environment Check ==="
echo ""

# Check Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    if [[ "$NODE_VERSION" > "v18" ]]; then
        check_pass "Node.js version: $NODE_VERSION"
    else
        check_fail "Node.js version too old: $NODE_VERSION (need 18+)"
    fi
else
    check_fail "Node.js not found"
fi

# Check npm
if command -v npm &> /dev/null; then
    check_pass "npm version: $(npm --version)"
else
    check_fail "npm not found"
fi

echo ""
echo "=== Phase 2: Build Verification ==="
echo ""

# Check if bridge package exists
if [ -d "packages/bridge" ]; then
    check_pass "Bridge package directory exists"

    # Check if bridge is built
    if [ -f "packages/bridge/dist/cli.js" ]; then
        check_pass "Bridge CLI built (dist/cli.js)"
    else
        check_fail "Bridge CLI not built - run: cd packages/bridge && npm run build"
    fi

    # Check if main files exist
    if [ -f "packages/bridge/dist/index.js" ]; then
        check_pass "Bridge main entry exists"
    else
        check_fail "Bridge main entry missing"
    fi

    if [ -f "packages/bridge/dist/bridge-server.js" ]; then
        check_pass "Bridge server exists"
    else
        check_fail "Bridge server missing"
    fi
else
    check_fail "Bridge package directory not found"
fi

# Check if extension is built
if [ -f "dist/manifest.json" ]; then
    check_pass "Extension manifest built"

    # Verify manifest is valid JSON
    if jq empty dist/manifest.json 2>/dev/null; then
        check_pass "Extension manifest is valid JSON"
    else
        check_fail "Extension manifest is invalid JSON"
    fi

    # Check terminal files
    if [ -f "dist/src/terminal/index.html" ]; then
        check_pass "Terminal HTML exists"
    else
        check_fail "Terminal HTML missing"
    fi
else
    check_fail "Extension not built - run: npm run build"
fi

echo ""
echo "=== Phase 3: Dependency Check ==="
echo ""

# Check bridge dependencies
if [ -d "packages/bridge/node_modules" ]; then
    check_pass "Bridge dependencies installed"

    # Check specific critical packages
    if [ -d "packages/bridge/node_modules/ws" ]; then
        check_pass "ws package installed"
    else
        check_fail "ws package missing"
    fi

    if [ -d "packages/bridge/node_modules/chokidar" ]; then
        check_pass "chokidar package installed"
    else
        check_fail "chokidar package missing"
    fi
else
    check_fail "Bridge dependencies not installed - run: cd packages/bridge && npm install"
fi

# Check extension dependencies
if [ -d "node_modules" ]; then
    check_pass "Extension dependencies installed"

    if [ -d "node_modules/xterm" ]; then
        check_pass "xterm package installed"
    else
        check_fail "xterm package missing"
    fi
else
    check_fail "Extension dependencies not installed - run: npm install"
fi

echo ""
echo "=== Phase 4: Port Availability ==="
echo ""

# Check if port 3456 is available
if command -v netstat &> /dev/null; then
    if netstat -an | grep -q ":3456.*LISTEN"; then
        check_warn "Port 3456 is already in use - bridge server may already be running"
    else
        check_pass "Port 3456 is available"
    fi
elif command -v ss &> /dev/null; then
    if ss -ln | grep -q ":3456"; then
        check_warn "Port 3456 is already in use - bridge server may already be running"
    else
        check_pass "Port 3456 is available"
    fi
else
    check_warn "Cannot check port availability (netstat/ss not found)"
fi

echo ""
echo "=== Phase 5: Workspace Check ==="
echo ""

# Check workspace directory
if [ -d "packages/bridge/overleaf-workspace" ]; then
    check_pass "Workspace directory exists"
    WORKSPACE_COUNT=$(find packages/bridge/overleaf-workspace -type d -mindepth 1 -maxdepth 1 2>/dev/null | wc -l)
    if [ "$WORKSPACE_COUNT" -gt 0 ]; then
        check_warn "Workspace has $WORKSPACE_COUNT project(s) - consider cleaning for fresh test"
    fi
else
    check_pass "Workspace directory not created yet (expected for first run)"
fi

echo ""
echo "=== Summary ==="
echo ""
echo -e "${GREEN}Passed: $PASS${NC}"
echo -e "${RED}Failed: $FAIL${NC}"
echo ""

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed! Ready for testing.${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Start bridge server: cd packages/bridge && node dist/cli.js"
    echo "2. Load extension in Chrome (chrome://extensions/)"
    echo "3. Open Overleaf project and click Terminal button"
    echo ""
    echo "See test plan: docs/testing/systematic-test-plan.md"
    exit 0
else
    echo -e "${RED}✗ Some checks failed. Please fix the above issues before testing.${NC}"
    echo ""
    echo "Common fixes:"
    echo "- Missing build: Run 'npm run build' (root) and 'cd packages/bridge && npm run build'"
    echo "- Missing dependencies: Run 'npm install' in respective directories"
    echo "- Port in use: Kill existing bridge server or use different port"
    exit 1
fi
