"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { useGameContext } from "@/context/GameContext";

const GlobalPerspectiveView = dynamic(
  () => import("@/components/global/GlobalPerspectiveView"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-white/70">
        3D 뷰 로딩 중...
      </div>
    ),
  }
);

const MAX_SPEED = 320;

const BotClients = ({ count = 10 }: { count?: number }) => {
  const { serverUrl } = useGameContext();
  const socketsRef = useRef<Socket[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!serverUrl) return;

    let cancelled = false;
    const created: Socket[] = [];

    const url = new URL(serverUrl, window.location.origin);
    const origin = `${url.protocol}//${url.host}`;
    const path = url.pathname || "/socket";

    for (let i = 0; i < count; i += 1) {
      const socket = io(origin, {
        path,
        transports: ["websocket"],
        query: {
          // 서버에서 isBot=true로 취급하도록
          type: "bot",
        },
      });

      socket.on("connect", () => {
        if (cancelled) {
          socket.disconnect();
          return;
        }
        // 서버에 플레이어 생성
        socket.emit("respawn");
        socket.emit("gotit", {
          name: `g-bot-${i + 1}`,
          screenWidth: window.innerWidth,
          screenHeight: window.innerHeight,
        });

        // 입력 패킷 전송 루프 (개인뷰와 같은 "0" 이벤트 사용)
        const sendLoop = () => {
          if (cancelled || socket.disconnected) return;
          const angle = Math.random() * Math.PI * 2;
          const speed = MAX_SPEED * (0.3 + Math.random() * 0.7);
          const vx = Math.cos(angle) * speed;
          const vy = Math.sin(angle) * speed;
          socket.emit("0", { vx, vy });
          setTimeout(sendLoop, 120);
        };
        sendLoop();
      });

      created.push(socket);
    }

    socketsRef.current = created;

    return () => {
      cancelled = true;
      socketsRef.current.forEach((s) => {
        try {
          s.disconnect();
        } catch {
          // ignore
        }
      });
      socketsRef.current = [];
    };
  }, [serverUrl, count]);

  return null;
};

export default function GlobalBotsPage() {
  return (
    <div className="h-screen w-full bg-slate-950 text-white">
      {/* 이 페이지에 접속했을 때만 봇 클라이언트들이 접속 */}
      <BotClients count={10} />
      <GlobalPerspectiveView showHud={false} showModeToggle />
    </div>
  );
}
