#!/bin/bash
# PITAS Log Rotation
# Rotate daily-run.log weekly, keep 4 weeks
# Add to crontab: 0 0 * * 0 /path/to/rotate-logs.sh

LOG_DIR="$(dirname "$0")/../logs"
cd "$LOG_DIR" || exit 1

# Rotate current log
if [ -f daily-run.log ]; then
  # Shift existing rotations
  for i in 4 3 2 1; do
    if [ -f "daily-run.log.$i" ]; then
      mv "daily-run.log.$i" "daily-run.log.$((i+1))"
    fi
  done

  # Remove oldest
  rm -f daily-run.log.5

  # Rotate current
  cp daily-run.log daily-run.log.1
  > daily-run.log
  echo "[$(date -Iseconds)] Log rotated"
fi

# Prune snapshots older than 30 days
SNAP_DIR="$(dirname "$0")/../snapshots"
if [ -d "$SNAP_DIR" ]; then
  find "$SNAP_DIR" -name "*.html" -mtime +30 -delete 2>/dev/null
  echo "[$(date -Iseconds)] Snapshots pruned (>30 days)"
fi
