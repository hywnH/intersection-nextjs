import type {
  AudioState,
  AudioClusterState,
  AudioSelfState,
} from "@/types/game";

export interface NoiseCraftParam {
  nodeId: string;
  paramName?: string;
  value: number;
}

const NODE_IDS = {
  selfFreq: "0",
  selfGain: "1",
  clusterFreqs: ["4", "6", "8"],
  clusterGain: "12",
} as const;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const format = (value: number, precision = 3) =>
  Number(value.toFixed(precision));

const buildSelfParams = (self: AudioSelfState | null): NoiseCraftParam[] => {
  if (!self) {
    return [
      { nodeId: NODE_IDS.selfGain, paramName: "value", value: 0 },
      { nodeId: NODE_IDS.selfFreq, paramName: "value", value: 220 },
    ];
  }
  const freq = clamp(150 + self.noiseLevel * 480, 100, 900);
  const gain = clamp(0.05 + self.ambientLevel * 0.45, 0.05, 0.7);
  return [
    { nodeId: NODE_IDS.selfFreq, paramName: "value", value: format(freq, 2) },
    { nodeId: NODE_IDS.selfGain, paramName: "value", value: format(gain) },
  ];
};

const buildClusterParams = (
  cluster: AudioClusterState | null
): NoiseCraftParam[] => {
  if (!cluster) {
    return [
      { nodeId: NODE_IDS.clusterGain, paramName: "value", value: 0 },
      ...NODE_IDS.clusterFreqs.map((nodeId) => ({
        nodeId,
        paramName: "value",
        value: 0,
      })),
    ];
  }

  const params: NoiseCraftParam[] = [];
  NODE_IDS.clusterFreqs.forEach((nodeId, index) => {
    const note =
      cluster.chord[index] ?? cluster.chord[cluster.chord.length - 1] ?? null;
    if (!note) return;
    params.push({
      nodeId,
      paramName: "value",
      value: format(note.freq, 2),
    });
  });
  params.push({
    nodeId: NODE_IDS.clusterGain,
    paramName: "value",
    value: format(clamp(cluster.gain, 0, 1)),
  });
  return params;
};

export const buildNoiseCraftParams = (
  audio: AudioState,
  mode: "personal" | "global"
): NoiseCraftParam[] => {
  if (mode === "personal") {
    return [
      ...buildSelfParams(audio.self),
      ...buildClusterParams(audio.cluster),
    ];
  }
  return buildClusterParams(audio.global);
};

export const postNoiseCraftParams = (
  iframe: HTMLIFrameElement | null,
  origin: string | null,
  params: NoiseCraftParam[]
) => {
  if (!iframe || !origin || !params.length) return;
  iframe.contentWindow?.postMessage(
    { type: "noiseCraft:setParams", params },
    origin
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
  const src = `${ncBase.replace(
    /\/$/,
    ""
  )}/public/embedded.html?io=${encodeURIComponent(rtUrl)}`;
  const embedOrigin = new URL(ncBase, pageOrigin).origin;
  return { src, origin: embedOrigin };
};
