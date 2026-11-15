import { NextResponse } from "next/server";

const NASA_AIA_304_URL =
  "https://svs.gsfc.nasa.gov/vis/a000000/a003900/a003983/SDOAIA304A_Jewelbox.01000.jpg";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function imageError(message: string, status: number) {
  return NextResponse.json(
    {
      success: false,
      source: "NASA Solar Dynamics Observatory / AIA 304 Å",
      error: message,
    },
    { status }
  );
}

export async function GET() {
  try {
    const upstream = await fetch(NASA_AIA_304_URL, {
      method: "GET",
      cache: "force-cache",
      headers: {
        Accept: "image/jpeg",
        "User-Agent": "LunaPath/1.0 (NASA solar reference imagery)",
      },
      signal: AbortSignal.timeout(20_000),
    });

    if (!upstream.ok) {
      return imageError(
        `NASA SVS returned HTTP ${upstream.status} for the AIA 304 reference frame.`,
        502
      );
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("image/jpeg")) {
      return imageError("NASA SVS did not return a JPEG image.", 502);
    }

    const bytes = await upstream.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
      return imageError(
        `NASA AIA image size is invalid (${bytes.byteLength} bytes).`,
        502
      );
    }

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
        "X-LunaPath-Image-Source": "NASA SDO/AIA 304 Å",
        "X-LunaPath-Image-Use": "Historical EUV false-colour reference frame; not live solar data",
      },
    });
  } catch (error) {
    return imageError(
      `Could not retrieve NASA AIA 304 imagery: ${error instanceof Error ? error.message : "network request failed"}`,
      502
    );
  }
}
