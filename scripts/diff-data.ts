import { readFile } from "node:fs/promises";

type Delta = {
  region: string;
  addedOnDemand: string[];
  removedOnDemand: string[];
  addedRegional: string[];
  removedRegional: string[];
  addedGlobal: string[];
  removedGlobal: string[];
};

const [, , oldPath, newPath] = process.argv;
if (!oldPath || !newPath) {
  console.error("usage: bun scripts/diff-data.ts <old.json> <new.json>");
  process.exit(2);
}

const oldData = JSON.parse(await readFile(oldPath, "utf8"));
const newData = JSON.parse(await readFile(newPath, "utf8"));

const ids = (arr: unknown, key: string): Set<string> => {
  if (!Array.isArray(arr)) return new Set();
  return new Set(arr.map((x: Record<string, unknown>) => String(x[key] ?? "")).filter(Boolean));
};

const setDiff = (prev: Set<string>, next: Set<string>) => ({
  added: [...next].filter((x) => !prev.has(x)).sort(),
  removed: [...prev].filter((x) => !next.has(x)).sort(),
});

const allRegions = new Set<string>([
  ...Object.keys(oldData.regions ?? {}),
  ...Object.keys(newData.regions ?? {}),
]);

const deltas: Delta[] = [];
for (const region of [...allRegions].sort()) {
  const o = oldData.regions?.[region] ?? { onDemand: [], regional: [], global: [] };
  const n = newData.regions?.[region] ?? { onDemand: [], regional: [], global: [] };
  const od = setDiff(ids(o.onDemand, "modelId"), ids(n.onDemand, "modelId"));
  const rg = setDiff(ids(o.regional, "profileId"), ids(n.regional, "profileId"));
  const gl = setDiff(ids(o.global, "profileId"), ids(n.global, "profileId"));
  if (
    od.added.length || od.removed.length ||
    rg.added.length || rg.removed.length ||
    gl.added.length || gl.removed.length
  ) {
    deltas.push({
      region,
      addedOnDemand: od.added,
      removedOnDemand: od.removed,
      addedRegional: rg.added,
      removedRegional: rg.removed,
      addedGlobal: gl.added,
      removedGlobal: gl.removed,
    });
  }
}

if (deltas.length === 0) {
  console.log(JSON.stringify({ hasChanges: false }));
  process.exit(0);
}

const uniqAddedOnDemand = new Set<string>();
const uniqRemovedOnDemand = new Set<string>();
const uniqAddedProfiles = new Set<string>();
const uniqRemovedProfiles = new Set<string>();

for (const d of deltas) {
  d.addedOnDemand.forEach((x) => uniqAddedOnDemand.add(x));
  d.removedOnDemand.forEach((x) => uniqRemovedOnDemand.add(x));
  [...d.addedRegional, ...d.addedGlobal].forEach((x) => uniqAddedProfiles.add(x));
  [...d.removedRegional, ...d.removedGlobal].forEach((x) => uniqRemovedProfiles.add(x));
}

const titleParts: string[] = [];
if (uniqAddedOnDemand.size) titleParts.push(`+${uniqAddedOnDemand.size} model${uniqAddedOnDemand.size === 1 ? "" : "s"}`);
if (uniqRemovedOnDemand.size) titleParts.push(`-${uniqRemovedOnDemand.size} model${uniqRemovedOnDemand.size === 1 ? "" : "s"}`);
if (uniqAddedProfiles.size) titleParts.push(`+${uniqAddedProfiles.size} profile${uniqAddedProfiles.size === 1 ? "" : "s"}`);
if (uniqRemovedProfiles.size) titleParts.push(`-${uniqRemovedProfiles.size} profile${uniqRemovedProfiles.size === 1 ? "" : "s"}`);

const datePart = String(newData.generatedAt ?? "").slice(0, 10);
const title = `Bedrock catalog changes: ${titleParts.join(", ")} (${datePart})`;

const lines: string[] = [];
lines.push(`Snapshot **${newData.generatedAt}** compared to the previous commit on \`main\`.`);
lines.push("");
lines.push(`**${deltas.length}** region${deltas.length === 1 ? "" : "s"} with changes across ${allRegions.size} tracked regions.`);
lines.push("");

const section = (header: string, items: Set<string>) => {
  if (!items.size) return;
  lines.push(`### ${header}`);
  for (const x of [...items].sort()) lines.push(`- \`${x}\``);
  lines.push("");
};

if (uniqAddedOnDemand.size || uniqAddedProfiles.size) {
  lines.push("## New");
  section("On-demand models", uniqAddedOnDemand);
  section("Inference profiles", uniqAddedProfiles);
}

if (uniqRemovedOnDemand.size || uniqRemovedProfiles.size) {
  lines.push("## Removed");
  section("On-demand models", uniqRemovedOnDemand);
  section("Inference profiles", uniqRemovedProfiles);
}

lines.push("## Per-region breakdown");
lines.push("");
lines.push("<details>");
lines.push("<summary>Expand</summary>");
lines.push("");
for (const d of deltas) {
  lines.push(`#### \`${d.region}\``);
  const fmt = (xs: string[]) => xs.map((x) => `\`${x}\``).join(", ");
  if (d.addedOnDemand.length) lines.push(`- **+on-demand** ${fmt(d.addedOnDemand)}`);
  if (d.removedOnDemand.length) lines.push(`- **-on-demand** ${fmt(d.removedOnDemand)}`);
  if (d.addedRegional.length) lines.push(`- **+regional** ${fmt(d.addedRegional)}`);
  if (d.removedRegional.length) lines.push(`- **-regional** ${fmt(d.removedRegional)}`);
  if (d.addedGlobal.length) lines.push(`- **+global** ${fmt(d.addedGlobal)}`);
  if (d.removedGlobal.length) lines.push(`- **-global** ${fmt(d.removedGlobal)}`);
  lines.push("");
}
lines.push("</details>");
lines.push("");
lines.push(`Auto-opened by the nightly \`refresh-data\` workflow. The accompanying PR updates \`public/data.json\` and auto-merges once checks pass.`);

console.log(JSON.stringify({
  hasChanges: true,
  title,
  body: lines.join("\n"),
  stats: {
    regionsChanged: deltas.length,
    addedModels: uniqAddedOnDemand.size,
    removedModels: uniqRemovedOnDemand.size,
    addedProfiles: uniqAddedProfiles.size,
    removedProfiles: uniqRemovedProfiles.size,
  },
}));
