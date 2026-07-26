#!/bin/sh
# Denizen backup loop — runs INSIDE a docker:cli container on the NAS
# (installed by infra/setup-nas-db-backup.py; container: denizen-db-backup).
#
# Daily: pg_dump of NAS Postgres (supabase-db) + tar of the deploy dir's
# runtime binds (data/, layouts/). Prunes anything older than KEEP_DAYS.
# Before 2026-07-26 there was NO database backup at all (dossier defect #3).
set -u

BK=${BACKUP_DIR:-/backups}
KEEP_DAYS=${KEEP_DAYS:-14}
INTERVAL=${INTERVAL_SECONDS:-86400}
DEPLOY=${DEPLOY_DIR:-/volume1/docker/denizen-server}
SUPA_ENV=${SUPA_ENV:-/volume1/docker/supabase-project/.env}

log() { echo "[db-backup $(date -u +%FT%TZ)] $*"; }
mkdir -p "$BK"
log "loop started: dir=$BK keep=${KEEP_DAYS}d interval=${INTERVAL}s"

while :; do
  STAMP=$(date -u +%Y%m%d-%H%M%S)

  PW=$(grep '^POSTGRES_PASSWORD=' "$SUPA_ENV" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')
  if docker exec -e PGPASSWORD="$PW" supabase-db \
       pg_dump -U postgres -d postgres --no-owner 2>>"$BK/backup-errors.log" \
       | gzip > "$BK/pg-$STAMP.sql.gz" \
     && [ -s "$BK/pg-$STAMP.sql.gz" ]; then
    log "pg dump OK: pg-$STAMP.sql.gz ($(du -h "$BK/pg-$STAMP.sql.gz" | cut -f1))"
  else
    log "PG DUMP FAILED (see backup-errors.log)"
    rm -f "$BK/pg-$STAMP.sql.gz"
  fi

  if tar czf "$BK/runtime-$STAMP.tar.gz" -C "$DEPLOY" data layouts 2>>"$BK/backup-errors.log"; then
    log "runtime tar OK: runtime-$STAMP.tar.gz ($(du -h "$BK/runtime-$STAMP.tar.gz" | cut -f1))"
  else
    log "runtime tar FAILED"
  fi

  find "$BK" -name '*.gz' -mtime +"$KEEP_DAYS" -delete 2>/dev/null
  sleep "$INTERVAL"
done
