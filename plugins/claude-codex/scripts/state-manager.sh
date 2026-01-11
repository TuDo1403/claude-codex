#!/bin/bash
# State manager using JSON files with atomic writes

# Determine plugin root (where configs live) - use CLAUDE_PLUGIN_ROOT or derive from script location
if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" ]]; then
  PLUGIN_ROOT="$CLAUDE_PLUGIN_ROOT"
else
  # Fallback: derive from script location (for direct execution)
  _STATE_MGR_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  PLUGIN_ROOT="$(dirname "$_STATE_MGR_DIR")"
fi

# Use CLAUDE_PROJECT_DIR for task state (project-local), fall back to current dir
# This ensures each project has its own .task directory regardless of plugin installation scope
TASK_DIR="${CLAUDE_PROJECT_DIR:-.}/.task"
STATE_FILE="$TASK_DIR/state.json"

# Initialize state if not exists (with full schema)
init_state() {
  if [[ ! -f "$STATE_FILE" ]]; then
    mkdir -p "$TASK_DIR"
    cat > "$STATE_FILE" << 'EOF'
{
  "status": "idle",
  "current_task_id": null,
  "iteration": 0,
  "previous_state": null,
  "updated_at": null,
  "started_at": null,
  "error_retry_count": 0
}
EOF
  fi
}

# Get current state
get_state() {
  cat "$STATE_FILE"
}

# Get specific field
get_status() {
  jq -r '.status' "$STATE_FILE"
}

get_task_id() {
  jq -r '.current_task_id // empty' "$STATE_FILE"
}

get_iteration() {
  jq -r '.iteration' "$STATE_FILE"
}

# Update state atomically (write to tmp, then mv)
set_state() {
  local new_status="$1"
  local task_id="$2"

  # When starting a new task, clear the Codex session marker for fresh context
  if [[ "$new_status" == "plan_drafting" ]]; then
    rm -f "$TASK_DIR/.codex-session-active"
  fi

  local current_status
  current_status=$(jq -r '.status' "$STATE_FILE")

  # Store previous state when transitioning to error or needs_user_input
  # But preserve existing previous_state if we're already in that state (avoid clobbering)
  local prev_state=""
  if [[ "$new_status" == "error" || "$new_status" == "needs_user_input" ]]; then
    if [[ "$current_status" == "$new_status" ]]; then
      # Already in this state - preserve existing previous_state
      prev_state=$(jq -r '.previous_state // empty' "$STATE_FILE")
    else
      # Transitioning into this state - record where we came from
      prev_state="$current_status"
    fi
  fi

  if [[ -n "$prev_state" ]]; then
    jq --arg s "$new_status" --arg t "$task_id" --arg p "$prev_state" \
      '.status = $s | .current_task_id = $t | .previous_state = $p | .updated_at = (now | todate)' \
      "$STATE_FILE" > "${STATE_FILE}.tmp"
  else
    jq --arg s "$new_status" --arg t "$task_id" \
      '.status = $s | .current_task_id = $t | del(.previous_state) | .updated_at = (now | todate)' \
      "$STATE_FILE" > "${STATE_FILE}.tmp"
  fi

  mv "${STATE_FILE}.tmp" "$STATE_FILE"
}

# Get previous state (used for error recovery)
get_previous_state() {
  jq -r '.previous_state // empty' "$STATE_FILE"
}

# Check if state file is readable (for non-mutating commands)
check_state_readable() {
  if [[ ! -f "$STATE_FILE" ]]; then
    echo "State file missing. Run './scripts/orchestrator.sh' to initialize."
    return 1
  fi
  if ! jq empty "$STATE_FILE" 2>/dev/null; then
    echo "State file invalid JSON. Run './scripts/orchestrator.sh reset' to fix."
    return 1
  fi
  return 0
}

# Increment iteration (for review loops)
increment_iteration() {
  jq '.iteration += 1 | .updated_at = (now | todate)' \
    "$STATE_FILE" > "${STATE_FILE}.tmp"
  mv "${STATE_FILE}.tmp" "$STATE_FILE"
}

# Reset iteration (for new task)
reset_iteration() {
  jq '.iteration = 0 | .started_at = (now | todate) | .updated_at = (now | todate)' \
    "$STATE_FILE" > "${STATE_FILE}.tmp"
  mv "${STATE_FILE}.tmp" "$STATE_FILE"
}

# Note: awaiting_output functions removed - no longer needed with subagent architecture

# Check if stuck (no update for N seconds)
is_stuck() {
  local timeout_seconds="${1:-600}"
  local updated_at
  updated_at=$(jq -r '.updated_at // empty' "$STATE_FILE")

  if [[ -z "$updated_at" ]]; then
    echo "0"
    return
  fi

  local updated_epoch
  local now_epoch

  # Handle both GNU and BSD date
  if date --version >/dev/null 2>&1; then
    # GNU date
    updated_epoch=$(date -d "$updated_at" +%s 2>/dev/null || echo "0")
  else
    # BSD date
    updated_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$updated_at" +%s 2>/dev/null || echo "0")
  fi

  now_epoch=$(date +%s)
  local diff=$((now_epoch - updated_epoch))

  [[ $diff -gt $timeout_seconds ]] && echo "1" || echo "0"
}

# Get config value with local override support
# Priority: project-local > plugin-local > plugin-base
get_config_value() {
  local filter="$1"
  local base_cfg="$PLUGIN_ROOT/pipeline.config.json"
  local plugin_local_cfg="$PLUGIN_ROOT/pipeline.config.local.json"
  local project_dir="${CLAUDE_PROJECT_DIR:-.}"
  local project_local_cfg="$project_dir/pipeline.config.local.json"

  # Build list of config files to merge (base first, overrides last)
  local configs=("$base_cfg")

  if [[ -f "$plugin_local_cfg" ]] && jq empty "$plugin_local_cfg" 2>/dev/null; then
    configs+=("$plugin_local_cfg")
  fi

  if [[ -f "$project_local_cfg" ]] && jq empty "$project_local_cfg" 2>/dev/null; then
    configs+=("$project_local_cfg")
  fi

  # Merge configs (later files override earlier)
  if [[ ${#configs[@]} -eq 1 ]]; then
    jq -r "$filter" "${configs[0]}"
  else
    jq -r -s 'reduce .[] as $item ({}; . * $item) | '"$filter" "${configs[@]}"
  fi
}

# Get review loop limit from config (legacy, for backward compat)
get_review_loop_limit() {
  get_config_value '.autonomy.reviewLoopLimit // 10'
}

# Get plan review limit (separate from code review)
get_plan_review_limit() {
  get_config_value '.autonomy.planReviewLoopLimit // .autonomy.reviewLoopLimit // 10'
}

# Get code review limit (separate from plan review)
get_code_review_limit() {
  get_config_value '.autonomy.codeReviewLoopLimit // .autonomy.reviewLoopLimit // 15'
}

# Check if we've exceeded review loop limit
# Usage: exceeded_review_limit [plan|code]
exceeded_review_limit() {
  local phase="${1:-code}"
  local iteration limit
  iteration=$(get_iteration)

  if [[ "$phase" == "plan" ]]; then
    limit=$(get_plan_review_limit)
  else
    limit=$(get_code_review_limit)
  fi

  [[ $iteration -ge $limit ]] && echo "1" || echo "0"
}

# Source this file to use functions, or run directly for testing
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  case "${1:-}" in
    init)
      init_state
      echo "State initialized"
      ;;
    status)
      get_status
      ;;
    state)
      get_state
      ;;
    set)
      set_state "$2" "$3"
      echo "State updated"
      ;;
    *)
      echo "Usage: $0 {init|status|state|set <status> <task_id>}"
      exit 1
      ;;
  esac
fi
