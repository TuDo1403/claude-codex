#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# Source state manager
source "$SCRIPT_DIR/state-manager.sh"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Locking functions
LOCK_FILE=".task/.orchestrator.lock"

get_lock_pid() {
  [[ ! -f "$LOCK_FILE" ]] && return
  local content
  content=$(cat "$LOCK_FILE" 2>/dev/null)
  [[ "$content" =~ ^[0-9]+$ ]] && echo "$content"
}

is_pid_alive() {
  local pid="$1"
  [[ -z "$pid" ]] && return 1
  if kill -0 "$pid" 2>/dev/null; then
    return 0
  else
    if kill -0 "$pid" 2>&1 | grep -q "Operation not permitted"; then
      return 0
    fi
    return 1
  fi
}

acquire_lock() {
  local existing_pid
  existing_pid=$(get_lock_pid)

  if [[ -n "$existing_pid" ]]; then
    if is_pid_alive "$existing_pid"; then
      log_error "Another orchestrator is running (PID: $existing_pid)"
      log_error "If this is incorrect, manually remove $LOCK_FILE"
      return 1
    else
      log_warn "Removing stale lock (PID $existing_pid no longer exists)"
      rm -f "$LOCK_FILE"
    fi
  fi

  mkdir -p .task
  if ( set -C; echo $$ > "$LOCK_FILE" ) 2>/dev/null; then
    return 0
  else
    log_error "Failed to acquire lock (race condition)"
    return 1
  fi
}

release_lock() {
  local lock_pid
  lock_pid=$(get_lock_pid)
  [[ "$lock_pid" == "$$" ]] && rm -f "$LOCK_FILE"
}

setup_traps() {
  trap 'release_lock' EXIT
  trap 'release_lock; exit 130' INT
  trap 'release_lock; exit 143' TERM
}

# Get max retries from config
get_max_retries() {
  if [[ -f "pipeline.config.json" ]]; then
    jq -r '.errorHandling.autoResolveAttempts // 3' pipeline.config.json
  else
    echo "3"
  fi
}

# Log error to file
log_error_to_file() {
  local stage="$1"
  local exit_code="$2"
  local message="$3"

  mkdir -p .task/errors
  local timestamp
  timestamp=$(date +%Y%m%d-%H%M%S)
  local error_file=".task/errors/error-${timestamp}.json"

  cat > "$error_file" << EOF
{
  "id": "err-${timestamp}",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "stage": "$stage",
  "exit_code": $exit_code,
  "message": "$message",
  "task_id": "$(get_task_id)",
  "iteration": $(get_iteration)
}
EOF

  echo "$error_file"
}

# Note: Old run_* functions removed - subagents now handle execution
# The orchestrator just shows status and next actions

# Dry-run validation mode
run_dry_run() {
  local errors=0
  local warnings=0

  echo "Running dry-run validation..."
  echo ""

  # 1. Check .task/ directory
  if [[ -d .task ]]; then
    echo "Task directory: OK"
  else
    echo "Task directory: MISSING"
    ((errors++)) || true
  fi

  # 2. Check state.json
  if [[ -f .task/state.json ]]; then
    if jq empty .task/state.json 2>/dev/null; then
      local status
      status=$(jq -r '.status // empty' .task/state.json)
      local valid_states="idle plan_drafting plan_refining plan_reviewing implementing reviewing fixing complete error needs_user_input"
      if [[ -n "$status" ]] && [[ " $valid_states " =~ " $status " ]]; then
        echo "State file: OK (status: $status)"
      else
        echo "State file: INVALID STATUS ($status)"
        ((errors++)) || true
      fi
    else
      echo "State file: INVALID JSON"
      ((errors++)) || true
    fi
  else
    echo "State file: MISSING (will be created on first run)"
  fi

  # 3. Check config file
  if [[ -f pipeline.config.json ]]; then
    if jq empty pipeline.config.json 2>/dev/null; then
      echo "Config file: OK"
    else
      echo "Config file: INVALID JSON"
      ((errors++)) || true
    fi
  else
    echo "Config file: MISSING"
    ((errors++)) || true
  fi

  # 4. Check required scripts
  local required_scripts=(
    "state-manager.sh"
    "run-codex-review.sh"
    "run-codex-plan-review.sh"
    "plan-to-task.sh"
    "orchestrator.sh"
    "recover.sh"
    "validate-config.sh"
    "setup.sh"
  )
  local scripts_ok=1
  for script in "${required_scripts[@]}"; do
    if [[ ! -f "$SCRIPT_DIR/$script" ]]; then
      echo "Script missing: $script"
      scripts_ok=0
      ((errors++)) || true
    elif [[ ! -x "$SCRIPT_DIR/$script" ]]; then
      echo "Script not executable: $script"
      scripts_ok=0
      ((errors++)) || true
    fi
  done
  [[ $scripts_ok -eq 1 ]] && echo "Scripts: OK (${#required_scripts[@]} scripts)"

  # 5. Check subagents
  local subagents_dir="$PROJECT_ROOT/.claude/agents"
  local required_agents=(
    "planner.md"
    "implementer.md"
    "reviewer-sonnet.md"
    "reviewer-opus.md"
    "researcher.md"
  )
  local agents_ok=1
  if [[ -d "$subagents_dir" ]]; then
    for agent in "${required_agents[@]}"; do
      if [[ ! -f "$subagents_dir/$agent" ]]; then
        echo "Subagent missing: $agent"
        agents_ok=0
        ((errors++)) || true
      fi
    done
    [[ $agents_ok -eq 1 ]] && echo "Subagents: OK (${#required_agents[@]} agents)"
  else
    echo "Subagents directory: MISSING (.claude/agents/)"
    ((errors++)) || true
  fi

  # 5. Check required docs
  if [[ -f docs/standards.md ]]; then
    echo "docs/standards.md: OK"
  else
    echo "docs/standards.md: MISSING"
    ((errors++)) || true
  fi

  if [[ -f docs/workflow.md ]]; then
    echo "docs/workflow.md: OK"
  else
    echo "docs/workflow.md: MISSING"
    ((errors++)) || true
  fi

  # 6. Check .gitignore for .task
  if [[ -f .gitignore ]] && grep -q "\.task" .gitignore; then
    echo ".gitignore (.task): OK"
  else
    echo ".gitignore (.task): WARNING - .task not in .gitignore"
    ((warnings++)) || true
  fi

  # 7. Check CLI tools
  if command -v jq >/dev/null 2>&1; then
    echo "CLI jq: OK"
  else
    echo "CLI jq: MISSING (required)"
    ((errors++)) || true
  fi

  if command -v claude >/dev/null 2>&1; then
    echo "CLI claude: OK"
  else
    echo "CLI claude: WARNING - not found"
    ((warnings++)) || true
  fi

  if command -v codex >/dev/null 2>&1; then
    echo "CLI codex: OK"
  else
    echo "CLI codex: WARNING - not found"
    ((warnings++)) || true
  fi

  # 8. Check for global CLAUDE.md conflict
  local global_claude="$HOME/.claude/CLAUDE.md"
  if [[ -f "$global_claude" ]]; then
    if [[ -f .task/preferences.json ]] && jq -e '.workflow_mode' .task/preferences.json >/dev/null 2>&1; then
      local mode
      mode=$(jq -r '.workflow_mode' .task/preferences.json)
      echo "Global CLAUDE.md: DETECTED (configured: $mode mode)"
    else
      echo "Global CLAUDE.md: WARNING - detected but setup not run"
      echo "  Run: ./scripts/setup.sh"
      ((warnings++)) || true
    fi
  else
    echo "Global CLAUDE.md: OK (not detected)"
  fi

  # Summary
  echo ""
  if [[ $errors -eq 0 ]]; then
    if [[ $warnings -gt 0 ]]; then
      echo "Dry run: PASSED ($warnings warnings)"
    else
      echo "Dry run: PASSED"
    fi
    exit 0
  else
    echo "Dry run: FAILED ($errors errors, $warnings warnings)"
    exit 1
  fi
}

# Show next action based on current state
show_next_action() {
  local status
  status=$(get_status)

  log_info "Current state: $status"
  echo ""

  case "$status" in
    idle)
      echo "Pipeline idle. To start:"
      echo "  1. Create .task/user-request.txt with your feature request"
      echo "  2. Run: ./scripts/state-manager.sh set plan_drafting \"\""
      echo "  3. Invoke the planner subagent to create .task/plan.json"
      ;;
    plan_drafting)
      echo "ACTION: Invoke 'planner' subagent"
      echo ""
      echo "Task: Create initial plan from user request"
      echo "Input: .task/user-request.txt"
      echo "Output: .task/plan.json"
      echo ""
      echo "After completion, transition state:"
      echo "  ./scripts/state-manager.sh set plan_refining \"\$(jq -r .id .task/plan.json)\""
      ;;
    plan_refining)
      echo "ACTION: Invoke 'planner' + 'researcher' subagents"
      echo ""
      echo "Task: Refine plan with technical details"
      echo "Input: .task/plan.json"
      if [[ -f .task/plan-review.json ]]; then
        echo "Feedback: .task/plan-review.json (address all concerns)"
      fi
      echo "Output: .task/plan-refined.json"
      echo ""
      echo "After completion, run internal reviews IN PARALLEL:"
      echo "  1. Invoke 'reviewer-sonnet' → .task/internal-review-sonnet.json"
      echo "  2. Invoke 'reviewer-opus' → .task/internal-review-opus.json"
      echo ""
      echo "If BOTH internal reviews approve, transition to Codex final review:"
      echo "  ./scripts/state-manager.sh set plan_reviewing \"\$(jq -r .id .task/plan-refined.json)\""
      ;;
    plan_reviewing)
      echo "ACTION: Run Codex final plan review"
      echo ""
      echo "Command: ./scripts/run-codex-plan-review.sh"
      echo "Output: .task/plan-review.json"
      echo ""
      echo "After Codex review:"
      echo "  - If approved: ./scripts/plan-to-task.sh (auto-converts to task)"
      echo "  - If needs_changes: ./scripts/state-manager.sh set plan_refining <plan_id>"
      ;;
    implementing)
      echo "ACTION: Invoke 'implementer' subagent"
      echo ""
      echo "Task: Implement the approved plan"
      echo "Input: .task/current-task.json"
      echo "Standards: docs/standards.md"
      if [[ -f .task/review-result.json ]]; then
        echo "Feedback: .task/review-result.json (fix all issues)"
      fi
      echo "Output: .task/impl-result.json"
      echo ""
      echo "After implementation, run internal reviews IN PARALLEL:"
      echo "  1. Invoke 'reviewer-sonnet' → .task/internal-review-sonnet.json"
      echo "  2. Invoke 'reviewer-opus' → .task/internal-review-opus.json"
      echo ""
      echo "Each reviewer covers code quality, security, and test coverage."
      echo ""
      echo "If BOTH internal reviews approve, transition to Codex final review:"
      echo "  ./scripts/state-manager.sh set reviewing \"\$(jq -r .id .task/current-task.json)\""
      ;;
    reviewing)
      echo "ACTION: Run Codex final code review"
      echo ""
      echo "Command: ./scripts/run-codex-review.sh"
      echo "Output: .task/review-result.json"
      echo ""
      echo "After Codex review:"
      echo "  - If approved: ./scripts/state-manager.sh set complete <task_id>"
      echo "  - If needs_changes: ./scripts/state-manager.sh set fixing <task_id>"
      echo "  - If rejected: ./scripts/state-manager.sh set error <task_id>"
      echo "    (Task is fundamentally flawed; use ./scripts/recover.sh to restart)"
      ;;
    fixing)
      echo "ACTION: Invoke 'implementer' subagent to fix issues"
      echo ""
      echo "Task: Fix issues from Codex review"
      echo "Input: .task/current-task.json"
      echo "Feedback: .task/review-result.json"
      echo "Output: .task/impl-result.json (updated)"
      echo ""
      echo "After fixes, run internal reviews again, then:"
      echo "  ./scripts/state-manager.sh set reviewing <task_id>"
      ;;
    complete)
      log_success "Task completed successfully!"
      echo ""
      echo "To reset for next task:"
      echo "  ./scripts/orchestrator.sh reset"
      ;;
    needs_user_input)
      log_warn "Pipeline paused - user input required"
      echo ""
      echo "Check for questions in:"
      echo "  - .task/impl-result.json"
      echo "  - .task/plan-refined.json"
      echo ""
      echo "After providing answers, resume with:"
      echo "  ./scripts/state-manager.sh set <plan_refining|implementing> <task_id>"
      ;;
    error)
      log_error "Pipeline in error state"
      echo ""
      echo "To recover:"
      echo "  ./scripts/recover.sh"
      echo ""
      echo "Or reset:"
      echo "  ./scripts/orchestrator.sh reset"
      ;;
    *)
      log_error "Unknown state: $status"
      exit 1
      ;;
  esac
}

# Entry point
case "${1:-run}" in
  run|"")
    # Show current state and next action
    init_state
    show_next_action
    ;;
  status)
    if ! check_state_readable; then exit 1; fi
    echo "Current state: $(get_status)"
    echo "Task ID: $(get_task_id)"
    echo "Iteration: $(get_iteration)"
    ;;
  reset)
    if ! acquire_lock; then
      log_error "Cannot reset while another orchestrator is running"
      exit 1
    fi
    setup_traps
    log_warn "Resetting pipeline state..."
    init_state
    set_state "idle" ""
    rm -f .task/impl-result.json .task/review-result.json
    rm -f .task/plan.json .task/plan-refined.json .task/plan-review.json
    rm -f .task/current-task.json .task/user-request.txt
    rm -f .task/internal-review-sonnet.json .task/internal-review-opus.json
    log_success "Pipeline reset to idle"
    ;;
  dry-run|--dry-run)
    run_dry_run
    ;;
  *)
    echo "Usage: $0 {run|status|reset|dry-run}"
    echo ""
    echo "Commands:"
    echo "  run       Run the orchestrator (default)"
    echo "  status    Show current pipeline state"
    echo "  reset     Reset pipeline to idle"
    echo "  dry-run   Validate setup without running"
    exit 1
    ;;
esac
