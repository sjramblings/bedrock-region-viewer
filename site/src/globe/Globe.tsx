import { useEffect, useMemo, useRef, useState } from "react";
import { geoOrthographic, geoPath, geoGraticule10 } from "d3-geo";
import { drag, type D3DragEvent } from "d3-drag";
import { select } from "d3-selection";
import { scaleSqrt } from "d3-scale";
import { feature } from "topojson-client";
import type { GeometryObject, Topology } from "topojson-specification";
import type { ColorKey, RegionDot } from "../types";

// Ported from sjramblings/aws-ip-ranges/site/src/globe/Globe.tsx
// (commit-by-commit equivalent on D3 logic — drag accumulation, clipAngle 90,
// halo gradient, ease-cubed rotation animation). Differences from upstream:
//   * Props bind RegionDot[] (Bedrock data) instead of region/count pairs
//   * Pin colour comes from the precomputed `colorKey` per dot rather than
//     a partition group function — Bedrock dots are coloured by inference-
//     profile geographic membership, not commercial/govcloud partition.
//   * Pins with `inGlobal === true` get a bright cyan ring overlay.

interface Props {
  dots: RegionDot[];
  selected: string | null;
  onSelect: (region: string | null) => void;
}

const GEO_COLORS: Record<ColorKey, string> = {
  us:        "#FF9900",
  eu:        "#3B82F6",
  apac:      "#22D3D9",
  au:        "#84CC16",
  ca:        "#EF4444",
  jp:        "#EC4899",
  "us-gov":  "#A78BFA",
  multi:     "#F59E0B",
  ondemand:  "#64748B",
};

const GLOBAL_RING_COLOR = "#0FB5BA";

export function Globe({ dots, selected, onSelect }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 760, h: 760 });
  const [topology, setTopology] = useState<Topology | null>(null);
  const [topologyErr, setTopologyErr] = useState<string | null>(null);
  const [rotation, setRotation] = useState<[number, number]>([20, -10]);
  const [hover, setHover] = useState<{ region: string; x: number; y: number } | null>(null);

  const scale = useMemo(() => {
    const max = dots.reduce((m, d) => Math.max(m, d.onDemandCount), 1);
    return scaleSqrt().domain([0, max]).range([2.5, 12]);
  }, [dots]);

  // Resize observer — keep the globe square and centred
  useEffect(() => {
    const node = ref.current?.parentElement;
    if (!node) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.min(e.contentRect.width, 760);
        setSize({ w, h: w });
      }
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  // Load topology once. Falls back to sphere+graticule+pins if unavailable.
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}world-land-110m.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`world topology load failed: ${r.status}`);
        return r.json();
      })
      .then((t: Topology) => setTopology(t))
      .catch((e) => setTopologyErr((e as Error).message));
  }, []);

  // Auto-rotate to selected region using ease-cubed on a 700ms span. The
  // effect intentionally reads `rotation` once at start (snapshot, not a
  // live dep) so the animation doesn't trigger on every interim frame.
  useEffect(() => {
    if (!selected) return;
    const dot = dots.find((d) => d.region === selected);
    if (!dot) return;
    const target: [number, number] = [-dot.lng, -dot.lat];
    let raf = 0;
    const start = performance.now();
    const dur = 700;
    const [l0, p0] = rotation;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      const lambda = l0 + (target[0] - l0) * eased;
      const phi = p0 + (target[1] - p0) * eased;
      setRotation([lambda, phi]);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const { path, projection } = useMemo(() => {
    const projection = geoOrthographic()
      .scale(size.w / 2 - 12)
      .translate([size.w / 2, size.h / 2])
      .clipAngle(90)
      .rotate([rotation[0], rotation[1]]);
    const path = geoPath(projection);
    return { path, projection };
  }, [size, rotation]);

  // Drag-to-rotate. Use `ev.dx` / `ev.dy` (deltas), NOT `ev.x` / `ev.y`
  // (positions) — using positions jumps the globe at drag-start. Effect
  // binds once and reads no closure state, so drag stays smooth across
  // renders. (Pattern from aws-ip-ranges PR #5 codex P1 review.)
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const sensitivity = 0.4;
    const dragBehavior = drag<SVGSVGElement, unknown>()
      .on("drag", function (ev: D3DragEvent<SVGSVGElement, unknown, unknown>) {
        setRotation((prev) => [
          prev[0] + ev.dx * sensitivity,
          Math.max(-90, Math.min(90, prev[1] - ev.dy * sensitivity)),
        ]);
      });
    select(svg).call(dragBehavior as never);
    return () => {
      select(svg).on(".drag", null);
    };
  }, []);

  const landPath = useMemo(() => {
    if (!topology) return null;
    const obj = topology.objects.land as GeometryObject;
    const land = feature(topology, obj) as unknown as GeoJSON.Feature;
    return path(land) ?? "";
  }, [topology, path]);

  const graticulePath = useMemo(() => path(geoGraticule10()) ?? "", [path]);
  const spherePath = useMemo(() => path({ type: "Sphere" }) ?? "", [path]);
  const haloRadius = (size.w / 2) - 12;

  return (
    <div className="relative w-full" style={{ aspectRatio: "1 / 1" }}>
      {topologyErr && (
        <div className="absolute top-2 left-2 text-ink-600 text-[11px] font-mono opacity-50">
          (no land topology — sphere + pins only)
        </div>
      )}
      <svg
        ref={ref}
        width={size.w}
        height={size.h}
        viewBox={`0 0 ${size.w} ${size.h}`}
        className="cursor-grab active:cursor-grabbing select-none touch-none"
        style={{ display: "block", margin: "0 auto" }}
      >
        <defs>
          <radialGradient id="globe-shade" cx="35%" cy="35%" r="65%">
            <stop offset="0%" stopColor="#0F141A" stopOpacity={0} />
            <stop offset="70%" stopColor="#0B0F14" stopOpacity={0.65} />
            <stop offset="100%" stopColor="#000" stopOpacity={0.95} />
          </radialGradient>
          <radialGradient id="globe-halo" cx="50%" cy="50%" r="50%">
            <stop offset="92%" stopColor="#FF9900" stopOpacity={0} />
            <stop offset="100%" stopColor="#FF9900" stopOpacity={0.18} />
          </radialGradient>
          <filter id="dot-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" />
          </filter>
        </defs>

        <circle cx={size.w / 2} cy={size.h / 2} r={haloRadius + 8} fill="url(#globe-halo)" />
        <path d={spherePath} fill="#0F141A" stroke="rgba(58,70,84,0.5)" strokeWidth={1} />
        <path d={graticulePath} fill="none" stroke="rgba(58,70,84,0.35)" strokeWidth={0.5} />
        {landPath && <path d={landPath} fill="#1E2733" stroke="rgba(15,181,186,0.35)" strokeWidth={0.5} />}
        <path d={spherePath} fill="url(#globe-shade)" pointerEvents="none" />

        <g>
          {dots.map((d) => {
            const projected = projection([d.lng, d.lat]);
            if (!projected) return null;
            const [px, py] = projected;
            const r = scale(d.onDemandCount);
            const sel = selected === d.region;
            const color = GEO_COLORS[d.colorKey];
            return (
              <g
                key={d.region}
                transform={`translate(${px},${py})`}
                style={{ cursor: "pointer" }}
                onMouseEnter={(e) =>
                  setHover({ region: d.region, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })
                }
                onMouseLeave={() => setHover(null)}
                onClick={() => onSelect(sel ? null : d.region)}
              >
                <circle r={r * 1.6} fill={color} opacity={sel ? 0.3 : 0.18} filter="url(#dot-glow)" />
                <circle r={r} fill={color} opacity={0.95} stroke="#0B0F14" strokeWidth={sel ? 2 : 1} />
                {d.inGlobal && (
                  <circle r={r + 3} fill="none" stroke={GLOBAL_RING_COLOR} strokeWidth={1.4} opacity={0.85} />
                )}
                {sel && (
                  <circle r={r + 6} fill="none" stroke={color} strokeWidth={1.2} opacity={0.6}>
                    <animate
                      attributeName="r"
                      values={`${r + 4};${r + 14};${r + 4}`}
                      dur="2.4s"
                      repeatCount="indefinite"
                    />
                    <animate
                      attributeName="opacity"
                      values="0.7;0;0.7"
                      dur="2.4s"
                      repeatCount="indefinite"
                    />
                  </circle>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {hover && (() => {
        const dot = dots.find((d) => d.region === hover.region);
        if (!dot) return null;
        const [px, py] = projection([dot.lng, dot.lat]) ?? [0, 0];
        return (
          <div
            className="pointer-events-none absolute card px-3 py-2 text-xs shadow-2xl"
            style={{
              left: Math.min(size.w - 200, Math.max(0, px + 14)),
              top: Math.max(0, py - 36),
            }}
          >
            <div className="font-mono text-accent-500">{dot.region}</div>
            <div className="num-display text-base mt-0.5 text-ink-900">{dot.onDemandCount}</div>
            <div className="text-ink-600">on-demand model{dot.onDemandCount === 1 ? "" : "s"}</div>
            <div className="text-ink-600 mt-0.5">
              {dot.regionalCount} regional · {dot.globalCount} global
            </div>
            {dot.geos.length > 0 && (
              <div className="text-ink-600 mt-0.5">
                {dot.geos.length === 1 ? `geo: ${dot.geos[0]}` : `geos: ${dot.geos.join(", ")}`}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
