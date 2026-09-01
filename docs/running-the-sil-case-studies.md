# Running the SIL case studies in ALUR

A working protocol for Case Study 5 (GP / primary care access) and Case Study 2
(urban green space allocation), written against the app as it stands rather than
as it is meant to end up.

Both cases are the same five-stage loop over different data, so the shared setup
is real rather than boilerplate — do it once and the second case is mostly a
different set of columns.

Where something is not there yet, this says so and says what to do instead. That
matters more than completeness: a protocol that quietly assumes a capability is
worse than one that names the gap.

---

## Where each SIL stage lives

| Stage | What you use | What it leaves behind |
| --- | --- | --- |
| **Filter** | Filter node, **Named conditions** mode, keeping failures | `alur_excluded`, `alur_excluded_by`, `alur_excluded_count` on every row |
| **Prioritise** | Score node | `alur_score`, `alur_score_rank`, one contribution column per criterion |
| **Intervene** | Calculation node on the canvas, or the same calculation from the Calculations toolbox | A dataset per declared output, plus a table the graph reads on |
| **Evaluate** | Compare workspace | A measured comparison between variants |
| **Refine** | A new variant, plus the provenance log | The account of how you got here |

The two Intervene routes are the same calculation and produce the same answer.
The difference is what feeds it and what it can be told:

| | Toolbox dialog | Workflow node |
| --- | --- | --- |
| Input | Loaded datasets you pick | Whatever is wired into the handle |
| Repeatable as part of a pipeline | No | Yes |
| Changes with `referent: "point"` (place something on the map) | Yes | Yes |
| Changes with `referent: "rows"` (act on a selection) | **Yes** | **No — held back, with a warning** |

That last row decides which you use. A node reads a mid-pipeline result with its
own row numbering, and nothing connects those rows back to the ones you selected
in the source data, so the node refuses rather than applying your assertion to
whichever rows happened to land on those numbers. **If your scenario turns on
"close these three practices" or "commit these units", run it from the toolbox.**
If it turns on "put a new one here", either works.

---

## Shared setup

### 1. Get the data into a shape ALUR reads

ALUR reads **Parquet, CSV, JSON and GeoJSON**. It does not read GeoTIFF,
shapefile or GeoPackage, and it does not do raster sampling.

- **Use Parquet for anything substantial.** Loaded JSON and GeoJSON are capped at
  25 MB, because parsing a large untrusted document is how the tab locks up.
  (Results a calculation produces are exempt — those were built in memory from
  rows DuckDB already held.)
- **Raster sources must be converted to tables first.** UKCP18 heat anomalies and
  DEFRA NO₂ background grids are rasters; sample them onto your spatial unit in
  QGIS or Python and export the result as a column. ALUR joins tables; it does not
  sample grids.
- **Geometry travels as WGS84 by convention.** GeoJSON is WGS84 by definition
  (RFC 7946). Parquet geometry gets its CRS estimated from the extent, so check
  the layer's reported CRS before you trust any distance.

Load with the **Add data** button, drag-and-drop, or a remote Parquet URL from
the Remote Data node. Loaded files are cached in the browser (OPFS), so a reload
does not re-read them.

### 2. Open a line of enquiry before you touch the analysis

Open **Workflow** in the rail. That one entry opens the canvas and, beside it,
the palette that holds sessions and variants — building the pipeline and
recording what you are asking it are deliberately the same place.

Create an **analysis session** and fill in *What is this asking?* in your own
words — "which neighbourhoods face the worst access, and what closes the gap
most cheaply?" A session holds variants; a variant holds the changes you assert.

Do this first. A variant created later cannot retroactively own the reasoning
that produced it, and the Refine diagnostic — *can the user explain how this
scenario came to be?* — is answered from this record or not at all.

Create at least two variants per case: a **baseline** you do not modify, and the
scenario you are actually arguing for.

### 3. Nothing to install

Every calculation both cases need ships with ALUR: **Assign to nearest with
capacity** and **Phased allocation under a recurring budget** under Allocation,
and **Thin by minimum spacing** under Selection. Open the Calculations toolbox
and they are already there.

If you do add an external plugin later, serve it with CORS enabled —
`npx serve --cors`, not `python -m http.server`, which sends no
`Access-Control-Allow-Origin` and fails in a way that reads exactly like a
missing file.

---

## Case Study 5 — GP / primary care access

### The data you need

Two tables. Column names are yours; you bind them to roles later.

**Neighbourhoods** (LSOA, with geometry — polygons or centroids both work):

| Needs | Used for |
| --- | --- |
| LSOA code | identifier |
| Registered population, or projected population | demand weight |
| Projected growth to 2030 | filter + score |
| IMD health deprivation subdomain | score |
| Elderly population share | score |

**Practices** (point geometry):

| Needs | Used for |
| --- | --- |
| Practice code | identifier |
| List-size capacity — e.g. WTE GPs × your target list size | supply capacity |

**On travel time.** The case study calls for DfT Journey Times to Services. ALUR
has no routing engine, so there are two honest options: join the DfT journey-time
table as a column and use it as a score criterion, or, if you need modelled
travel time over a real network, install
[reach-ops](https://github.com/danylaksono/reach-ops) as a plugin. What you
**cannot** do is treat the `distance_km` that comes out of the allocation below
as travel time — it is straight-line distance and will flatter dense urban areas.

### The pipeline

```
[Neighbourhoods] → Attribute → Filter → Score ─┐
                                               ├→ Calculation: Assign to nearest with capacity → Output
[Practices] ───────────────────────────────────┘
```

### 1 · Filter

Add a **Filter** node and set its mode to **Named conditions**. Then set *Rows
failing a hard condition* to **Keep them, marked** rather than *Remove them*.

This is the whole diagnostic. If failures are removed, an excluded LSOA
disappears and you cannot say why; if they are kept and marked, every row
survives carrying `alur_excluded`,
`alur_excluded_by` (the names of the conditions it failed) and
`alur_excluded_count`. You can then map the exclusions, click one, and read the
reason — which is what *"can the user explain why a location is excluded?"*
actually demands.

Add conditions as **hard** where they are constraints and **soft** where they are
preferences. A typical set:

- hard — `patients_per_gp > 2200`
- hard — `projected_growth_2030 > 0.10`
- soft — `journey_time_minutes > 20`

The case study's awkward case — *an LSOA with a high ratio but within 10 minutes
of a practice with capacity should be visibly excluded with that rationale* —
resolves in two steps: the ratio and growth conditions here, and the capacity
part after the allocation has run, from `assigned_to` and `passed_over`.

If `patients_per_gp` is not already a column, put an **Attribute** node before the
filter and compute it there.

### 2 · Prioritise

Add a **Score** node from the palette. Add one criterion per row of the case
study's list, each with a weight, a direction and a normalisation:

| Criterion | Direction | Note |
| --- | --- | --- |
| Patients per GP | higher | |
| Projected growth | higher | |
| Journey time | higher | if you joined it |
| Health deprivation | higher | |
| Elderly share | higher | |

Set **missing values** deliberately. `zero` treats absent data as the best
possible case and will quietly promote incomplete records; `exclude` is usually
what you want, and `mean` is defensible if the gaps are random.

Leave **contributions** on. Each criterion gets its own column, so you can answer
*"why is this one above that one?"* by reading the two rows side by side rather
than by re-deriving the arithmetic.

The case study's test — *a high-growth LSOA with moderate current pressure should
rank above a currently pressured but stable one* — is a check on your weights.
Find the two rows in the table, compare their contribution columns, and adjust
until the ordering is the one you can defend.

### 3 · Intervene

Open **Calculations** in the rail (under Analyse). Find **Assign to nearest with
capacity** under Allocation, and click the small workflow icon beside its name to
place it on the canvas. Clicking the name itself opens the dialog instead — same
calculation, different gesture.

Wire it up:

- **Demand** handle ← the Score node
- **Supply** handle ← the practices input node

Open the node's settings (the gear) and bind:

| Input | Role | Bind to |
| --- | --- | --- |
| Demand | Identifier | LSOA code |
| Demand | Amount | registered or projected population |
| Supply | Identifier | practice code |
| Supply | Capacity | list-size capacity |

Set **Maximum distance (km)** to your access threshold, or 0 for no limit.

Press **Run**. You get two datasets:

- **Where demand went** — per LSOA: `served`, `assigned_to`, `distance_km`,
  `passed_over`. `served = false` **is the unmet-demand residual**, and
  `passed_over` counts how many nearer sites were full before this one found room
  — which is the pressure signal that a plain catchment map hides.
- **What each site took on** — per practice: `assigned`, `capacity`,
  `utilisation`, `units_served`. `assigned` is the modelled list size, so this is
  where the "ratio falls from 2,480 to 1,920" claim comes from.

**To add a branch surgery**, open the same calculation from the toolbox, choose
your scenario variant, pick **Add a supply point here**, set its capacity, and
click the map. That records a change on the variant. Because it is a *point*
change it also applies on a node run, so your canvas pipeline picks it up.

**To close a practice or change its capacity**, you must use the toolbox dialog —
those changes target selected rows and the node holds them back. Select the
practices on the map or in the table first, then record the change.

### 4 · Evaluate

Open **Compare** in the rail (under Analyse) and put the baseline variant against
the scenario.

Compare on at least three measures, because each hides something the others
show:

| Measure | What it answers |
| --- | --- |
| Mean `distance_km` | did access improve on average |
| Count where `served = false` | who is still left out |
| Max `utilisation` across practices | is any single site now implausible |

The case study's warning — *telehealth lowers the ratio on paper but leaves
elderly-heavy LSOAs underserved* — is exactly why the third measure matters. An
intervention that fixes the mean while leaving one cohort unserved will look good
on the first row and bad on the second. Filter the comparison to high
elderly-share LSOAs to make the point visible rather than arguable.

### 5 · Refine — the phased plan

The case study's refinement moves from one capital commitment to a phased blend:
cheap capacity in years 1–2, a branch surgery in year 6 where growth is steepest.

That is **Phased allocation under a recurring budget**, under Allocation in the
toolbox. Add it to the canvas after the score node:

```
… → Score → Calculation: Phased allocation under a recurring budget → Output
```

Bind **Priority** to `alur_score`, **Cost** to the capital cost of intervening in
that LSOA, and **Annual yield** to whatever you are counting as the return —
patients brought under the threshold, say. Set **First year** / **Last year** to
your horizon, **Budget per year** to the annual envelope, and **Years to reach
full yield** to the ramp.

Output **What was committed** gives you `committed_year` per unit; **Year by
year** gives the trajectory, which is what you chart to show phasing.

To force the year-6 branch surgery, use **Commit these units** from the toolbox
dialog with the year set — it puts your selection ahead of the ranking, though it
still has to be affordable. Do this from the dialog, not the node.

Then create a third variant, and let the provenance log carry the reasoning:
"single capital commitment → too much of the budget in year 1 → phased blend".

---

## Case Study 2 — Urban green space

The structural difference from Case 5 is that there is no allocation to a fixed
set of supply points. The intervention *is* the selection, so the Intervene stage
is about which candidates you choose and when — which makes the dispersion rule
and the budget phasing the whole substance.

### The data you need

One table of spatial units (LSOA or H3 cell) with geometry, carrying:

| Needs | Source in the case study | Note |
| --- | --- | --- |
| Unit code | — | identifier |
| IMD score or decile | ONS IMD 2019 | |
| Heat anomaly | UKCP18 | **raster — sample it first** |
| NO₂ background | DEFRA UK-AIR | **raster — sample it first** |
| Green space coverage | OS Open Greenspace | see below |
| Population density | Census 2021 | |
| Distance to schools/GPs/care homes | OS Points of Interest | see below |

Two of these are not columns you can download; you compute them in ALUR:

**Green-space coverage within 400 m** — load OS Open Greenspace as a second
input, add an **Analysis** node with `ST_Buffer` at 400 m on your units, then a
**Join** node with `ST_Intersects`, then an **Aggregate** node summing green-space
area per unit. Divide by the buffer area in an Attribute node.

**Vulnerable-population proximity** — load the POI layer and use a **Join** node
with the `ST_DWithin` predicate at your threshold distance, then aggregate to a
count per unit.

### The pipeline

```
[Units] → Attribute (deficit) → Filter (marked) → Score
            → Calculation: Thin by minimum spacing
              → Calculation: Phased allocation under a recurring budget → Output
```

Two calculations in a row. Run the upper one first — the graph will not compile
past a calculation that has not been run, and it says so by name.

### 1 · Filter

Filter node, **Named conditions** mode, keeping failures, matching the case
study's opening move:

- hard — `imd_decile <= 3`
- hard — `heat_anomaly > <75th percentile>`
- hard — `tree_cover < 0.08`

The case study's next beat is the analyst saying *"that feels too tight"* and
relaxing to decile ≤ 5 and cover < 15%. Do that by editing the thresholds in
place — the candidate set updates and the previously excluded rows are still
present and inspectable, because you are in tag mode. That is the *"Filter is a
lens, not a gate"* claim made concrete.

### 2 · Prioritise

Score node, six criteria:

| Criterion | Direction |
| --- | --- |
| Heat anomaly | higher |
| IMD | higher |
| NO₂ | higher |
| Vulnerable-population proximity | higher (count) or lower (distance) |
| Green-space deficit | higher |
| Population density | higher |

Weights are the argument. The case study's own worked example is heat 0.35,
deprivation 0.30, NO₂ 0.20, school-proximity 0.15 — and its point is that
reweighting to equity-first produces a *different and equally defensible* map.
Make both. They are two variants, not two attempts.

### 3 · Intervene — dispersion first

This is the case study's Refine step, and it has a calculation of its own:
**Thin by minimum spacing**, under Selection in the Calculations toolbox.

Place it after the Score node, wire the Score node into **Candidates**, and bind:

- Identifier → unit code
- Rank by → `alur_score`

Set **Minimum spacing (km)** to `0.5`, and **Consider first the** to *highest
ranked*. Leave **Stop after keeping** at 0 to keep as many as the spacing allows,
or set it to 20 to reproduce the case study's shortlist.

This walks the ranked list and keeps each candidate only if nothing already kept
lies within 500 m. It is exactly the *"top 20 are all in one ward → apply a 500 m
dispersion constraint → now spans four wards"* move, and the before/after is two
variants you can compare.

**To protect a specific site from the spacing rule**, use **Keep these
regardless** from the toolbox dialog — it is a row-targeted change, so the node
will not apply it.

### 4 · Intervene — phasing and budget

Add **Phased allocation under a recurring budget** after the thinning node.

Bind **Priority** to `alur_score`, **Cost** to the capital cost of the
intervention in that unit, and **Annual yield** to the benefit you are counting.

Here is the part the case study leaves to you: **the intervention coefficients
are yours to supply.** ALUR has no model of how much a pocket park cools a
neighbourhood. Cooling in °C, NO₂ uptake in μg/m³, stormwater retention in
m³/year — compute these as columns in an Attribute node from your own
coefficients, one column per intervention type, and bind the one you are
modelling as **Annual yield**. Different intervention types are different
variants, or different columns in the same run.

Set **Budget per year**, the year range, and **Years to reach full yield** — the
last one matters more here than in Case 5, because trees do not cool on the day
they are planted, and a 15-year ramp changes which units are worth committing
early.

Leave **Minimum spacing** at 0 in this node; the thinning node above already did
that job, and applying it twice would silently discard candidates the first pass
had already spaced properly.

### 5 · Evaluate and Refine

Compare on the measures the case study names: mean cooling, NO₂ reduction,
residents served, capital cost. The comparison the write-up reaches — *the
dispersed portfolio reaches 40% more residents for 62% more capital* — is a
two-variant comparison on two measures, and it is worth stating in exactly that
form, because a ratio of ratios is the honest way to present a trade-off with no
single optimum.

For the case study's second what-if — top 20 with a full intervention mix versus
top 60 with trees only, same £3.5m — run the phased allocation twice with the
same **Budget per year** and different cost and yield columns. Same budget,
different portfolio, directly comparable.

---

## What ALUR does not do for these cases yet

Stated plainly, because each of these is a place where a protocol could otherwise
imply a capability that is not there.

| Gap | What to do instead |
| --- | --- |
| **No routing or travel-time modelling** | Join a journey-time table, or install `reach-ops`. `distance_km` from the allocation is straight-line. |
| **No raster reading or sampling** | Sample UKCP18 / DEFRA grids onto your units in QGIS or Python first. |
| **No intervention-effect models** | Supply cooling, uptake and retention as columns you computed from your own coefficients. |
| **No natural-language interface** | The NL transcripts in the case studies are a design target. Every step in them has a manual equivalent above. |
| **Row-targeted changes do not apply on node runs** | Run that calculation from the toolbox dialog. The node warns rather than misapplying them. |
| **No weight-sensitivity sweep in the score node UI** | Vary the weights across variants and compare. The spec has a `sensitivity` field, but nothing drives it yet. |
| **Calculation instances are rebuilt per run** | Nothing to do; it costs time on large inputs, not correctness. |
| **At most 1,000,000 features per calculation input** | Truncation is reported, never silent. Aggregate upstream if you hit it. |

---

## What travels, and what does not

When you save the project:

**In the file** — the workflow graph, every node's configuration, the calculation
nodes' bindings and settings with the plugin id **and version**, the sessions and
variants with every change you asserted in order, the provenance log, layer
presentation, and dataset descriptors.

**Not in the file** — your data, and the plugin code. Both are addresses, not
contents.

So a colleague opening your project needs the same source files and the same
plugins installed. If a plugin is missing, the project still opens and says which
calculation it cannot run, rather than silently producing a different answer —
which is why the version is recorded alongside the id.

This is the split that makes the case studies reproducible in a useful sense:
**the project file is the method, the variant is the scenario asserted against
it.** Someone can take your method, apply their own scenario, and compare — a
stronger claim than handing them one frozen answer.

Two habits make this hold:

- **Re-run a stale calculation before you save.** A node whose upstream has moved
  says *"Out of date — what feeds this has changed"* and keeps its old answer
  rather than silently recomputing. That is deliberate: nothing should change a
  map without you deciding it should. But a saved project with a stale node is a
  project whose map does not follow from its graph.
- **Write the session's question down.** It is the only part of the record that
  says what you were trying to find out, and it is the first thing a reader needs.

---

## Related

| | |
| --- | --- |
| [Building your first calculation](building-your-first-calculation.md) | If a stage above needs something no existing calculation does. |
| [Authoring a calculation provider](authoring-a-calculation-provider.md) | The contract reference. |
| [`src/providers/bundled/`](../src/providers/bundled/) | The three calculations ALUR ships, and why each is not a SQL query. |
