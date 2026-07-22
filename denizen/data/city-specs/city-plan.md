# Denizen City District Plan
### Fitting all 31 hero + 16 strong LimeZu Modern Exteriors scenes into one coherent map

Companion data: `scene-specs.json` (same folder). Scene numbers below refer to gallery files (`00.gif` = scene 00, etc.).

---

## 1. Canvas expansion

| | Width | Height |
|---|---|---|
| Current world | 4096 | 3072 |
| **New world** | **6144** | **5632** |

- The existing 4096x3072 map stays untouched at the top-left (0,0)-(4096,3072). Nothing already built moves: east-west avenue at y=1880, plaza at (640, 2000-2800), Denizen HQ at x=1200 on the avenue, Japanese retreat NW, security complex W, news studio NE, helipad SE at (3400,2400).
- **East expansion band**: x 4096-6144, y 0-3072 (forest outskirts, industry, military).
- **South expansion band**: y 3072-5120, full width (residential, parks, beach).
- **Underground strip**: y 5120-5632, x 0-4096 — the subway network, visually separated from the surface by a solid divider band. Reached only via station entrances (teleport/stairs), so it reads as "underground" without a second map file.
- The avenue at y=1880 extends east to x=6144 (becomes the highway out of town past the gas station). A new north-south boulevard at x≈3800 connects the avenue down into the south band and is the residential/park spine.

---

## 2. Districts

### D1 — Main Street Retail (downtown core)
- **BBox**: (1600, 1560) - (3300, 2260), straddling the existing avenue (y=1880); HQ at x=1200 sits at its western gate.
- **Scenes realized**: 31 (main-street block with walkable rooftop, ice cream + bakery), 64 (MARKET block with T-intersection), 25 (hardware store row, fire escapes), 01 (townhouse plaza with vendor carts + pocket park), 05 (construction site as an infill lot at the SE corner — "downtown is still growing").
- **Key animations**: traffic lights cycling, cars driving/parking, billboard flicker, rooftop laundry sway, AC fans, vendor awnings, scissor lift + cement mixer on the construction lot.

### D2 — Shopping Center & Parking
- **BBox**: (3200, 1100) - (4090, 1860), north side of the avenue, south of the news studio.
- **Scenes realized**: 07 + 55 merged into ONE shopping center (they are the same building in two renders — use 55 as ground truth, 07 for animation cues), 23 (the surface parking lot + EV bays fills the east side of the lot and doubles as the mall's parking).
- **Key animations**: sliding doors, glass elevator cab, boom barriers at the underground ramp, billboard ad cycling, EV charger blink, cars pulling in/out.

### D3 — Station Square & Grand Hotel
- **BBox**: (2200, 700) - (3300, 1560), directly north of D1.
- **Scenes realized**: 36 (train station + clock tower, forecourt faces south into the square), 57 (grand landmark building as the "City Museum" on the square's west side), 30 (HOTEL facade on the east side), 22 (post office tucked on the square's SE corner, its delivery trucks route onto the avenue).
- **Key animations**: clock ticking, flag waving, HOTEL marquee twinkle, bellhop trolley loop, envelope-sign arrows, DeliVery truck circuit.

### D4 — Plaza Food Market & Canal
- **BBox**: (400, 2000) - (1500, 3060) — extends the EXISTING plaza south to the map edge.
- **Scenes realized**: 35 (food-truck plaza occupies the plaza's south half), 27 (mushroom/ice-cream-cone/coffee-cup kiosks dotted around the existing plaza + info booth), 26 (the sunken teal canal cut along y 2900-3060 with railed embankments and stair descents; 26's hardware store is already realized in D1 so only the canal/kiosk/rooftop-terrace halves are used here), 04 (garage-sale yard on the plaza's west edge as a weekly flea-market corner).
- **Key animations**: canal water shimmer, food-truck steam, kiosk heart-signs pulsing, delivery robots trundling, fountain spray, pigeons.

### D5 — Civic Safety Campus
- **BBox**: (3300, 1900) - (4090, 3060), south side of the avenue, wrapping the EXISTING helipad at (3400,2400).
- **Scenes realized**: 40 (police HQ, NW corner, near the security complex's line of sight), 48 (fire station facing the avenue), 32 (hospital, south half with its own rooftop helipad), 34 (upgrade of the existing helipad into the fenced rescue pad — shared by hospital + police).
- **Key animations**: helicopter rotors, searchlight sweeps, ambulance/police light bars, EMERGENCY sign pulse, garage bay doors, gurney runs.

### D6 — Residential District
- **BBox**: (200, 3200) - (2200, 4400), west of the south boulevard.
- **Scenes realized**: 62 (modular suburb — the street grid backbone), 08 (family home with play-yard), 66 (red-brick apartment with rooftop garden/laundry), 00 (apartment-block playground square), 43 (grand mansion on a hill lot at the NW, below the Japanese retreat), 37 (neighborhood playground with tube mazes), 56 (school PE yard, doubling as the school lot), 06 (one rundown/condemned corner at the SE edge, using 53 facades, as the "old block" transition toward the graveyard).
- **Key animations**: swings/slides/trampoline, laundry flapping, gardener + resident NPC loops, rats at the derelict corner, door open/close.

### D7 — Grand Park & Gardens
- **BBox**: (2200, 3200) - (3600, 4800), central south band; boulevard runs along its east edge.
- **Scenes realized**: 41 (formal hedge maze + fountains as the park's north entrance), 47 (waterfall/cliff nature zone in the middle, its stream feeds the D4 canal conceptually), 11 (forest basketball court), 12 (soccer pitch), 13 (outdoor gym), 65 (treehouse set piece in the SW grove).
- **Key animations**: four fountains, waterfall + pipe outflow, players dribbling/kicking, tire swing, hula hoops, pond shimmer.

### D8 — Beach & Boardwalk
- **BBox**: (3600, 3200) - (6100, 5100), the entire SE of the map; water fills the far south/east edges (21's buoy/rock props dress the open water).
- **Scenes realized**: 18 (beach cove: volleyball + shark bar), 19 (sand-sculpture strip + Beach signage), 09 (fishing pier network on the east water), 39 (pool/waterpark complex on the landward side, gated off the boulevard), 20 (concert stage on the sand at the south tip — Denizen's event venue), 21 (buoys, rocks, seagulls as water dressing).
- **Key animations**: whole-shoreline wave shimmer, floats bobbing, volleyball rally, laser/spotlight show, band + crowd loops, bobbers dipping, crabs scuttling.

### D9 — Graveyard (Old Cemetery)
- **BBox**: (200, 4400) - (1100, 5060), SW corner, behind the residential rundown block.
- **Scenes realized**: 49 (full walled cemetery + chapel; the friendly ghost sheet from the pack can haunt it).
- **Key animations**: torch flicker, bats, soul wisps, zombie/pumpkin-tree idles.

### D10 — Camping Forest & Highway Edge
- **BBox**: (4200, 200) - (6100, 1600), NE expansion band; dense tree fill.
- **Scenes realized**: 67 (gas station where the avenue/highway exits east, its "Camping" trailhead points north), 10 (trailer-park campsite up the trail), 65 (extra treehouses deep in the forest), 38 (wind power station in the far NE corner — visible turbines animate the skyline).
- **Key animations**: turbine blades, car wash rollers, price totem LEDs, campfire + bubbles, bees, apple drops.

### D11 — Industrial Yard
- **BBox**: (4200, 1600) - (5100, 2700), east band, south of the forest, fronting the extended avenue.
- **Scenes realized**: 14 (junkyard compound), 46 (sanitation depot corner — garbage trucks spawn here and do city rounds), 53 (spare condemned facades as yard-edge dressing).
- **Key animations**: burn-pile flame, compactor, garbage-truck route + compactor cycle, raccoon in trash can.

### D12 — Military Base
- **BBox**: (5100, 1600) - (6100, 2700), far east edge behind the industrial yard; single checkpoint gate onto the avenue.
- **Scenes realized**: 29 (walled compound: watchtower, hangars, barracks N01-N10), 58 (tents, bunkers, sandbag emplacement inside the walls), 59 (radar dome tower at the NE corner), 60 + 61 (tank and helicopter sprites parked/patrolling inside).
- **Key animations**: searchlight sweep, boom barriers, radar beacon blink, rotor spin-up, guard patrols.

### D13 — Subway Underground
- **BBox**: (0, 5120) - (4096, 5632), underground strip.
- **Scenes realized**: 16 (two-level station: grungy old platform west half, clean LME platform east half), 17 (grungy connector tunnel between them).
- **Entrances**: Station Square (D3, under the train station), Main Street (D1), Plaza (D4). Three stair/teleport pairs.
- **Key animations**: trains arriving, departure boards, busker + drummer, SOS light blink, vending glow.

### Cross-district systems (fillers, built once, used everywhere)
- **Traffic system**: 02, 03, 15, 24 — traffic lights, intersections, drivable cars, taxi. Powers D1/D2/D5/D10 roads.
- **Sanitation**: 46 trucks route D11 → D1 → D6.
- **Drones**: 28 — delivery drones fly between the D3 post office and districts.
- **Water dressing**: 21 across D8.

---

## 3. Build order

1. **Phase 1 — Main Street Retail (D1)**: scenes 31, 64, 25, 01, 05 + traffic system (02/03/15/24). Establishes the downtown look and the road/NPC systems everything else reuses.
2. **Phase 2 — Shopping Center & Parking (D2)**: 07/55 merged + 23.
3. **Phase 3 — Station Square (D3)**: 36, 57, 30, 22.
4. **Phase 4 — Plaza Market & Canal (D4)**: 35, 27, 26 (canal), 04.
5. **Phase 5 — Civic Safety (D5)**: 40, 48, 32, 34 (helipad upgrade).
6. **Phase 6 — Residential (D6)**: 62, 08, 66, 00, 43, 37, 56, 06 (+53 facades).
7. **Phase 7 — Grand Park (D7)**: 41, 47, 11, 12, 13, 65.
8. **Phase 8 — Beach & Boardwalk (D8)**: 18, 19, 09, 39, 20, 21.
9. **Phase 9 — Graveyard (D9)**: 49.
10. **Phase 10 — Subway (D13)**: 16, 17 + three entrances retrofit into D1/D3/D4.
11. **Phase 11 — Camping Forest (D10)**: 67, 10, 65, 38.
12. **Phase 12 — Industrial (D11)**: 14, 46, 53.
13. **Phase 13 — Military Base (D12)**: 29, 58, 59, 60, 61.

Rationale: retail first per direction (it anchors the avenue the whole city hangs off and forces the traffic/NPC systems into existence early); residential next so the city has inhabitants; then leisure districts outward; subway once three of its entrance districts exist; the self-contained outskirts (camping, industry, military) last since nothing depends on them.

---

## 4. Coverage check

- **Heroes (31)**: 00 01 05 07 08 10 14 16 18 20 22 23 26 30 31 32 35 36 37 38 39 40 41 43 47 48 49 55 56 57 62 64 66 67 — all placed. (07+55 merged; 26 split between D1/D4.)
- **Strongs (16)**: 04 06 09 11 12 13 17 19 25 27 29 34 58 59 65 — all placed (65 appears in D7 and D10).
- **Fillers (12)**: 02 03 15 21 24 28 46 53 60 61 — consumed as cross-district systems/props.
- **Skips (9)**: 33 42 44 45 50 51 52 54 63 — logo/UI assets, dropped from scene-specs.json.
