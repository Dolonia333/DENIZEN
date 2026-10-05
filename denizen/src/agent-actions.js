/**
 * Agent Action Protocol
 * Defines executable actions that AI agents can perform in the pixel office game.
 * Loaded in the browser. Each action returns a Promise that resolves when complete.
 */

class AgentActions {
  /**
   * @param {Phaser.Scene} scene - The office scene
   */
  constructor(scene) {
    this.scene = scene;
    this._actionQueues = new Map(); // npcKey -> Promise chain
    this._speechBubbles = new Map(); // npcKey -> { container, timer }
    this._thoughtBubbles = new Map();
    this._emoteBubbles = new Map();
    this._roleLabels = new Map(); // npcKey -> text object
    this._typingIndicators = new Map(); // npcKey -> text object
    this._sittingNpcs = new Map(); // npcKey -> { chairSprite, origDepth, origY }
    this._standingMeetingNpcs = new Set(); // npcKey -> Set of NPCs currently standing in meeting
    // Tracks how many NPCs are currently walking up to speak to a given target.
    // Caps concurrent speakers so Abby doesn't attract a 4-NPC tornado.
    this._activeSpeakers = new Map(); // targetNpcKey -> count
    this.MAX_SPEAKERS_PER_TARGET = 2;

    // "Follow me" — NPCs the player has told to follow. Ticked every frame in
    // update() so they re-path to the player's CURRENT position as they move.
    this._followers = new Map();      // npcKey -> { lastRetargetAt, lastPx, lastPy }
    this.FOLLOW_STOP_DIST = 84;       // close enough — stop walking + face player
    this.FOLLOW_RETARGET_MS = 250;    // min gap between re-paths (avoid thrash)

    // Seated desk work: keyboard bob + "Hmm." beats, and workload clutter props.
    this._deskWork = new Map();       // npcKey -> loop state
    this._deskClutter = new Map();    // npcKey -> { deskSprite, kinds, props }
    this._deskSlotCache = new WeakMap(); // deskSprite -> { x, y, candidates }
    this.DESK_KEY_TICK_MS = 140;
    this.DESK_BEAT_MS = 1700;
    // Prop base offsets (bottom-center) from a desk's bottom-center anchor,
    // measured on the pack art so props rest on the surface, not the lip/legs.
    this.DESK_CLUTTER_GEOMETRY = {
      cubicle_desk_front: { xs: [-34, -26, 19, 27], ys: [-14, -24] },
      cubicle_desk_back: { xs: [-34, -26, 19, 27], ys: [-5] },
      cubicle_desk: { xs: [-34, -26, 19, 27], ys: [-19, -32] },
      box_desk: { xs: [-36, -26, 26, 36], ys: [-26, -45] },
    };
    this.DESK_PROP_FOOTPRINT = {
      paper: { halfW: 8, h: 18 },
      mug: { halfW: 4, h: 9 },
    };

    // Room definitions — agents understand the office layout
    this.ROOMS = {
      open_office: { name: 'Open Office', xMin: 100, xMax: 800, yMin: 80, yMax: 420, purpose: 'Main workspace with cubicle desks and computers' },
      manager_office: { name: 'Manager Office', xMin: 880, xMax: 1248, yMin: 80, yMax: 240, purpose: 'Private office for management' },
      conference: { name: 'Conference Room', xMin: 880, xMax: 1248, yMin: 280, yMax: 440, purpose: 'Meetings, printer, supplies' },
      breakroom: { name: 'Break Room', xMin: 40, xMax: 280, yMin: 460, yMax: 660, purpose: 'Couches, coffee, vending machines' },
      reception: { name: 'Reception', xMin: 380, xMax: 840, yMin: 460, yMax: 660, purpose: 'Front desk, waiting area for visitors' },
      storage: { name: 'Storage/IT', xMin: 880, xMax: 1248, yMin: 460, yMax: 660, purpose: 'Server room, IT equipment, storage' },
    };
  }

  // ---- Follow-me ----

  /** Start an NPC following the player. Idempotent. */
  startFollow(npcKey) {
    const npc = this._getNpc(npcKey);
    if (!npc || !npc.ai) return false;
    if (this._sittingNpcs.has(npcKey)) this._standUpNpc(npcKey);
    if (npc._pathFollower) npc._pathFollower.stop();
    npc.ai.mode = 'agent_task';      // keep manager mode so autonomous wander won't fight us
    npc.ai.taskState = 'walking';
    this._followers.set(npcKey, { lastRetargetAt: 0, lastPx: null, lastPy: null });
    return true;
  }

  /** Stop an NPC following the player. */
  stopFollow(npcKey) {
    if (!this._followers.has(npcKey)) return false;
    this._followers.delete(npcKey);
    const npc = this._getNpc(npcKey);
    if (npc?.body) npc.body.setVelocity(0, 0);
    if (npc?.ai) npc.ai.taskState = 'arrived';
    return true;
  }

  isFollowing(npcKey) { return this._followers.has(npcKey); }
  stopAllFollow() { for (const k of [...this._followers.keys()]) this.stopFollow(k); }

  /** Per-frame: keep each follower walking toward the player's current spot. */
  _tickFollow() {
    if (!this._followers.size) return;
    const player = this.scene.player;
    if (!player) return;
    const now = this.scene.time?.now || Date.now();
    this._followers.forEach((st, npcKey) => {
      const npc = this._getNpc(npcKey);
      if (!npc || !npc.ai || !npc.body) return;
      const dx = player.x - npc.x, dy = player.y - npc.y;
      const dist = Math.hypot(dx, dy);
      if (dist > this.FOLLOW_STOP_DIST) {
        npc.ai.mode = 'agent_task';
        // Re-path when the player has moved enough, or the throttle elapsed.
        const moved = st.lastPx == null || Math.hypot(player.x - st.lastPx, player.y - st.lastPy) > 20;
        if (moved || now - st.lastRetargetAt > this.FOLLOW_RETARGET_MS) {
          const pf = this.scene?._pathfinder;
          let tx = player.x, ty = player.y;
          if (pf && typeof pf.findGoodApproachNear === 'function') {
            const app = pf.findGoodApproachNear(player.x, player.y, 30, 64);
            if (app) { tx = app.x; ty = app.y; }
          }
          const side = npc.x <= player.x ? -1 : 1;
          npc.ai.taskTarget = { x: tx + side * 8, y: ty + 6 };  // small final bias
          npc.ai.taskState = 'walking';
          st.lastRetargetAt = now; st.lastPx = player.x; st.lastPy = player.y;
        }
      } else {
        // Arrived — stop and face the player.
        npc.body.setVelocity(0, 0);
        npc.ai.taskState = 'arrived';
        if (Math.abs(dx) > Math.abs(dy)) npc.ai.facing = dx < 0 ? 'left' : 'right';
        else npc.ai.facing = dy < 0 ? 'up' : 'down';
      }
    });
  }

  // ---- NPC / Furniture Helpers ----

  _getNpc(npcKey) {
    if (!this.scene.npcs) return null;
    return this.scene.npcs.find(n => n.texture?.key === npcKey) || null;
  }

  _getFurniture(furnitureId) {
    if (!this.scene._interactables) return null;
    return this.scene._interactables.find(
      it => it.instanceId === furnitureId || it.id === furnitureId
    ) || null;
  }

  /**
   * Find the nearest chair to a desk (searches _interactables for seats within range).
   * Prefers chairs aligned with the desk (same column, south side for cubicles).
   */
  _findChairNearDesk(desk, range = 96) {
    if (!this.scene._interactables || !desk?.sprite) return null;

    let best = null;
    let bestScore = Infinity;

    this.scene._interactables.forEach(it => {
      if (!it.def || !it.sprite) return;
      const isSeat = it.def.type === 'seat' || (it.id && /chair|seat|stool/i.test(it.id));
      if (!isSeat) return;

      const dx = it.sprite.x - desk.sprite.x;
      const dy = it.sprite.y - desk.sprite.y;
      const d = Math.hypot(dx, dy);
      if (d > range) return;

      let score = d;
      // Cubicle chairs usually sit south of (below) the desk surface
      if (dy < -20) score += 100;
      // Penalize chairs far to the side — wrong pod neighbor
      score += Math.abs(dx) * 0.35;

      if (score < bestScore) {
        bestScore = score;
        best = it;
      }
    });

    return best;
  }

  /**
   * Exact pixel position where an NPC should sit for a chair (matches player sit offsets).
   */
  _getChairSitPos(chair, desk = null) {
    if (!chair?.sprite) {
      if (desk?.sprite) {
        return { x: desk.sprite.x, y: desk.sprite.y + 24, facing: 'up', backFacing: true };
      }
      return null;
    }

    const chairInfo = this._getChairFacing(chair, desk);
    const def = chair.def || {};
    const snap = def.snap_offset || { x: 0, y: 0 };
    const id = (chair.id || '').toLowerCase();
    let x = chair.sprite.x + (snap.x || 0);
    let y = chair.sprite.y + (snap.y || 0);

    // The blueprint already stores the exact bottom-center chair anchor.
    // Do not add a generic Y offset: front chairs are north of their desk and
    // back chairs are south of it, so one shared offset moves half the roster
    // onto the desktop. The seated crop below handles body height instead.
    // A tiny seat-depth nudge centers the cropped torso in the chair cushion
    // without moving it into the desk surface.
    y += chairInfo.backFacing ? 4 : 3;

    return { x, y, ...chairInfo };
  }

  /**
   * Snap NPC sprite to a chair sit pose (position, frame, depth).
   */
  _applySitPose(npc, npcKey, chair, sit, desk = null) {
    const existingSit = this._sittingNpcs.get(npcKey);
    npc.body?.setVelocity(0, 0);
    npc.x = sit.x;
    npc.y = sit.y;
    npc.ai.facing = sit.facing;
    npc.anims.stop();
    if (sit.facing === 'up') npc.setFrame(12);
    else if (sit.facing === 'down') npc.setFrame(0);
    else if (sit.facing === 'left') npc.setFrame(4);
    else npc.setFrame(8);
    // XP character sheets have no dedicated seated frames. Crop away the legs
    // while seated so only the head/upper torso rises above the workstation.
    // This is true desk occlusion; scaling the whole standing body still read
    // as a tiny person standing on top of the desk.
    if (typeof npc.setCrop === 'function') {
      const frameWidth = npc.frame?.realWidth || npc.frame?.width || 32;
      const frameHeight = npc.frame?.realHeight || npc.frame?.height || 48;
      npc.setCrop(0, 0, frameWidth, Math.max(28, frameHeight - 15));
    }
    npc.ai.taskState = 'sitting';
    if (npc._bootHidden) {
      npc._bootHidden = false;
      npc.setVisible?.(true);
    }
    if (chair?.sprite) {
      this._applySitDepth(npc, npcKey, chair, sit, desk);
    }
  }

  /**
   * Determine if a chair is "back-facing" (NPC sits behind it, facing up toward desk)
   * or "front-facing" (NPC sits in front of it, facing down).
   * Uses the chair sprite name first (most reliable), falls back to Y position.
   */
  _getChairFacing(chair, desk) {
    if (!chair?.sprite || !desk?.sprite) return { facing: 'up', backFacing: true };

    // Check sprite name for explicit facing info
    const chairId = (chair.id || '').toLowerCase();
    if (/side_left/.test(chairId)) {
      return { facing: 'right', backFacing: false };
    }
    if (/side_right/.test(chairId)) {
      return { facing: 'left', backFacing: false };
    }
    if (/back/.test(chairId)) {
      // Chair sprite shows the back → NPC faces UP (away from camera, toward desk)
      // Chair renders ON TOP of NPC
      return { facing: 'up', backFacing: true };
    }
    if (/front/.test(chairId)) {
      // Chair sprite shows the front → NPC faces DOWN (toward camera)
      // NPC renders ON TOP of chair
      return { facing: 'down', backFacing: false };
    }

    // Fallback: use Y position relative to desk
    if (chair.sprite.y > desk.sprite.y) {
      return { facing: 'up', backFacing: true };
    } else {
      return { facing: 'down', backFacing: false };
    }
  }

  /**
   * Get which room a position is in
   */
  getRoom(x, y) {
    for (const [key, room] of Object.entries(this.ROOMS)) {
      if (x >= room.xMin && x <= room.xMax && y >= room.yMin && y <= room.yMax) {
        return { key, ...room };
      }
    }
    return { key: 'unknown', name: 'Unknown Area', xMin: 0, xMax: 1280, yMin: 0, yMax: 720, purpose: 'Uncharted area' };
  }

  /**
   * Get a full map description for AI agents to understand the environment
   */
  getEnvironmentDescription() {
    const rooms = Object.entries(this.ROOMS).map(([key, room]) => {
      // Count furniture in this room
      const furniture = (this.scene._interactables || []).filter(it => {
        if (!it.sprite) return false;
        return it.sprite.x >= room.xMin && it.sprite.x <= room.xMax &&
               it.sprite.y >= room.yMin && it.sprite.y <= room.yMax;
      });

      const desks = furniture.filter(f => /desk/i.test(f.id || ''));
      const chairs = furniture.filter(f => f.def?.type === 'seat' || /chair/i.test(f.id || ''));
      const shelves = furniture.filter(f => /shelf|bookcase/i.test(f.id || ''));

      return `${room.name} (${key}): ${room.purpose}. Contains ${desks.length} desks, ${chairs.length} chairs, ${shelves.length} shelves, ${furniture.length} total items.`;
    });

    return {
      rooms: rooms.join('\n'),
      totalFurniture: (this.scene._interactables || []).length,
      mapSize: '1280x720 pixels',
      tileSize: '32px',
    };
  }

  // ---- Action Queue ----

  queueAction(npcKey, actionFn) {
    const current = this._actionQueues.get(npcKey) || Promise.resolve();
    const next = current.then(() => actionFn()).catch(err => {
      console.warn(`[AgentActions] Action failed for ${npcKey}:`, err);
    });
    this._actionQueues.set(npcKey, next);
    return next;
  }

  // ---- Core Actions ----

  /**
   * walkTo(npcKey, x, y) - Walk NPC to position
   */
  walkTo(npcKey, x, y) {
    return this.queueAction(npcKey, () => {
      return new Promise((resolve) => {
        const npc = this._getNpc(npcKey);
        if (!npc || !npc.ai) { resolve(); return; }

        // If sitting, stand up first
        if (this._sittingNpcs.has(npcKey)) {
          this._standUpNpc(npcKey);
        }

        // Add slight random offset so multiple NPCs don't stack on the exact same pixel
        let ox = x + (Math.random() - 0.5) * 12;
        let oy = y + (Math.random() - 0.5) * 12;

        // Snap to actual walkable cell so pathing rarely fails
        const pf = this.scene?._pathfinder;
        if (pf && typeof pf.findWalkableNear === 'function') {
          const snapped = pf.findWalkableNear(ox, oy, 56);
          if (snapped) { ox = snapped.x; oy = snapped.y; }
        }

        if (npc._pathFollower) npc._pathFollower.stop();
        npc.body && npc.body.setVelocity(0, 0);

        npc.ai.mode = 'agent_task';
        npc.ai.taskTarget = { x: ox, y: oy };
        npc.ai.taskState = 'walking';

        // Purposeful-trip window: the desk-return enforcer must not teleport an
        // NPC back to its seat while it is deliberately walking somewhere (and
        // for a short linger after arrival). Covers the whole walk (12s timeout)
        // plus ~8s at the destination so the visit actually reads on screen.
        // A flag, not ai.mode/waypoints, because those flicker between segments.
        npc._purposefulWalkUntil = Date.now() + 20000;

        const checkInterval = this.scene.time.addEvent({
          delay: 100,
          loop: true,
          callback: () => {
            const dist = Math.hypot(ox - npc.x, oy - npc.y);
            if (dist <= 10 || npc.ai.taskState === 'arrived') {
              checkInterval.remove();
              npc.body.setVelocity(0, 0);
              if (npc._pathFollower) npc._pathFollower.stop();
              // Brief idle pause on arrival — looks like settling into position
              this.scene.time.delayedCall(200, () => {
                npc.ai.taskState = 'arrived';
                resolve();
              });
            }
          }
        });

        this.scene.time.delayedCall(12000, () => {
          checkInterval.remove();
          npc.body.setVelocity(0, 0);
          if (npc._pathFollower) npc._pathFollower.stop();
          // If we timed out far away, force unstick so we don't stay broken
          const d = npc.ai.taskTarget ? Math.hypot(npc.x - npc.ai.taskTarget.x, npc.y - npc.ai.taskTarget.y) : 0;
          if (d > 80 && this.scene._unstickNpc) this.scene._unstickNpc(npc);
          resolve();
        });
      });
    });
  }

  _cancelDeskWalk(npcKey) {
    const npc = this._getNpc(npcKey);
    if (!npc?.ai) return;
    if (npc.ai._deskSitInterval) {
      npc.ai._deskSitInterval.remove();
      npc.ai._deskSitInterval = null;
    }
    if (npc.ai._deskSitTimeout) {
      npc.ai._deskSitTimeout.remove();
      npc.ai._deskSitTimeout = null;
    }
    npc.ai._sitSnap = null;
    if (npc._pathFollower) npc._pathFollower.stop();
    npc.body?.setVelocity(0, 0);
  }

  isSeatedAtDesk(npcKey, deskId) {
    if (!this._sittingNpcs.has(npcKey)) return false;
    const desk = this._getFurniture(deskId);
    const chair = this._findChairNearDesk(desk);
    const sit = this._getChairSitPos(chair, desk);
    if (!sit) return false;
    const npc = this._getNpc(npcKey);
    if (!npc) return false;
    return Math.hypot(npc.x - sit.x, npc.y - sit.y) < 40;
  }

  _sitAtDeskNow(npcKey, deskId) {
    this._cancelDeskWalk(npcKey);
    const npc = this._getNpc(npcKey);
    const desk = this._getFurniture(deskId);
    if (!npc || !desk?.sprite) return false;
    const chair = this._findChairNearDesk(desk);
    const sit = this._getChairSitPos(chair, desk);
    if (!sit) return false;
    if (npc.body) {
      npc.body.setSize(10, 8);
      npc.body.setOffset(3, 16);
      npc.body.setVelocity(0, 0);
    }
    this._applySitPose(npc, npcKey, chair, sit, desk);
    npc.ai.mode = 'agent_task';
    npc.ai.taskTarget = null;
    this._showTypingIndicator(npc, npcKey);
    this._startDeskWorkLoop(npc, npcKey, desk);
    return true;
  }

  /**
   * useComputer(npcKey, deskId, opts) - Sit at desk chair. opts.instant skips walking.
   */
  useComputer(npcKey, deskId, opts = {}) {
    return this.queueAction(npcKey, () => {
      return new Promise((resolve) => {
        if (this.isSeatedAtDesk(npcKey, deskId)) {
          // Already in the chair. Restart the work loop only if it died
          // (a later useComputer used to return and leave the desk static).
          const seated = this._getNpc(npcKey);
          const deskNow = this._getFurniture(deskId);
          if (seated && deskNow && !this._deskWork.has(npcKey)) {
            this._showTypingIndicator(seated, npcKey);
            this._startDeskWorkLoop(seated, npcKey, deskNow);
          }
          resolve();
          return;
        }

        const npc = this._getNpc(npcKey);
        const desk = this._getFurniture(deskId);
        if (!npc || !desk?.sprite) { resolve(); return; }

        const chair = this._findChairNearDesk(desk);
        const sit = this._getChairSitPos(chair, desk);
        if (!sit) { resolve(); return; }

        const dist = Math.hypot(npc.x - sit.x, npc.y - sit.y);
        // Only teleport when already at the chair (or caller forced it).
        // Old: dist < 120 OR 4.5s timeout → mid-office NPCs vanished and
        // "spawned" back at their desk. Walk the whole way instead.
        const instant = opts.instant === true || dist < 40;

        if (instant) {
          this._sitAtDeskNow(npcKey, deskId);
          resolve();
          return;
        }

        if (this._sittingNpcs.has(npcKey)) this._standUpNpc(npcKey);
        this._cancelDeskWalk(npcKey);

        let approachX = sit.x;
        let approachY = sit.y;
        const pf2 = this.scene?._pathfinder;
        if (pf2?.findWalkableNear) {
          const s = pf2.findWalkableNear(sit.x, sit.y, 40);
          if (s) { approachX = s.x; approachY = s.y; }
        }

        npc.ai.mode = 'agent_task';
        npc.ai.taskTarget = { x: approachX, y: approachY };
        npc.ai._sitSnap = sit;
        npc.ai.taskState = 'walking';
        npc.body?.setSize(6, 4);
        npc.body?.setOffset(5, 20);
        // Kick pathfinder immediately so they don't idle for a frame then snap.
        try {
          if (npc._pathFollower?.navigateTo) {
            npc._pathFollower.navigateTo(approachX, approachY);
          }
        } catch (_) {}
        // Protect from desk-enforce yank while walking home.
        npc._purposefulWalkUntil = Date.now() + 25000;

        let finished = false;
        const finishSit = () => {
          if (finished) return;
          finished = true;
          this._cancelDeskWalk(npcKey);
          this._sitAtDeskNow(npcKey, deskId);
          resolve();
        };

        npc.ai._deskSitInterval = this.scene.time.addEvent({
          delay: 100,
          loop: true,
          callback: () => {
            const d = Math.hypot(approachX - npc.x, approachY - npc.y);
            if (d <= 22 || (npc.ai._sitSnap && d <= 40)) finishSit();
          },
        });

        // Long timeout — never teleport across the office. If still far,
        // abandon the sit and keep them free on the floor.
        npc.ai._deskSitTimeout = this.scene.time.delayedCall(22000, () => {
          if (finished) return;
          const d = Math.hypot(approachX - npc.x, approachY - npc.y);
          if (d <= 56) {
            finishSit();
            return;
          }
          finished = true;
          this._cancelDeskWalk(npcKey);
          if (npc.ai) {
            npc.ai.mode = 'wander';
            npc.ai.taskState = null;
            npc.ai.taskTarget = null;
            npc.ai._sitSnap = null;
            npc.ai.nextWanderAt = 0;
          }
          resolve();
        });
      });
    });
  }

  /**
   * teleportToDesk(npcKey, deskId) - Instantly place NPC at desk chair (queued, cancels walk)
   */
  teleportToDesk(npcKey, deskId) {
    return this.useComputer(npcKey, deskId, { instant: true });
  }

  /**
   * Re-snap a seated NPC to the current chair position (after layout edit).
   */
  resnapSeatedNpc(npcKey, chair, desk = null) {
    const npc = this._getNpc(npcKey);
    if (!npc || !this._sittingNpcs.has(npcKey)) return;
    const sit = this._getChairSitPos(chair, desk);
    if (!sit) return;
    this._applySitPose(npc, npcKey, chair, sit, desk);
    if (desk?.sprite) {
      this._deskSlotCache.delete(desk.sprite);
      this._clearDeskClutter(npcKey);
      if (this._deskWork.has(npcKey)) this._startDeskWorkLoop(npc, npcKey, desk);
    }
  }

  /**
   * Apply correct depth when NPC sits in a chair
   * Back-facing chair: chair renders ON TOP of NPC (higher depth)
   * Front-facing chair: NPC renders ON TOP of chair (higher depth)
   */
  _applySitDepth(npc, npcKey, chair, chairInfo, desk = null) {
    const existingSit = this._sittingNpcs.get(npcKey);
    const origDepth = existingSit?.origDepth ?? npc.depth;
    const origScaleX = existingSit?.origScaleX ?? npc.scaleX;
    const origScaleY = existingSit?.origScaleY ?? npc.scaleY;
    const chairDepth = chair.sprite.depth;

    if (chairInfo.backFacing) {
      // Back-facing workstation: both the chair back and desk surface must
      // cover the seated body. Comparing only with the chair made NPCs render
      // on top of desks whose sprite depth happened to be lower.
      const deskDepth = desk?.sprite?.depth;
      const occluderDepth = Number.isFinite(deskDepth)
        ? Math.min(chairDepth, deskDepth)
        : chairDepth;
      npc.setDepth(occluderDepth - 0.5);
    } else {
      // Front-facing: NPC should be on top of chair
      npc.setDepth(chairDepth + 0.5);
    }

    this._sittingNpcs.set(npcKey, {
      chairSprite: chair.sprite,
      deskSprite: desk?.sprite || null,
      deskId: desk?.id || null,
      origDepth,
      origScaleX,
      origScaleY,
      origY: npc.y,
      chairInfo,
    });
  }

  /**
   * Stand up NPC from sitting
   */
  _standUpNpc(npcKey) {
    const sitData = this._sittingNpcs.get(npcKey);
    if (!sitData) return;

    const npc = this._getNpc(npcKey);
    if (npc) {
      // Restore original depth (Y-sort will take over)
      npc.setDepth(sitData.origDepth);
      if (typeof npc.setCrop === 'function') npc.setCrop();
      if (typeof npc.setScale === 'function') {
        npc.setScale(sitData.origScaleX, sitData.origScaleY);
      }
      // Step onto floor on the side AWAY from the desk before pathfinding.
      // The old facing-only offset was reversed for south-side chairs and
      // placed NPCs inside/on top of the desktop for their first walk frames.
      const chair = sitData.chairSprite;
      const desk = sitData.deskSprite;
      let awayX = 0;
      let awayY = sitData.chairInfo.backFacing ? 1 : -1;
      if (chair && desk) {
        const dx = chair.x - desk.x;
        const dy = chair.y - desk.y;
        const len = Math.hypot(dx, dy) || 1;
        awayX = dx / len;
        awayY = dy / len;
      }
      let standX = npc.x + awayX * 26;
      let standY = npc.y + awayY * 26;
      const pf = this.scene?._pathfinder;
      if (pf?.findWalkableNear) {
        const floor = pf.findWalkableNear(standX, standY, 24);
        if (floor) {
          standX = floor.x;
          standY = floor.y;
        }
      }
      npc.x = standX;
      npc.y = standY;
      if (npc.ai) {
        npc.ai.facing = Math.abs(awayX) > Math.abs(awayY)
          ? (awayX < 0 ? 'left' : 'right')
          : (awayY < 0 ? 'up' : 'down');
        npc.ai.taskTarget = null;
        npc.ai._sitSnap = null;
      }
    }

    this._stopDeskWorkLoop(npcKey);
    this._clearDeskClutter(npcKey);
    this._hideTypingIndicator(npcKey);
    this._hideReadingIndicator(npcKey);
    this._sittingNpcs.delete(npcKey);
  }

  /**
   * sitAt(npcKey, furnitureId) - Walk to and sit at a specific chair
   */
  sitAt(npcKey, furnitureId) {
    return this.queueAction(npcKey, () => {
      return new Promise((resolve) => {
        const npc = this._getNpc(npcKey);
        const furniture = this._getFurniture(furnitureId);
        if (!npc || !furniture?.sprite) { resolve(); return; }

        if (this._sittingNpcs.has(npcKey)) {
          this._standUpNpc(npcKey);
        }

        const sit = this._getChairSitPos(furniture, null);
        if (!sit) { resolve(); return; }

        let approachX = sit.x;
        let approachY = sit.y;
        const pf = this.scene?._pathfinder;
        if (pf?.findWalkableNear) {
          const s = pf.findWalkableNear(sit.x, sit.y, 40);
          if (s) { approachX = s.x; approachY = s.y; }
        }

        npc.ai.mode = 'agent_task';
        npc.ai.taskTarget = { x: approachX, y: approachY };
        npc.ai._sitSnap = sit;
        npc.ai.taskState = 'walking';

        const checkInterval = this.scene.time.addEvent({
          delay: 100,
          loop: true,
          callback: () => {
            const dist = Math.hypot(approachX - npc.x, approachY - npc.y);
            if (dist <= 18) {
              checkInterval.remove();
              this._applySitPose(npc, npcKey, furniture, sit);
              npc.ai._sitSnap = null;
              resolve();
            }
          }
        });

        this.scene.time.delayedCall(8000, () => {
          checkInterval.remove();
          resolve();
        });
      });
    });
  }

  /**
   * standUp(npcKey) - Stand up from sitting
   */
  standUp(npcKey) {
    return this.queueAction(npcKey, () => {
      this._standUpNpc(npcKey);
      const npc = this._getNpc(npcKey);
      if (npc) {
        npc.ai.taskState = 'idle';
        npc.ai.mode = 'agent_task';
      }
    });
  }

  /**
   * checkBookshelf(npcKey, shelfId) - Walk to bookshelf and face it
   */
  checkBookshelf(npcKey, shelfId) {
    return this.queueAction(npcKey, () => {
      return new Promise((resolve) => {
        const npc = this._getNpc(npcKey);
        if (!npc) { resolve(); return; }

        if (this._sittingNpcs.has(npcKey)) {
          this._standUpNpc(npcKey);
        }

        const shelf = this._getFurniture(shelfId);
        let targetX, targetY;
        if (shelf?.sprite) {
          targetX = shelf.sprite.x;
          targetY = shelf.sprite.y + 24;
        } else {
          // Find any bookshelf
          const anyShelf = (this.scene._interactables || []).find(
            it => it.id && /bookshelf|shelf|bookcase/i.test(it.id)
          );
          if (anyShelf?.sprite) {
            targetX = anyShelf.sprite.x;
            targetY = anyShelf.sprite.y + 24;
          } else {
            targetX = 700; targetY = 300;
          }
        }

        npc.ai.mode = 'agent_task';
        npc.ai.taskTarget = { x: targetX, y: targetY };
        npc.ai.taskState = 'walking';

        const checkInterval = this.scene.time.addEvent({
          delay: 100,
          loop: true,
          callback: () => {
            const dist = Math.hypot(targetX - npc.x, targetY - npc.y);
            if (dist <= 14) {
              checkInterval.remove();
              npc.body.setVelocity(0, 0);
              npc.ai.taskState = 'reading';
              npc.ai.facing = 'up';
              npc.anims.stop();
              npc.setFrame(12);
              this._showReadingIndicator(npc, npcKey);
              resolve();
            }
          }
        });

        this.scene.time.delayedCall(10000, () => {
          checkInterval.remove();
          resolve();
        });
      });
    });
  }

  /**
   * speak(npcKey, text) - Show speech bubble above NPC
   */
  speak(npcKey, text, duration) {
    return this.queueAction(npcKey, () => {
      const npc = this._getNpc(npcKey);
      if (!npc) return;
      this._showSpeechBubble(npc, npcKey, text, 'speech', duration);
    });
  }

  /**
   * speakTo(npcKey, targetNpcKey, text) - NPC talks to another NPC
   */
  speakTo(npcKey, targetNpcKey, text) {
    return this.queueAction(npcKey, () => {
      return new Promise((resolve) => {
        const npc = this._getNpc(npcKey);
        const target = this._getNpc(targetNpcKey);
        if (!npc || !target) { resolve(); return; }

        // #4 — Conversation slot reservation. If the target already has
        // MAX_SPEAKERS_PER_TARGET speakers walking up, skip this speakTo so we
        // don't form a pile. The speaker just doesn't walk over — a short speech
        // bubble at their own spot still works via the separate speak() verb.
        const activeCount = this._activeSpeakers.get(targetNpcKey) || 0;
        if (activeCount >= this.MAX_SPEAKERS_PER_TARGET) {
          resolve();
          return;
        }
        this._activeSpeakers.set(targetNpcKey, activeCount + 1);
        let slotReleased = false;
        const releaseSlot = () => {
          if (slotReleased) return;
          slotReleased = true;
          const n = (this._activeSpeakers.get(targetNpcKey) || 1) - 1;
          if (n <= 0) this._activeSpeakers.delete(targetNpcKey);
          else this._activeSpeakers.set(targetNpcKey, n);
        };

        // Walk near the target NPC — add slight Y offset so they don't stack.
        let tx = target.x + (npc.x > target.x ? 26 : -26);
        let ty = target.y + Phaser.Math.Between(-6, 6);

        // #2 — Snap target to nearest walkable cell so we don't aim into a wall
        // (happens when the target NPC is flush against furniture).
        const pf = this.scene._pathfinder;
        if (pf && typeof pf.findWalkableNear === 'function') {
          const snapped = pf.findWalkableNear(tx, ty, 48);
          if (snapped) { tx = snapped.x; ty = snapped.y; }
        }

        npc.ai.mode = 'agent_task';
        npc.ai.taskTarget = { x: tx, y: ty };
        npc.ai.taskState = 'walking';

        // Stuck detection: if distance doesn't decrease for ~1.5s, abort early
        // so the NPC doesn't grind into a wall or pile onto another NPC.
        let lastDist = Math.hypot(tx - npc.x, ty - npc.y);
        let stuckTicks = 0;
        const STUCK_LIMIT = 15; // 15 × 100ms = 1.5s with no progress
        let resolved = false;
        const finish = (mode) => {
          if (resolved) return;
          resolved = true;
          releaseSlot();
          checkInterval.remove();
          npc.body.setVelocity(0, 0);
          if (mode === 'arrived') {
            // Face speaker toward the target
            npc.ai.facing = target.x > npc.x ? 'right' : 'left';
            npc.anims.stop();
            if (npc.ai.facing === 'left') npc.setFrame(4);
            else npc.setFrame(8);

            // Face the target NPC back toward the speaker, lock them in
            // place for ~8s so they don't walk off mid-conversation, and
            // mark them as "being addressed" in worldState so their next
            // think prompt knows to acknowledge the speaker.
            if (target.ai) {
              target.ai.facing = npc.x > target.x ? 'right' : 'left';
              target.body.setVelocity(0, 0);
              target.anims.stop();
              if (target.ai.facing === 'left') target.setFrame(4);
              else target.setFrame(8);

              // Conversation focus: pin the recipient until ~8s after they
              // were spoken to. agent-office-manager's NPC tick respects
              // this by skipping any new wander/walk decisions while
              // _addressedUntil is in the future.
              const now = this.scene.time.now;
              target.ai._addressedUntil = now + 8000;
              target.ai._addressedBy = npcKey;
            }

            // Surface "you were just addressed" into worldState so the
            // recipient's next LLM call sees it as a prompt section. The
            // npc-brains think() reads worldState.npcs[name].lastAddressed.
            try {
              if (typeof globalThis !== 'undefined' && globalThis.window === undefined) {
                // server-side — no-op; the cofounder mirror already handles state
              } else if (window?.__DenizenScene?._agentManager) {
                // Find the target's display name from the agent registry.
                const tgtAgent = window.__DenizenScene._agentManager.agents.get(targetNpcKey);
                if (tgtAgent && tgtAgent.name && window.__DenizenScene._agentManager._send) {
                  // Lightweight 'addressed' message — the server will mirror
                  // this into worldState so the next think sees it.
                  window.__DenizenScene._agentManager._send({
                    type: 'npc_addressed',
                    target: tgtAgent.name,
                    from: window.__DenizenScene._agentManager.agents.get(npcKey)?.name || npcKey,
                    text: String(text || '').slice(0, 200),
                    ts: Date.now(),
                  });
                }
              }
            } catch (_) { /* best-effort */ }

            // Small idle pause before speaking — looks like settling in
            this.scene.time.delayedCall(350, () => {
              // Show speech bubble after the pause
              this._showSpeechBubble(npc, npcKey, text, 'speech');
              // After a beat, resolve
              this.scene.time.delayedCall(1500, () => resolve());
            });
          } else {
            // Stuck or timed out — release the NPC back to wander so it
            // doesn't stay jammed against geometry.
            npc.ai.mode = 'wander';
            npc.ai.taskTarget = null;
            npc.ai.taskState = null;
            npc.ai.nextWanderAt = this.scene.time.now + 1500;
            resolve();
          }
        };

        const checkInterval = this.scene.time.addEvent({
          delay: 100,
          loop: true,
          callback: () => {
            const dist = Math.hypot(tx - npc.x, ty - npc.y);
            if (dist <= 20) {
              finish('arrived');
              return;
            }
            // Made less than 1px of progress this tick — count as stuck.
            if (lastDist - dist < 1) {
              stuckTicks++;
              if (stuckTicks >= STUCK_LIMIT) {
                finish('stuck');
                return;
              }
            } else {
              stuckTicks = 0;
            }
            lastDist = dist;
          }
        });

        // Hard ceiling — dropped from 8s to 3s so jammed NPCs recover fast.
        this.scene.time.delayedCall(3000, () => finish('timeout'));
      });
    });
  }

  /**
   * think(npcKey, text) - Show thought bubble
   */
  think(npcKey, text) {
    return this.queueAction(npcKey, () => {
      const npc = this._getNpc(npcKey);
      if (!npc) return;
      this._showSpeechBubble(npc, npcKey, text, 'thought');
    });
  }

  /**
   * emote(npcKey, type) - Show emoji reaction
   */
  emote(npcKey, type) {
    return this.queueAction(npcKey, () => {
      const npc = this._getNpc(npcKey);
      if (!npc) return;
      const emoteMap = {
        '!': '!', '?': '?', 'idea': '💡', 'confused': '?',
        'happy': ':)', 'working': '...', 'done': '✓',
        'error': '✗', 'star': '★', 'wave': '👋',
      };
      const symbol = emoteMap[type] || type || '!';
      this._showEmote(npc, npcKey, symbol);
    });
  }

  /**
   * goToBreakroom(npcKey) - Walk to breakroom area
   */
  goToBreakroom(npcKey) {
    if (this._sittingNpcs.has(npcKey)) {
      this._standUpNpc(npcKey);
    }
    const room = this.ROOMS.breakroom;
    const pf = this.scene?._pathfinder;

    let bx = 80 + Math.random() * 150;
    let by = 490 + Math.random() * 70;  // safer band: avoid sofa cluster at ~548-576 and very bottom

    // Prefer a walkable cell; try a few samples inside the room rect for a good one
    if (pf && typeof pf.findWalkableNear === 'function') {
      let best = null;
      let bestScore = -1;
      for (let i = 0; i < 8; i++) {
        const tx = room.xMin + 20 + Math.random() * (room.xMax - room.xMin - 40);
        const ty = room.yMin + 20 + Math.random() * (room.yMax - room.yMin - 80); // keep away from bottom wall
        const snapped = pf.findWalkableNear(tx, ty, 36);
        if (snapped) {
          // score: prefer a bit of open space (avoid furniture y's) and not too close to walls
          const sofaY = 555;
          const distToSofaBand = Math.abs(snapped.y - sofaY);
          let score = distToSofaBand;
          // slight preference for middle of the gap entrance side
          if (snapped.x > 140 && snapped.x < 260) score += 20;
          if (score > bestScore) {
            bestScore = score;
            best = snapped;
          }
        }
      }
      if (best) {
        bx = best.x;
        by = best.y;
      } else {
        const s = pf.findWalkableNear(bx, by, 48);
        if (s) { bx = s.x; by = s.y; }
      }
    }
    return this.walkTo(npcKey, bx, by);
  }

  /**
   * goToCoffee(npcKey) - Walk to coffee-like furniture in the breakroom,
   * then pick up a steaming LimeZu mug prop (when preloaded).
   * Falls back to a generic breakroom spot if no match is found.
   */
  goToCoffee(npcKey) {
    if (this._sittingNpcs.has(npcKey)) {
      this._standUpNpc(npcKey);
    }
    const item = (this.scene._interactables || []).find(it => {
      return it.sprite && it.id && /coffee|espresso|kettle|vending|snack|fridge|microwave/i.test(it.id);
    });
    const afterArrive = () => {
      const npc = this._getNpc(npcKey);
      if (!npc) return;
      this._flashCoffeeMug(npc, npcKey, 4200);
      this._showEmote?.(npc, npcKey, '☕');
    };
    if (item && item.sprite) {
      let x = item.sprite.x + Phaser.Math.Between(-12, 12);
      let y = item.sprite.y + 18 + Phaser.Math.Between(-4, 4);  // stand slightly in front
      const pf = this.scene?._pathfinder;
      if (pf && typeof pf.findWalkableNear === 'function') {
        const s = pf.findWalkableNear(x, y, 32);
        if (s) { x = s.x; y = s.y; }
      }
      return this.walkTo(npcKey, x, y).then(afterArrive);
    }
    return this.goToBreakroom(npcKey).then(afterArrive);
  }

  /**
   * visit(npcKey, targetNpcKey) - Walk toward a coworker's desk for a
   * drop-by check-in. Does not speak; caller can follow up with speak()
   * or speakTo() if they want a conversation. Returns a promise that
   * resolves once the NPC has arrived (or given up).
   */
  visit(npcKey, targetNpcKey) {
    return this.queueAction(npcKey, () => {
      return new Promise((resolve) => {
        const npc = this._getNpc(npcKey);
        const target = this._getNpc(targetNpcKey);
        if (!npc || !target) { resolve(); return; }

        if (this._sittingNpcs.has(npcKey)) {
          this._standUpNpc(npcKey);
        }

        // Aim for a walkable offset beside the target — snapped to the grid
        // so we don't land inside a desk or wall.
        let tx = target.x + (npc.x > target.x ? 30 : -30);
        let ty = target.y + Phaser.Math.Between(-8, 8);
        const pf = this.scene._pathfinder;
        if (pf && typeof pf.findWalkableNear === 'function') {
          const snapped = pf.findWalkableNear(tx, ty, 48);
          if (snapped) { tx = snapped.x; ty = snapped.y; }
        }

        npc.ai.mode = 'agent_task';
        npc.ai.taskTarget = { x: tx, y: ty };
        npc.ai.taskState = 'walking';

        const checkInterval = this.scene.time.addEvent({
          delay: 100,
          loop: true,
          callback: () => {
            const dist = Math.hypot(tx - npc.x, ty - npc.y);
            if (dist <= 18) {
              checkInterval.remove();
              npc.body.setVelocity(0, 0);
              // Face the target
              npc.ai.facing = target.x > npc.x ? 'right' : 'left';
              npc.anims.stop();
              npc.setFrame(npc.ai.facing === 'left' ? 4 : 8);
              resolve();
            }
          }
        });

        // Dropped 8s → 3s ceiling so jammed visitors abandon quickly.
        this.scene.time.delayedCall(3000, () => {
          checkInterval.remove();
          npc.body.setVelocity(0, 0);
          resolve();
        });
      });
    });
  }


  /**
   * visitCoworker(npcKey, targetNpcKey?) - Drop by a coworker.
   * If no target is given, pick a random other NPC who is currently in the scene.
   */
  visitCoworker(npcKey, targetNpcKey = null) {
    if (!targetNpcKey) {
      const others = (this.scene.npcs || [])
        .map(n => n.texture?.key)
        .filter(k => k && k !== npcKey);
      if (!others.length) return this.goToRoom(npcKey, 'open_office');
      targetNpcKey = others[Math.floor(Math.random() * others.length)];
    }
    return this.visit(npcKey, targetNpcKey);
  }

  /**
   * goToRoom(npcKey, roomKey) - Walk to center of a named room
   */
  goToRoom(npcKey, roomKey) {
    const room = this.ROOMS[roomKey];
    if (!room) return this.walkTo(npcKey, 400, 300);
    let x = (room.xMin + room.xMax) / 2 + Phaser.Math.Between(-30, 30);
    let y = (room.yMin + room.yMax) / 2 + Phaser.Math.Between(-20, 20);
    // Snap using pathfinder when possible
    const pf = this.scene?._pathfinder;
    if (pf && typeof pf.findWalkableNear === 'function') {
      const s = pf.findWalkableNear(x, y, 40);
      if (s) { x = s.x; y = s.y; }
    }
    return this.walkTo(npcKey, x, y);
  }

  /**
   * Find available chairs in the conference room that no NPC is sitting in
   */
  _findConferenceChairs() {
    if (!this.scene._interactables) return [];
    const room = this.ROOMS.conference;
    const chairs = this.scene._interactables.filter(it => {
      if (!it.sprite || !it.def) return false;
      const isSeat = it.def.type === 'seat' || (it.id && /chair|seat|stool/i.test(it.id));
      if (!isSeat) return false;
      const x = it.sprite.x, y = it.sprite.y;
      return x >= room.xMin && x <= room.xMax && y >= room.yMin && y <= room.yMax;
    });
    // Sort by position so we can spread NPCs out (alternate sides of table)
    chairs.sort((a, b) => a.sprite.x - b.sprite.x || a.sprite.y - b.sprite.y);
    return chairs;
  }

  /**
   * joinMeeting(npcKey) - Walk to conference room and sit at an available chair
   */
  joinMeeting(npcKey) {
    if (this._sittingNpcs.has(npcKey)) {
      this._standUpNpc(npcKey);
    }

    const chairs = this._findConferenceChairs();
    // Find chairs not occupied by another NPC
    const occupiedChairs = new Set();
    this._sittingNpcs.forEach((data) => {
      if (data.chairSprite) occupiedChairs.add(data.chairSprite);
    });

    const available = chairs.filter(c => !occupiedChairs.has(c.sprite));
    if (available.length === 0) {
      return this.goToRoom(npcKey, 'conference');
    }

    // Spread out: pick the chair farthest from any occupied chair
    let bestChair = available[0];
    if (occupiedChairs.size > 0) {
      let bestMinDist = -1;
      for (const chair of available) {
        let minDist = Infinity;
        occupiedChairs.forEach(occ => {
          const d = Math.hypot(chair.sprite.x - occ.x, chair.sprite.y - occ.y);
          if (d < minDist) minDist = d;
        });
        if (minDist > bestMinDist) {
          bestMinDist = minDist;
          bestChair = chair;
        }
      }
    }

    return this.sitAt(npcKey, bestChair.instanceId || bestChair.id);
  }

  /**
   * attendMeeting(npcKey) - Walk to conference room and stand in rows (for lower-rank staff)
   * Standing NPCs form rows behind the seated leadership, facing the table.
   */
  attendMeeting(npcKey) {
    if (this._sittingNpcs.has(npcKey)) {
      this._standUpNpc(npcKey);
    }

    return this.queueAction(npcKey, () => {
      return new Promise((resolve) => {
        const npc = this._getNpc(npcKey);
        if (!npc) { resolve(); return; }

        const room = this.ROOMS.conference;
        // Standing positions: rows behind the chairs, spread across the room
        // Use size for stable index to avoid snapshot issues when multiple enter
        this._standingMeetingNpcs.add(npcKey);
        const standIndex = this._standingMeetingNpcs.size - 1;

        // Arrange in rows, spread across the conference room width with good spacing
        const cols = 5;
        const row = Math.floor(standIndex / cols);
        const col = standIndex % cols;
        const startX = room.xMin + 50;
        const spacingX = (room.xMax - room.xMin - 100) / (cols - 1);
        // More vertical spacing for rows to prevent piling
        const startY = room.yMax - 30 + (row * 36); 

        let targetX = startX + col * spacingX;
        let targetY = startY;

        // Add jitter so they don't stack exactly on the grid point
        const jitter = 12;
        targetX += (Math.random() - 0.5) * jitter;
        targetY += (Math.random() - 0.5) * (jitter * 0.7);

        // Clamp to conference room bounds with margin so they don't go outside
        targetX = Math.max(room.xMin + 30, Math.min(room.xMax - 30, targetX));
        targetY = Math.max(room.yMin + 20, Math.min(room.yMax - 15, targetY));

        npc.ai.mode = 'agent_task';
        npc.ai.taskTarget = { x: targetX, y: targetY };
        npc.ai.taskState = 'walking';

        const checkInterval = this.scene.time.addEvent({
          delay: 100,
          loop: true,
          callback: () => {
            const dist = Math.hypot(targetX - npc.x, targetY - npc.y);
            if (dist <= 16) {
              checkInterval.remove();
              npc.body.setVelocity(0, 0);
              npc.ai.taskState = 'attending_meeting';
              // Face upward toward the table/presenters
              npc.anims.stop();
              npc.setFrame(0); // facing up/front

              // Final anti-pile nudge relative to other standing meeting NPCs + stable spacing
              const others = Array.from(this._standingMeetingNpcs || [])
                .filter(k => k !== npcKey)
                .map(k => this._getNpc(k))
                .filter(Boolean);
              let nudgeX = 0, nudgeY = 0;
              others.forEach(o => {
                const dx = npc.x - o.x;
                const dy = npc.y - o.y;
                const d = Math.hypot(dx, dy);
                if (d > 0 && d < 26) {
                  const strength = (26 - d) / 26 * 8;
                  nudgeX += (dx / d) * strength;
                  nudgeY += (dy / d) * strength;
                }
              });
              npc.x += nudgeX;
              npc.y += nudgeY;

              // Extra row spread nudge based on index
              if (standIndex % 2 === 0) npc.y -= 4;

              resolve();
            }
          }
        });

        this.scene.time.delayedCall(12000, () => {
          checkInterval.remove();
          npc.body.setVelocity(0, 0);
          resolve();
        });
      });
    });
  }

  /**
   * leaveMeeting(npcKey) - Clean up standing meeting state when NPC leaves
   */
  leaveMeeting(npcKey) {
    if (this._standingMeetingNpcs) {
      this._standingMeetingNpcs.delete(npcKey);
    }
    return this.standUp(npcKey);
  }

  /**
   * reportToCEO(npcKey) - Walk to player and face them
   */
  reportToCEO(npcKey) {
    return this.queueAction(npcKey, () => {
      return new Promise((resolve) => {
        const npc = this._getNpc(npcKey);
        const player = this.scene.player;
        if (!npc || !player) { resolve(); return; }

        if (this._sittingNpcs.has(npcKey)) {
          this._standUpNpc(npcKey);
        }

        // Use smart approach finder so NPCs can reach the player no matter where the player is standing
        let targetX = player.x + 32;
        let targetY = player.y;
        const pf = this.scene?._pathfinder;
        if (pf && typeof pf.findGoodApproachNear === 'function') {
          const good = pf.findGoodApproachNear(player.x, player.y, 28, 70);
          if (good) {
            targetX = good.x;
            targetY = good.y;
          } else {
            const snap = pf.findWalkableNear(player.x + 32, player.y, 48);
            if (snap) { targetX = snap.x; targetY = snap.y; }
          }
        } else if (pf && typeof pf.findWalkableNear === 'function') {
          const snap = pf.findWalkableNear(targetX, targetY, 48);
          if (snap) { targetX = snap.x; targetY = snap.y; }
        }

        npc.ai.mode = 'agent_task';
        npc.ai.taskTarget = { x: targetX, y: targetY };
        npc.ai.taskState = 'walking';

        const checkInterval = this.scene.time.addEvent({
          delay: 120,
          loop: true,
          callback: () => {
            const livePlayer = this.scene.player;
            const livePf = this.scene?._pathfinder;
            // Re-snap / adjust target occasionally if player moved
            let curTx = targetX, curTy = targetY;
            if (livePlayer && livePf && typeof livePf.findGoodApproachNear === 'function' && (Math.random() < 0.25)) {
              const refreshed = livePf.findGoodApproachNear(livePlayer.x, livePlayer.y, 26, 65);
              if (refreshed) { curTx = refreshed.x; curTy = refreshed.y; npc.ai.taskTarget = { x: curTx, y: curTy }; }
            }
            const dist = Math.hypot(curTx - npc.x, curTy - npc.y);
            const pDist = livePlayer ? Math.hypot(livePlayer.x - npc.x, livePlayer.y - npc.y) : 999;
            const arrival = (pDist < 48) ? 48 : 26;
            if (dist <= arrival || pDist < 42) {
              checkInterval.remove();
              npc.body.setVelocity(0, 0);
              npc.ai.taskState = 'reporting';
              if (livePlayer) npc.ai.facing = livePlayer.x < npc.x ? 'left' : 'right';
              npc.anims.stop();
              const f = npc.ai.facing || 'down';
              if (f === 'left') npc.setFrame(4);
              else if (f === 'right') npc.setFrame(8);
              else if (f === 'up') npc.setFrame(12);
              else npc.setFrame(0);
              resolve();
            }
          }
        });

        this.scene.time.delayedCall(12000, () => {
          checkInterval.remove();
          npc.body.setVelocity(0, 0);
          resolve();
        });
      });
    });
  }

  /**
   * setIdle(npcKey) - Put NPC in idle state at current position
   */
  setIdle(npcKey) {
    const npc = this._getNpc(npcKey);
    if (!npc || !npc.ai) return;

    if (this._sittingNpcs.has(npcKey)) {
      this._standUpNpc(npcKey);
    }

    npc.ai.mode = 'agent_task';
    npc.ai.taskState = 'idle';
    npc.body.setVelocity(0, 0);
    npc.anims.stop();

    // Set idle frame based on facing
    if (npc.ai.facing === 'up') npc.setFrame(12);
    else if (npc.ai.facing === 'down') npc.setFrame(0);
    else if (npc.ai.facing === 'left') npc.setFrame(4);
    else npc.setFrame(8);

    this._hideTypingIndicator(npcKey);
    this._hideReadingIndicator(npcKey);
  }

  // ---- Visual Helpers ----

  _showSpeechBubble(npc, npcKey, text, style, duration) {
    this._clearBubble(npcKey, this._speechBubbles);

    const isThought = style === 'thought';
    // Compact — thoughts shorter than spoken lines so the head isn't buried.
    const maxChars = isThought ? 42 : 52;
    const truncated = text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text;

    // Voice — route speech (not thought) through DenizenSpeak. The voice
    // gate handles the presence check and the provider override
    // (ElevenLabs when configured, browser SpeechSynthesis otherwise).
    // Without this, every autonomous NPC line was silent because the
    // bubble path bypassed the voice layer entirely. Thoughts are
    // intentionally silent — they're internal monologue.
    if (!isThought && typeof window !== 'undefined' && typeof window.DenizenSpeak === 'function'
        && !window.DenizenVoiceSession?.isActive?.()) {
      try {
        // Resolve display name from the agent manager. Fall back to npcKey
        // if the manager isn't around (e.g. demo scene).
        const displayName = this.scene?._agentManager?.agents?.get?.(npcKey)?.name
          || (window.DenizenNpcRoster?.keyToDisplay?.[npcKey])
          || npcKey;
        window.DenizenSpeak(displayName, text);
      } catch (err) {
        // Don't let TTS failure block the bubble render.
        console.warn('[AgentActions] DenizenSpeak failed:', err?.message || err);
      }
    }

    // Pokémon-style: light glass chip + dark readable text (no stroke halo).
    const bgColor = isThought ? '#e0f2fede' : '#f8fafcee';
    const textColor = isThought ? '#0c4a6e' : '#0f172a';
    const prefix = isThought ? '…' : '';
    const label = prefix ? `${prefix}${truncated}` : truncated;

    const bubbleText = this.scene.add.text(0, 0, label, {
      fontSize: isThought ? '8px' : '9px',
      fontFamily: 'monospace',
      color: textColor,
      backgroundColor: bgColor,
      padding: { x: 4, y: 3 },
      wordWrap: { width: isThought ? 110 : 130 },
      align: 'center',
    });
    if (typeof bubbleText.setResolution === 'function') bubbleText.setResolution(1);
    bubbleText.setOrigin(0.5, 1);
    bubbleText.setDepth(9998);
    bubbleText.setAlpha(0.96);
    bubbleText.x = npc.x;
    bubbleText.y = npc.y - (isThought ? 44 : 48);

    // Nudge up when another live bubble sits on roughly the same spot so
    // clustered NPCs don't stack unreadable chips on top of each other.
    try {
      const bw = bubbleText.width || 80;
      const bh = bubbleText.height || 16;
      let guard = 0;
      while (guard < 6) {
        let hit = false;
        for (const [otherKey, other] of this._speechBubbles) {
          if (otherKey === npcKey || !other?.text) continue;
          const dx = Math.abs(other.text.x - bubbleText.x);
          const dy = Math.abs(other.text.y - bubbleText.y);
          if (dx < (bw + (other.text.width || 80)) * 0.55 && dy < Math.max(bh, other.text.height || 16) + 4) {
            hit = true;
            break;
          }
        }
        if (!hit) break;
        bubbleText.y -= (bh + 6);
        guard += 1;
      }
    } catch (_) { /* layout nudge is best-effort */ }

    // duration=0 means persist forever (no auto-clear), undefined defaults to 5s
    const dur = duration !== undefined ? duration : (isThought ? 3500 : 5000);
    const timer = dur > 0 ? this.scene.time.delayedCall(dur, () => {
      this._clearBubble(npcKey, this._speechBubbles);
    }) : null;

    this._speechBubbles.set(npcKey, { text: bubbleText, timer, npc, isThought });
  }

  _showEmote(npc, npcKey, symbol) {
    this._clearBubble(npcKey, this._emoteBubbles);

    const emoteText = this.scene.add.text(0, 0, symbol, {
      fontSize: '11px',
      fontFamily: 'monospace',
      fontStyle: 'bold',
      color: '#0c4a6e',
      backgroundColor: '#e0f2fede',
      padding: { x: 3, y: 1 },
    });
    emoteText.setOrigin(0.5, 1);
    emoteText.setDepth(9999);
    emoteText.x = npc.x + 12;
    emoteText.y = npc.y - 52;

    const timer = this.scene.time.delayedCall(2500, () => {
      this._clearBubble(npcKey, this._emoteBubbles);
    });

    this._emoteBubbles.set(npcKey, { text: emoteText, timer, npc });
  }

  _showTypingIndicator(npc, npcKey) {
    this._hideTypingIndicator(npcKey);

    const indicator = this.scene.add.text(0, 0, '…', {
      fontSize: '8px',
      fontFamily: 'monospace',
      color: '#0c4a6e',
      backgroundColor: '#e0f2fede',
      padding: { x: 3, y: 2 },
    });
    indicator.setOrigin(0.5, 1);
    indicator.setDepth(9997);
    indicator.setAlpha(0.95);
    indicator.x = npc.x;
    indicator.y = npc.y - 36;

    let dotCount = 0;
    const dotTimer = this.scene.time.addEvent({
      delay: 400,
      loop: true,
      callback: () => {
        dotCount = (dotCount + 1) % 4;
        indicator.setText('.'.repeat(dotCount || 1));
      }
    });

    this._typingIndicators.set(npcKey, { text: indicator, timer: dotTimer, npc });
  }

  _hideTypingIndicator(npcKey) {
    const existing = this._typingIndicators.get(npcKey);
    if (existing) {
      existing.text.destroy();
      if (existing.timer) existing.timer.remove();
      this._typingIndicators.delete(npcKey);
    }
  }

  _showReadingIndicator(npc, npcKey) {
    this._hideTypingIndicator(npcKey);

    const indicator = this.scene.add.text(0, 0, 'Reading…', {
      fontSize: '7px',
      fontFamily: 'monospace',
      color: '#0c4a6e',
      backgroundColor: '#e0f2fede',
      padding: { x: 3, y: 2 },
    });
    indicator.setOrigin(0.5, 1);
    indicator.setDepth(9997);
    indicator.setAlpha(0.95);
    indicator.x = npc.x;
    indicator.y = npc.y - 36;

    this._typingIndicators.set(npcKey, { text: indicator, timer: null, npc });
  }

  _hideReadingIndicator(npcKey) {
    this._hideTypingIndicator(npcKey);
  }

  showRoleLabel(npcKey, name, role) {
    this._clearRoleLabel(npcKey);
    const npc = this._getNpc(npcKey);
    if (!npc) return;

    // Micro nameplate — world-space; camera zoom is often 1.5–2.8× so a
    // small name chip still reads clearly over ~32px sprites. The blue
    // letter-initial chip that used to sit above the name was removed; the
    // name label now doubles as the click target for the MCP-connect dialog.
    const who = String(name || npcKey || '').trim() || 'Agent';

    const label = this.scene.add.text(0, 0, who, {
      fontSize: '5px',
      fontFamily: 'Segoe UI, system-ui, -apple-system, sans-serif',
      fontStyle: '600',
      color: '#0f172a',
      backgroundColor: '#ffffffee',
      padding: { x: 2, y: 0 },
      align: 'center',
    });
    label.setOrigin(0.5, 1);
    label.setDepth(9996);
    label.setAlpha(0.92);
    label.setData?.('npcKey', npcKey);
    label.setData?.('displayName', who);
    label.setInteractive({ useHandCursor: true });
    label.on('pointerover', () => { try { label.setAlpha(1); label.setScale(1.08); } catch (_) {} });
    label.on('pointerout', () => { try { label.setAlpha(0.92); label.setScale(1); } catch (_) {} });
    label.on('pointerdown', (pointer, _lx, _ly, event) => {
      try { event?.stopPropagation?.(); } catch (_) {}
      try { pointer?.event?.stopPropagation?.(); } catch (_) {}
      this._openNpcMcpConnect(npcKey, who);
    });
    // Crisp on retina; 1 on light-perf phones.
    let res = 2;
    try {
      const light = globalThis.DenizenDeviceProfile?.lightPerf?.()?.light
        || globalThis.DenizenDeviceProfile?.wantsLightPerf?.();
      if (light) res = 1;
    } catch (_) {}
    if (typeof label.setResolution === 'function') label.setResolution(res);
    // Optional: keep role for tooltips if Phaser exposes it (no visual line).
    if (role && typeof label.setData === 'function') label.setData('role', String(role).trim());

    label.x = npc.x;
    label.y = npc.y - 34;

    this._roleLabels.set(npcKey, {
      text: label,
      npc,
      yOff: 34,
    });
  }

  _folderForNpcKey(npcKey) {
    const roster = globalThis.DenizenNpcRoster;
    const key = String(npcKey || '');
    const entry = (roster?.entries || []).find((e) => e.textureKey === key || e.folder === key);
    if (entry?.folder) return entry.folder;
    return key.replace(/^xp_/, '').toLowerCase();
  }

  async _openNpcMcpConnect(npcKey, displayName) {
    const folder = this._folderForNpcKey(npcKey);
    const name = String(displayName || npcKey || folder).trim();
    const sess = globalThis.DenizenVisitorSession;
    if (sess?.isProtectedNpc?.(folder)) {
      alert(`${name} is a system NPC — MCP tokens are not available. Claim a teammate assistant instead.`);
      return;
    }
    const ensureUi = async () => {
      if (globalThis.DenizenVisitorMcpConnectUI?.openConnect) return true;
      try {
        await globalThis.DenizenLazyScripts?.load?.(
          ['./src/visitor-mcp-connect-ui.js?v=mcpHeader1'],
        );
      } catch (_) { /* ignore */ }
      return !!globalThis.DenizenVisitorMcpConnectUI?.openConnect;
    };
    if (!(await ensureUi())) {
      alert('MCP connect UI is still loading — try again in a second.');
      return;
    }
    globalThis.DenizenVisitorMcpConnectUI.openConnect(folder, name);
  }

  _clearRoleLabel(npcKey) {
    const existing = this._roleLabels.get(npcKey);
    if (existing) {
      try { existing.text?.destroy?.(); } catch (_) {}
      this._roleLabels.delete(npcKey);
    }
  }

  _clearBubble(npcKey, map) {
    const existing = map.get(npcKey);
    if (existing) {
      if (existing.text) existing.text.destroy();
      if (existing.timer) existing.timer.remove();
      map.delete(npcKey);
    }
  }

  /**
   * Update all visual elements positions (call from scene update)
   */

  // ---- Living-office furniture verbs ----

  /**
   * Find furniture matching a kind regex, optionally constrained to a room.
   * Returns the interactable entry or null.
   */
  _findFurnitureByKind(kindRe, roomKey = null) {
    const items = this.scene?._interactables || [];
    const room = roomKey ? this.ROOMS[roomKey] : null;
    const matches = [];
    for (const it of items) {
      if (!it?.sprite || !it.id) continue;
      if (!kindRe.test(String(it.id)) && !(it.def?.name && kindRe.test(String(it.def.name)))) continue;
      if (room) {
        const x = it.sprite.x, y = it.sprite.y;
        if (x < room.xMin || x > room.xMax || y < room.yMin || y > room.yMax) continue;
      }
      matches.push(it);
    }
    if (!matches.length) return null;
    return matches[Math.floor(Math.random() * matches.length)];
  }

  /**
   * Walk up to furniture, stand in front, face it, then resolve.
   */
  _approachFurniture(npcKey, furniture, { offsetY = 20, dwellMs = 2500, face = 'up', onArrive = null } = {}) {
    return this.queueAction(npcKey, () => new Promise((resolve) => {
      const npc = this._getNpc(npcKey);
      if (!npc || !furniture?.sprite) { resolve(); return; }
      if (this._sittingNpcs.has(npcKey)) this._standUpNpc(npcKey);

      let tx = furniture.sprite.x;
      let ty = furniture.sprite.y + offsetY;
      const pf = this.scene?._pathfinder;
      if (pf?.findWalkableNear) {
        const s = pf.findWalkableNear(tx, ty, 40);
        if (s) { tx = s.x; ty = s.y; }
      }

      npc.ai.mode = 'agent_task';
      npc.ai.taskTarget = { x: tx, y: ty };
      npc.ai.taskState = 'walking';

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        try { check.remove(); } catch (_) {}
        npc.body?.setVelocity?.(0, 0);
        npc.ai.taskState = 'arrived';
        npc.anims?.stop?.();
        if (face === 'up') npc.setFrame?.(12);
        else if (face === 'down') npc.setFrame?.(0);
        else if (face === 'left') npc.setFrame?.(4);
        else npc.setFrame?.(8);
        npc.ai.facing = face;
        try { onArrive?.(npc, furniture); } catch (_) {}
        this.scene.time.delayedCall(dwellMs, () => resolve());
      };

      const check = this.scene.time.addEvent({
        delay: 100,
        loop: true,
        callback: () => {
          if (Math.hypot(tx - npc.x, ty - npc.y) <= 18) finish();
        },
      });
      this.scene.time.delayedCall(8000, finish);
    }));
  }

  /**
   * Attach a LimeZu watering-can prop, tip it, and stream droplets toward a target.
   * No-op if the texture isn't loaded yet.
   * @param {{x:number,y:number}|null} pourTarget world point to pour toward (plant soil)
   */
  _flashWateringCan(npc, npcKey, ms = 2800, pourTarget = null) {
    if (!npc || !this.scene?.add) return null;
    const key = 'vfx_watering_can';
    if (!this.scene.textures?.exists?.(key)) return null;
    try {
      this._clearWateringCan?.(npcKey);
      const can = this.scene.add.image(npc.x + 0, npc.y - 16, key);
      can.setOrigin(0.78, 0.62);
      can.setDepth((npc.depth || 10) + 2);
      can.setScale(1.1);
      const ox = 0;
      const oy = -16;
      const follow = this.scene.time.addEvent({
        delay: 30,
        loop: true,
        callback: () => {
          if (!can.active || !npc.active) return;
          can.x = npc.x + ox;
          can.y = npc.y + oy;
        },
      });

      // Tip spout (left-facing can → negative angle) then pour
      try {
        this.scene.tweens.add({
          targets: can,
          angle: -28,
          scale: 1.25,
          duration: 650,
          ease: 'Sine.easeInOut',
          onComplete: () => {
            if (!can.active) return;
            const target = pourTarget || { x: npc.x - 12, y: npc.y - 6 };
            for (let i = 0; i < 14; i++) {
              this.scene.time.delayedCall(i * 80, () => {
                if (!can.active) return;
                const ang = Phaser.Math.DegToRad(can.angle || 0);
                // Spout relative to handle-grip origin
                const spoutX = can.x + (-20) * Math.cos(ang) - (-3) * Math.sin(ang);
                const spoutY = can.y + (-20) * Math.sin(ang) + (-3) * Math.cos(ang);
                const drop = this.scene.add.circle(
                  spoutX,
                  spoutY,
                  2,
                  0x7ec8e3,
                  0.95,
                );
                drop.setDepth((npc.depth || 10) + 3);
                this.scene.tweens.add({
                  targets: drop,
                  x: target.x + Phaser.Math.Between(-5, 5),
                  y: target.y + Phaser.Math.Between(-2, 3),
                  alpha: 0.1,
                  duration: 340,
                  ease: 'Quad.easeIn',
                  onComplete: () => { try { drop.destroy(); } catch (_) {} },
                });
              });
            }
            // Swap to empty can after stream finishes
            this.scene.time.delayedCall(1300, () => {
              if (!can.active) return;
              if (this.scene.textures?.exists?.('vfx_watering_can_empty')) {
                try { can.setTexture('vfx_watering_can_empty'); } catch (_) {}
              }
              try {
                this.scene.tweens.add({
                  targets: can,
                  angle: 0,
                  scale: 1.1,
                  duration: 420,
                  ease: 'Sine.easeOut',
                });
              } catch (_) {}
            });
          },
        });
      } catch (_) {}

      const timer = this.scene.time.delayedCall(ms, () => {
        try { follow.remove(); } catch (_) {}
        try { can.destroy(); } catch (_) {}
        this._wateringCans?.delete?.(npcKey);
      });
      if (!this._wateringCans) this._wateringCans = new Map();
      this._wateringCans.set(npcKey, { can, follow, timer });
      return can;
    } catch (_) {
      return null;
    }
  }

  _clearWateringCan(npcKey) {
    const row = this._wateringCans?.get?.(npcKey);
    if (!row) return;
    try { row.follow?.remove?.(); } catch (_) {}
    try { row.timer?.remove?.(); } catch (_) {}
    try { row.can?.destroy?.(); } catch (_) {}
    this._wateringCans.delete(npcKey);
  }

  /**
   * Hold a steaming LimeZu coffee mug beside the NPC for a short beat.
   * No-op if vfx_coffee_mug isn't preloaded.
   */
  _flashCoffeeMug(npc, npcKey, ms = 4200) {
    if (!npc || !this.scene?.add) return null;
    // Prefer the tight cup-only texture so it can sit on the mouth
    const cupKey = this.scene.textures?.exists?.('vfx_coffee_cup') ? 'vfx_coffee_cup' : null;
    const sheetKey = this.scene.textures?.exists?.('vfx_coffee_mug') ? 'vfx_coffee_mug' : null;
    if (!cupKey && !sheetKey) return null;
    try {
      this._clearCoffeeMug?.(npcKey);
      let mug;
      // Abby face: eyes ~row 30–31 (oy≈-26), mouth pink ~32–33 (oy≈-22)
      const mouthY = 22;
      if (cupKey) {
        mug = this.scene.add.image(npc.x, npc.y - mouthY, cupKey);
        // Texture top = rim on mouth (originY 0 — see mock holdMugAtMouth)
        mug.setOrigin(0.5, 0);
        mug.setScale(1.3);
        mug.setAngle(-15);
      } else {
        mug = this.scene.add.sprite(npc.x, npc.y - mouthY, sheetKey, 0);
        mug.setOrigin(0.5, 0);
        mug.setScale(1.15);
        mug.setAngle(-15);
        try { mug.setCrop(0, 15, 16, 17); } catch (_) {}
      }
      mug.setDepth((npc.depth || 10) + 2);

      try {
        mug.y = npc.y - 12;
        this.scene.tweens.add({
          targets: mug,
          y: npc.y - mouthY,
          duration: 280,
          ease: 'Back.easeOut',
        });
      } catch (_) {}

      const frameOf = (spr) => {
        const fr = spr?.frame;
        if (!fr) return 0;
        const n = Number(fr.name);
        if (Number.isFinite(n)) return n;
        if (typeof fr.index === 'number') return fr.index;
        return 0;
      };

      const follow = this.scene.time.addEvent({
        delay: 40,
        loop: true,
        callback: () => {
          if (!mug.active || !npc.active) return;
          const f = frameOf(npc);
          let ox = 0;
          let oy = -mouthY;
          if (f >= 4 && f <= 7) { ox = -8; mug.setAngle(-15); }
          else if (f >= 8 && f <= 11) { ox = 8; mug.setAngle(15); }
          else if (f >= 12) { oy = -23; mug.setAngle(0); }
          else mug.setAngle(0);
          mug.x = npc.x + ox;
          mug.y = npc.y + oy;
        },
      });
      const timer = this.scene.time.delayedCall(ms, () => {
        try { follow.remove(); } catch (_) {}
        try { mug.destroy(); } catch (_) {}
        this._coffeeMugs?.delete?.(npcKey);
      });
      if (!this._coffeeMugs) this._coffeeMugs = new Map();
      this._coffeeMugs.set(npcKey, { mug, follow, timer });
      return mug;
    } catch (_) {
      return null;
    }
  }

  _clearCoffeeMug(npcKey) {
    const row = this._coffeeMugs?.get?.(npcKey);
    if (!row) return;
    try { row.follow?.remove?.(); } catch (_) {}
    try { row.timer?.remove?.(); } catch (_) {}
    try { row.mug?.destroy?.(); } catch (_) {}
    this._coffeeMugs.delete(npcKey);
  }

  /**
   * waterPlant(npcKey) - Walk to a potted plant and pour into it.
   * Visual: tip LimeZu can + droplet stream (when preloaded) + 💦 emote.
   */
  waterPlant(npcKey) {
    const plant = this._findFurnitureByKind(/plant|flora|pot|fern|bush/i);
    if (!plant) {
      // No plant placed — still look purposeful: short breakroom stretch.
      return this.goToBreakroom(npcKey).then(() => this.emote(npcKey, '💦'));
    }
    return this._approachFurniture(npcKey, plant, {
      offsetY: 22,
      dwellMs: 3600,
      face: 'up',
      onArrive: () => {
        const npc = this._getNpc(npcKey);
        const soil = plant.sprite
          ? { x: plant.sprite.x, y: plant.sprite.y - 8 }
          : null;
        this._flashWateringCan(npc, npcKey, 3200, soil);
        this._showEmote?.(npc, npcKey, '💦');
      },
    }).then(() => {
      const npc = this._getNpc(npcKey);
      if (npc) this._showSpeechBubble?.(npc, npcKey, 'Looking healthy.', 'speech', 2000);
    });
  }

  /**
   * useWhiteboard(npcKey, note?) - Walk to a whiteboard / cork board and sketch.
   */
  useWhiteboard(npcKey, note = null) {
    const board = this._findFurnitureByKind(/whiteboard|cork|board|chart/i)
      || this._findFurnitureByKind(/whiteboard|cork|board|chart/i, 'conference')
      || this._findFurnitureByKind(/whiteboard|cork|board|chart/i, 'open_office');
    if (!board) {
      return this.goToRoom(npcKey, 'conference').then(() => this.think(npcKey, note || 'Sketching ideas…'));
    }
    return this._approachFurniture(npcKey, board, {
      offsetY: 24,
      dwellMs: 4500,
      face: 'up',
      onArrive: () => {
        const npc = this._getNpc(npcKey);
        this._showEmote?.(npc, npcKey, '✎');
        this._flashBoardReveal(board.sprite || board, 3600);
      },
    }).then(() => this.think(npcKey, note || 'Jotting this down…'));
  }

  /**
   * Soft reveal on a whiteboard — prefer swapping to a drawn board texture
   * from the pack; fall back to a brief thought only (no freehand HUD lines).
   */
  _flashBoardReveal(boardSprite, ms = 3600) {
    if (!boardSprite || !this.scene?.textures) return null;
    try {
      const drawnKey = this.scene.textures.exists('vfx_whiteboard_drawn')
        ? 'vfx_whiteboard_drawn'
        : (this.scene.textures.exists('whiteboard_line_chart') ? 'whiteboard_line_chart' : null);
      if (!drawnKey || !boardSprite.setTexture) {
        return null;
      }
      const prevKey = boardSprite.texture?.key;
      const prevFrame = boardSprite.frame?.name;
      boardSprite.setTexture(drawnKey);
      this.scene.time.delayedCall(ms, () => {
        try {
          if (prevKey) boardSprite.setTexture(prevKey, prevFrame);
        } catch (_) {}
      });
      return boardSprite;
    } catch (_) {
      return null;
    }
  }

  /**
   * Quiet run_skill tell — one thought line matching office bubble style.
   */
  _flashSkillCast(npc, npcKey, skill = '', ms = 3600) {
    if (!npc) return null;
    try {
      const kind = /cod|github|desktop|build/i.test(skill) ? 'coding'
        : /research|search|web|browser/i.test(skill) ? 'research'
          : 'work';
      const line = kind === 'research' ? 'Looking that up…'
        : kind === 'coding' ? 'Drafting a fix…'
          : 'Working…';
      this.think(npcKey, line);
      // Seated NPCs already own their typing dots via the desk work loop.
      if (!this._deskWork.has(npcKey)) {
        this._showTypingIndicator?.(npc, npcKey);
        this.scene?.time?.delayedCall?.(ms, () => {
          if (!this._deskWork.has(npcKey)) this._hideTypingIndicator?.(npcKey);
        });
      }
      return true;
    } catch (_) {
      return null;
    }
  }

  /**
   * taskPhase finished — small check emote + short speech (no confetti HUD).
   */
  _flashShipBeat(npc, npcKey, ms = 2200) {
    if (!npc) return null;
    try {
      this._showEmote?.(npc, npcKey, '✓');
      this._showSpeechBubble?.(npc, npcKey, 'Done.', 'speech', ms);
      return true;
    } catch (_) {
      return null;
    }
  }

  // ---- Seated desk work loop ----

  _deskNow() {
    return this.scene?.time?.now ?? Date.now();
  }

  /** The computer / laptop setup standing on a desk (parented child first). */
  _findDeskSetupSprite(desk) {
    const deskSprite = desk?.sprite;
    if (!deskSprite) return null;
    const halfW = (deskSprite.displayWidth || 96) / 2;
    const h = deskSprite.displayHeight || 32;
    let best = null;
    let bestScore = Infinity;
    for (const it of this.scene?._interactables || []) {
      if (!it?.sprite || it.sprite === deskSprite) continue;
      const id = String(it.id || '');
      if (!/desk_setup|monitor|laptop|computer|keyboard/i.test(id) || /floor/i.test(id)) continue;
      const parented = !!desk.instanceId && it.parentInstanceId === desk.instanceId;
      const dx = Math.abs(it.sprite.x - deskSprite.x);
      const dy = it.sprite.y - deskSprite.y;
      if (!parented && (dx > halfW || dy < -h || dy > 8)) continue;
      const score = parented ? -1 : dx + Math.abs(dy);
      if (score < bestScore) {
        best = it.sprite;
        bestScore = score;
      }
    }
    return best;
  }

  /**
   * While seated: bursty 1px keyboard bob on the desk setup, and every so often
   * a "Hmm." beat — typing dots pause for a short stare, then typing resumes.
   */
  _startDeskWorkLoop(npc, npcKey, desk) {
    this._stopDeskWorkLoop(npcKey);
    if (!npc || !this.scene?.time?.addEvent) return null;
    const st = {
      npc,
      setup: this._findDeskSetupSprite(desk),
      pressed: false,
      burstLeft: 0,
      restUntil: 0,
      beatUntil: 0,
      nextBeatAt: this._deskNow() + this._deskBeatGap(true),
      timer: null,
    };
    st.timer = this.scene.time.addEvent({
      delay: this.DESK_KEY_TICK_MS,
      loop: true,
      callback: () => this._tickDeskWork(npcKey),
    });
    this._deskWork.set(npcKey, st);
    return st;
  }

  _stopDeskWorkLoop(npcKey) {
    const st = this._deskWork.get(npcKey);
    if (!st) return;
    try { st.timer?.remove?.(); } catch (_) {}
    this._setDeskSetupPressed(st, false);
    this._deskWork.delete(npcKey);
  }

  /** ms until the next "Hmm." beat — the first one lands a little sooner. */
  _deskBeatGap(first = false) {
    return first ? 14000 + Math.random() * 16000 : 22000 + Math.random() * 26000;
  }

  _tickDeskWork(npcKey) {
    const st = this._deskWork.get(npcKey);
    if (!st) return;
    if (!st.npc?.active || !this._sittingNpcs.has(npcKey)) {
      this._stopDeskWorkLoop(npcKey);
      return;
    }
    const now = this._deskNow();
    if (st.beatUntil) {
      if (now < st.beatUntil) return;
      st.beatUntil = 0;
      st.nextBeatAt = now + this._deskBeatGap();
      this._showTypingIndicator(st.npc, npcKey);
      return;
    }
    if (now >= st.nextBeatAt) {
      if (this._speechBubbles.has(npcKey)) {
        st.nextBeatAt = now + 4000;
      } else {
        this._setDeskSetupPressed(st, false);
        this._hideTypingIndicator(npcKey);
        this._showSpeechBubble(st.npc, npcKey, 'Hmm.', 'thought', this.DESK_BEAT_MS - 200);
        st.beatUntil = now + this.DESK_BEAT_MS;
        return;
      }
    }
    if (now < st.restUntil) return;
    if (st.burstLeft <= 0) st.burstLeft = 3 + Math.floor(Math.random() * 4);
    const press = !st.pressed;
    this._setDeskSetupPressed(st, press);
    if (!press) {
      st.burstLeft -= 1;
      if (st.burstLeft <= 0) st.restUntil = now + 500 + Math.random() * 1100;
    }
  }

  _setDeskSetupPressed(st, pressed) {
    const s = st?.setup;
    if (!s || typeof s.setOrigin !== 'function' || st.pressed === pressed) return;
    st.pressed = pressed;
    if (!s.active) return;
    if (s._deskBobOriginY == null) s._deskBobOriginY = s.originY ?? 1;
    const h = s.displayHeight || s.height || 0;
    // Nudge the render origin, never .y — layout saves persist sprite.x/y.
    const oy = pressed && h ? s._deskBobOriginY - 1 / h : s._deskBobOriginY;
    s.setOrigin(s.originX ?? 0.5, oy);
  }

  // ---- Desk workload clutter ----

  /**
   * Pack props on the NPC's current desk that read as workload:
   * light/clear → nothing, medium → paper stack or mug, heavy → both.
   */
  setDeskClutter(npcKey, load) {
    const sit = this._sittingNpcs.get(npcKey);
    const deskSprite = sit?.deskSprite || null;
    const kinds = deskSprite ? this._deskClutterKinds(npcKey, load) : [];
    let row = this._deskClutter.get(npcKey);
    if (row && row.deskSprite !== deskSprite) {
      this._clearDeskClutter(npcKey);
      row = null;
    }
    if (!kinds.length) {
      this._clearDeskClutter(npcKey);
      return [];
    }
    if (!row) {
      row = { deskSprite, kinds: [], slots: [], props: [] };
      this._deskClutter.set(npcKey, row);
    }
    let keep = 0;
    while (keep < row.kinds.length && keep < kinds.length && row.kinds[keep] === kinds[keep]) {
      const kept = row.props[keep];
      // A missed slot (occluders not ready, texture not loaded) must retry
      // on the next indicator tick instead of sticking as a hole.
      if (!kept || kept.active === false) break;
      keep += 1;
    }
    row.props.splice(keep).forEach((p) => { try { p?.destroy?.(); } catch (_) {} });
    row.slots.length = keep;
    row.kinds.length = keep;
    for (let i = keep; i < kinds.length; i++) {
      const slot = this._pickDeskClutterSlot(npcKey, sit, kinds[i], row.slots);
      row.kinds.push(kinds[i]);
      row.slots.push(slot);
      row.props.push(slot ? this._spawnDeskProp(kinds[i], slot, deskSprite) : null);
    }
    return row.props.filter(Boolean);
  }

  _clearDeskClutter(npcKey) {
    const row = this._deskClutter.get(npcKey);
    if (!row) return;
    row.props.forEach((p) => { try { p?.destroy?.(); } catch (_) {} });
    this._deskClutter.delete(npcKey);
  }

  _deskClutterKinds(npcKey, load) {
    if (load !== 'medium' && load !== 'heavy') return [];
    const tex = this.scene?.textures;
    const has = {
      paper: !!tex?.exists?.('vfx_desk_papers'),
      mug: !!tex?.exists?.('vfx_coffee_mug'),
    };
    // Stable per-NPC order so medium → heavy only adds the second prop.
    let h = 0;
    for (const ch of String(npcKey)) h = (h * 31 + ch.charCodeAt(0)) | 0;
    const order = (h & 1) ? ['mug', 'paper'] : ['paper', 'mug'];
    return order.filter((k) => has[k]).slice(0, load === 'heavy' ? 2 : 1);
  }

  _pickDeskClutterSlot(npcKey, sit, kind, taken = []) {
    const desk = sit?.deskSprite;
    if (!desk) return null;
    const candidates = this._deskClutterCandidates(sit, this._getNpc(npcKey));
    const used = taken.filter(Boolean);
    const side = used.length ? Math.sign(used[0].dx) : 0;
    const free = candidates.filter((c) => c.blocked[kind] <= 0.12
      && used.every((u) => Math.abs(u.x - c.x) >= 18 || Math.abs(u.y - c.y) >= 14));
    free.sort((a, b) => {
      const sideA = side && Math.sign(a.dx) === side ? 1 : 0;
      const sideB = side && Math.sign(b.dx) === side ? 1 : 0;
      return (sideA - sideB)
        || (a.blocked[kind] - b.blocked[kind])
        || (a.row - b.row)
        || (Math.abs(b.dx) - Math.abs(a.dx));
    });
    return free[0] || null;
  }

  /** Candidate prop bases on a desk, scored against whatever already covers it. */
  _deskClutterCandidates(sit, npc) {
    const desk = sit.deskSprite;
    const cached = this._deskSlotCache.get(desk);
    if (cached && cached.x === desk.x && cached.y === desk.y) return cached.candidates;
    const w = desk.displayWidth || 96;
    const h = desk.displayHeight || 32;
    const known = this.DESK_CLUTTER_GEOMETRY[sit.deskId];
    const sx = (desk.flipX ? -1 : 1) * Math.abs(desk.scaleX || 1);
    const sy = Math.abs(desk.scaleY || 1);
    const geo = known
      ? { xs: known.xs.map((dx) => dx * sx), ys: known.ys.map((dy) => dy * sy) }
      : {
        xs: [-0.34, -0.26, 0.2, 0.28].map((f) => f * w),
        ys: [-0.38, -0.62].map((f) => f * h),
      };
    const occluders = this._deskOccluders(desk, sit, npc);
    const candidates = [];
    geo.ys.forEach((dy, row) => {
      geo.xs.forEach((dx) => {
        const x = Math.round(desk.x + dx);
        const y = Math.round(desk.y + dy);
        if (!this._deskSurfaceUnder(desk, x, y)) return;
        candidates.push({
          x,
          y,
          dx: Math.round(dx),
          row,
          blocked: {
            paper: this._deskFootprintBlocked(occluders, x, y, this.DESK_PROP_FOOTPRINT.paper),
            mug: this._deskFootprintBlocked(occluders, x, y, this.DESK_PROP_FOOTPRINT.mug),
          },
        });
      });
    });
    this._deskSlotCache.set(desk, { x: desk.x, y: desk.y, candidates });
    return candidates;
  }

  _deskOccluders(desk, sit, npc) {
    const halfW = (desk.displayWidth || 96) / 2;
    const top = desk.y - (desk.displayHeight || 32);
    const deskEntry = (this.scene?._interactables || []).find((it) => it?.sprite === desk) || null;
    const out = [];
    for (const it of this.scene?._interactables || []) {
      const s = it?.sprite;
      if (!s || s === desk || s.visible === false) continue;
      if (it.def?.type === 'surface' || it.def?.type === 'floor') continue;
      if (it.def?.wall_mount || it.def?._placement?.wallMount) continue;
      // Cubicle walls sit behind the desktop. Props are meant to draw in
      // front of them; treating the divider as solid left every monitor
      // desk with zero legal slots.
      const iid = String(it.id || '');
      if (it.def?.type === 'partition' || /divider|partition/i.test(iid)) continue;
      if (this._isOwnDeskSetup(it, desk, deskEntry?.instanceId)) continue;
      if (Math.abs(s.x - desk.x) > halfW + (s.displayWidth || 0) / 2) continue;
      const sTop = s.y - (s.displayHeight || 0) * (s.originY ?? 1);
      const sBottom = sTop + (s.displayHeight || 0);
      if (sBottom < top || sTop > desk.y) continue;
      out.push({ sprite: s });
    }
    if (sit.chairSprite && !out.some((o) => o.sprite === sit.chairSprite)) {
      out.push({ sprite: sit.chairSprite });
    }
    // Front-facing sitters render over the counter; keep props out of their lap.
    if (npc && sit.chairInfo && !sit.chairInfo.backFacing) {
      out.push({ rect: { x0: npc.x - 14, x1: npc.x + 14, y0: npc.y - 36, y1: npc.y } });
    }
    return out;
  }

  _deskSurfaceUnder(desk, x, y) {
    return [-3, 0, 3].every((ox) => {
      const a = this._spriteAlphaAt(desk, x + ox, y - 2);
      return a == null || a > 24;
    });
  }

  _deskFootprintBlocked(occluders, x, y, fp) {
    if (!occluders.length) return 0;
    let hits = 0;
    let total = 0;
    for (let oy = 1; oy <= fp.h; oy += 3) {
      for (let ox = -fp.halfW; ox <= fp.halfW; ox += 3) {
        total += 1;
        const px = x + ox;
        const py = y - oy;
        const hit = occluders.some((o) => (o.rect
          ? px >= o.rect.x0 && px <= o.rect.x1 && py >= o.rect.y0 && py <= o.rect.y1
          : (this._spriteAlphaAt(o.sprite, px, py) || 0) > 24));
        if (hit) hits += 1;
      }
    }
    return total ? hits / total : 0;
  }

  /**
   * The monitor/laptop rig that belongs on this desk. Clutter is supposed to
   * sit on that same surface (and draws just in front of it). Counting the
   * rig as an occluder rejected every corner of a stock workstation.
   * A neighbor's setup, still centered on the next desk, keeps blocking.
   */
  _isOwnDeskSetup(it, deskSprite, deskInstanceId) {
    const id = String(it?.id || '');
    if (!/desk_setup|monitor|laptop|keyboard/i.test(id) || /floor/i.test(id)) return false;
    if (deskInstanceId && it.parentInstanceId === deskInstanceId) return true;
    const reach = (deskSprite?.displayWidth || 96) * 0.35;
    return Math.abs((it.sprite?.x ?? 0) - (deskSprite?.x ?? 0)) <= reach;
  }

  /** Texture alpha under a world point (null when the renderer can't say). */
  _spriteAlphaAt(sprite, wx, wy) {
    const tex = this.scene?.textures;
    if (!sprite?.frame || typeof tex?.getPixelAlpha !== 'function') return null;
    try {
      if (sprite.rotation) {
        const b = sprite.getBounds?.();
        return b?.contains?.(wx, wy) ? 255 : 0;
      }
      const w = sprite.width || sprite.frame.realWidth || 0;
      const h = sprite.height || sprite.frame.realHeight || 0;
      let lx = (wx - sprite.x) / (sprite.scaleX || 1) + (sprite.originX ?? 0.5) * w;
      let ly = (wy - sprite.y) / (sprite.scaleY || 1) + (sprite.originY ?? 0.5) * h;
      if (sprite.flipX) lx = w - lx;
      if (sprite.flipY) ly = h - ly;
      if (lx < 0 || ly < 0 || lx >= w || ly >= h) return 0;
      const px = Math.min(w - 1, Math.floor(lx));
      const py = Math.min(h - 1, Math.floor(ly));
      return tex.getPixelAlpha(px, py, sprite.texture?.key, sprite.frame.name) || 0;
    } catch (_) {
      return null;
    }
  }

  _spawnDeskProp(kind, slot, deskSprite) {
    const add = this.scene?.add;
    if (!add) return null;
    try {
      let prop;
      if (kind === 'mug') {
        prop = add.sprite(slot.x, slot.y, 'vfx_coffee_mug', 0);
        // Mug body ends on row 25 of the 16x32 frame; steam rises above it.
        prop.setOrigin(0.5, 26 / 32);
        if (this._ensureDeskMugSteam()) {
          prop.play?.({ key: 'vfx_desk_mug_steam', startFrame: Math.floor(Math.random() * 7) });
        }
      } else {
        prop = add.image(slot.x, slot.y, 'vfx_desk_papers');
        prop.setOrigin(0.5, 1);
      }
      // Same band as stacked desk items: over the desk, under walking people.
      prop.setDepth((deskSprite?.depth || 2) + 8.2);
      return prop;
    } catch (_) {
      return null;
    }
  }

  _ensureDeskMugSteam() {
    const anims = this.scene?.anims;
    if (!anims?.create) return false;
    if (anims.exists?.('vfx_desk_mug_steam')) return true;
    try {
      anims.create({
        key: 'vfx_desk_mug_steam',
        frames: anims.generateFrameNumbers('vfx_coffee_mug', { frames: [0, 1, 2, 3, 4, 5, 0] }),
        frameRate: 5,
        repeat: -1,
        repeatDelay: 1400,
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Find an unoccupied couch/sofa (prefers breakroom).
   */
  _findFreeCouch(preferRoom = 'breakroom') {
    const items = this.scene?._interactables || [];
    const room = this.ROOMS[preferRoom];
    const occupied = new Set();
    this._sittingNpcs.forEach((data) => {
      if (data.chairSprite) occupied.add(data.chairSprite);
    });
    const couches = items.filter((it) => {
      if (!it?.sprite) return false;
      const id = String(it.id || '');
      const name = String(it.def?.name || '');
      const isCouch = /couch|sofa|loveseat|bench/i.test(id) || /couch|sofa/i.test(name)
        || (it.def?.type === 'seat' && /couch|sofa/i.test(id));
      if (!isCouch) return false;
      if (occupied.has(it.sprite)) return false;
      if (room) {
        const x = it.sprite.x, y = it.sprite.y;
        if (x < room.xMin - 20 || x > room.xMax + 20 || y < room.yMin - 20 || y > room.yMax + 40) {
          return false;
        }
      }
      return true;
    });
    if (!couches.length) return null;
    return couches[Math.floor(Math.random() * couches.length)];
  }

  /**
   * chillInBreakroom(npcKey) - Go chill: sit on a couch when free, else hang near one.
   * Supports multiple people — each picks a free couch/spot.
   */
  chillInBreakroom(npcKey) {
    if (this._sittingNpcs.has(npcKey)) this._standUpNpc(npcKey);
    const couch = this._findFreeCouch('breakroom');
    if (couch) {
      return this.sitAt(npcKey, couch.instanceId || couch.id).then(() => {
        this.emote(npcKey, 'happy');
      });
    }
    // Soft lounge near coffee / room center if no free couch.
    return this.goToBreakroom(npcKey).then(() => {
      const npc = this._getNpc(npcKey);
      if (!npc) return;
      npc.ai.taskState = 'chilling';
      this.emote(npcKey, 'happy');
    });
  }

  /**
   * Find seats inside manager_office for 1:1 / small group.
   */
  _findManagerOfficeSeats() {
    const room = this.ROOMS.manager_office;
    if (!room || !this.scene?._interactables) return [];
    const occupied = new Set();
    this._sittingNpcs.forEach((data) => {
      if (data.chairSprite) occupied.add(data.chairSprite);
    });
    return this.scene._interactables.filter((it) => {
      if (!it?.sprite) return false;
      const isSeat = it.def?.type === 'seat' || /chair|seat|stool|couch|sofa/i.test(String(it.id || ''));
      if (!isSeat) return false;
      const x = it.sprite.x, y = it.sprite.y;
      if (x < room.xMin || x > room.xMax || y < room.yMin || y > room.yMax) return false;
      return !occupied.has(it.sprite);
    }).sort((a, b) => a.sprite.x - b.sprite.x || a.sprite.y - b.sprite.y);
  }

  /**
   * inviteToManagerOffice(hostKey, guestKeys) - Host (usually Abby) collects
   * 1–3 people and brings them into the manager office for a sit-down.
   */
  inviteToManagerOffice(hostKey, guestKeys = []) {
    const guests = (guestKeys || []).filter((k) => k && k !== hostKey).slice(0, 3);
    if (!guests.length) return this.goToRoom(hostKey, 'manager_office');

    const chain = Promise.resolve();
    // Host stands and greets the first guest, then everyone files into the office.
    return chain
      .then(() => this.standUp(hostKey))
      .then(() => this.visit(hostKey, guests[0]))
      .then(() => this.speakTo(hostKey, guests[0], guests.length > 1
        ? 'Got a minute? Quick huddle in my office.'
        : 'Got a minute? Step into my office.'))
      .then(() => {
        const moves = [this.goToRoom(hostKey, 'manager_office')];
        guests.forEach((g, i) => {
          moves.push(
            this.standUp(g).then(() =>
              this.scene.time.delayedCall
                ? new Promise((r) => this.scene.time.delayedCall(400 * (i + 1), r))
                : Promise.resolve()
            ).then(() => this.goToRoom(g, 'manager_office'))
          );
        });
        return Promise.all(moves);
      })
      .then(() => {
        const seats = this._findManagerOfficeSeats();
        const sitters = [hostKey, ...guests];
        const sits = [];
        sitters.forEach((k, i) => {
          if (seats[i]) sits.push(this.sitAt(k, seats[i].instanceId || seats[i].id));
        });
        return Promise.all(sits);
      });
  }

  /**
   * approachManagerOffice(npcKey) - Walk toward Abby's office (doorway area).
   * Caller decides busy-gate / conversation.
   */
  approachManagerOffice(npcKey) {
    if (this._sittingNpcs.has(npcKey)) this._standUpNpc(npcKey);
    const room = this.ROOMS.manager_office;
    // Doorway approach on the open-office side of the manager office.
    let x = (room?.xMin || 880) - 24;
    let y = ((room?.yMin || 80) + (room?.yMax || 240)) / 2;
    const pf = this.scene?._pathfinder;
    if (pf?.findWalkableNear) {
      const s = pf.findWalkableNear(x, y, 48);
      if (s) { x = s.x; y = s.y; }
    }
    return this.walkTo(npcKey, x, y);
  }


  update() {
    // Keep "follow me" NPCs glued to the player.
    this._tickFollow();

    const updateMap = (map, yOffset) => {
      map.forEach((entry) => {
        if (entry.npc && entry.text && !entry.text.scene) return;
        if (entry.npc && entry.text) {
          entry.text.x = entry.npc.x;
          const off = entry.isThought ? 44 : (entry.yOff != null ? entry.yOff : yOffset);
          entry.text.y = entry.npc.y - off;
        }
      });
    };

    updateMap(this._speechBubbles, 48);
    updateMap(this._emoteBubbles, 56);
    updateMap(this._roleLabels, 34);

    this._typingIndicators.forEach((entry) => {
      if (entry.npc && entry.text) {
        entry.text.x = entry.npc.x;
        entry.text.y = entry.npc.y - 36;
      }
    });

    // Keep sitting NPCs from being moved by Y-sort (lock their depth)
    this._sittingNpcs.forEach((sitData, npcKey) => {
      const npc = this._getNpc(npcKey);
      if (!npc) return;

      const chairDepth = sitData.chairSprite?.depth;
      if (chairDepth != null) {
        if (sitData.chairInfo?.backFacing) {
          npc.setDepth(chairDepth - 0.5);
        } else {
          npc.setDepth(chairDepth + 0.5);
        }
      }
    });
  }
}

window.AgentActions = AgentActions;
