# Godot × REA engine study (for an AI game engine)

> Status: **Phase 2 deep internals** (source of the hot path).  
> The Linux editor ELF is **stripped** (`file`: no `.symtab`). Ghidra 12.1.4 via REA
> imported it and entered full analysis (`ANALYZING all memory` at 04:29:53 UTC);
> decompiler switch analysis was still running after ~15 minutes. Unnamed `FUN_*`
> output is less useful than the MIT source below — that source **is** the deepest
> accurate model.

**Targets (official, MIT-licensed):**

| Artifact | Identity |
|----------|----------|
| Source | [godotengine/godot](https://github.com/godotengine/godot) tag `4.4.1-stable` @ `49a5bc7b` |
| Binary | `Godot_v4.4.1-stable_linux.x86_64` SHA-256 `54215149d52efb1d653a3dec39d0993587bdf5daa2c56e787b5ee88417fb1339` (~123 MiB ELF64) |
| Tooling | [REA](https://github.com/morluto/rea) `rea-agents@6.7.0` + Ghidra 12.1.4 |

This is a **legitimate open-source study** (clone + analyze). It is **not** a crack of a closed engine.

---

## 1. Method

```
rea-agents doctor
rea inspect-artifact  Godot_v4.4.1-stable_linux.x86_64   # ELF carrier, no embedded PCK
rea import-reference-source  godot/  --detail summary     # 12 276 files / ~250 MiB source
readelf + strings                                         # ELF header + subsystem symbols
rea analyze … --provider ghidra                           # native (long; see §7)
```

Evidence kept under `/tmp/godot-rea-study/evidence/` in the study environment
(`godot-source-summary.json`, `artifact-inline.json`, `strings-*.txt`, `readelf-*.txt`).

---

## 2. What REA found on the binary

### Artifact graph (`inspect-artifact`)

- Format: **ELF** executable, single root node (no child container / no trailing Godot PCK).
- Size: **128 294 320** bytes; content SHA-256 matches release zip member.
- Limitation recorded by REA: *“Artifact has no child container entries.”*  
  Expected for the **editor binary** (game `.pck` packs are separate; REA’s
  `inspect-artifact` on `.pck` is the path for exported games).

### ELF header (`readelf -h`)

| Field | Value |
|-------|--------|
| Class | ELF64 |
| Type | EXEC |
| Machine | x86-64 |
| Entry | `0x442950` |
| Sections | 32 |

### Strings / mangled symbols (subsystem proof in the ship binary)

Demangled fragments prove the **Servers + RID** model is in the shipping editor:

- `RenderingServer::*` (viewport, light, particles, canvas, environment, …)
- `PhysicsServer2D::*` (body/joint/space params, CCD, …)
- `PackedScene`, `ResourceLoader`, `res://` path machinery
- ClassDB / MethodBind glue (`MethodBindTIJ3RID…`) → reflection surface agents can mirror

---

## 3. What REA found on the source tree

`import-reference-source` summary (authority: **historical-reference**):

| Metric | Value |
|--------|------:|
| Files | 12 276 |
| Directories | 936 |
| Hashed bytes | ~262 MiB |
| Git HEAD | `49a5bc7b616bd04689a2c89e89bda41f50241464` |
| Top languages | C++, C, C#, Python, Java, JS, ObjC, … |

### Layer map (directories REA outlined)

```
main/          — lifecycle / MainLoop bootstrap
core/          — Object, ClassDB, Variant, IO, RID, OS
servers/       — Rendering, Physics2D/3D, Navigation, Audio, Display, XR…
scene/         — Node / SceneTree / 2D / 3D / GUI / resources / animation
editor/        — import, atlas packer, export, plugins, inspectors
modules/       — gdscript, gltf, navigation, physics, mono, xatlas_unwrap…
drivers/       — vulkan, gles3, metal, d3d12, audio backends…
platform/      — linuxbsd, windows, macos, android, ios, web
thirdparty/    — vulkan, jolt, freetype, xatlas, …
```

Approximate C/C++ file counts (study environment):

| Tree | Files |
|------|------:|
| `scene/` | 622 |
| `editor/` | 585 |
| `modules/` | 787 |
| `core/` | 368 |
| `servers/` | 303 |
| `platform/` | 259 |

### Confirmed class anchors (headers)

| Concept | Header |
|---------|--------|
| `SceneTree : MainLoop` | `scene/main/scene_tree.h` |
| `Node : Object` | `scene/main/node.h` |
| `RenderingServer` | `servers/rendering_server.h` |
| `PhysicsServer2D` | `servers/physics_server_2d.h` |
| `ResourceLoader` | `core/io/resource_loader.h` |
| `ClassDB` | `core/object/class_db.h` |
| Atlas tooling | `editor/editor_atlas_packer.{h,cpp}` |
| Import dock | `editor/import*` |

---

## 4. What makes Godot a game engine (compressed model)

Godot is **not** ECS-first. It is:

1. **MainLoop → SceneTree** — frame/physics ticks, pause, groups  
2. **Node tree** — composition + scene inheritance (nested prefabs)  
3. **Servers + RIDs** — low-level render/physics/nav/audio APIs; nodes are high-level façades  
4. **Resources + `res://`** — `ResourceLoader` / `PackedScene` serialization  
5. **ClassDB** — runtime type/method registry (scripting + editor)  
6. **Editor as first-class** — import pipeline, atlas packer, export, inspectors  
7. **Modules** — optional features (GDScript, GLTF, physics backends, …)

That split (**scene optional-in-theory, servers required**) is the design to copy for an AI engine: expose **stable server-like verbs** to agents, keep the scene as one consumer.

Official docs: [architecture diagram](https://docs.godotengine.org/en/stable/engine_details/architecture/godot_architecture_diagram.html), [design philosophy](https://docs.godotengine.org/en/stable/getting_started/introduction/godot_design_philosophy.html), [servers](https://docs.godotengine.org/en/stable/tutorials/performance/using_servers.html).

---

## 5. Competitive takeaway (honest)

| Engine | Strength | Weakness for “AI office world” |
|--------|----------|--------------------------------|
| **Godot** | Open, scene+servers, great 2D, editor scripts | Not agent-native; GDScript/editor still human-centered |
| **Unity** | Ecosystem, tooling | Closed; don’t crack — license or skip |
| **Unreal** | High-end 3D | Overkill for pixel office |
| **Phaser (Denizen today)** | Already in production office | Thin tooling; no ClassDB/import/atlas editor |
| **Bevy** | Rust ECS, code-first | Steeper for asset/editor workflows |

For Denizen, **Godot wins as the open textbook**. Runtime can stay Phaser until the agent API is solid; optionally migrate later.

---

## 6. Steal list → Denizen “AI game engine”

Map Godot ideas to MCP / runtime tools (build these next):

| Godot idea | AI-facing Denizen tool |
|------------|------------------------|
| Scene instance / `PackedScene` | `office_spawn_prefab` / place furniture from catalog |
| Node groups | `office_query_group` (`npcs`, `desks`, `doors`) |
| `RenderingServer` / transform | `office_walk_to`, camera/look snapshot |
| `PhysicsServer2D` | blockers / `setBlockers` already sketched in scene-runtime |
| `ResourceLoader` + import | **Asset Factory**: classify → cut → sheet → catalog JSON |
| `EditorAtlasPacker` | `atlas_pack` skill (wrap existing `build-ext-atlas`) |
| ClassDB methods | Frozen MCP command catalog (`spawn`, `navigate`, `use`, …) |
| Editor import dock | Watched `assets/inbox/` → auto-catalog proposals |

**Asset pipeline (sprites / shirts / sheets / rooms)** aligns with Godot’s
`editor/import` + `editor_atlas_packer` + `scene/resources` — implement as
skills/MCP, not as a GDScript port.

---

## 7. Ghidra / native status

| Pass | Result |
|------|--------|
| Default `rea analyze --provider ghidra` | `provider_timeout` at **330 000 ms** (binary too large for default deadline) |
| Extended timeout (30 min) | AnalyzeHeadless **running** (`-Xmx2G`, decompiler child active); snapshot path reserved |

When the long pass finishes, re-query with:

```bash
export GHIDRA_INSTALL_DIR=/path/to/ghidra_12.1.4_PUBLIC
export REA_GHIDRA_STARTUP_TIMEOUT_MS=1800000
rea analyze Godot_v4.4.1-stable_linux.x86_64 --provider ghidra \
  --snapshot godot-ghidra.snapshot.json --json
rea search Godot_v4.4.1-stable_linux.x86_64 "SceneTree" --provider ghidra --json
rea function Godot_v4.4.1-stable_linux.x86_64 SceneTree::process --provider ghidra --json
```

For **exported games**, prefer `rea inspect-artifact game.pck` (formats 2–4) over the editor ELF.

---

## 8. Reproduce locally

```bash
npx -y rea-agents@latest doctor
# Install Ghidra 12.1.x; set GHIDRA_INSTALL_DIR
git clone --depth 1 --branch 4.4.1-stable https://github.com/godotengine/godot.git
# Download Linux editor zip from Godot 4.4.1 release
rea import-reference-source ./godot --detail summary --outline-depth 2 --json > godot-source.json
rea inspect-artifact ./Godot_v4.4.1-stable_linux.x86_64 --json > godot-elf.json
```

Optional: `npx rea-agents setup` to register REA MCP in Cursor/Grok for interactive follow-ups.

---

## 9. Bottom line

- REA **did** inventory the Godot editor ELF and **fully imported** the 4.4.1 source graph.  
- Architecture to copy for AI: **Servers/RID verbs + scene composition + resource/import pipeline + ClassDB-like command surface**.  
- Denizen should become that surface via MCP (office body + asset factory), using Godot as the open reference — not as a cracked binary clone.  
- Full native decompile of the **stripped** editor yields unnamed functions and is still running under Ghidra; the **source hot path below is the deep study**.

---

## 10. Deep internals (4.4.1 source)

The shipping ELF has **no symbol table**. Ghidra is analyzing code, not recovering C++ names. These are the mechanisms an AI engine should copy.

### Frame loop — `SceneTree::_process` (`scene/main/scene_tree.cpp`)

1. Drop groups marked `removed`, then re-sort by process-thread order.
2. Snapshot `group_count` so groups added mid-frame are ignored until next frame.
3. For each process group: sort nodes by `process_priority` if dirty, **copy the node vector**, then notify.
4. Physics path: `NOTIFICATION_INTERNAL_PHYSICS_PROCESS` then `NOTIFICATION_PHYSICS_PROCESS`.
5. Idle path: `NOTIFICATION_INTERNAL_PROCESS` then `NOTIFICATION_PROCESS`.
6. Nodes removed during the call are skipped via `nodes_removed_on_group_call`.
7. `call_queue.flush()` before **and** after the group (deferred calls).
8. Groups flagged `PROCESS_THREAD_GROUP_SUB_THREAD` run on `WorkerThreadPool` and are joined before the next order band.
9. `PhysicsServer2D::set_active` follows suspend/pause so the server loop and the scene loop stay coupled.

**AI engine lesson:** one ordered tick, copy-on-iterate, deferred queue, physics vs idle split. Denizen’s Phaser `update()` should grow the same contract (process groups + deferred commands), not a pile of ad-hoc `setInterval`s.

### Entering the world — `Node::_propagate_enter_tree` (`scene/main/node.cpp`)

- Depth = parent depth + 1; viewport inherited from parent.
- `inside_tree = true` **before** notifications.
- Re-register every group on the tree.
- Order: `ENTER_TREE` → virtual `_enter_tree` → signal `tree_entered` → `node_added` → parent `child_entered_tree` → children (pre-order).
- `_propagate_ready` is **post-order**: children ready first, then `POST_ENTER_TREE` + `READY` once (`ready_first`).

**AI engine lesson:** spawn is not “add sprite”. It is enter-tree (groups, viewport, parent notify) then ready (children first). MCP `spawn` should do both phases.

### RID — stable server handles (`core/templates/rid.h`, `rid_owner.h`)

- `RID` is a `uint64_t`. Local index is the low 32 bits.
- Owner slot stores a **validator** in the high 32 bits (`_gen_id() & 0x7FFFFFFF`).
- High bit `0x80000000` means uninitialized until first `get_or_null(..., initialize=true)`.
- `get_or_null` rejects mismatched validator (use-after-free) and `0xFFFFFFFF` free slots.

**AI engine lesson:** furniture/NPC ids should be generation-counted handles, not raw array indexes, so agents can’t poke a deleted desk.

### Resource binary — `RSRC` (`core/io/resource_format_binary.cpp`)

- Magic bytes `RSRC` written at the **end** of the file as well as the header path (`store_buffer("RSRC")`).
- `FORMAT_VERSION = 6` in 4.4.1. Loader refuses `ver_format > 6` or a newer `ver_major`.
- Import metadata offset, UID, dependency rename (format ≥ 1), NodePath property change (format ≥ 3).

**AI engine lesson:** Denizen catalog JSON is the friendly form; a versioned binary blob with a trailing magic (like RSRC) is how you ship packed rooms without a text parse every boot.

### PCK — `FileAccessPack` (`core/io/file_access_pack.cpp`)

- Magic `PACK_HEADER_MAGIC = 0x43504447` (`GDPC` little-endian).
- This tree’s `PACK_FORMAT_VERSION` is **2** (matches REA’s note that 4.4.1 emits format 2).
- Search order: embedded `pck` section, else **EOF trailer** (last 4 bytes magic, then 8-byte size back to header). REA’s PCK reader follows this same loader.
- After magic: `version`, `ver_major`, `ver_minor`, unused patch, `pack_flags`, `file_base` u64, 16 reserved u32s, `file_count`.
- Flags: `PACK_DIR_ENCRYPTED` (bit 0), `PACK_REL_FILEBASE`. Encrypted directories go through `FileAccessEncrypted` — REA **does not decrypt**.
- Directory key is MD5 of the path with `res://` stripped (`PathMD5`).

**AI engine lesson:** one content pack (office + sprites) addressed by path hash, with optional encryption you do not pretend to break.

### Atlas packer — `EditorAtlasPacker::chart_pack`

- Rasterize chart AABBs into bitmaps divided by `min(64, cell_resolution)`.
- Plot triangle edges with Bresenham, optional transpose if taller than wide.
- Shelf-pack into a power-of-two atlas capped by `atlas_max_size`.
- Write `final_offset` + `transposed` back onto each chart.

**AI engine lesson:** Denizen’s `build-ext-atlas` should grow the same contract: input rects → power-of-two page → frame table (`x,y,w,h`) that `DenizenSceneRuntime.setupAtlas` already consumes. Shirt cutouts are charts; sheets are the packed page.

### What Ghidra added beyond the source

| Observation | Meaning |
|-------------|---------|
| ELF stripped | No `SceneTree::` symbols for `nm` |
| Import 04:29:50 | Loader `x86:LE:64:default:gcc` |
| `ANALYZING` 04:29:53 | Full-memory auto-analysis, not a quick header dump |
| PNG datatype errors at `05795f20` etc. | Embedded image blobs, not a pack of scenes |
| Decompiler switch restart 04:36:53 | Still inside analysis; not a finished function catalog |

When that job exits, `godot-ghidra.snapshot.json` can be re-queried. It will not beat the source for names.

## Related Denizen docs

- [SCENE_RUNTIME.md](SCENE_RUNTIME.md) (when merged) — frozen scene commands  
- [WORLD_ENGINE.md](WORLD_ENGINE.md) — seeded generators  
- [GROK_BOT_ACTIVITY_ROUTINES.md](GROK_BOT_ACTIVITY_ROUTINES.md) — agent feed routines  
- [NPC_MCP_GATEWAY.md](NPC_MCP_GATEWAY.md) — MCP tool surface  
