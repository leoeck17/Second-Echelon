# M0 notes and assumptions

M0 is the COFM calculator with no map: `npm install`, `npm run dev` to play, `npm test` for the tests.

## Code layout

- `src/core/data.ts`: types for equipment, units and era files, plus validation (unknown equipment, wrong era, bad placements, missing norms).
- `src/core/cofm.ts`: unit potential, sector potential, NATO estimates (low/mid/high), ratios per category, comparison with norms.
- `src/planning/plan.ts`: the plan (formation to sector, role per sector) and `evaluatePlan`, which runs the core for every sector.
- `src/ui/`: the page. It only renders; it does no arithmetic of its own.
- There is no DOM code in `core/` or `planning/`, so both are tested in Node.

## The COFM model

- **Unit potential** is `strength × readiness × Σ nᵢ·cᵢ`, kept separate per category. "Overall" is the sum of all categories.
- **Categories.** Each equipment type belongs to exactly one category:
  - tanks
  - antitank (RPG, recoilless guns, ATGMs)
  - artillery (guns, howitzers, mortars)
  - infantry: the IFV or APC *with its squad*, because the 1977 table scores the BMP-1 as a whole and dismounts aren't counted separately
  - other (recon vehicles, air defence), which counts toward overall but gets no ratio of its own

  Real weapons spread across categories (the BMP-1's Sagger is an antitank weapon); splitting a coefficient is left for later.
- **Ratios are like-for-like** (Soviet tanks against NATO tanks, and so on), as the M0 prompt asks. Tanks against antitank means might be more meaningful and could be added as a further row.
- **Edge cases.** Soviet forces against nothing reads ∞ and meets the norm. If neither side has anything in a category, it shows "—" and is left out of the sector verdict.
- **Colours.** Green means the ratio meets the norm. Amber means it reaches at least `amberFraction` (75%) of the norm. Red means it is below that. The sector header shows the worst category.
- **Estimates.** Each NATO unit has an intel range (`low`/`high` multipliers on its nominal potential). The headline ratio uses the point estimate. The small figures show the pessimistic to optimistic range, and ▲ marks a ratio that drops a colour band if NATO turns out to be at the high end. In M0 the NATO data *is* the intelligence picture; there is no hidden truth yet (that is M5).
- **Placement.** A formation is in one sector, spread evenly over all three (artillery only, standing in for fires on call until fire planning in M2), or uncommitted. Uncommitted Soviet units and the NATO brigade reserve count nowhere.
- **Roles and norms.** Each sector has a role: breakthrough, attack or holding attack, and each role has its own norms in `data/eras/1970s.json`. More than one sector can be set to breakthrough; nothing stops you. Sector width (2 km each) is stored but not yet used, because tubes per km belongs to M2.

## Numbers: what is sourced and what is invented

- **Coefficients.** Only T-55/T-62 (1.0), T-54A (0.9), BMP-1 (0.8) and M1 (2.5) come from the 1977 CIA table quoted in DESIGN.md, and are marked `"basis": "source"`. Every other value is a game-tuned guess, marked `"basis": "game-tuned"`. That includes M60A1 = 1.10, the placeholder from DESIGN.md.
- **Norms.** Overall 3:1 and 5:1 in tanks and artillery on the breakthrough sector come from DESIGN.md's "approximate" table. The antitank norm (1:1), the infantry norms and the whole holding-attack role are game-tuned. The basis of each norm is recorded in the era file.
- **Soviet order of battle** (approximate, from general knowledge of FM 100-2-3-style tables; verify):
  - BMP regiment: 3 MRBs, each with 3 companies of 10 BMP-1 and 9 RPG-7, plus a battalion HQ BMP, a 6-tube 120 mm mortar battery and an AT platoon (2 SPG-9, 2 AT-3 teams)
  - Tank battalion of 31 T-62
  - Regimental artillery battalion of 18 × 2S1
  - Attached division (18 × D-30) and army (18 × D-20) artillery battalions
  - Recon company (3 PT-76, 4 BRDM-2), AT battery (9 × 9P122), AD battery (4 ZSU-23-4, 4 SA-9)
  - Engineers are left out because they have no combat potential in this model.
  - 2 MRB's 5th company is at 70% strength and 3 MRB is at readiness 0.9, so the battalions are not interchangeable.
- **US task force** (approximate):
  - Mech-heavy TF (3 mech companies + 1 tank company of 17 M60A1), cross-attached into Teams A and B (2 mech platoons + 1 tank platoon each) and Team C (pure mech)
  - A tank-heavy Team Tank in TF reserve, placed in depth behind sector B and counted there
  - TOWs spread over the forward teams, a heavy mortar platoon, and two batteries of the brigade's DS M109A1 battalion (both spread over all sectors)
  - A brigade reserve tank company, which counts in no sector
  - The 1970s TOE details (TOW count, Dragon issue) should be checked.
- **Unit names are fictional.** The regiment and task force aren't modelled on real units.
- **Balance check.** With everything committed, the regiment has about 2.9:1 overall over the TF elements inside the sectors, but fewer tanks than NATO there (32 against 19 in M60A1 terms, before the brigade reserve). Meeting the breakthrough norms therefore means massing on one sector and accepting holding attacks elsewhere. Sector B, where Team Tank stands, is the hardest place to break through.

## Deliberately not in M0

Map, echelons, fire planning and tubes per km, the time and planning budget, fog of war with hidden truth, combat. The current plan is saved in the browser's localStorage only.
