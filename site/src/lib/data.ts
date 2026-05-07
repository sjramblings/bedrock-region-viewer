import type { BedrockSnapshot, ColorKey, RegionDot } from "../types";
import { REGION_COORDS } from "../globe/region-coords";

// Vite serves anything in /public at the site root; the existing fetch
// pipeline already writes public/data.json there. We re-fetch through the
// app entry rather than importing at build time so the deploy pipeline can
// refresh data without rebuilding the SPA.
export async function loadSnapshot(): Promise<BedrockSnapshot> {
  const res = await fetch(`${import.meta.env.BASE_URL}data.json`);
  if (!res.ok) {
    throw new Error(`Failed to load data.json: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as BedrockSnapshot;
}

// Shape the snapshot into globe-ready RegionDot rows. Skips regions without
// a coordinate entry (e.g., regions that exist in AWS but are not yet in
// REGION_COORDS — those should be added to the lookup table rather than
// silently invented here).
export function snapshotToDots(snapshot: BedrockSnapshot): RegionDot[] {
  const out: RegionDot[] = [];
  for (const [region, rd] of Object.entries(snapshot.regions ?? {})) {
    const coord = REGION_COORDS[region];
    if (!coord) continue;
    const geos = new Set<string>();
    for (const p of rd.regional ?? []) {
      if (p.geo) geos.add(p.geo);
    }
    const geoList = [...geos].sort();
    const inGlobal = (rd.global ?? []).length > 0;
    const colorKey: ColorKey =
      geoList.length === 0 ? "ondemand"
      : geoList.length === 1 ? (geoList[0] as ColorKey)
      : "multi";
    out.push({
      region,
      lng: coord[0],
      lat: coord[1],
      onDemandCount: (rd.onDemand ?? []).length,
      regionalCount: (rd.regional ?? []).length,
      globalCount: (rd.global ?? []).length,
      geos: geoList,
      inGlobal,
      colorKey,
    });
  }
  return out.sort((a, b) => a.region.localeCompare(b.region));
}
