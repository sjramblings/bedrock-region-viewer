// Types mirror the shape produced by ../../scripts/fetch-data.ts and served
// from public/data.json. Keep these in sync with the script — when the script
// adds a field, this file gets a matching property and a fallback.

export interface OnDemandModel {
  modelId: string;
  providerName?: string;
  modelName?: string;
  inputModalities: string[];
  outputModalities: string[];
  inferenceTypesSupported: string[];
  responseStreamingSupported?: boolean;
}

export interface Profile {
  profileId: string;
  profileName?: string;
  description?: string;
  geo?: string;
  models: string[];
  routeRegions: string[];
}

export interface RegionData {
  onDemand: OnDemandModel[];
  regional: Profile[];
  global: Profile[];
}

export interface BedrockSnapshot {
  generatedAt: string;
  regions: Record<string, RegionData>;
  errors: Record<string, string>;
}

// Shape consumed by the Globe section
export interface RegionDot {
  region: string;
  lng: number;
  lat: number;
  onDemandCount: number;
  regionalCount: number;
  globalCount: number;
  geos: string[];
  inGlobal: boolean;
  colorKey: ColorKey;
}

export type ColorKey =
  | "us"
  | "eu"
  | "apac"
  | "au"
  | "ca"
  | "jp"
  | "us-gov"
  | "multi"
  | "ondemand";
