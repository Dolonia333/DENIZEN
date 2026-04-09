/**
 * Tests for the OfficePathfinder class (src/pathfinding.js)
 *
 * The source file assigns classes to `window`, so we set up a global
 * window object before loading the script.
 */

// Provide a minimal `window` global so the script can attach its exports
global.window = global.window || {};

// Load the source file — it will set window.OfficePathfinder, window.NpcPathFollower
require('../src/pathfinding.js');

const OfficePathfinder = window.OfficePathfinder;

describe('OfficePathfinder', () => {
  // Create a small 160x160 world with 16px cells = 10x10 grid
  let pf;

  beforeEach(() => {
    pf = new OfficePathfinder(160, 160, 16);
    // Grid starts fully walkable (all zeros)
  });

  // ── Construction ──────────────────────────────────────────────────

  test('initializes grid dimensions correctly', () => {
    expect(pf.cols).toBe(10);
    expect(pf.rows).toBe(10);
    expect(pf.grid.length).toBe(100);
  });

  // ── Coordinate conversion ─────────────────────────────────────────

  test('toGrid converts pixel coords to grid coords', () => {
    expect(pf.toGrid(0, 0)).toEqual({ x: 0, y: 0 });
    expect(pf.toGrid(24, 40)).toEqual({ x: 1, y: 2 });
    expect(pf.toGrid(159, 159)).toEqual({ x: 9, y: 9 });
  });

  test('toPixel converts grid coords to pixel center', () => {
    expect(pf.toPixel(0, 0)).toEqual({ x: 8, y: 8 });
    expect(pf.toPixel(5, 3)).toEqual({ x: 88, y: 56 });
  });

  // ── isWalkable ────────────────────────────────────────────────────

  test('all cells start as walkable', () => {
    expect(pf.isWalkable(0, 0)).toBe(true);
    expect(pf.isWalkable(5, 5)).toBe(true);
  });

  test('out-of-bounds cells are not walkable', () => {
    expect(pf.isWalkable(-1, 0)).toBe(false);
    expect(pf.isWalkable(0, -1)).toBe(false);
    expect(pf.isWalkable(10, 0)).toBe(false);
    expect(pf.isWalkable(0, 10)).toBe(false);
  });

  test('blocked cells are not walkable', () => {
    pf.grid[5 * 10 + 5] = 1; // block cell (5,5)
    expect(pf.isWalkable(5, 5)).toBe(false);
    expect(pf.isWalkable(4, 5)).toBe(true); // neighbor still walkable
  });

  // ── _blockRect ────────────────────────────────────────────────────

  test('_blockRect marks cells as blocked', () => {
    // Block a 32x32 pixel area starting at (32, 32) — should cover grid cells around (2,2)
    pf._blockRect(32, 32, 32, 32);
    // The cell at grid (2,2) = pixel (32,32) should be blocked
    expect(pf.isWalkable(2, 2)).toBe(false);
    // Cells far away should still be walkable
    expect(pf.isWalkable(8, 8)).toBe(true);
  });

  // ── findPath — basic ──────────────────────────────────────────────

  test('findPath returns an array of waypoints for a valid path', () => {
    const path = pf.findPath(8, 8, 136, 136); // (0,0) to (8,8) in grid
    expect(path).not.toBeNull();
    expect(Array.isArray(path)).toBe(true);
    expect(path.length).toBeGreaterThan(0);
    // Each waypoint should have x and y
    path.forEach(wp => {
      expect(wp).toHaveProperty('x');
      expect(wp).toHaveProperty('y');
    });
  });

  test('findPath returns empty array when start equals end', () => {
    const path = pf.findPath(40, 40, 40, 40);
    expect(path).toEqual([]);
  });

  // ── findPath — blocked cells ──────────────────────────────────────

  test('findPath routes around blocked cells', () => {
    // Block a wall across the middle: row 5, columns 0-8
    for (let x = 0; x <= 8; x++) {
      pf.grid[5 * 10 + x] = 1;
    }
    // Leave column 9 open as a gap
    // Path from top to bottom must go through the gap at column 9
    const path = pf.findPath(8, 8, 8, 136); // grid (0,0) -> grid (0,8)
    expect(path).not.toBeNull();
    expect(path.length).toBeGreaterThan(0);
  });

  // ── findPath — unreachable destination ────────────────────────────

  test('findPath returns null when destination is completely unreachable', () => {
    // Surround cell (5,5) with blocked cells on all sides
    const cx = 5, cy = 5;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        pf.grid[(cy + dy) * 10 + (cx + dx)] = 1;
      }
    }
    // Also block (5,5) itself so _nearestWalkable search from there
    // has no adjacent walkable cell within range
    pf.grid[cy * 10 + cx] = 1;

    // Block a larger area to make _nearestWalkable fail
    for (let r = 2; r <= 9; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx >= 0 && nx < 10 && ny >= 0 && ny < 10) {
            pf.grid[ny * 10 + nx] = 1;
          }
        }
      }
    }

    // Now the destination area is fully blocked
    const path = pf.findPath(8, 8, 88, 88);
    expect(path).toBeNull();
  });

  // ── findPath — adjacent cells ─────────────────────────────────────

  test('findPath handles adjacent start and end cells', () => {
    // Start at pixel (8,8) = grid(0,0), end at pixel (24,8) = grid(1,0)
    const path = pf.findPath(8, 8, 24, 8);
    expect(path).not.toBeNull();
    // Should be a very short path
    expect(path.length).toBeLessThanOrEqual(2);
  });

  // ── _nearestWalkable ──────────────────────────────────────────────

  test('_nearestWalkable finds a nearby walkable cell', () => {
    pf.grid[5 * 10 + 5] = 1; // block (5,5)
    const result = pf._nearestWalkable(5, 5);
    expect(result).not.toBeNull();
    expect(pf.isWalkable(result.x, result.y)).toBe(true);
  });

  // ── MinHeap (exposed via window) ──────────────────────────────────
  // MinHeap is used internally by A* but not exported. We test it
  // indirectly through findPath above. That's sufficient.
});
