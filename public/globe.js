// Bedrock Globe — vanilla-JS port of aws-ip-ranges Globe.tsx, adapted for
// inference-profile geography. No build step. D3 + topojson loaded from CDN
// (see globe.html).

(function () {
  "use strict";

  // AWS region → [lng, lat] city centroids (D3/GeoJSON convention).
  // Mirrors sjramblings/aws-ip-ranges site/src/globe/region-coords.ts so the
  // two dashboards stay coordinate-consistent.
  const REGION_COORDS = {
    "us-east-1":      [-77.46, 38.95],
    "us-east-2":      [-83.00, 39.96],
    "us-west-1":      [-121.96, 37.35],
    "us-west-2":      [-119.70, 45.84],
    "us-gov-east-1":  [-77.46, 38.95],
    "us-gov-west-1":  [-119.70, 45.84],
    "ca-central-1":   [-73.57, 45.50],
    "ca-west-1":      [-114.07, 51.04],
    "mx-central-1":   [-100.39, 20.59],
    "sa-east-1":      [-46.63, -23.55],
    "eu-west-1":      [-6.27, 53.35],
    "eu-west-2":      [-0.13, 51.51],
    "eu-west-3":      [2.35, 48.86],
    "eu-central-1":   [8.68, 50.11],
    "eu-central-2":   [8.55, 47.37],
    "eu-north-1":     [18.07, 59.33],
    "eu-south-1":     [9.19, 45.46],
    "eu-south-2":     [-0.88, 41.66],
    "me-central-1":   [54.37, 24.47],
    "me-south-1":     [50.55, 26.07],
    "il-central-1":   [34.78, 32.08],
    "af-south-1":     [18.42, -33.92],
    "ap-east-1":      [114.17, 22.32],
    "ap-east-2":      [121.56, 25.04],
    "ap-south-1":     [72.88, 19.08],
    "ap-south-2":     [78.49, 17.39],
    "ap-northeast-1": [139.76, 35.68],
    "ap-northeast-2": [126.98, 37.57],
    "ap-northeast-3": [135.50, 34.69],
    "ap-southeast-1": [103.82, 1.35],
    "ap-southeast-2": [151.21, -33.87],
    "ap-southeast-3": [106.85, -6.21],
    "ap-southeast-4": [144.96, -37.81],
    "ap-southeast-5": [101.69, 3.14],
    "ap-southeast-7": [100.50, 13.76],
  };

  const GEO_COLORS = {
    us:        "#FF9900",
    eu:        "#3B82F6",
    apac:      "#22D3D9",
    au:        "#84CC16",
    ca:        "#EF4444",
    jp:        "#EC4899",
    "us-gov":  "#A78BFA",
    multi:     "#F59E0B",
    ondemand:  "#64748B",
    global:    "#0FB5BA",
  };

  const TOPOLOGY_URL = "https://unpkg.com/world-atlas@2/land-110m.json";

  // ── DOM refs ──
  const container = document.getElementById("globe-container");
  const errorBanner = document.getElementById("error-banner");
  const metaEl = document.getElementById("meta-generated");
  const detailEl = document.getElementById("globe-detail");
  const detailRegion = document.getElementById("detail-region");
  const detailSummary = document.getElementById("detail-summary");
  const detailProfiles = document.getElementById("detail-profiles");
  const detailClose = document.querySelector(".globe-detail-close");
  const themeToggle = document.getElementById("theme-toggle");

  // ── State ──
  let topology = null;
  let dots = [];
  let rotation = [20, -10];
  let selected = null;
  let svgEl = null;
  let projection = null;
  let path = null;
  let size = { w: 760, h: 760 };

  // Persist + restore theme
  const storedTheme = localStorage.getItem("bedrock-theme");
  if (storedTheme) document.documentElement.dataset.theme = storedTheme;
  themeToggle?.addEventListener("click", () => {
    const next = (document.documentElement.dataset.theme === "dark") ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("bedrock-theme", next);
  });

  detailClose?.addEventListener("click", () => {
    selected = null;
    detailEl.classList.add("hidden");
    redraw();
  });

  // ── Boot ──
  Promise.all([
    fetch("data.json").then((r) => r.json()).catch((e) => {
      showError("Failed to load data.json — run `bun run fetch` first. " + e.message);
      return null;
    }),
    fetch(TOPOLOGY_URL).then((r) => r.ok ? r.json() : null).catch(() => null),
  ]).then(([data, topo]) => {
    if (!data) return;
    topology = topo;
    metaEl.textContent = data.generatedAt
      ? `Snapshot: ${data.generatedAt}`
      : "Snapshot: unknown";
    dots = buildDots(data);
    initGlobe();
    redraw();
  });

  function showError(msg) {
    errorBanner.textContent = msg;
    errorBanner.classList.remove("hidden");
  }

  // ── Data shaping ──

  function buildDots(data) {
    const out = [];
    const regions = data.regions || {};
    for (const [region, rd] of Object.entries(regions)) {
      const coord = REGION_COORDS[region];
      if (!coord) continue;
      const onDemandCount = (rd.onDemand || []).length;
      // Geo memberships: which geo prefixes have profiles routing through this region
      const geos = new Set();
      for (const p of (rd.regional || [])) {
        if (p.geo) geos.add(p.geo);
      }
      const inGlobal = (rd.global || []).length > 0;
      const geoList = [...geos].sort();
      let colorKey;
      if (geoList.length === 0) colorKey = "ondemand";
      else if (geoList.length === 1) colorKey = geoList[0];
      else colorKey = "multi";

      out.push({
        region,
        lng: coord[0],
        lat: coord[1],
        onDemandCount,
        regional: rd.regional || [],
        global: rd.global || [],
        geos: geoList,
        inGlobal,
        colorKey,
      });
    }
    return out;
  }

  // ── Globe init ──

  function initGlobe() {
    container.innerHTML = "";
    const w = Math.min(container.clientWidth || 760, 760);
    size = { w, h: w };

    svgEl = d3.select(container)
      .append("svg")
      .attr("width", size.w)
      .attr("height", size.h)
      .attr("viewBox", `0 0 ${size.w} ${size.h}`)
      .style("display", "block")
      .style("margin", "0 auto")
      .style("touch-action", "none")
      .style("cursor", "grab");

    // Defs for glow + halo gradients
    const defs = svgEl.append("defs");
    const haloGrad = defs.append("radialGradient")
      .attr("id", "globe-halo")
      .attr("cx", "50%").attr("cy", "50%").attr("r", "50%");
    haloGrad.append("stop").attr("offset", "92%").attr("stop-color", "#FF9900").attr("stop-opacity", 0);
    haloGrad.append("stop").attr("offset", "100%").attr("stop-color", "#FF9900").attr("stop-opacity", 0.18);

    const shadeGrad = defs.append("radialGradient")
      .attr("id", "globe-shade")
      .attr("cx", "35%").attr("cy", "35%").attr("r", "65%");
    shadeGrad.append("stop").attr("offset", "0%").attr("stop-color", "#0F141A").attr("stop-opacity", 0);
    shadeGrad.append("stop").attr("offset", "70%").attr("stop-color", "#0B0F14").attr("stop-opacity", 0.65);
    shadeGrad.append("stop").attr("offset", "100%").attr("stop-color", "#000").attr("stop-opacity", 0.95);

    defs.append("filter").attr("id", "dot-glow")
      .attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%")
      .append("feGaussianBlur").attr("stdDeviation", 2);

    // Halo
    svgEl.append("circle")
      .attr("class", "halo")
      .attr("cx", size.w / 2).attr("cy", size.h / 2)
      .attr("r", (size.w / 2) - 4)
      .attr("fill", "url(#globe-halo)");

    // Sphere, graticule, land, dots groups (drawn order matters)
    svgEl.append("path").attr("class", "sphere").attr("fill", "#0F141A").attr("stroke", "rgba(58,70,84,0.5)").attr("stroke-width", 1);
    svgEl.append("path").attr("class", "graticule").attr("fill", "none").attr("stroke", "rgba(58,70,84,0.35)").attr("stroke-width", 0.5);
    svgEl.append("path").attr("class", "land").attr("fill", "#1E2733").attr("stroke", "rgba(15,181,186,0.35)").attr("stroke-width", 0.5);
    svgEl.append("path").attr("class", "shade").attr("fill", "url(#globe-shade)").attr("pointer-events", "none");
    svgEl.append("g").attr("class", "dots");

    // Drag to rotate — sensitivity 0.4, accumulate dx/dy (NOT absolute x/y) to
    // avoid the drag-start jump (codex P1 noted in aws-ip-ranges PR #5).
    const sensitivity = 0.4;
    svgEl.call(d3.drag()
      .on("start", () => svgEl.style("cursor", "grabbing"))
      .on("drag", (ev) => {
        rotation = [
          rotation[0] + ev.dx * sensitivity,
          Math.max(-90, Math.min(90, rotation[1] - ev.dy * sensitivity)),
        ];
        redraw();
      })
      .on("end", () => svgEl.style("cursor", "grab")));
  }

  function redraw() {
    if (!svgEl) return;

    projection = d3.geoOrthographic()
      .scale(size.w / 2 - 12)
      .translate([size.w / 2, size.h / 2])
      .clipAngle(90)
      .rotate([rotation[0], rotation[1]]);
    path = d3.geoPath(projection);

    const sphereD = path({ type: "Sphere" });
    svgEl.select(".sphere").attr("d", sphereD);
    svgEl.select(".shade").attr("d", sphereD);
    svgEl.select(".graticule").attr("d", path(d3.geoGraticule10()));

    if (topology && topology.objects && topology.objects.land) {
      const land = topojson.feature(topology, topology.objects.land);
      svgEl.select(".land").attr("d", path(land));
    }

    // Sqrt scale: pin radius from on-demand count
    const maxCount = dots.reduce((m, d) => Math.max(m, d.onDemandCount), 1);
    const scale = d3.scaleSqrt().domain([0, maxCount]).range([2.5, 12]);

    const g = svgEl.select(".dots");
    g.selectAll("g.dot").remove();

    for (const d of dots) {
      const projected = projection([d.lng, d.lat]);
      if (!projected) continue; // far hemisphere — clipped
      const [px, py] = projected;
      const r = scale(d.onDemandCount);
      const sel = selected === d.region;
      const color = GEO_COLORS[d.colorKey] || GEO_COLORS.ondemand;

      const dot = g.append("g")
        .attr("class", "dot")
        .attr("transform", `translate(${px},${py})`)
        .style("cursor", "pointer")
        .on("click", () => {
          selected = (sel ? null : d.region);
          if (selected) {
            animateRotateTo(d.lng, d.lat);
            showDetail(d);
          } else {
            detailEl.classList.add("hidden");
          }
          redraw();
        })
        .on("mouseenter", () => showTooltip(d, px, py))
        .on("mouseleave", hideTooltip);

      // Glow halo behind pin
      dot.append("circle")
        .attr("r", r * 1.6).attr("fill", color)
        .attr("opacity", sel ? 0.3 : 0.18)
        .attr("filter", "url(#dot-glow)");
      // Main pin
      dot.append("circle")
        .attr("r", r).attr("fill", color)
        .attr("opacity", 0.95)
        .attr("stroke", "#0B0F14")
        .attr("stroke-width", sel ? 2 : 1);
      // global ring overlay
      if (d.inGlobal) {
        dot.append("circle")
          .attr("r", r + 3).attr("fill", "none")
          .attr("stroke", GEO_COLORS.global).attr("stroke-width", 1.4)
          .attr("opacity", 0.85);
      }
      // Selection pulse
      if (sel) {
        const pulse = dot.append("circle")
          .attr("r", r + 6).attr("fill", "none")
          .attr("stroke", color).attr("stroke-width", 1.2).attr("opacity", 0.6);
        pulse.append("animate")
          .attr("attributeName", "r")
          .attr("values", `${r + 4};${r + 14};${r + 4}`)
          .attr("dur", "2.4s").attr("repeatCount", "indefinite");
        pulse.append("animate")
          .attr("attributeName", "opacity")
          .attr("values", "0.7;0;0.7")
          .attr("dur", "2.4s").attr("repeatCount", "indefinite");
      }
    }
  }

  // ── Animation: ease rotation to target lng/lat ──
  function animateRotateTo(lng, lat) {
    const target = [-lng, -lat];
    const start = performance.now();
    const dur = 700;
    const [l0, p0] = rotation;
    function tick(now) {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      rotation = [
        l0 + (target[0] - l0) * eased,
        p0 + (target[1] - p0) * eased,
      ];
      redraw();
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // ── Tooltip ──
  let tooltipEl = null;
  function showTooltip(d, px, py) {
    hideTooltip();
    tooltipEl = document.createElement("div");
    tooltipEl.className = "globe-tooltip";
    const geoLabel = d.geos.length === 0 ? "(on-demand only)"
      : d.geos.length === 1 ? d.geos[0]
      : `${d.geos.length} geos: ${d.geos.join(", ")}`;
    const globalLabel = d.inGlobal ? ` · in global.*` : "";
    tooltipEl.innerHTML = `
      <div class="tt-region">${escapeHtml(d.region)}</div>
      <div class="tt-stat"><strong>${d.onDemandCount}</strong> on-demand model${d.onDemandCount === 1 ? "" : "s"}</div>
      <div class="tt-stat"><strong>${d.regional.length}</strong> regional profile${d.regional.length === 1 ? "" : "s"}${globalLabel}</div>
      <div class="tt-geo">${escapeHtml(geoLabel)}</div>
    `;
    const rect = container.getBoundingClientRect();
    tooltipEl.style.left = Math.min(size.w - 200, Math.max(0, px + 14)) + "px";
    tooltipEl.style.top = Math.max(0, py - 36) + "px";
    container.appendChild(tooltipEl);
  }
  function hideTooltip() {
    if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }
  }

  // ── Detail card ──
  function showDetail(d) {
    detailEl.classList.remove("hidden");
    detailRegion.textContent = d.region;
    const summary = [
      `${d.onDemandCount} on-demand model${d.onDemandCount === 1 ? "" : "s"}`,
      `${d.regional.length} regional profile${d.regional.length === 1 ? "" : "s"}`,
      d.inGlobal ? `${d.global.length} global profile${d.global.length === 1 ? "" : "s"}` : null,
    ].filter(Boolean).join(" · ");
    detailSummary.textContent = summary;

    detailProfiles.innerHTML = "";
    const allProfiles = [
      ...d.regional.map((p) => ({ ...p, kind: "regional" })),
      ...d.global.map((p) => ({ ...p, kind: "global" })),
    ];
    if (allProfiles.length === 0) {
      const li = document.createElement("li");
      li.className = "profile-empty";
      li.textContent = "No inference profiles route through this region.";
      detailProfiles.appendChild(li);
      return;
    }
    allProfiles.sort((a, b) => a.profileId.localeCompare(b.profileId));
    for (const p of allProfiles) {
      const li = document.createElement("li");
      li.innerHTML = `
        <code>${escapeHtml(p.profileId)}</code>
        <span class="profile-kind">${p.kind}${p.geo ? ` · ${escapeHtml(p.geo)}` : ""}</span>
        <span class="profile-models">${p.models.length} model${p.models.length === 1 ? "" : "s"}</span>
      `;
      detailProfiles.appendChild(li);
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }
})();
