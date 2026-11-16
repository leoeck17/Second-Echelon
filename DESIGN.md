# COFM Wargame – Design Document

Nov 1, 2026 · @Leon

## Concept and design pillars

The player is a Soviet regimental commander who wins or loses mostly in the planning phase: the game asks whether you calculated correctly, massed in the right place and accepted the right risks. Then the battle runs largely on its own, and the debrief compares your plan with what actually happened.

**Working title:** *Correlation* (placeholder).

**Format:** single-player, Soviet side only, NATO played by the computer. Browser game (HTML/JS), plan-then-watch. Two eras on one engine: mid-1970s and mid-1980s, Central Front.

**Design pillars**

1. **The calculation is the gameplay.** The correlation of forces and means (COFM) is always visible and recalculates live as the player assigns units and fires to sectors.
2. **Norms as pressure, not rules.** Doctrinal norms (required ratios, artillery densities, frontages, time norms) are shown as targets. The player may ignore them, and the simulation decides whether that was bold or foolish.
3. **Arithmetic versus fog of war.** The calculation is only as good as the intelligence picture. Reconnaissance, planning time and deception are resources the player spends.
4. **Plan, then let go.** Execution follows the plan. The player intervenes only at a few decision points, as a Soviet commander would: commit the second echelon, shift fires, commit the reserve.
5. **Two eras, one engine.** 1970s and 1980s scenarios share all code; only data changes (equipment, orders of battle, NATO doctrine).

**Victory** is measured against the mission, Soviet-style: reach the immediate and subsequent objectives by the planned time, with losses that leave the regiment combat-capable.

## Historical basis: how COFM worked

Soviet planners scored every force by its combat potential and compared the totals sector by sector, at every level from tactical to strategic. A 1987 US intelligence memo describes exactly this: forces receive scores from their qualitative characteristics and their quantity, and the scores feed planning models ([CIA, 1987](https://cia.gov/readingroom/print/2012131)).

**Coefficients of commensurability.** Each weapon type gets a coefficient relative to a reference weapon. In a 1977 Soviet table obtained by the CIA, the reference was the T-55 tank at 1.0, and the scores appear to reflect firepower, survivability and mobility ([CIA, 1977](https://www.cia.gov/readingroom/docs/1977-09-21b.pdf)). A Soviet *Military Thought* article notes that coefficients should also reflect losses already suffered ([CIA translation](https://www.cia.gov/readingroom/print/1923555)). This is the game's core number.

Sample values legible in the declassified 1977 table ([CIA](https://www.cia.gov/readingroom/docs/1980-08-25.pdf); OCR is poor, verify before use):

| Equipment | Combat potential (T-55 = 1.0) |
| --- | --- |
| M1 (then experimental) | 2.50 |
| T-55, T-62 | 1.00 |
| Swiss Pz 68 | 1.00 |
| T-54A | 0.90 |
| BMP-1 | 0.80 |
| Pz 61 | 0.60 |

**Planning norms the game uses.** Values marked *approximate* are from general knowledge of Western studies of Soviet doctrine (e.g. US Army FM 100-2-1, 1984) and should be checked before they are locked in.

| Norm | Starting value | Basis |
| --- | --- | --- |
| Overall superiority needed to attack a prepared defense | about 3:1 | approximate |
| Superiority on the breakthrough sector | about 5–6:1 in tanks and artillery | approximate |
| Artillery density, breakthrough sector | 90–110 tubes and mortars per km | [CIA 1975](https://www.cia.gov/readingroom/docs/1975-11-07.pdf), [Military Thought](https://www.cia.gov/readingroom/node/1923538) (108/km), [front exercise 1981](https://www.cia.gov/readingroom/docs/1981-07-31.pdf) (107/km) |
| WWII comparison | 200–300 tubes per km | [CIA](https://www.cia.gov/readingroom/print/1936644) |
| Battalion attack frontage | 1–2 km (breakthrough), 2–3 km normal | [balagan.info](https://balagan.info/soviet-order-of-battle-and-doctrine-in-the-cold-war) (secondary) |
| Battalion immediate objective depth | 2–4 km | same |
| Battalion subsequent objective depth | 8–15 km | same |

The norms already include the defender's advantage of terrain and preparation. The game should therefore display the raw ratio against the norm, and leave terrain and fortification effects to the simulation.

## Scale, units and orders of battle

The player plans at battalion level and the simulation runs at company level. That matches "battalion or brigade scale": a reinforced Soviet motor rifle regiment attacks into the sector of a NATO battalion task force, inside a brigade defense.

**Soviet player force (default scenario):** one motor rifle regiment in a division's first echelon.

- 3 motor rifle battalions (3 companies each)
- 1 tank battalion (3 companies)
- 1 artillery battalion (3 batteries), plus attached division and army artillery battalions
- Reconnaissance company, antitank battery, air defense battery, engineer company
- On-call support from division: attack helicopters, extra fire missions

**NATO opponent:** a US mechanized battalion task force or a Bundeswehr Panzergrenadier battalion, company teams in battle positions, with brigade reserve and artillery behind it.

**Map scale:** about 15 km wide by 25 km deep, hexes of 500 m. That fits a regimental attack zone plus the depth of the subsequent objective.

**What changes between eras** (approximate, to verify per scenario):

|  | Mid-1970s | Mid-1980s |
| --- | --- | --- |
| Soviet tanks | T-62, early T-64 | T-64B, T-72, T-80 |
| Soviet infantry vehicles | BMP-1, BTR-60PB | BMP-2, BTR-70 |
| Soviet artillery | D-30 towed, first 2S1 | 2S1, 2S3, BM-21 |
| US equipment | M60A1, M113, TOW, Dragon | M1, M2 Bradley, improved TOW |
| West German equipment | Leopard 1, Marder, Milan | Leopard 2, Marder, Milan |
| NATO doctrine | Active Defense (FM 100-5, 1976): win the first battle by attrition from successive battle positions | AirLand Battle (1982): deeper defense, counterattacks, deep fires against second echelons |
| Soviet emphasis | Heavy artillery preparation, rigid echelonment | Attack from the march, forward detachments, operational maneuver groups |

Era changes therefore hit the player where COFM is calculated: NATO ATGMs and the M1 shift the coefficients, and AirLand Battle punishes a second echelon that waits in the open.

## Game loop

One scenario runs through four phases: briefing, planning, execution, debrief. Planning is where the player spends most of the time.

Flow: Briefing → Planning (recon loop) → Execution (orders loop) → Debrief → next scenario.

Recon loops inside planning and orders loop inside execution; the debrief feeds the next scenario.

**1. Briefing.** The division order: attack zone, main axis suggested by division, immediate and subsequent objectives, H-hour, attachments. Known NATO positions from division intelligence.

**2. Planning** (the core). The player works through these decisions while the COFM panel updates live:

1. **Spend planning time.** A fixed budget of planning hours before H-hour. Recon missions cost time but turn suspected NATO units into confirmed ones and shrink the error bars on their potential.
2. **Choose the breakthrough sector:** where, and how wide (for example 2 km of a 6 km zone).
3. **Assign battalions** to first echelon, second echelon and reserve, each to a sector.
4. **Plan fires:** form the regimental artillery group, set preparation length and targets. The panel shows tubes per km against the norm.
5. **Allocate support:** engineers to obstacles, air defense coverage, antitank reserve.
6. **Check the plan** against the norms, then commit.

**The COFM panel** shows, for each sector, the ratio per category (tanks, antitank means, artillery, infantry) and overall, coloured green, amber or red against the norm. Unit potential and sector ratio:

```latex
P_{unit} = k_{strength} \cdot k_{readiness} \cdot \sum_i n_i \, c_i
```

```latex
COFM_{sector} = \frac{\sum P_{Soviet}}{\sum \hat{P}_{NATO}}
```

Here c is the coefficient of each weapon type, n the number held, and P-hat the *estimated* NATO potential from intelligence, shown with a low–high range. The player is always calculating against an estimate, never the truth.

**3. Execution.** The battle runs in simulated time with speed controls (pause, 1×, 4×, 16×). The plan executes automatically. At decision points the player gets a short list of options: commit the second echelon, shift artillery, commit the reserve, request helicopters. Only a few orders per hour are allowed, which reflects limited command bandwidth.

**4. Debrief.** Planned versus actual ratios per sector, the true NATO deployment revealed, objectives and timings reached, losses, and which estimates were wrong.

## Simulation model

The simulation uses the same combat potential numbers as the planner, plus everything the planner cannot see: terrain, fortification, suppression, morale and chance. That is what makes a good plan likely, but never certain, to work.

**Map.** Hex grid, 500 m per hex. Terrain types: open, broken, forest, town, river (with crossing points), ridge; roads and bridges as hex-side features. The first map is fictional but Central-Front-like; a real-terrain map can follow later.

**Movement.** Speed per unit type and terrain, slower in combat formation than in march column. Time step of 1 simulated minute.

**Combat.** Lanchester-style attrition, driven by combat potential:

```latex
\Delta S_{def} = -\alpha \cdot P_{att} \cdot m_{terrain} \cdot m_{suppression} \cdot \varepsilon \cdot \Delta t
```

The attacker's losses use the same form with the defender's potential, multiplied by a fortification and terrain bonus. Epsilon is a seeded random factor (for example 0.7–1.3). Losses reduce strength, which reduces potential, which is exactly the Soviet idea of coefficients that include losses suffered.

**Artillery.** Preparation fire suppresses defenders, temporarily cutting their effective potential. Suppression scales with tubes per km on the target, so the density norm matters in play, not just on paper.

**Breaking point.** A company that falls below about 50% strength, or is suppressed and outnumbered, withdraws or breaks. A breakthrough happens when the defenders in a sector are destroyed, suppressed or withdrawing.

**Fog of war.** NATO units are hidden until spotted. Each has a known, suspected or unknown status, and the planner sees estimated strength with an error range. Recon and contact reveal units; NATO may place dummy positions.

**NATO AI.** Rule-based, one doctrine profile per era:

- **1970s, Active Defense:** strong forward battle positions, ATGM ambushes, fall back to the next position under pressure, shift the reserve toward the identified main effort.
- **1980s, AirLand Battle:** thinner forward screen, defense in depth, local counterattacks into the flanks of a penetration, artillery and helicopter strikes on the second echelon before it is committed.

Each NATO unit gets a role (screen, battle position, reserve, fire support) and simple triggers, for example "if enemy main effort is identified, move reserve to blocking position B". That is enough for convincing behaviour without complex AI.

## Data model and technical architecture

Build it as a static browser app in TypeScript with Vite, with the simulation kept strictly separate from the user interface. That separation lets Claude test the combat and COFM math in Node without a browser, and makes balancing far easier.

**Stack**

- TypeScript + Vite, no backend; hosts free on GitHub Pages
- Rendering: HTML Canvas for the hex map, plain HTML/CSS for panels
- All game content in JSON files (equipment, units, scenarios, eras)
- Seeded random number generator, so a battle can be replayed exactly
- Vitest for unit tests of the COFM and combat functions

**Folder structure**

```
/src
  /core      cofm.ts, combat.ts, movement.ts, fog.ts, rng.ts  (pure logic, no DOM)
  /ai        nato-active-defense.ts, nato-airland.ts
  /planning  plan model, norm checks
  /ui        map canvas, COFM panel, timeline, debrief
/data
  /eras      1970s.json, 1980s.json
  equipment.json, scenarios/*.json
/tests
DESIGN.md    (this document)
CLAUDE.md    (instructions for Claude Code)
```

**Example data**

```
// equipment.json
{ "T-62":  { "type": "tank", "cp": 1.00, "era": ["1970s"] },
  "BMP-1": { "type": "ifv",  "cp": 0.80, "era": ["1970s", "1980s"] },
  "M60A1": { "type": "tank", "cp": 1.10, "era": ["1970s"] } }

// unit (company level)
{ "id": "2MRB-4", "side": "SOV", "name": "4th MR Coy",
  "equipment": { "BMP-1": 10, "RPG-7": 9 },
  "strength": 1.0, "readiness": 1.0, "parent": "2MRB" }

// scenario
{ "era": "1970s", "map": "fulda-like-01", "hHour": "04:30",
  "planningHours": 6, "objectives": [...], "natoDoctrine": "active-defense" }
```

The M60A1 value above is a placeholder; every coefficient should be marked as source-based or game-tuned in the data file.

## Build roadmap for Claude Code

Build the COFM calculator first, without a map: it is the heart of the game and is already fun as a planning puzzle. Each milestone below ends with something you can play.

1. **M0 – Data and COFM core.** Equipment and unit JSON for the 1970s; `cofm.ts` with tests. A screen listing both forces, three sectors, and live ratios against the norms.
2. **M0.5 – Tactical decision game.** Playable without a map: scenarios with a hidden true NATO deployment, recon that costs planning time, an abstract adjudication step (`adjudicate.ts`: COFM score × seeded chance → outcome and losses), the NATO reserve reacting to the main effort, one mid-battle decision (commit the second echelon, shift fires), an optional timer, and a debrief against the truth and a school solution. M3's simulation later replaces `adjudicate.ts` behind the same phase interface; the scenarios carry over.
3. **M1 – Map and deployment.** Hex map, terrain, units placed on it; drag battalions into sectors and echelons.
4. **M2 – Fire planning.** Artillery groups, preparation length, tubes-per-km check.
5. **M3 – Execution.** Movement, combat, suppression, breaking point; speed controls and decision points.
6. **M4 – NATO AI.** Active Defense profile with role-based triggers.
7. **M5 – Fog of war and recon.** Hidden units, estimates with ranges, planning-hours budget (sector-level first version in M0.5; M5 adds spotting on the map).
8. **M6 – Debrief.** Plan versus reality, revealed NATO positions, scoring (first version in M0.5).
9. **M7 – 1980s era.** New equipment data and the AirLand Battle AI profile.
10. **M8 – Polish.** Tutorial scenario, more scenarios, sound, save games.

**Working with Claude Code**

- Put this document in the repository as `DESIGN.md`, and add a short `CLAUDE.md` saying: read DESIGN.md first, keep `/src/core` free of DOM code, write tests for every core function.
- One milestone per session. Play it, write down what feels wrong, then start the next session with that list.
- Ask Claude to put every tunable number (coefficients, norms, attrition factor) in data files, never hard-coded.

**First prompt (M0)**

```
Read DESIGN.md. Set up a TypeScript + Vite project with Vitest.
Implement milestone M0 only:
- data/equipment.json and data/eras/1970s.json for one Soviet motor rifle
  regiment and one US mechanized battalion task force (company level).
- src/core/cofm.ts: unit potential, sector potential, ratios per category
  (tanks, antitank, artillery, infantry, overall), comparison with norms.
- Unit tests for cofm.ts.
- A simple page: Soviet units on the left, three sectors in the middle,
  NATO estimate on the right; assign Soviet battalions to sectors and see
  the ratios update, coloured against the norms.
No map yet. Explain any assumptions in a short NOTES.md.
```

## Open questions

- [ ] **Player echelon:** regiment commander (current default), or division commander with regiments as the pieces?
- [ ] **Map:** stay fictional, or use real terrain such as the Fulda Gap or the North German Plain later?
- [ ] **Nuclear and chemical weapons:** leave them out entirely, or keep them as a background threat that affects dispersion?
- [ ] **Air power:** only on-call helicopters, or fixed-wing support and NATO air interdiction too?
- [ ] **Structure:** separate scenarios, or a short campaign where losses carry over?
- [ ] **1980s coefficients:** the 1977 table covers the 1970s. Should 1980s values be extrapolated and marked as game estimates?
- [ ] **Language:** English or German interface, or both?
- [ ] **Realism versus playability:** how much doctrinal detail (march tables, time norms per step) should the player see?

## Sources

- [CIA memo on net assessment and COFM, 1987](https://cia.gov/readingroom/print/2012131)
- [CIA, NATO–Warsaw Pact force ratios in Central Europe, 1977](https://www.cia.gov/readingroom/docs/1977-09-21b.pdf)
- [CIA, Soviet combat potentials of armament and equipment (1977 documents)](https://www.cia.gov/readingroom/docs/1980-08-25.pdf)
- [Military Thought (USSR): determining the balance of forces and means](https://www.cia.gov/readingroom/print/1923555)
- [Military Thought (USSR): army artillery ammunition needs](https://www.cia.gov/readingroom/node/1923538)
- [CIA, front artillery breakthrough exercise, 1981](https://www.cia.gov/readingroom/docs/1981-07-31.pdf)
- [CIA, Soviet artillery in a breakthrough sector, 1975](https://www.cia.gov/readingroom/docs/1975-11-07.pdf)
- [CIA, artillery density in breakthrough sectors](https://www.cia.gov/readingroom/print/1936644)
- [RAND, Russian Assessments and Applications of the COFM, 2020](https://www.rand.org/pubs/research_reports/RR4235.html): best modern overview, worth reading in full
- [FAS, The Soviet Army: Operations and Tactics, FM 100-2-1 (1984)](https://fas.org/?p=10777)
- [balagan.info, Soviet order of battle and doctrine](https://balagan.info/soviet-order-of-battle-and-doctrine-in-the-cold-war) (secondary)

The CIA documents were found via search excerpts; their scanned PDFs could not be opened here, so check the figures in the originals.
