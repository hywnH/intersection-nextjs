"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

export default function QRCodeDisplay() {
  const [ip, setIp] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // 클라이언트에서 직접 현재 접속한 호스트명/IP 사용
    if (typeof window !== "undefined") {
      const hostname = window.location.hostname;
      setIp(hostname);
    }
  }, []);

  if (loading || !ip) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <div className="text-white">로딩 중...</div>
      </div>
    );
  }

  // 현재 프로토콜 사용 (http 또는 https)
  const protocol =
    typeof window !== "undefined"
      ? window.location.protocol.slice(0, -1)
      : "http";
  // QR 코드는 루트 경로로 연결
  const url = `${protocol}://${ip}/`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-black">
      <div className="flex flex-col items-center justify-center">
        <QRCodeSVG
          value={url}
          size={400}
          level="H"
          includeMargin={true}
          fgColor="#ffffff"
          bgColor="#000000"
        />
        <div className="mt-8 text-center">
          <p className="text-white text-lg font-mono">{url}</p>
        </div>
      </div>
    </div>
  );
}

