#!/usr/bin/env bash
# M2E Walk — pull DB snapshots OFF the VPS. Run this on ANOTHER machine
# (the operator's PC / the assistant VM), never rely on the copies that
# live only on the VPS: the VPS is on a short plan and may expire.
#
# Usage:
#   bash deploy/pull-backup.sh <ssh-host> [local-dir]
#     <ssh-host>   e.g. m2e-vps  (an ~/.ssh/config alias) or user@203.0.113.10
#     [local-dir]  default: ~/m2e-walk-backups
#
# Pulls /opt/m2e-walk/backups/*.db via rsync over SSH (only new files).
set -euo pipefail

HOST="${1:?usage: pull-backup.sh <ssh-host> [local-dir]}"
LOCAL_DIR="${2:-$HOME/m2e-walk-backups}"
mkdir -p "$LOCAL_DIR"

rsync -az --include='m2e-walk-*.db' --exclude='*' \
  "$HOST:/opt/m2e-walk/backups/" "$LOCAL_DIR/"

echo "Local snapshots in $LOCAL_DIR:"
ls -lt "$LOCAL_DIR" | head -8
