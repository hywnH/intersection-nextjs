import type {
  AudioState,
  AudioClusterState,
  AudioSelfState,
  NoiseSlot,
} from "@/types/game";

export interface NoiseCraftParam {
  nodeId: string;
  paramName?: string;
  value: number;
}

const SLOT_FALLBACKS: Record<number, { nodes: string[]; label: string }> = {
  // 기본 매핑: 1번 슬롯 → 노드 206, 2번 슬롯 → 노드 183
  0: { nodes: ["206"], label: "fact" },
  1: { nodes: ["183"], label: "Vol CHORDS" },
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const format = (value: number, precision = 3) =>
  Number(value.toFixed(precision));

const computeSelfFreq = (self: AudioSelfState | null) => {
  // Slot 1 (index 0): 0.01 ~ 0.05, 공 속도(noiseLevel)에 따라 선형 스케일
  const min = 0.01;
  const max = 0.05;
  if (!self) return format(min);
  const level = clamp(self.noiseLevel, 0, 1);
  const value = min + (max - min) * level;
  return format(value);
};

const computeSelfGain = (self: AudioSelfState | null) => {
  // Slot 2 (index 1): 0.15 ~ 0.8, 공 속도(noiseLevel)에 따라 선형 스케일
  const min = 0.15;
  const max = 0.8;
  if (!self) return format(min);
  const level = clamp(self.noiseLevel, 0, 1);
  const value = min + (max - min) * level;
  return format(value);
};

const resolveSlotNodes = (
  slots: NoiseSlot[],
  slotIndex: number,
  fallback: string[]
) => {
  const entry = slots.find((slot) => slot.slot === slotIndex);
  if (entry && entry.nodeIds.length) {
    return entry.nodeIds;
  }
  return fallback;
};

const appendSlotParams = (
  params: NoiseCraftParam[],
  slotIndex: number,
  valueList: number[],
  slots: NoiseSlot[],
  fallbackNodes: string[]
) => {
  if (!valueList.length) return;
  const nodeIds = resolveSlotNodes(slots, slotIndex, fallbackNodes);
  nodeIds.forEach((nodeId, index) => {
    const value =
      valueList[index] ?? valueList[valueList.length - 1] ?? valueList[0];
    params.push({
      nodeId,
      paramName: "value",
      value,
    });
  });
};

export const buildNoiseCraftParams = (
  audio: AudioState,
  slots: NoiseSlot[] = [],
  mode: "personal" | "global",
  proximityValue = 0
): NoiseCraftParam[] => {
  const params: NoiseCraftParam[] = [];
  if (mode === "personal") {
    appendSlotParams(
      params,
      0,
      [computeSelfFreq(audio.self)],
      slots,
      SLOT_FALLBACKS[0].nodes
    );
    appendSlotParams(
      params,
      1,
      [computeSelfGain(audio.self)],
      slots,
      SLOT_FALLBACKS[1].nodes
    );
  } else {
    appendSlotParams(params, 0, [220], slots, SLOT_FALLBACKS[0].nodes);
    appendSlotParams(params, 1, [0], slots, SLOT_FALLBACKS[1].nodes);
  }

  if (mode === "personal") {
    const clampedProximity = format(clamp(proximityValue, 0, 1));
    ["5", "35", "107"].forEach((nodeId) =>
      params.push({
        nodeId,
        paramName: "value",
        value: clampedProximity,
      })
    );
  }

  return params;
};

export const postNoiseCraftParams = (
  iframe: HTMLIFrameElement | null,
  origin: string | null,
  params: NoiseCraftParam[]
) => {
  if (!iframe || !params.length) return;
  // if (process.env.NODE_ENV === "development") {
  //   // 디버그용: 3000 → iframe으로 전송되는 파라미터 확인
  //   // eslint-disable-next-line no-console
  //   // console.log("[NoiseCraft] postParams", { origin, params });
  // }
  iframe.contentWindow?.postMessage(
    { type: "noiseCraft:setParams", params },
    origin || "*"
  );
};

export const resolveNoiseCraftEmbed = () => {
  if (typeof window === "undefined") {
    return { src: "about:blank", origin: null };
  }
  const isDev = process.env.NODE_ENV === "development";
  const ncEnv =
    process.env.NEXT_PUBLIC_NOISECRAFT_WS_URL ||
    (isDev ? "http://localhost:4000" : "/audiocraft");
  const rtEnv =
    process.env.NEXT_PUBLIC_WS_URL ||
    (isDev ? "http://localhost:3001/socket" : "/socket");
  const pageOrigin = window.location.origin;
  const ncBase = ncEnv.startsWith("/") ? `${pageOrigin}${ncEnv}` : ncEnv;
  const rtUrl = rtEnv.startsWith("/") ? `${pageOrigin}${rtEnv}` : rtEnv;
  const normalizedNcBase = ncBase.replace(/\/$/, "");
  const normalizePatchSrc = (raw: string) => {
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith("/")) {
      return `${normalizedNcBase}${raw}`;
    }
    return `${normalizedNcBase}/${raw}`;
  };
  const patchSrcEnv =
    process.env.NEXT_PUBLIC_NOISECRAFT_PATCH_SRC?.trim() || "";
  const patchProjectId =
    process.env.NEXT_PUBLIC_NOISECRAFT_PATCH_PROJECT_ID?.trim() || "";
  const embedSearch = new URLSearchParams();
  embedSearch.set("io", rtUrl);
  if (patchSrcEnv) {
    embedSearch.set("src", normalizePatchSrc(patchSrcEnv));
  } else if (patchProjectId) {
    embedSearch.set("project", patchProjectId);
  } else {
    embedSearch.set("src", `${normalizedNcBase}/current-project`);
  }
  const src = `${normalizedNcBase}/public/embedded.html?${embedSearch.toString()}`;
  const embedOrigin = new URL(src, pageOrigin).origin;
  return { src, origin: embedOrigin };
};
