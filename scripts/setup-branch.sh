#!/bin/bash
set -e
cd /root/.openclaw/workspace/pitas

# Create branch
git checkout main 2>&1 || true
git checkout -b fix/tighter-it-classification 2>&1 || true

echo "BRANCH: $(git branch --show-current)"
echo "FILES:"
ls lib/
