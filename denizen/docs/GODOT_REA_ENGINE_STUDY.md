# Godot × REA engine study (for an AI game engine)

> Status: **Phase 1 complete** (REA artifact + historical source + binary string evidence).  
> Phase 2 (full Ghidra decompile of the 123 MB editor) was started; first pass hit
> REA’s default 330 s startup deadline; a longer run (`REA_GHIDRA_STARTUP_TIMEOUT_MS=1800000`)
> was left importing under AnalyzeHeadless.

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
- Full native decompile is optional polish; **source + ClassDB/strings already give the study you need to design an AI engine.**

## Related Denizen docs

- [SCENE_RUNTIME.md](SCENE_RUNTIME.md) (when merged) — frozen scene commands  
- [WORLD_ENGINE.md](WORLD_ENGINE.md) — seeded generators  
- [GROK_BOT_ACTIVITY_ROUTINES.md](GROK_BOT_ACTIVITY_ROUTINES.md) — agent feed routines  
- [NPC_MCP_GATEWAY.md](NPC_MCP_GATEWAY.md) — MCP tool surface  
