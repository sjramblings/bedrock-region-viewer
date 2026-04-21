import {
  BedrockClient,
  ListFoundationModelsCommand,
  ListInferenceProfilesCommand,
  type FoundationModelSummary,
  type InferenceProfileSummary,
} from "@aws-sdk/client-bedrock";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const BEDROCK_REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "ca-central-1",
  "ca-west-1",
  "sa-east-1",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "eu-central-1",
  "eu-central-2",
  "eu-north-1",
  "eu-south-1",
  "eu-south-2",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-northeast-3",
  "ap-south-1",
  "ap-south-2",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-southeast-3",
  "ap-southeast-4",
  "ap-southeast-5",
  "ap-southeast-7",
  "ap-east-1",
  "ap-east-2",
  "af-south-1",
  "me-central-1",
  "me-south-1",
  "il-central-1",
  "mx-central-1",
];

const GEO_PREFIXES = ["us-gov", "us", "eu", "apac", "au", "ca", "jp"] as const;

type OnDemandModel = {
  modelId: string;
  providerName?: string;
  modelName?: string;
  inputModalities: string[];
  outputModalities: string[];
  inferenceTypesSupported: string[];
  responseStreamingSupported?: boolean;
};

type Profile = {
  profileId: string;
  profileName?: string;
  description?: string;
  geo?: string;
  models: string[];
  routeRegions: string[];
};

type RegionData = {
  onDemand: OnDemandModel[];
  regional: Profile[];
  global: Profile[];
};

type Output = {
  generatedAt: string;
  regions: Record<string, RegionData>;
  errors: Record<string, string>;
};

function classifyProfile(profileId: string): "global" | "regional" | "unknown" {
  if (profileId.startsWith("global.")) return "global";
  for (const prefix of GEO_PREFIXES) {
    if (profileId.startsWith(`${prefix}.`)) return "regional";
  }
  return "unknown";
}

function geoFromProfile(profileId: string): string | undefined {
  for (const prefix of GEO_PREFIXES) {
    if (profileId.startsWith(`${prefix}.`)) return prefix;
  }
  return undefined;
}

function mapModel(m: FoundationModelSummary): OnDemandModel {
  return {
    modelId: m.modelId ?? "",
    providerName: m.providerName,
    modelName: m.modelName,
    inputModalities: m.inputModalities ?? [],
    outputModalities: m.outputModalities ?? [],
    inferenceTypesSupported: m.inferenceTypesSupported ?? [],
    responseStreamingSupported: m.responseStreamingSupported,
  };
}

function mapProfile(p: InferenceProfileSummary): Profile {
  const id = p.inferenceProfileId ?? "";
  const arns = (p.models ?? [])
    .map((m) => m.modelArn ?? "")
    .filter(Boolean);
  // ARN shape: arn:aws:bedrock:<region>:<account>:foundation-model/<modelId>
  // Each entry in p.models represents one route-through region, so model IDs
  // are usually duplicated N times. Dedupe and surface the regions separately
  // so the UI can show "which regions does this profile route through".
  const models = [
    ...new Set(arns.map((arn) => arn.split("/").pop() ?? arn)),
  ].sort();
  const routeRegions = [
    ...new Set(arns.map((arn) => arn.split(":")[3] ?? "").filter(Boolean)),
  ].sort();
  return {
    profileId: id,
    profileName: p.inferenceProfileName,
    description: p.description,
    geo: geoFromProfile(id),
    models,
    routeRegions,
  };
}

async function fetchRegion(region: string): Promise<RegionData> {
  const client = new BedrockClient({ region });

  const onDemandModels: OnDemandModel[] = [];
  let onDemandNextToken: string | undefined = undefined;
  do {
    const res = await client.send(
      new ListFoundationModelsCommand({
        byInferenceType: "ON_DEMAND",
      }),
    );
    for (const m of res.modelSummaries ?? []) onDemandModels.push(mapModel(m));
    onDemandNextToken = undefined;
  } while (onDemandNextToken);

  const regional: Profile[] = [];
  const global: Profile[] = [];
  let profileNextToken: string | undefined = undefined;
  do {
    const res: any = await client.send(
      new ListInferenceProfilesCommand({
        typeEquals: "SYSTEM_DEFINED",
        nextToken: profileNextToken,
        maxResults: 100,
      }),
    );
    for (const p of res.inferenceProfileSummaries ?? []) {
      const mapped = mapProfile(p);
      const klass = classifyProfile(mapped.profileId);
      if (klass === "global") global.push(mapped);
      else if (klass === "regional") regional.push(mapped);
    }
    profileNextToken = res.nextToken;
  } while (profileNextToken);

  onDemandModels.sort((a, b) =>
    (a.providerName ?? "").localeCompare(b.providerName ?? "") ||
    (a.modelName ?? "").localeCompare(b.modelName ?? ""),
  );
  regional.sort((a, b) => a.profileId.localeCompare(b.profileId));
  global.sort((a, b) => a.profileId.localeCompare(b.profileId));

  return { onDemand: onDemandModels, regional, global };
}

async function main() {
  const output: Output = {
    generatedAt: new Date().toISOString(),
    regions: {},
    errors: {},
  };

  console.log(`Fetching ${BEDROCK_REGIONS.length} regions in parallel...`);

  const results = await Promise.allSettled(
    BEDROCK_REGIONS.map(async (region) => {
      const data = await fetchRegion(region);
      return [region, data] as const;
    }),
  );

  for (let i = 0; i < results.length; i++) {
    const region = BEDROCK_REGIONS[i];
    const r = results[i];
    if (r.status === "fulfilled") {
      const [, data] = r.value;
      output.regions[region] = data;
      console.log(
        `  ✓ ${region.padEnd(16)} on-demand=${data.onDemand.length
          .toString()
          .padStart(3)} regional=${data.regional.length
          .toString()
          .padStart(3)} global=${data.global.length.toString().padStart(3)}`,
      );
    } else {
      const msg = r.reason?.message ?? String(r.reason);
      output.errors[region] = msg;
      console.log(`  ✗ ${region.padEnd(16)} ${msg}`);
    }
  }

  const outPath = resolve(import.meta.dir, "..", "public", "data.json");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(output, null, 2));

  const ok = Object.keys(output.regions).length;
  const failed = Object.keys(output.errors).length;
  console.log(
    `\nWrote ${outPath}\n  ${ok} regions ok, ${failed} failed\n  generatedAt=${output.generatedAt}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
