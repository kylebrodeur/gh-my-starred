#!/usr/bin/env bash

# Simple test runner for gh-my-starred

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "=== Running gh-my-starred tests ==="
echo ""

# Test 1: Script exists and is executable
echo "Test: Script exists and is executable"
if [ -f "./gh-my-starred" ] && [ -x "./gh-my-starred" ]; then
  echo "  PASS"
else
  echo "  FAIL: Script not found or not executable"
  exit 1
fi

# Test 2: Valid bash syntax for wrapper
echo "Test: Wrapper script has valid bash syntax"
if bash -n ./gh-my-starred; then
  echo "  PASS"
else
  echo "  FAIL: Syntax error"
  exit 1
fi

# Test 3: Node.js CLI exists and is executable
echo "Test: Node.js CLI exists and is executable"
if [ -f "./src/cli.js" ] && [ -x "./src/cli.js" ]; then
  echo "  PASS"
else
  echo "  FAIL: CLI not found or not executable"
  exit 1
fi

# Test 4: Help works
echo "Test: --help shows usage"
if ./gh-my-starred --help | grep -q "USAGE"; then
  echo "  PASS"
else
  echo "  FAIL"
  exit 1
fi

# Test 5: Version works
echo "Test: --version shows version"
if ./gh-my-starred --version | grep -q "0.2.3"; then
  echo "  PASS"
else
  echo "  FAIL"
  exit 1
fi

# Test 6: Invalid option fails
echo "Test: Invalid option returns error"
if ! ./gh-my-starred --invalid 2>/dev/null; then
  echo "  PASS"
else
  echo "  FAIL"
  exit 1
fi

# Test 7: Help includes list options
echo "Test: --help includes star list options"
if ./gh-my-starred --help | grep -q "\-\-lists"; then
  echo "  PASS"
else
  echo "  FAIL"
  exit 1
fi

# Test 8: PI extension file exists
echo "Test: PI extension file exists"
if [ -f ".pi/extensions/gh-my-starred.ts" ]; then
  echo "  PASS"
else
  echo "  FAIL"
  exit 1
fi

# Test 9: Root package.json is a pi package
echo "Test: Root package.json is a pi package"
if [ -f "package.json" ] && grep -q '"pi"' package.json; then
  echo "  PASS"
else
  echo "  FAIL"
  exit 1
fi

# Test 11: Shared library exists
echo "Test: Shared library (src/lib.js) exists"
if [ -f "src/lib.js" ]; then
  echo "  PASS"
else
  echo "  FAIL"
  exit 1
fi

# Test 12: SKILL.md exists
echo "Test: SKILL.md exists with frontmatter"
if [ -f "SKILL.md" ] && head -1 SKILL.md | grep -q "^---"; then
  echo "  PASS"
else
  echo "  FAIL"
  exit 1
fi

# Test 13: LICENSE exists
echo "Test: LICENSE exists"
if [ -f "LICENSE" ]; then
  echo "  PASS"
else
  echo "  FAIL"
  exit 1
fi

echo ""
echo "=== All tests passed ==="
