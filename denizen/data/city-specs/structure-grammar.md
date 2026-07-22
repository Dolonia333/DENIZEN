# City Structure Grammar — from the LimeZu full-city reference maps

Derived by directly studying gallery/26.png (the definitive assembled city map,
2444x1356) and gallery/50.png. These are the numeric rules our city must follow.

## The core rule the current city violates
**The urban core is CONTINUOUS PAVED GROUND** — light-grey sidewalk tile fills
the entire walkable city; buildings sit flush on it. There is NO grass showing
between buildings. Grass appears only as: hedge-dividers, rooftop gardens, and
dedicated parks/rural edges. Our districts were built as islands floating on the
default grass — that is the "no structure / everything looks broken" problem.

## Measured grammar (16px native tiles)
- **Roads**: dark asphalt, 3-4 tiles wide (~48-64px), white dashed centerline +
  dashed edge lines, ZEBRA CROSSWALKS at every intersection.
- **Sidewalk**: light-grey tile, 1-2 tiles wide beside every road, and it fills
  ALL space between roads and buildings. The paved plane is the city floor.
- **Buildings**: pack tight, flush to the sidewalk edge (0-1 tile setback),
  adjacent buildings nearly touch / share party walls. All face the street
  (doors south). Awnings overhang the sidewalk.
- **Props**: benches, lamps, hydrants, trash, ATMs, planters, hedges line the
  sidewalks — against building walls and along road edges, never floating.
- **Elevation**: real LimeZu cities use tiered platforms w/ retaining walls +
  ramps. (Advanced — we skip tiers for v1; flat paved core is the 80/20 win.)
- **Density gradient**: dense paved core → looser residential → grass parks →
  rural edge (farm, camping, graveyard, beach).

## Our world layout (6656 x 6400) after the restructure
Urban core (paved): downtown (N-center), shopping+mainstreet+station (NE mass
along the avenue y1880), civic (center-south of core). West-center: plaza +
foodmarket + HQ + legacy zones. Rural/grass edges: farm (NW), residential (SW),
park (S-center), graveyard (S), beach (SE), camping (relocated to N gap between
downtown & shopping), industrial + military (relocated to the band below the
core). Underground: subway + shop interiors (south bands, teleport-linked).

`d00-structure.json` renders the paved core slabs (depth ~0.87, under all
stamps) + the connecting road grid, so the whole core reads as one paved city.
