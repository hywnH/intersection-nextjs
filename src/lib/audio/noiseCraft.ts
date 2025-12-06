import type { AudioState, NoiseSlot } from "@/types/game";

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

const computeSelfFreq = (approachValue: number) => {
  // Slot 1 (index 0): 0.01 ~ 0.05, 접근 속도에 따라 선형 스케일
  const min = 0.01;
  const max = 0.05;
  const level = clamp(approachValue, 0, 1);
  const value = min + (max - min) * level;
  return format(value);
};

const computeSelfGain = (approachValue: number) => {
  // Slot 2 (index 1): 0.15 ~ 0.8, 접근 속도에 따라 선형 스케일
  const min = 0.15;
  const max = 0.8;
  const level = clamp(approachValue, 0, 1);
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
  approachValue = 0
): NoiseCraftParam[] => {
  const params: NoiseCraftParam[] = [];
  if (mode === "personal") {
    appendSlotParams(
      params,
      0,
      [computeSelfFreq(approachValue)],
      slots,
      SLOT_FALLBACKS[0].nodes
    );
    appendSlotParams(
      params,
      1,
      [computeSelfGain(approachValue)],
      slots,
      SLOT_FALLBACKS[1].nodes
    );
  } else {
    appendSlotParams(params, 0, [220], slots, SLOT_FALLBACKS[0].nodes);
    appendSlotParams(params, 1, [0], slots, SLOT_FALLBACKS[1].nodes);
  }

  if (mode === "personal") {
    const clampedApproach = format(clamp(approachValue, 0, 1));
    ["5", "35", "107"].forEach((nodeId) =>
      params.push({
        nodeId,
        paramName: "value",
        value: clampedApproach,
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
  if (process.env.NODE_ENV === "development") {
    // 디버그용: iframe으로 전송되는 파라미터 확인
    // eslint-disable-next-line no-console
    // console.log("[NoiseCraft] postParams", { origin, params });
  }
  // 개발 중에는 로컬/다른 포트(IP)로 접속하는 경우가 많아서
  // origin 불일치로 인한 경고를 피하기 위해 targetOrigin을 완화
  const targetOrigin =
    process.env.NODE_ENV === "development" ? "*" : origin || "*";
  iframe.contentWindow?.postMessage(
    { type: "noiseCraft:setParams", params },
    targetOrigin
  );
};

export const resolveNoiseCraftEmbed = () => {
  if (typeof window === "undefined") {
    return { src: "about:blank", origin: null };
  }
  const isDev = process.env.NODE_ENV === "development";
  const pageOrigin = window.location.origin;
  const pageUrl = new URL(pageOrigin);
  const replaceLocalhostHost = (raw: string, defaultPort: string) => {
    try {
      const url = new URL(raw, pageOrigin);
      if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
        const protocol = pageUrl.protocol;
        const port = url.port || defaultPort;
        const path = url.pathname || "/";
        const hostPart = port ? `${pageUrl.hostname}:${port}` : pageUrl.hostname;
        return `${protocol}//${hostPart}${path}`;
      }
      return url.toString();
    } catch {
      return raw;
    }
  };

  const rawNcEnv =
    process.env.NEXT_PUBLIC_NOISECRAFT_WS_URL ||
    (isDev ? "http://localhost:4000" : "/audiocraft");
  const rawRtEnv =
    process.env.NEXT_PUBLIC_WS_URL ||
    (isDev ? "http://localhost:3001/socket" : "/socket");

  // 개발 환경에서 localhost/127.0.0.1이 설정된 경우,
  // 현재 접속 호스트(IP/도메인) 기준으로 다시 작성
  const ncEnv = replaceLocalhostHost(rawNcEnv, "4000");
  const rtEnv = replaceLocalhostHost(rawRtEnv, "3001");

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
