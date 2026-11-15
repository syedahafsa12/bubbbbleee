import { NextResponse } from "next/server";

const NASA_PHOTOSPHERE_URL =
  "https://svs.gsfc.nasa.gov/vis/a000000/a003900/a003987/SDOAIA4500A_Jewelbox.01000.jpg";
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export async function GET() {
  try {
    const upstream = await fetch(NASA_PHOTOSPHERE_URL, {
      method: "GET",
      cache: "force-cache",
      headers: {
        Accept: "image/jpeg",
        "User-Agent": "LunaPath/1.0 (NASA SDO visible-light photosphere)",
      },
      signal: AbortSignal.timeout(20_000),
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { success: false, source: "NASA SDO/AIA 4500 Å", error: "NASA SVS returned HTTP " + upstream.status + "." },
        { status: 502 }
      );
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("image/jpeg")) {
      return NextResponse.json(
        { success: false, source: "NASA SDO/AIA 4500 Å", error: "NASA SVS did not return a JPEG image." },
        { status: 502 }
      );
    }

    const bytes = await upstream.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { success: false, source: "NASA SDO/AIA 4500 Å", error: "Image size is invalid (" + bytes.byteLength + " bytes)." },
        { status: 502 }
      );
    }

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
        "X-LunaPath-Image-Source": "NASA SDO/AIA 4500 Å",
        "X-LunaPath-Image-Use": "Visible-light photosphere reference with sunspots; historical frame",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        source: "NASA SDO/AIA 4500 Å",
        error: "Could not retrieve NASA photosphere imagery: " + (error instanceof Error ? error.message : "network request failed"),
      },
      { status: 502 }
    );
  }
}
