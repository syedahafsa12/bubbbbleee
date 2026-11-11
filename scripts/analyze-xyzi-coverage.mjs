
import fs from "node:fs";

const buffer = fs.readFileSync(
  "scripts/Site04_final_adj.xyzi"
);

const RECORD_SIZE = 32;
const COUNT = buffer.length / RECORD_SIZE;

// Observation point converted from metres to kilometres.
// Provisional assumption: XYZI coordinates use kilometres.
const targetX = -1.0000366057;
const targetY = -7.0003455653;

const radiiMeters = [25, 50, 100, 250, 500, 1000];

const counts = Object.fromEntries(
  radiiMeters.map((r) => [r, 0])
);

const nearest = [];

for (let i = 0; i < COUNT; i++) {
  const offset = i * RECORD_SIZE;

  const x = buffer.readDoubleLE(offset);
  const y = buffer.readDoubleLE(offset + 8);
  const z = buffer.readDoubleLE(offset + 16);
  const fourth = buffer.readDoubleLE(offset + 24);

  const distanceMeters =
    Math.hypot(x - targetX, y - targetY) * 1000;

  for (const radius of radiiMeters) {
    if (distanceMeters <= radius) {
      counts[radius]++;
    }
  }

  if (nearest.length < 10 || distanceMeters < nearest[9].distanceMeters) {
    nearest.push({
      record: i,
      distanceMeters,
      x,
      y,
      z,
      fourth,
    });

    nearest.sort(
      (a, b) => a.distanceMeters - b.distanceMeters
    );

    if (nearest.length > 10) nearest.pop();
  }
}

console.log("\n=== NASA LOLA POINT-CLOUD COVERAGE ===\n");

console.log("Records:", COUNT);
console.log("Target:", { x: targetX, y: targetY });

console.log("\n=== POINTS WITHIN DISTANCE ===\n");
console.table(
  Object.entries(counts).map(([radius, count]) => ({
    radiusMeters: Number(radius),
    pointCount: count,
  }))
);

console.log("\n=== 10 NEAREST POINTS ===\n");
console.table(nearest);

console.log("\n=== ANALYSIS COMPLETE ===\n");
