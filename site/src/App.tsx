import { useEffect, useState } from "react";
import { Globe } from "./globe/Globe";
import { loadSnapshot, snapshotToDots } from "./lib/data";
import type { BedrockSnapshot, RegionDot } from "./types";

// Minimal v1 of the bedrock-region-viewer aligned port. Sections to follow
// (Hero, RegionAtlas, ProviderComposition, Footer, Nav) live in
// src/sections/ — currently only Globe is wired. See PR description for the
// follow-up checklist.

interface State {
  snapshot: BedrockSnapshot | null;
  dots: RegionDot[];
  err: string | null;
}

export function App() {
  const [{ snapshot, dots, err }, setState] = useState<State>({
    snapshot: null,
    dots: [],
    err: null,
  });
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadSnapshot()
      .then((snapshot) => {
        if (cancelled) return;
        setState({ snapshot, dots: snapshotToDots(snapshot), err: null });
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setState({ snapshot: null, dots: [], err: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen text-ink-900">
      <header className="container-x py-8">
        <div className="flex items-baseline justify-between">
          <h1 className="text-3xl font-semibold tracking-tight">
            Bedrock <span className="text-accent-500">/</span> Region Geography
          </h1>
          <span className="pill" title="Aligned port of sjramblings/aws-ip-ranges site">
            v0.1 · early
          </span>
        </div>
        <p className="mt-2 text-ink-600 text-sm max-w-2xl">
          AWS Bedrock model availability across regions and inference profiles. Pins coloured
          by which geographic profile collection each region participates in. Sized by on-demand
          model count.
        </p>
        {snapshot && (
          <p className="mt-1 text-ink-600 text-xs font-mono">
            snapshot: {snapshot.generatedAt}
          </p>
        )}
        {err && (
          <p className="mt-2 text-amber-400 text-sm">
            Failed to load <code>data.json</code>: {err}
          </p>
        )}
      </header>

      <main className="container-x pb-16">
        <section className="card p-6 md:p-8">
          <div className="grid md:grid-cols-[minmax(0,1fr)_280px] gap-6">
            <div>
              <Globe dots={dots} selected={selected} onSelect={setSelected} />
            </div>
            <aside>
              <Legend selected={selected} dots={dots} />
            </aside>
          </div>
        </section>

        <section className="mt-8 card p-6 md:p-8 text-ink-600 text-sm">
          <h2 className="text-ink-900 font-semibold text-base mb-2">Coming next</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Hero</strong> with totals + sparkline (region count, model count, profile count)</li>
            <li><strong>Region Atlas</strong> — sortable cards per region (current: globe-only)</li>
            <li><strong>Provider Composition</strong> — stacked area of Anthropic / Amazon / Meta / Cohere / Mistral</li>
            <li><strong>Profile Lens</strong> — On-demand vs Regional vs Global tier comparison</li>
            <li><strong>Model Explorer</strong> — searchable / filterable model table</li>
            <li><strong>Time-series</strong> — once <code>public/data.json</code> accrues ~90 daily commits</li>
          </ul>
        </section>
      </main>

      <footer className="container-x py-8 text-ink-600 text-xs">
        <p>
          Aligned port of{" "}
          <a className="text-accent-500 hover:underline" href="https://github.com/sjramblings/aws-ip-ranges">
            sjramblings/aws-ip-ranges
          </a>{" "}
          · data refreshed nightly via <code>scripts/fetch-data.ts</code>
        </p>
      </footer>
    </div>
  );
}

interface LegendProps {
  selected: string | null;
  dots: RegionDot[];
}

function Legend({ selected, dots }: LegendProps) {
  const sel = selected ? dots.find((d) => d.region === selected) : null;
  return (
    <div className="space-y-4 text-sm">
      <div>
        <h3 className="text-ink-900 font-semibold text-xs uppercase tracking-wider mb-2">
          Inference-profile membership
        </h3>
        <ul className="space-y-1.5 text-ink-700">
          <Swatch color="#FF9900" label="US (us.* profiles)" />
          <Swatch color="#3B82F6" label="EU (eu.* profiles)" />
          <Swatch color="#22D3D9" label="APAC (apac.* profiles)" />
          <Swatch color="#84CC16" label="Australia (au.*)" />
          <Swatch color="#EF4444" label="Canada (ca.*)" />
          <Swatch color="#EC4899" label="Japan (jp.*)" />
          <Swatch color="#A78BFA" label="GovCloud (us-gov.*)" />
          <Swatch color="#F59E0B" label="Multiple geos" />
          <Swatch color="#64748B" label="On-demand only" />
          <Swatch ringColor="#0FB5BA" label="Ring: in global.*" ring />
        </ul>
        <p className="text-ink-600 text-[11px] mt-2">
          Pin size scales with on-demand model count.
        </p>
      </div>

      {sel && (
        <div className="card p-4 bg-ink-100/40">
          <div className="font-mono text-accent-500 text-xs">{sel.region}</div>
          <div className="text-ink-900 text-xl font-semibold mt-1">
            {sel.onDemandCount}
            <span className="text-ink-600 text-xs font-normal"> on-demand</span>
          </div>
          <div className="text-ink-700 text-xs mt-2">
            {sel.regionalCount} regional · {sel.globalCount} global
          </div>
          {sel.geos.length > 0 && (
            <div className="text-ink-700 text-xs mt-1">
              geos: {sel.geos.join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Swatch({
  color,
  ringColor,
  label,
  ring,
}: {
  color?: string;
  ringColor?: string;
  label: string;
  ring?: boolean;
}) {
  const dotStyle = ring
    ? { background: "transparent", border: `2px solid ${ringColor}` }
    : { background: color };
  return (
    <li className="flex items-center gap-2">
      <span
        className="inline-block w-3 h-3 rounded-full flex-shrink-0"
        style={dotStyle}
      />
      <span className="text-xs">{label}</span>
    </li>
  );
}
