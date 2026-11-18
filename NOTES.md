# Notes and assumptions

Current state: **M0** (COFM calculator), **M0.5** (tactical decision game) and **M1** (continuous map, deployment by depth band, axes of advance, terrain).

- `npm install`, then `npm run dev` to play.
- `npm test` runs the unit and balance tests.
- `npm run build` type-checks and bundles.

## Code layout

- **`src/core/`** holds the game logic, all without DOM code and tested in Node:
  - `data.ts`: data types and validation for equipment, era files and scenarios.
  - `cofm.ts`: unit and sector potential, NATO estimates (low/mid/high), ratios per category, and comparison with the norms.
  - `fog.ts`: recon and contact (the estimate is replaced by the truth sector by sector), and readiness from planning time left.
  - `adjudicate.ts`: sector score, outcome, losses and one phase of fighting. M3's simulation will replace it behind the same `resolvePhase` interface.
  - `rng.ts`: the seeded random generator, with an independent stream per (seed, phase, sector).
  - `geom.ts`: plane geometry in metres (distances, polylines, point in polygon).
  - `terrain.ts`: the map format, terrain lookup, route cost and map validation.
  - `axes.ts`: which NATO units an axis engages, bypasses or encircles, and cut-off after a successful attack.
  - `fight.ts`: who fights whom in each sector, with terrain, tempo and flank threats. Both planning and adjudication use it.
- **`src/planning/`**, also DOM-free:
  - `plan.ts`: the plan (position, echelon and axis per formation, role per sector) and `evaluatePlan`, which takes the NATO units explicitly so the same code rates the estimate and the truth.
  - `tdg.ts`: the game as a pure reducer, running briefing → planning → decision → debrief, plus `simulate` for the school solution and the balance tests.
- **`src/ui/`**: screens (`views.ts`), the SVG map and its pointer input (`map.ts`), the controller (`app.ts`), and the countdown (`timer.ts`, the only real-time code).
- **`src/content.ts`**: loads the data files. Both the app and the tests use it.

## Data files

- **`data/equipment.json`**: coefficients, each marked `"basis": "source"` or `"game-tuned"`.
- **`data/eras/1970s.json`**: the norms, the Soviet order of battle, and the tunable numbers for prep time, recon, adjudication, terrain and axes.
- **`data/maps/*.json`**: maps (see below).
- **`data/scenarios/*.json`**: briefing, map id and geometry (sector lanes, line of contact, depth bands, objectives), the NATO **estimate** and **truth** with positions, the NATO reaction rule, time limits and the school solution.

## Maps: format, and how to supply real ones

A map is a GeoJSON `FeatureCollection` in **local metres**: origin at the bottom-left (south-west) corner, x east, y north. North is up on screen and the Soviets attack from the right (east). The shipped `central-01` is fictional, 25 km × 15 km.

- **Top level:** `id`, `name`, `width`, `height` (metres).
- **Areas** (`Polygon`, `properties.kind`): `forest`, `town`, `water`, `marsh`, `ridge`. Anything not covered is open ground. Later features draw over earlier ones.
- **Lines** (`LineString`): `road`, `river`, `ridgeline`.
- **Points** (`Point`): `crossing` (bridge or ford on a river), `place` (a label).
- `properties.name` is optional everywhere; it shows as a label or tooltip.

To add a **real map**, the easiest thing to send me is:

1. **The area:** a bounding box (south-west and north-east corners in lat/lon), about 25 km east–west by 15 km north–south, with the direction of the Soviet attack.
2. **Terrain, either way:**
   - an export from OpenStreetMap (for example from overpass-turbo.eu or QGIS) as GeoJSON with forests (`landuse=forest`, `natural=wood`), built-up areas (`landuse=residential`), water (`natural=water`, `waterway=river|stream`), marsh (`natural=wetland`), roads (`highway=primary|secondary|tertiary`) and bridges; or
   - a map drawn by hand in geojson.io or QGIS with the kinds above.
3. **Optional:** a historical topographic map (scan) of the same area, to correct OSM's present-day land use back to the 1970s/80s (roads, towns and forests have changed).

I then convert lat/lon to local metres, simplify the shapes and map OSM tags to the kinds above. Elevation (ridges and dead ground from a DEM) is not used yet; ridges are drawn as areas for now.

A scenario places itself on a map with `geometry`: the line of contact (`lineOfContactX`), depth bands east of it (first echelon, second echelon, assembly/reserve, artillery general support), `objectiveX` (default end of an axis), objectives, and `reactionX` (where NATO's reserve meets the main effort). Each sector is a horizontal lane with a `yRange`.

## How a TDG plays

1. **Briefing.** The situation, the known enemy positions and the planning-hour budget.
2. **Planning.**
   - **Deployment:** drag a unit, or tap it and then the map. The depth band sets its echelon (first echelon attacks; second echelon and reserve wait for the decision); the lane sets its sector. Artillery fires on the sector it stands behind, or on all sectors from the GS area. The A/B/C buttons in the list do the same without the map.
   - **Axes of advance:** each first-echelon battalion attacks west along its axis, by default straight to the objective depth. "Draw axis" adds waypoints; after the last one the axis continues west.
   - **Recon:** costs 2 h per sector and replaces the estimate there with the truth.
     - Dummies vanish and hidden units appear.
     - A unit that is really elsewhere becomes "location unknown"; recon does not reveal where it went.
   - **Readiness:** hours left at H-hour set a readiness multiplier for the whole regiment, from 100% with 4+ h left down to 85% with none. Recon therefore costs battle-procedure time.
   - **Commit:** "Commit plan", or the timer running out, locks the plan.
3. **Phase 1.** Every sector with Soviet forces is adjudicated against the *true* NATO deployment.
   - Contact reveals the enemy in the attacked sectors.
   - NATO's reserve moves toward the **main effort**: the attacked sector with the most Soviet combat potential. This is the Active Defense rule from DESIGN.md: shift the reserve toward the identified main effort.
4. **Decision.** The player may commit the second echelon and reserve (with new axes) and re-site artillery. First-echelon battalions are in contact and can't move; roles are fixed.
   - A sector broken through in phase 1 is now judged against **exploitation** norms. That role is game-applied and the player can't select it.
5. **Phase 2** settles it.
   - **Mission accomplished:** an attack or breakthrough sector succeeds in phase 2, holding at least 30% of the regiment's starting potential (enough to go on to the objective), with regiment losses below 35%.
   - **Partial success:** a sector is won, but too few forces got through or the losses are too high.
   - **Failure:** no sector is won.
6. **Debrief.**
   - The planned ratio against the actual one per sector, the outcomes and losses per phase, and every NATO unit as reported against what it actually was.
   - The school solution, played with the same seed.
   - "Replay (same seed)" keeps the luck fixed, so only your choices change the result.

## Adjudication model (all game-tuned, all in the era file)

- **Sector score.** A weighted geometric mean over the categories of `ratio / norm`, each clamped to [0.2, 2.5].
  - 1.0 means exactly at the norms.
  - Weights: tanks 0.3, overall 0.35, artillery 0.15, antitank 0.1, infantry 0.1.
  - A geometric mean punishes a weak category more than an arithmetic one would, so massed artillery can't make up for too few tanks.
  - A category with nothing on either side is left out.
- **Chance.** The score is multiplied by ε, drawn uniformly from 0.8–1.2.
- **Outcome.** At least 1.0 is success, at least 0.75 is stalled, anything lower is repulsed.
- **Losses** for the sector's units:
  - Soviet: `0.15 × intensity ÷ effective score`
  - NATO: `0.25 × intensity × effective score`
  - Both are capped at 60%.
  - Intensity is 1.0 for breakthrough and attack, 0.8 for exploitation, and 0.5 for a holding attack.
  - Artillery placed "spread" takes no losses.
  - Losses lower `strength`, which lowers potential. This is the Soviet idea of coefficients that include losses suffered.
- **Not modelled yet:** fortification, suppression, morale, frontage and tubes per km. M2 and M3 bring the rest.

## Terrain and axes (M1, all game-tuned, all in the era file)

- **Who fights.** A sector's fight is its first-echelon battalions (plus the artillery behind it, and a third of any GS artillery) against the NATO units their axes **engage**: those within 1.5 km of an axis. Units in a lane that no axis comes near are not fought.
- **Terrain.** NATO's potential in a fight is multiplied by the terrain its engaged units hold, weighted by their potential: open 1.0, forest 1.1, ridge 1.1, marsh 1.1, water 1.2, town 1.25. Open ground is the baseline the norms assume.
- **Tempo.** An axis through forest, town or marsh, or across a river away from a bridge or ford, is slower: the battalion's potential is multiplied by (direct distance ÷ terrain-weighted route cost)^0.3. Roads are cheap.
- **Bypassing.** A unit an axis passes within 3.2 km (but not within 1.5 km) is **bypassed**. It stays out of the fight but threatens the flank: 15% of its potential is added to the defender's overall potential (not to a single category, so a bypassed tank unit doesn't wreck the tank ratio).
- **Encirclement.** A unit passed both north and south (within 3.2 km) by axes that reach at least 1 km beyond it is **encircled**.
- **Cut-off.** After phase 1, units bypassed by an attack that broke through lose 25% of their strength; units encircled by attacks that *all* broke through lose 60%. Neither moves in NATO's reaction.
- **Counterattack.** NATO's reserve deploys at `reactionX` in the main-effort lane and engages that sector whatever the axes do.
- **Abstract, for now.** This rates the plan geometrically; M3 will move units along the same axes over the same map.

## Balance

`tests/balance.test.ts` plays every scenario over seeds 1–50 and checks:

- the school solution wins at least 70% of runs (currently 90–100%), and committing the second echelon never hurts;
- in scenarios 1–3, a broad-front attack with nothing kept back wins at most 30% (currently 0%);
- in scenarios 1–2, the second echelon is worth at least 15 points (currently about 30);
- in scenario 2, the plan the estimate suggests (mass on A) wins at most 30%;
- in scenario 4, a frontal attack on the village wins at most 30% (currently 8%), and the school pincer encircles it in at least 70% of runs (currently all).

Re-run these after changing any number in `data/`.

## Scenarios (fictional units, game-tuned)

1. **First echelon.** Mostly an accurate estimate. Team C has an unreported tank platoon. The lesson: mass, then keep a second echelon for the counterattack.
2. **The suspected reserve.** Team Tank is really behind sector A, not B. The tanks reported in C are a dummy. On paper A is weakest, so recon pays off.
3. **Late H-hour.** Only 2 planning hours and tight time limits. The village in B is strong and C is a thin screen. The DS artillery is a full battalion, not the two batteries reported.
4. **The strongpoint.** Altdorf is a tank-heavy strongpoint with thin screens north and south. A frontal attack bleeds the regiment; attacks on both flanks that swing in behind the village encircle it.

## Earlier assumptions (M0), still valid

- **Coefficients.** Only T-55/T-62 (1.0), T-54A (0.9), BMP-1 (0.8) and M1 (2.5) come from the 1977 CIA table quoted in DESIGN.md. Everything else, including M60A1 = 1.10, is game-tuned.
- **Categories.** Each equipment type belongs to exactly one category.
  - Infantry is the IFV or APC *with its squad*.
  - "Other" (recon vehicles, air defence) counts toward overall only.
- **Ratios are like-for-like**, Soviet tanks against NATO tanks and so on. Soviet forces against nothing reads ∞. Nothing on either side reads "—".
- **Colours.** Green means the ratio meets the norm; amber means at least 75% of it.
- **Norms.**
  - From DESIGN.md: overall 3:1, and 5:1 in tanks and artillery on the breakthrough sector.
  - Game-tuned: the antitank norm (1:1), the infantry norms, holding attack and exploitation.
- **Orders of battle** are approximate, from general knowledge of FM 100-2-3-style tables, and should be checked.
  - 2 MRB's 5th company is at 70% strength.
  - 3 MRB is at readiness 0.9.

## Known limitations

- **Timer:** switching it off and on during a phase restarts the countdown, so it is honour-system.
- **Saved state:** only the timer preference and each scenario's best result are kept (in localStorage). A game in progress is lost on reload.
- **NATO reaction:** only one reaction rule exists (reserve to the main effort). The AirLand Battle profile and deep fires belong to M4 and M7.
- **Map:** one fictional map; no elevation or line of sight yet. Zoom is by buttons (not pinch) and the map scrolls inside its frame.
