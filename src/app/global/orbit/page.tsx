"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import QRCodeDisplay from "@/components/shared/QRCodeDisplay";

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

export default function GlobalOrbitPage() {
  const [showQR, setShowQR] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // 입력 필드에 포커스가 있으면 무시
      if (
        document.activeElement &&
        (document.activeElement.tagName === "INPUT" ||
          document.activeElement.tagName === "TEXTAREA")
      ) {
        return;
      }

      // 스페이스바 처리
      if (event.code === "Space") {
        event.preventDefault();
        setShowQR((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div className="relative h-screen w-full bg-slate-950 text-white">
      <GlobalPerspectiveView
        showHud={false}
        showModeToggle={false}
        initialViewMode="perspective"
        hideIframe={true}
      />
      {showQR && (
        <div className="fixed inset-0 z-50 bg-black">
          <QRCodeDisplay />
        </div>
      )}
    </div>
  );
}

