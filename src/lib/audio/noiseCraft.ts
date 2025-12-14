import type { NoiseCraftParam } from "@/lib/audio/noiseCraftCore";
export type {
  NoiseCraftParam,
  PersonalAudioMetrics,
} from "@/lib/audio/noiseCraftCore";
export { buildNoiseCraftParams } from "@/lib/audio/noiseCraftCore";

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

export const resolveNoiseCraftEmbed = (opts?: {
  pathnameOverride?: string;
}) => {
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
        const hostPart = port
          ? `${pageUrl.hostname}:${port}`
          : pageUrl.hostname;
        return `${protocol}//${hostPart}${path}`;
      }
      return url.toString();
    } catch {
      return raw;
    }
  };
  const resolveEnvUrl = (raw: string, defaultPort: string) => {
    // 경로만 주어진 경우(/audiocraft, /socket)는 항상 현재 origin 기준으로만 사용
    if (raw.startsWith("/")) {
      try {
        return new URL(raw, pageOrigin).toString();
      } catch {
        return raw;
      }
    }
    // 절대 URL인 경우에는 localhost → 현재 호스트 재작성 로직 유지
    return replaceLocalhostHost(raw, defaultPort);
  };

  const rawNcEnv =
    process.env.NEXT_PUBLIC_NOISECRAFT_WS_URL ||
    (isDev ? "http://localhost:4000" : "/audiocraft");
  const rawRtEnv =
    process.env.NEXT_PUBLIC_WS_URL ||
    (isDev ? "http://localhost:3001/socket" : "/socket");

  // 개발 환경에서 localhost/127.0.0.1 또는 절대 URL이 설정된 경우,
  // 현재 접속 호스트(IP/도메인) 기준으로 다시 작성.
  // 경로만 주어진 경우(/audiocraft, /socket)는 항상 현재 origin을 그대로 사용.
  const ncEnv = resolveEnvUrl(rawNcEnv, "4000");
  const rtEnv = resolveEnvUrl(rawRtEnv, "3001");

  const ncBase = ncEnv;
  const rtUrl = rtEnv;
  const normalizedNcBase = ncBase.replace(/\/$/, "");
  const normalizePatchSrc = (raw: string) => {
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith("/")) {
      return `${normalizedNcBase}${raw}`;
    }
    return `${normalizedNcBase}/${raw}`;
  };
  // NOTE: NoiseCraft 서버는 examples/ 폴더를 /public/examples 로 서빙한다.
  // docker-compose 등에서 /examples/... 로 설정되어 있으면 자동으로 보정한다.
  const normalizeExamplesPath = (raw: string) => {
    if (!raw) return raw;
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith("/public/examples/")) return raw;
    if (raw.startsWith("/examples/")) return `/public${raw}`; // -> /public/examples/...
    if (raw.startsWith("examples/")) return `public/${raw}`; // -> public/examples/...
    return raw;
  };

  const path = opts?.pathnameOverride ?? window.location.pathname ?? "";

  // 페이지 별로 다른 기본 패치를 쓸 수 있게 분기
  // - /mobile: 개인 오디오 패치(v2)
  // - /global: 글로벌 오디오 패치
  const basePatchSrcEnv =
    process.env.NEXT_PUBLIC_NOISECRAFT_PATCH_SRC?.trim() || "";
  const personalPatchSrcEnv =
    process.env.NEXT_PUBLIC_NOISECRAFT_PERSONAL_PATCH_SRC?.trim() || "";
  const globalPatchSrcEnv =
    process.env.NEXT_PUBLIC_NOISECRAFT_GLOBAL_PATCH_SRC?.trim() || "";

  const patchSrcEnvRaw = path.startsWith("/mobile")
    ? personalPatchSrcEnv ||
      basePatchSrcEnv ||
      "/public/examples/indiv_audio_map_v2.ncft"
    : path.startsWith("/global")
    ? globalPatchSrcEnv || basePatchSrcEnv
    : basePatchSrcEnv;

  const patchSrcEnv = normalizeExamplesPath(patchSrcEnvRaw);
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
  // /mobile, /global 디버그 뷰에서는 NoiseCraft 전체 패널을 보이도록 강제
  if (path.startsWith("/mobile/debug")) {
    embedSearch.set("view", "mobile-debug");
    // /mobile/debug에서는 NoiseCraft 전체 패널을 보이도록 강제
    embedSearch.set("editor", "full");
  } else if (path.startsWith("/global/debug")) {
    embedSearch.set("view", "global-debug");
    embedSearch.set("editor", "full");
  } else if (path.startsWith("/mobile")) {
    embedSearch.set("view", "mobile");
  } else if (path.startsWith("/global")) {
    embedSearch.set("view", "global");
  }
  const src = `${normalizedNcBase}/public/embedded.html?${embedSearch.toString()}`;
  const embedOrigin = new URL(src, pageOrigin).origin;
  return { src, origin: embedOrigin };
};
