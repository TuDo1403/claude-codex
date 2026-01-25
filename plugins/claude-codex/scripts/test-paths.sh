#!/bin/bash
# Test script for verifying path resolution in multi-project scenarios
# Run this to ensure PLUGIN_ROOT and TASK_DIR are correctly set

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Use temp file to track results across subshells
RESULTS_FILE=$(mktemp)
echo "0 0" > "$RESULTS_FILE"

log_test() { echo -e "${BLUE}[TEST]${NC} $1"; }
log_pass() {
  echo -e "${GREEN}[PASS]${NC} $1"
  local counts
  read -r passed failed < "$RESULTS_FILE"
  echo "$((passed + 1)) $failed" > "$RESULTS_FILE"
}
log_fail() {
  echo -e "${RED}[FAIL]${NC} $1"
  local counts
  read -r passed failed < "$RESULTS_FILE"
  echo "$passed $((failed + 1))" > "$RESULTS_FILE"
}
log_info() { echo -e "${YELLOW}[INFO]${NC} $1"; }

# Clean up function
cleanup() {
  rm -f "$RESULTS_FILE"
}
trap cleanup EXIT

echo ""
echo "========================================="
echo "   Path Resolution Tests"
echo "========================================="
echo ""

# Test 1: PLUGIN_ROOT defaults to script parent when no env var
log_test "PLUGIN_ROOT defaults correctly without CLAUDE_PLUGIN_ROOT"
(
  unset CLAUDE_PLUGIN_ROOT
  unset CLAUDE_PROJECT_DIR
  source "$SCRIPT_DIR/state-manager.sh"
  expected_plugin_root="$(dirname "$SCRIPT_DIR")"
  if [[ "$PLUGIN_ROOT" == "$expected_plugin_root" ]]; then
    log_pass "PLUGIN_ROOT=$PLUGIN_ROOT (derived from script location)"
  else
    log_fail "PLUGIN_ROOT=$PLUGIN_ROOT, expected $expected_plugin_root"
  fi
)

# Test 2: PLUGIN_ROOT uses CLAUDE_PLUGIN_ROOT when set
log_test "PLUGIN_ROOT uses CLAUDE_PLUGIN_ROOT env var"
(
  export CLAUDE_PLUGIN_ROOT="/fake/plugin/root"
  unset CLAUDE_PROJECT_DIR
  source "$SCRIPT_DIR/state-manager.sh"
  if [[ "$PLUGIN_ROOT" == "/fake/plugin/root" ]]; then
    log_pass "PLUGIN_ROOT=$PLUGIN_ROOT (from env var)"
  else
    log_fail "PLUGIN_ROOT=$PLUGIN_ROOT, expected /fake/plugin/root"
  fi
)

# Test 3: TASK_DIR defaults to ./.task when no env var
log_test "TASK_DIR defaults to ./.task without CLAUDE_PROJECT_DIR"
(
  unset CLAUDE_PLUGIN_ROOT
  unset CLAUDE_PROJECT_DIR
  source "$SCRIPT_DIR/state-manager.sh"
  if [[ "$TASK_DIR" == "./.task" ]]; then
    log_pass "TASK_DIR=$TASK_DIR (default)"
  else
    log_fail "TASK_DIR=$TASK_DIR, expected ./.task"
  fi
)

# Test 4: TASK_DIR uses CLAUDE_PROJECT_DIR when set
log_test "TASK_DIR uses CLAUDE_PROJECT_DIR env var"
(
  unset CLAUDE_PLUGIN_ROOT
  export CLAUDE_PROJECT_DIR="/my/project"
  source "$SCRIPT_DIR/state-manager.sh"
  if [[ "$TASK_DIR" == "/my/project/.task" ]]; then
    log_pass "TASK_DIR=$TASK_DIR (from env var)"
  else
    log_fail "TASK_DIR=$TASK_DIR, expected /my/project/.task"
  fi
)

# Test 5: State file uses TASK_DIR
log_test "STATE_FILE is relative to TASK_DIR"
(
  export CLAUDE_PROJECT_DIR="/test/project"
  source "$SCRIPT_DIR/state-manager.sh"
  if [[ "$STATE_FILE" == "/test/project/.task/state.json" ]]; then
    log_pass "STATE_FILE=$STATE_FILE"
  else
    log_fail "STATE_FILE=$STATE_FILE, expected /test/project/.task/state.json"
  fi
)

# Test 6: Integration test - create state in a temp project directory
log_test "Integration: State file created in project directory"
(
  TEST_PROJECT_DIR=$(mktemp -d)
  export CLAUDE_PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"
  export CLAUDE_PROJECT_DIR="$TEST_PROJECT_DIR"

  source "$SCRIPT_DIR/state-manager.sh"
  init_state

  if [[ -f "$TEST_PROJECT_DIR/.task/state.json" ]]; then
    log_pass "State file created at $TEST_PROJECT_DIR/.task/state.json"
    rm -rf "$TEST_PROJECT_DIR"
  else
    log_fail "State file not created in project directory"
    rm -rf "$TEST_PROJECT_DIR"
  fi
)

# Test 8: Multiple projects don't conflict
log_test "Integration: Multiple projects have isolated state"
(
  PROJECT_A=$(mktemp -d)
  PROJECT_B=$(mktemp -d)
  PLUGIN="$(dirname "$SCRIPT_DIR")"

  # Initialize state in project A
  CLAUDE_PLUGIN_ROOT="$PLUGIN" CLAUDE_PROJECT_DIR="$PROJECT_A" bash -c "
    source '$SCRIPT_DIR/state-manager.sh'
    init_state
    set_state 'implementing' 'task-a'
  "

  # Initialize state in project B
  CLAUDE_PLUGIN_ROOT="$PLUGIN" CLAUDE_PROJECT_DIR="$PROJECT_B" bash -c "
    source '$SCRIPT_DIR/state-manager.sh'
    init_state
    set_state 'plan_drafting' 'task-b'
  "

  # Read state from project A
  state_a=$(CLAUDE_PLUGIN_ROOT="$PLUGIN" CLAUDE_PROJECT_DIR="$PROJECT_A" bash -c "
    source '$SCRIPT_DIR/state-manager.sh'
    get_status
  ")

  # Read state from project B
  state_b=$(CLAUDE_PLUGIN_ROOT="$PLUGIN" CLAUDE_PROJECT_DIR="$PROJECT_B" bash -c "
    source '$SCRIPT_DIR/state-manager.sh'
    get_status
  ")

  if [[ "$state_a" == "implementing" && "$state_b" == "plan_drafting" ]]; then
    log_pass "Projects isolated: A=$state_a, B=$state_b"
  else
    log_fail "Projects not isolated: A=$state_a (expected implementing), B=$state_b (expected plan_drafting)"
  fi

  # Cleanup
  rm -rf "$PROJECT_A" "$PROJECT_B"
)

# Test 9: Review limit returns hardcoded default
log_test "get_review_loop_limit returns hardcoded default"
(
  export CLAUDE_PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"
  export CLAUDE_PROJECT_DIR="/some/other/project"
  source "$SCRIPT_DIR/state-manager.sh"

  limit=$(get_review_loop_limit)
  if [[ "$limit" == "10" ]]; then
    log_pass "get_review_loop_limit returned: $limit"
  else
    log_fail "get_review_loop_limit returned $limit, expected 10"
  fi
)

# Test 10: Review limit defaults
log_test "Review limit functions return expected defaults"
(
  export CLAUDE_PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"
  source "$SCRIPT_DIR/state-manager.sh"

  review_limit=$(get_review_loop_limit)
  plan_limit=$(get_plan_review_limit)
  code_limit=$(get_code_review_limit)

  if [[ "$review_limit" == "10" && "$plan_limit" == "10" && "$code_limit" == "15" ]]; then
    log_pass "Review limits correct: review=$review_limit, plan=$plan_limit, code=$code_limit"
  else
    log_fail "Review limits wrong: review=$review_limit, plan=$plan_limit, code=$code_limit"
  fi
)

# Test 11: Gitignore prompt shown when .task not in .gitignore
log_test "Gitignore prompt shown on first init (no .gitignore)"
(
  TEST_PROJECT_DIR=$(mktemp -d)
  export CLAUDE_PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"
  export CLAUDE_PROJECT_DIR="$TEST_PROJECT_DIR"

  source "$SCRIPT_DIR/state-manager.sh"
  output=$(init_state 2>&1)

  if [[ "$output" == *".task directory not in .gitignore"* ]]; then
    log_pass "Gitignore prompt shown when missing"
  else
    log_fail "Gitignore prompt not shown"
  fi

  # Cleanup
  rm -rf "$TEST_PROJECT_DIR"
)

# Test 12: Gitignore prompt NOT shown when .task is in .gitignore
log_test "Gitignore prompt skipped when .task in .gitignore"
(
  TEST_PROJECT_DIR=$(mktemp -d)
  export CLAUDE_PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"
  export CLAUDE_PROJECT_DIR="$TEST_PROJECT_DIR"

  # Create .gitignore with .task
  echo ".task" > "$TEST_PROJECT_DIR/.gitignore"

  source "$SCRIPT_DIR/state-manager.sh"
  output=$(init_state 2>&1)

  if [[ "$output" != *".task directory not in .gitignore"* ]]; then
    log_pass "Gitignore prompt skipped (already in .gitignore)"
  else
    log_fail "Gitignore prompt shown when it shouldn't"
  fi

  # Cleanup
  rm -rf "$TEST_PROJECT_DIR"
)

# Test 13: Gitignore prompt only shown once (marker file)
log_test "Gitignore prompt only shown once per project"
(
  TEST_PROJECT_DIR=$(mktemp -d)
  export CLAUDE_PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"
  export CLAUDE_PROJECT_DIR="$TEST_PROJECT_DIR"

  source "$SCRIPT_DIR/state-manager.sh"

  # First init - should show prompt
  output1=$(init_state 2>&1)

  # Reset state file to trigger init again
  rm -f "$TEST_PROJECT_DIR/.task/state.json"

  # Second init - should NOT show prompt (marker exists)
  output2=$(init_state 2>&1)

  if [[ "$output1" == *".task directory not in .gitignore"* ]] && \
     [[ "$output2" != *".task directory not in .gitignore"* ]]; then
    log_pass "Prompt shown first time only"
  else
    log_fail "Prompt behavior incorrect"
  fi

  # Cleanup
  rm -rf "$TEST_PROJECT_DIR"
)

# Summary
echo ""
echo "========================================="
echo "   Test Summary"
echo "========================================="
echo ""
read -r TESTS_PASSED TESTS_FAILED < "$RESULTS_FILE"
echo -e "Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Failed: ${RED}$TESTS_FAILED${NC}"
echo ""

if [[ $TESTS_FAILED -eq 0 ]]; then
  echo -e "${GREEN}All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}Some tests failed.${NC}"
  exit 1
fi
