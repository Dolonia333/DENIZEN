#!/bin/sh
# Denizen auto-deploy loop — runs INSIDE a docker:cli container on the NAS
# (installed by infra/setup-nas-auto-deploy.py; container: denizen-deployer).
#
# Polls origin/$BRANCH; on a new SHA: git reset --hard, docker build
# (Dockerfile.production, context denizen/), docker compose up -d in
# $DEPLOY_DIR, health-check, record SHA. On health failure: roll back to the
# :prev image. On build failure: running container is left untouched.
#
# Env (set by the installer's docker run):
#   REPO_URL      git@github.com:Dolonia333/DENIZEN.git
#   BRANCH        master
#   POLL_SECONDS  300
#   HEALTH_PORT   8888
# Mounts: /repo (clone), /deploy (= /volume1/docker/denizen-server),
#         /var/run/docker.sock, --network host (so 127.0.0.1 health works).
set -u

REPO_DIR=${REPO_DIR:-/repo}
DEPLOY_DIR=${DEPLOY_DIR:-/deploy}
REPO_URL=${REPO_URL:-git@github.com:Dolonia333/DENIZEN.git}
BRANCH=${BRANCH:-master}
POLL=${POLL_SECONDS:-300}
IMAGE=${IMAGE:-denizen-server:latest}
PORT=${HEALTH_PORT:-8888}
LOG="$DEPLOY_DIR/auto-deploy.log"

log() { echo "[auto-deploy $(date -u +%FT%TZ)] $*" | tee -a "$LOG"; }

# tools (docker:cli ships compose/buildx plugins; we add git+ssh+curl)
apk add --no-cache git curl openssh-client >/dev/null 2>&1 || true
export GIT_SSH_COMMAND="ssh -i $DEPLOY_DIR/deploy-key -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes"
git config --global --add safe.directory "$REPO_DIR" 2>/dev/null || true

if [ ! -d "$REPO_DIR/.git" ]; then
  log "cloning $REPO_URL ($BRANCH)"
  git clone --branch "$BRANCH" "$REPO_URL" "$REPO_DIR" 2>&1 | tail -2 | tee -a "$LOG"
fi

log "loop started: branch=$BRANCH poll=${POLL}s image=$IMAGE health=:$PORT"

while :; do
  cd "$REPO_DIR" 2>/dev/null || { log "FATAL: repo dir missing"; sleep "$POLL"; continue; }

  if ! git fetch origin "$BRANCH" --quiet 2>>"$LOG"; then
    log "fetch failed (network/auth?) — retrying next tick"
    sleep "$POLL"; continue
  fi

  REMOTE=$(git rev-parse "origin/$BRANCH" 2>/dev/null)
  CURRENT=$(cat "$DEPLOY_DIR/.deployed-sha" 2>/dev/null || echo none)

  if [ -n "$REMOTE" ] && [ "$REMOTE" != "$CURRENT" ]; then
    log "new $BRANCH: $REMOTE (deployed: $CURRENT) — building"
    git reset --hard "origin/$BRANCH" --quiet

    # compose config is GitOps'd too: the deploy-dir copy is what compose
    # actually reads, refresh it from the repo on every deploy
    cp "$REPO_DIR/denizen/docker-compose.production.yml" \
       "$DEPLOY_DIR/docker-compose.yml" 2>>"$LOG" \
      || log "WARN: compose refresh failed — using existing copy"

    # keep a rollback tag of whatever is currently running
    docker tag "$IMAGE" "${IMAGE%:*}:prev" 2>/dev/null || true

    if docker build -f "$REPO_DIR/denizen/Dockerfile.production" -t "$IMAGE" \
         "$REPO_DIR/denizen" >"$DEPLOY_DIR/last-build.log" 2>&1; then
      log "build OK — recreating container"
      ( cd "$DEPLOY_DIR" && docker compose -f docker-compose.yml up -d ) \
        >>"$DEPLOY_DIR/last-build.log" 2>&1

      # VERIFY the swap actually happened: compose cannot replace a container
      # it does not own (e.g. one created by docker run) — it errors
      # "name already in use" while the OLD container keeps serving, and a
      # bare health check then false-positives. Compare image ids; on
      # mismatch, force-remove the stale container and recreate.
      WANT=$(docker images --no-trunc -q "$IMAGE" | head -1)
      HAVE=$(docker inspect denizen-server --format '{{.Image}}' 2>/dev/null)
      if [ -n "$WANT" ] && [ "$WANT" != "$HAVE" ]; then
        log "swap did not take (running image != built image) — forcing recreate"
        docker rm -f denizen-server >>"$DEPLOY_DIR/last-build.log" 2>&1
        ( cd "$DEPLOY_DIR" && docker compose -f docker-compose.yml up -d ) \
          >>"$DEPLOY_DIR/last-build.log" 2>&1
        HAVE=$(docker inspect denizen-server --format '{{.Image}}' 2>/dev/null)
      fi

      OK=""
      if [ "$WANT" = "$HAVE" ]; then
        for i in $(seq 1 12); do
          sleep 10
          if curl -fsS -m 10 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
            OK=1; break
          fi
        done
      else
        log "SWAP FAILED — running image still differs after forced recreate"
      fi

      if [ -n "$OK" ]; then
        echo "$REMOTE" > "$DEPLOY_DIR/.deployed-sha"
        log "DEPLOYED $REMOTE — image verified + health OK"
      else
        log "DEPLOY FAIL for $REMOTE — ROLLING BACK to :prev"
        docker tag "${IMAGE%:*}:prev" "$IMAGE" 2>/dev/null || true
        docker rm -f denizen-server >>"$DEPLOY_DIR/last-build.log" 2>&1
        ( cd "$DEPLOY_DIR" && docker compose -f docker-compose.yml up -d ) \
          >>"$DEPLOY_DIR/last-build.log" 2>&1
      fi
    else
      log "BUILD FAILED for $REMOTE — running container untouched (see last-build.log)"
    fi
  fi

  sleep "$POLL"
done
