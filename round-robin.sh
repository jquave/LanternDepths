#!/usr/bin/env bash
# Round-robin multi-agent loop: Claude → Grok → Codex → (forever)
# Each turn writes TURN.md and runs one agent with PROMPT.md.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

AGENTS=(claude grok codex)
TURN_FILE="$ROOT/TURN.md"
GOAL_FILE="$ROOT/GOAL.md"
PROMPT_FILE="$ROOT/PROMPT.md"
STATE_FILE="$ROOT/.round-robin-state"
LOG_DIR="$ROOT/logs"

# Defaults
MAX_TURNS=0          # 0 = infinite
START_INDEX=0
SLEEP_BETWEEN=2
DRY_RUN=0
YES_DANGEROUS=0

usage() {
  cat <<'EOF'
Usage: ./round-robin.sh [options]

Round-robin loop: Claude → Grok → Codex → repeat forever.
Each iteration rewrites TURN.md, then runs one agent with PROMPT.md.

Options:
  --max-turns N     Stop after N turns (default: 0 = infinite)
  --start AGENT     First agent: claude | grok | codex (default: claude)
  --sleep SECONDS   Pause between turns (default: 2)
  --dry-run         Write TURN.md only; do not invoke agents
  --yes             Skip confirmation about auto-approve / skip-permissions
  -h, --help        Show this help

Files:
  GOAL.md     Objective agents must accomplish (edit before starting)
  PROMPT.md   Shared prompt given to every agent
  TURN.md     Written each turn with identity + instructions; agents update it
  logs/       Per-turn stdout/stderr captures
EOF
}

log() { printf '[round-robin] %s\n' "$*"; }
die() { printf '[round-robin] ERROR: %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --max-turns)
      MAX_TURNS="${2:?}"
      shift 2
      ;;
    --start)
      case "${2:?}" in
        claude) START_INDEX=0 ;;
        grok) START_INDEX=1 ;;
        codex) START_INDEX=2 ;;
        *) die "unknown agent for --start: $2 (use claude|grok|codex)" ;;
      esac
      shift 2
      ;;
    --sleep)
      SLEEP_BETWEEN="${2:?}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --yes)
      YES_DANGEROUS=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1 (try --help)"
      ;;
  esac
done

[[ -f "$PROMPT_FILE" ]] || die "missing $PROMPT_FILE"
[[ -f "$GOAL_FILE" ]] || die "missing $GOAL_FILE"

command -v grok >/dev/null 2>&1 || die "grok not found on PATH"
command -v codex >/dev/null 2>&1 || die "codex not found on PATH"
command -v claude >/dev/null 2>&1 || die "claude not found on PATH"

mkdir -p "$LOG_DIR"

# Resume turn counter if present
if [[ -f "$STATE_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$STATE_FILE"
fi
TURN_NUMBER="${TURN_NUMBER:-0}"
AGENT_INDEX="${AGENT_INDEX:-$START_INDEX}"

# If state file had no AGENT_INDEX but --start was given, prefer --start only on fresh runs
if [[ ! -f "$STATE_FILE" ]]; then
  AGENT_INDEX=$START_INDEX
fi

display_name() {
  case "$1" in
    grok) echo "Grok" ;;
    codex) echo "Codex" ;;
    claude) echo "Claude" ;;
    *) echo "$1" ;;
  esac
}

next_agent_id() {
  local idx=$1
  echo "${AGENTS[$(( (idx + 1) % ${#AGENTS[@]} ))]}"
}

write_turn_md() {
  local turn=$1
  local agent_id=$2
  local agent_name
  agent_name="$(display_name "$agent_id")"
  local next_id next_name
  next_id="$(next_agent_id "$AGENT_INDEX")"
  next_name="$(display_name "$next_id")"
  local started
  started="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  # Preserve previous agent handoff if present
  local prev_section=""
  if [[ -f "$TURN_FILE" ]] && grep -q '^## Agent report' "$TURN_FILE" 2>/dev/null; then
    prev_section="$(awk '
      /^## Agent report/ { capture=1 }
      capture { print }
    ' "$TURN_FILE")"
  fi

  cat >"$TURN_FILE" <<EOF
# Turn ${turn}

| Field | Value |
|-------|-------|
| **You are** | **${agent_name}** |
| Agent id | \`${agent_id}\` |
| Started (UTC) | ${started} |
| Rotation | Claude → Grok → Codex → (repeat) |
| Next agent | ${next_name} |

## Instructions (mandatory)

1. **State your name** (\`${agent_name}\`) at the start of this turn.
2. **Read \`GOAL.md\`** and ensure every action advances that goal. Update its checkboxes if you complete criteria.
3. **Read this file** end-to-end, including prior agent reports below.
4. Do concrete work in the repo toward \`GOAL.md\`.
5. Before you finish, fill in **Agent report** (below) with:
   - Your name
   - Changes you made (files + summary)
   - Progress vs \`GOAL.md\`
   - Handoff notes for **${next_name}**
6. Do not stop the orchestrator. Do not remove \`TURN.md\`, \`GOAL.md\`, \`PROMPT.md\`, or \`round-robin.sh\`.

## Agent report

<!-- ${agent_name}: replace this section before ending your turn -->

### Name

${agent_name}

### Changes this turn

- (list files touched and what changed)

### Progress on GOAL.md

- Status: not started | partial | blocked | complete
- Notes:

### Handoff for ${next_name}

- (what they should do next)

---

## Prior turns (most recent first)

EOF

  if [[ -n "$prev_section" ]]; then
    {
      echo
      echo "### Previous agent report (carried forward)"
      echo
      echo "$prev_section"
    } >>"$TURN_FILE"
  else
    echo "_No prior agent report yet._" >>"$TURN_FILE"
  fi
}

run_agent() {
  local agent_id=$1
  local turn=$2
  local log_file="$LOG_DIR/turn-$(printf '%04d' "$turn")-${agent_id}.log"
  local prompt
  prompt="$(cat "$PROMPT_FILE")"

  log "Turn ${turn}: starting $(display_name "$agent_id") → log ${log_file}"

  case "$agent_id" in
    grok)
      # Headless single-turn with auto tool approval
      grok -p "$prompt" --always-approve --cwd "$ROOT" 2>&1 | tee "$log_file"
      ;;
    codex)
      # Non-interactive exec; workspace write without full host escape by default
      # Use DANGEROUS_FULL=1 for --dangerously-bypass-approvals-and-sandbox
      if [[ "${DANGEROUS_FULL:-0}" == "1" ]]; then
        codex exec --dangerously-bypass-approvals-and-sandbox -C "$ROOT" "$prompt" 2>&1 | tee "$log_file"
      else
        codex exec --sandbox workspace-write -C "$ROOT" "$prompt" 2>&1 | tee "$log_file"
      fi
      ;;
    claude)
      # Print mode + skip permissions for unattended loop
      claude -p "$prompt" --dangerously-skip-permissions --permission-mode bypassPermissions 2>&1 | tee "$log_file"
      ;;
    *)
      die "unknown agent id: $agent_id"
      ;;
  esac
}

save_state() {
  cat >"$STATE_FILE" <<EOF
TURN_NUMBER=${TURN_NUMBER}
AGENT_INDEX=${AGENT_INDEX}
EOF
}

if [[ "$DRY_RUN" -eq 0 && "$YES_DANGEROUS" -eq 0 ]]; then
  cat <<'EOF'
This loop will invoke Grok, Codex, and Claude with auto-approve / elevated
permissions so they can edit the repo unattended. Review GOAL.md first.

EOF
  read -r -p "Continue? [y/N] " ans || true
  case "${ans:-}" in
    y|Y|yes|YES) ;;
    *) log "aborted."; exit 0 ;;
  esac
fi

log "cwd=$ROOT"
log "rotation: Claude → Grok → Codex"
log "max_turns=${MAX_TURNS:-infinite} dry_run=$DRY_RUN"
log "starting at turn=$((TURN_NUMBER + 1)) agent=$(display_name "${AGENTS[$AGENT_INDEX]}")"

while true; do
  TURN_NUMBER=$((TURN_NUMBER + 1))

  if [[ "$MAX_TURNS" -gt 0 && "$TURN_NUMBER" -gt "$MAX_TURNS" ]]; then
    log "reached --max-turns=$MAX_TURNS; exiting."
    break
  fi

  agent_id="${AGENTS[$AGENT_INDEX]}"
  write_turn_md "$TURN_NUMBER" "$agent_id"
  log "wrote $TURN_FILE for $(display_name "$agent_id")"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "dry-run: skipping agent invocation"
  else
    set +e
    run_agent "$agent_id" "$TURN_NUMBER"
    status=$?
    set -e
    if [[ $status -ne 0 ]]; then
      log "agent $(display_name "$agent_id") exited with status $status (continuing rotation)"
    fi
  fi

  AGENT_INDEX=$(( (AGENT_INDEX + 1) % ${#AGENTS[@]} ))
  save_state

  if [[ "$SLEEP_BETWEEN" != "0" ]]; then
    sleep "$SLEEP_BETWEEN"
  fi
done

log "done. last state in $STATE_FILE"
