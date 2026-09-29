import { GeoJsonPolygonSchema } from "../contracts/ruralProperty.ts";

export type EstimatedPerimeter = {
  polygon: {
    type: "Polygon";
    coordinates: [number, number][][];
  };
  json: string;
  sideMeters: number;
  perimeterMeters: number;
  hectares: number;
};

function round6(value: number) {
  return Math.round(value * 1e6) / 1e6;
}

/** Quadrado equivalente à área, centrado na sede, dentro de Rondônia. */
export function estimatePropertyPerimeter(
  latitude: number,
  longitude: number,
  hectares: number,
): EstimatedPerimeter | null {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(hectares) ||
    !(hectares > 0) ||
    hectares > 999_999
  )
    return null;
  const sideMeters = Math.sqrt(hectares * 10_000);
  const half = sideMeters / 2;
  const halfLat = half / 111_320;
  const cos = Math.cos((latitude * Math.PI) / 180);
  const metersPerDegLng = 111_320 * Math.max(Math.abs(cos), 0.2);
  const halfLng = half / metersPerDegLng;
  const north = round6(latitude + halfLat);
  const south = round6(latitude - halfLat);
  const west = round6(longitude - halfLng);
  const east = round6(longitude + halfLng);
  if (north === south || west === east) return null;
  const ring: [number, number][] = [
    [west, north],
    [east, north],
    [east, south],
    [west, south],
    [west, north],
  ];
  const polygon = { type: "Polygon" as const, coordinates: [ring] };
  const parsed = GeoJsonPolygonSchema.safeParse(polygon);
  if (!parsed.success) return null;
  return {
    polygon: parsed.data,
    json: JSON.stringify(parsed.data),
    sideMeters,
    perimeterMeters: sideMeters * 4,
    hectares,
  };
}

export function isEstimatedPerimeter(raw: string) {
  try {
    const parsed = GeoJsonPolygonSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.coordinates.length !== 1) return false;
    const ring = parsed.data.coordinates[0];
    if (!ring || ring.length !== 5) return false;
    const lons = new Set(ring.map((point) => point[0]));
    const lats = new Set(ring.map((point) => point[1]));
    return lons.size === 2 && lats.size === 2;
  } catch {
    return false;
  }
}
