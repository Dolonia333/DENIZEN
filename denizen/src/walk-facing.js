/**
 * Walk-cycle facing.
 * A grid path plus a small separation shove makes vx and vy trade places
 * for a frame or two. Restarting the sprite on each trade looks like the
 * character glitches. Hold the current facing until one axis is clearly
 * ahead, and don't flip between the step cycle and the stand pose while
 * speed is hovering near the stop threshold.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DenizenWalkFacing = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function chooseFacing(current, vx, vy, opts) {
    const o = opts || {};
    const x = Number(vx) || 0;
    const y = Number(vy) || 0;
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    const speed = Math.hypot(ax, ay);
    const moveOn = o.moveOn == null ? 10 : o.moveOn;
    const moveOff = o.moveOff == null ? 3.5 : o.moveOff;
    let moving = !!o.wasMoving;
    if (speed >= moveOn) moving = true;
    else if (speed <= moveOff) moving = false;

    const bias = o.bias == null ? 1.35 : o.bias;
    const cur = current || 'down';
    let desired = cur;
    if (ax > ay * bias && ax > 0.5) desired = x < 0 ? 'left' : 'right';
    else if (ay > ax * bias && ay > 0.5) desired = y < 0 ? 'up' : 'down';

    const now = Number(o.now) || 0;
    const holdMs = o.holdMs == null ? 160 : o.holdMs;
    let holdUntil = Number(o.holdUntil) || 0;
    let facing = cur;
    if (desired !== cur && now >= holdUntil) {
      facing = desired;
      holdUntil = now + holdMs;
    }
    return { facing, moving, holdUntil, desired };
  }

  return { chooseFacing };
});
