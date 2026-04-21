const STORAGE_KEY = "bedrock-region-viewer.region";
const THEME_KEY = "bedrock-region-viewer.theme";

const GEO_LABELS = {
  us: "US",
  eu: "EU",
  apac: "APAC",
  au: "AU",
  ca: "CA",
  jp: "JP",
  "us-gov": "US-GOV",
};

const state = {
  data: null,
  region: null,
  filter: "",
};

function regionGeo(region) {
  if (region.startsWith("us-gov-")) return "us-gov";
  if (region.startsWith("us-")) return "us";
  if (region.startsWith("ca-")) return "ca";
  if (region.startsWith("sa-")) return "sa";
  if (region.startsWith("eu-")) return "eu";
  if (region.startsWith("af-")) return "af";
  if (region.startsWith("me-")) return "me";
  if (region.startsWith("il-")) return "il";
  if (region.startsWith("mx-")) return "mx";
  if (region.startsWith("ap-")) return "ap";
  return "other";
}

const GEO_GROUP_LABELS = {
  us: "United States",
  "us-gov": "US GovCloud",
  ca: "Canada",
  sa: "South America",
  eu: "Europe",
  af: "Africa",
  me: "Middle East",
  il: "Israel",
  mx: "Mexico",
  ap: "Asia Pacific",
  other: "Other",
};

const GEO_GROUP_ORDER = ["us", "ca", "sa", "eu", "af", "me", "il", "mx", "ap", "us-gov", "other"];

function populateRegionSelect() {
  const select = document.getElementById("region-select");
  const regions = Object.keys(state.data.regions).sort();

  const grouped = {};
  for (const r of regions) {
    const g = regionGeo(r);
    (grouped[g] ||= []).push(r);
  }

  const frag = document.createDocumentFragment();
  for (const g of GEO_GROUP_ORDER) {
    if (!grouped[g]) continue;
    const og = document.createElement("optgroup");
    og.label = GEO_GROUP_LABELS[g] ?? g;
    for (const r of grouped[g]) {
      const opt = document.createElement("option");
      opt.value = r;
      opt.textContent = r;
      og.appendChild(opt);
    }
    frag.appendChild(og);
  }
  select.innerHTML = "";
  select.appendChild(frag);

  const saved = localStorage.getItem(STORAGE_KEY);
  const initial =
    saved && state.data.regions[saved]
      ? saved
      : regions.includes("us-east-1")
        ? "us-east-1"
        : regions[0];
  select.value = initial;
  state.region = initial;
}

function setMeta() {
  const el = document.getElementById("meta-generated");
  const d = new Date(state.data.generatedAt);
  const abs = d.toLocaleString();
  const ago = relativeTime(d);
  el.textContent = `Generated ${abs} (${ago})`;
}

function relativeTime(d) {
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function matchesFilter(...strings) {
  if (!state.filter) return true;
  const f = state.filter.toLowerCase();
  return strings.some((s) => s && s.toLowerCase().includes(f));
}

function copyCell(id) {
  const btn = document.createElement("button");
  btn.className = "copy";
  btn.type = "button";
  btn.textContent = id;
  btn.title = `Click to copy: ${id}`;
  btn.addEventListener("click", () => copyToClipboard(id));
  return btn;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  showToast("Copied");
}

let toastTimer;
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.classList.add("hidden"), 200);
  }, 900);
}

function renderOnDemand(models) {
  const tbody = document.getElementById("tbody-onDemand");
  tbody.innerHTML = "";
  let shown = 0;
  for (const m of models) {
    if (
      !matchesFilter(
        m.modelId,
        m.providerName,
        m.modelName,
        ...(m.inputModalities ?? []),
      )
    )
      continue;
    const tr = document.createElement("tr");

    const tdProv = document.createElement("td");
    tdProv.textContent = m.providerName ?? "";
    tr.appendChild(tdProv);

    const tdName = document.createElement("td");
    tdName.textContent = m.modelName ?? "";
    tr.appendChild(tdName);

    const tdId = document.createElement("td");
    tdId.appendChild(copyCell(m.modelId));
    tr.appendChild(tdId);

    const tdIn = document.createElement("td");
    tdIn.appendChild(tagList(m.inputModalities));
    tr.appendChild(tdIn);

    const tdOut = document.createElement("td");
    tdOut.appendChild(tagList(m.outputModalities));
    tr.appendChild(tdOut);

    const tdStream = document.createElement("td");
    if (m.responseStreamingSupported) {
      tdStream.innerHTML = '<span class="yes">Yes</span>';
    } else {
      tdStream.innerHTML = '<span class="no">—</span>';
    }
    tr.appendChild(tdStream);

    tbody.appendChild(tr);
    shown++;
  }
  document.getElementById("count-onDemand").textContent = shown;
  toggleEmpty("onDemand", shown === 0);
}

function renderProfiles(sectionId, profiles, includeGeo) {
  const tbody = document.getElementById(`tbody-${sectionId}`);
  tbody.innerHTML = "";
  let shown = 0;
  for (const p of profiles) {
    if (
      !matchesFilter(
        p.profileId,
        p.profileName,
        p.description,
        ...(p.models ?? []),
      )
    )
      continue;
    const tr = document.createElement("tr");

    if (includeGeo) {
      const tdGeo = document.createElement("td");
      const geo = p.geo ?? "";
      const label = GEO_LABELS[geo] ?? geo.toUpperCase();
      const span = document.createElement("span");
      span.className = `badge badge-${geo || "other"}`;
      span.textContent = label;
      tdGeo.appendChild(span);
      tr.appendChild(tdGeo);
    }

    const tdName = document.createElement("td");
    tdName.textContent = p.profileName ?? "";
    tr.appendChild(tdName);

    const tdId = document.createElement("td");
    tdId.appendChild(copyCell(p.profileId));
    tr.appendChild(tdId);

    const tdModels = document.createElement("td");
    tdModels.appendChild(tagList(uniq(p.models)));
    tr.appendChild(tdModels);

    const tdRoutes = document.createElement("td");
    const routes = uniq(p.routeRegions);
    if (routes.length === 0 && p.profileId?.startsWith("global.")) {
      const div = document.createElement("div");
      div.className = "tags";
      const span = document.createElement("span");
      span.className = "tag routes-all";
      span.textContent = "All commercial regions";
      div.appendChild(span);
      tdRoutes.appendChild(div);
    } else {
      tdRoutes.appendChild(tagList(routes));
    }
    tr.appendChild(tdRoutes);

    tbody.appendChild(tr);
    shown++;
  }
  document.getElementById(`count-${sectionId}`).textContent = shown;
  toggleEmpty(sectionId, shown === 0);
}

function tagList(items) {
  const div = document.createElement("div");
  div.className = "tags";
  if (!items || items.length === 0) {
    const em = document.createElement("span");
    em.className = "tag empty-tag";
    em.textContent = "—";
    div.appendChild(em);
    return div;
  }
  for (const it of items) {
    const span = document.createElement("span");
    span.className = "tag";
    span.textContent = it;
    div.appendChild(span);
  }
  return div;
}

function uniq(items) {
  if (!Array.isArray(items)) return [];
  return [...new Set(items)].sort();
}

function toggleEmpty(sectionId, empty) {
  const el = document.getElementById(`empty-${sectionId}`);
  el.classList.toggle("show", empty);
}

function renderRegion() {
  const r = state.region;
  const banner = document.getElementById("error-banner");
  const err = state.data.errors?.[r];
  if (err) {
    banner.textContent = `Could not fetch ${r}: ${err}`;
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }

  const d = state.data.regions[r];
  if (!d) {
    renderOnDemand([]);
    renderProfiles("regional", [], true);
    renderProfiles("global", [], false);
    return;
  }
  renderOnDemand(d.onDemand ?? []);
  renderProfiles("regional", d.regional ?? [], true);
  renderProfiles("global", d.global ?? [], false);
}

function wireControls() {
  document.getElementById("region-select").addEventListener("change", (e) => {
    state.region = e.target.value;
    localStorage.setItem(STORAGE_KEY, state.region);
    renderRegion();
  });
  document.getElementById("filter").addEventListener("input", (e) => {
    state.filter = e.target.value.trim();
    renderRegion();
  });
  const themeBtn = document.getElementById("theme-toggle");
  themeBtn.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(THEME_KEY, next);
  });
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme === "dark" || (!savedTheme && matchMedia("(prefers-color-scheme: dark)").matches)) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
}

async function main() {
  let resp;
  try {
    resp = await fetch("data.json", { cache: "no-store" });
  } catch (e) {
    showFatalError(
      `Could not load data.json. Run: bun run fetch (then refresh). ${e.message}`,
    );
    return;
  }
  if (!resp.ok) {
    showFatalError(
      `data.json returned HTTP ${resp.status}. Run: bun run fetch.`,
    );
    return;
  }
  state.data = await resp.json();
  if (!state.data.regions || Object.keys(state.data.regions).length === 0) {
    showFatalError(
      "data.json has no regions. Check AWS credentials and re-run: bun run fetch.",
    );
    return;
  }
  populateRegionSelect();
  setMeta();
  wireControls();
  renderRegion();
}

function showFatalError(msg) {
  const banner = document.getElementById("error-banner");
  banner.textContent = msg;
  banner.classList.remove("hidden");
  document.getElementById("meta-generated").textContent = "Data not loaded";
}

main();
