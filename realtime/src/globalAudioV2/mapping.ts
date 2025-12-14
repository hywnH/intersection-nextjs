import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GlobalSignals, NoiseCraftParam } from "./types";

export type InterpolationMode = "linear" | "logarithmic" | "exponential";
export type MappingOperation =
  | "none"
  | "add"
  | "subtract"
  | "multiply"
  | "divide"
  | "min"
  | "max"
  | "average";

export type StreamConfig = {
  stream: keyof GlobalSignals | string;
  interpolation?: InterpolationMode;
  inputMin?: number;
  inputMax?: number;
  outputMin?: number;
  outputMax?: number;
};

export type MappingItem = {
  id?: string;
  nodeId: string | number;
  paramName?: string;
  enabled?: boolean;
  operation?: MappingOperation;
  streams: StreamConfig[];
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const interpolate = (
  value: number,
  mode: InterpolationMode,
  inputMin: number,
  inputMax: number,
  outputMin: number,
  outputMax: number
) => {
  const denom = inputMax - inputMin || 1;
  const normalized = clamp01((value - inputMin) / denom);
  let transformed = normalized;
  if (mode === "logarithmic") {
    transformed = Math.log(normalized * 9 + 1) / Math.log(10);
  } else if (mode === "exponential") {
    transformed = (Math.pow(10, normalized) - 1) / 9;
  }
  return outputMin + transformed * (outputMax - outputMin);
};

const applyOperation = (values: number[], op: MappingOperation) => {
  if (values.length === 0) return null;
  if (values.length === 1) return values[0];
  if (op === "none") return values[0];

  let result = values[0];
  for (let i = 1; i < values.length; i += 1) {
    const next = values[i]!;
    switch (op) {
      case "add":
        result += next;
        break;
      case "subtract":
        result -= next;
        break;
      case "multiply":
        result *= next;
        break;
      case "divide":
        result = next !== 0 ? result / next : result;
        break;
      case "min":
        result = Math.min(result, next);
        break;
      case "max":
        result = Math.max(result, next);
        break;
      case "average":
        result = (result * i + next) / (i + 1);
        break;
      default:
        break;
    }
  }
  return result;
};

export class GlobalMappingEvaluator {
  private mappings: MappingItem[] = [];

  constructor(mappings: MappingItem[]) {
    this.mappings = mappings;
  }

  static loadDefaultFromAssets() {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const mappingsPath = path.resolve(
      __dirname,
      "../../assets/global-workspace-mappings.json"
    );
    const raw = readFileSync(mappingsPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("global-workspace-mappings.json must be an array");
    }
    const mappings = parsed.filter(
      (m): m is MappingItem =>
        m &&
        typeof m === "object" &&
        "nodeId" in m &&
        "streams" in m &&
        Array.isArray((m as { streams: unknown }).streams)
    );
    return new GlobalMappingEvaluator(mappings);
  }

  generateParams(signals: GlobalSignals): NoiseCraftParam[] {
    const params: NoiseCraftParam[] = [];
    for (const mapping of this.mappings) {
      if (mapping.enabled === false) continue;
      if (!mapping.streams || mapping.streams.length === 0) continue;

      const streamValues = mapping.streams.map((cfg) => {
        const rawValue = (signals as unknown as Record<string, number>)[
          cfg.stream
        ];
        if (rawValue === undefined || rawValue === null) return 0;
        return interpolate(
          Number(rawValue),
          (cfg.interpolation || "linear") as InterpolationMode,
          Number(cfg.inputMin ?? 0),
          Number(cfg.inputMax ?? 1),
          Number(cfg.outputMin ?? 0),
          Number(cfg.outputMax ?? 1)
        );
      });

      const op = (mapping.operation || "none") as MappingOperation;
      const value = applyOperation(streamValues, op);
      if (value === null || value === undefined) continue;

      params.push({
        nodeId: String(mapping.nodeId),
        paramName: mapping.paramName || "value",
        value: Number(value),
      });
    }
    return params;
  }
}
