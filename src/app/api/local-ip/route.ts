import { NextResponse } from "next/server";
import os from "os";

export async function GET() {
  try {
    const interfaces = os.networkInterfaces();
    let localIp = "localhost";

    // IPv4 주소 찾기 (192.168.x.x, 10.x.x.x 등)
    for (const name of Object.keys(interfaces)) {
      const nets = interfaces[name];
      if (!nets) continue;

      for (const net of nets) {
        // IPv4이고 내부 주소이며 loopback이 아닌 경우
        if (
          net.family === "IPv4" &&
          !net.internal &&
          (net.address.startsWith("192.168.") ||
            net.address.startsWith("10.") ||
            net.address.startsWith("172."))
        ) {
          localIp = net.address;
          break;
        }
      }
      if (localIp !== "localhost") break;
    }

    return NextResponse.json({ ip: localIp });
  } catch (error) {
    console.error("Error getting local IP:", error);
    return NextResponse.json({ ip: "localhost" }, { status: 500 });
  }
}

