// A complete, working ALUR calculation, kept as short as a real one can be.
//
// It orders a set of stops into a visiting sequence: start somewhere, then
// repeatedly go to the nearest place you have not been yet. That is a genuine
// calculation rather than a query — where you go next depends on everywhere you
// have already been, and no single SELECT can express that.
//
// Copy this directory, rename it, and replace the middle. Everything structural
// is here: field roles, a setting, a change the analyst asserts, a joined
// output, and a nominated measure.

/** @type {import('@alur/operation-contract').OperationManifest} */
const manifest = {
  id: "example.visit-order",
  label: "Order into a visiting sequence",
  description:
    "Starts at one stop and repeatedly moves to the nearest one not yet visited, reporting the order and how far each leg is.",
  version: "1.0.0",
  group: "Routing",
  keywords: ["route", "tour", "sequence", "nearest neighbour", "ordering"],

  inputs: [
    {
      id: "stops",
      label: "Stops",
      description:
        "The places to visit. Any geometry; areas are reduced to a representative point.",
      geometry: "any",
      multiple: true,
      fields: [
        { id: "id", label: "Identifier", semanticType: "identifier", required: true },
      ],
    },
  ],

  parameters: [
    {
      id: "returnToStart",
      label: "Return to the first stop at the end",
      type: "choice",
      defaultValue: "no",
      options: [
        { value: "no", label: "No" },
        { value: "yes", label: "Yes" },
      ],
    },
  ],

  accepts: [
    {
      id: "start-here",
      label: "Start from this stop",
      description: "The last one recorded wins, so changing your mind is one more record.",
      inputId: "stops",
      referent: "rows",
      targetFieldRole: "id",
      parameters: [],
    },
  ],

  outputs: [
    {
      id: "route",
      label: "Visiting order",
      kind: "join",
      joinInputId: "stops",
      joinFieldRole: "id",
      fields: [
        { name: "visit_order", type: "INTEGER" },
        { name: "leg_km", type: "DOUBLE" },
        { name: "cumulative_km", type: "DOUBLE" },
      ],
    },
  ],

  measure: {
    outputId: "route",
    field: "leg_km",
    label: "Total distance",
    unit: "km",
    aggregation: "sum",
    preferredDirection: "lower",
  },
};

// --- geometry ---------------------------------------------------------------
// Written out rather than imported. A plugin may not reach into ALUR, which is
// what keeps a bundled one and a fetched one the same kind of thing.

const toRadians = (degrees) => (degrees * Math.PI) / 180;

const distanceKm = (a, b) => {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

/**
 * One coordinate standing for a feature.
 *
 * Areas are averaged rather than rejected. Real data is rarely points — an
 * administrative unit arrives as a boundary — and demanding conversion first
 * makes a calculation unusable against the data it exists for.
 */
const representativePoint = (geometry) => {
  if (!geometry) return null;
  if (geometry.type === "Point") {
    const [lon, lat] = geometry.coordinates;
    return { lon, lat };
  }
  const positions = [];
  const walk = (value) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number") positions.push(value);
    else for (const entry of value) walk(entry);
  };
  walk(geometry.coordinates);
  if (!positions.length) return null;
  const total = positions.reduce((sum, [lon, lat]) => [sum[0] + lon, sum[1] + lat], [0, 0]);
  return { lon: total[0] / positions.length, lat: total[1] / positions.length };
};

// --- the instance -----------------------------------------------------------

class VisitOrderInstance {
  constructor(stops, byId) {
    this.stops = stops;
    this.byId = byId;
    this.returnToStart = false;
    this.startIndex = null;
  }

  async setParameters(values) {
    if (values.returnToStart !== undefined) {
      this.returnToStart = String(values.returnToStart) === "yes";
    }
  }

  /**
   * Rebuild from the whole list rather than adding to what is there.
   *
   * This is the rule the contract rests on: state at position *n* is a pure
   * function of the first *n* records, which is what makes undo exact rather
   * than approximately right. Here the last start recorded wins, so changing
   * your mind is one more record and not a special case.
   */
  async setChanges(changes) {
    this.startIndex = null;
    for (const change of [...changes].sort((a, b) => a.sequence - b.sequence)) {
      if (change.changeId !== "start-here" || change.target.kind !== "rows") continue;
      for (const rowId of change.target.rowIds) {
        const index = this.byId.get(String(rowId));
        if (index !== undefined) this.startIndex = index;
      }
    }
  }

  async evaluate() {
    const warnings = [];
    const placed = this.stops.filter((stop) => stop.point);
    if (placed.length < this.stops.length) {
      const missing = this.stops.length - placed.length;
      warnings.push(
        `${missing} stop${missing === 1 ? "" : "s"} carried no usable geometry and ${missing === 1 ? "was" : "were"} left out of the route.`,
      );
    }
    if (!placed.length) throw new Error("No stop carried usable geometry.");

    const remaining = new Set(placed.map((stop) => stop.index));
    let current =
      this.startIndex !== null && remaining.has(this.startIndex) ? this.startIndex : placed[0].index;
    if (this.startIndex !== null && !remaining.has(this.startIndex)) {
      warnings.push("The stop chosen as the start has no geometry; the route starts elsewhere.");
    }

    const visited = new Map();
    let order = 0;
    let cumulative = 0;

    while (remaining.size) {
      remaining.delete(current);
      const from = this.stops[current].point;

      let leg = null;
      if (order > 0) leg = distanceKm(this.stops[visited.get("previous")].point, from);
      if (leg !== null) cumulative += leg;

      order += 1;
      visited.set(current, { order, leg, cumulative });
      visited.set("previous", current);

      // The whole reason this is not a query: the next choice is a function of
      // everywhere already visited.
      let nearest = null;
      for (const candidate of remaining) {
        const gap = distanceKm(from, this.stops[candidate].point);
        if (!nearest || gap < nearest.gap) nearest = { index: candidate, gap };
      }
      if (!nearest) break;
      current = nearest.index;
    }

    if (this.returnToStart && order > 1) {
      const first = placed.find((stop) => visited.get(stop.index)?.order === 1);
      const last = this.stops[visited.get("previous")];
      cumulative += distanceKm(last.point, first.point);
      warnings.push(
        `The return leg is counted in the total but belongs to no stop, so the per-stop legs sum to ${(cumulative - distanceKm(last.point, first.point)).toFixed(2)} km.`,
      );
    }

    // Null, never zero, for a stop that is not on the route: zero would read on
    // a map as "visited first, at no cost".
    const rows = this.stops.map((stop) => {
      const outcome = visited.get(stop.index);
      return {
        key: stop.id,
        visit_order: outcome ? outcome.order : null,
        leg_km: outcome ? outcome.leg : null,
        cumulative_km: outcome ? outcome.cumulative : null,
      };
    });

    return {
      outputs: { route: { kind: "join", rows } },
      warnings: warnings.length ? warnings : undefined,
    };
  }

  dispose() {
    this.stops = [];
    this.byId = new Map();
  }
}

// --- the provider -----------------------------------------------------------

export const visitOrder = {
  manifest,

  async create({ inputs, parameters }) {
    const input = inputs.find((candidate) => candidate.inputId === "stops");
    if (!input?.geojson) throw new Error("The stops were not supplied as geometry.");
    const collection = JSON.parse(input.geojson);

    const byId = new Map();
    const stops = collection.features.map((feature, index) => {
      const properties = feature.properties ?? {};
      // Through `fields`, never by column name: the analyst chose the column,
      // and with several datasets bound they may each have chosen a different
      // one.
      const id = String(properties[input.fields.id] ?? index);
      if (!byId.has(id)) byId.set(id, index);
      return { id, point: representativePoint(feature.geometry), index };
    });

    if (!stops.length) throw new Error("The stops input carried no features.");

    const instance = new VisitOrderInstance(stops, byId);
    if (parameters && Object.keys(parameters).length) await instance.setParameters(parameters);
    return instance;
  },
};

export const providers = [visitOrder];
export default visitOrder;
