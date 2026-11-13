
import fs from "node:fs";

const filePath = "scripts/Site04_final_adj.xyzi";
const buffer = fs.readFileSync(filePath);

const RECORD_SIZE = 32;
const RECORD_COUNT = buffer.length / RECORD_SIZE;

if (!Number.isInteger(RECORD_COUNT)) {
  throw new Error("Invalid record size.");
}

const fields = ["x", "y", "z", "fourth"];

const stats = Object.fromEntries(
  fields.map((field) => [
    field,
    { min: Infinity, max: -Infinity, finite: true },
  ])
);

const fourthValues = new Map();
const records = [];

for (let i = 0; i < RECORD_COUNT; i++) {
  const offset = i * RECORD_SIZE;

  const record = {
    x: buffer.readDoubleLE(offset),
    y: buffer.readDoubleLE(offset + 8),
    z: buffer.readDoubleLE(offset + 16),
    fourth: buffer.readDoubleLE(offset + 24),
  };

  if (i < 10) records.push(record);

  for (const field of fields) {
    const value = record[field];
    const stat = stats[field];

    if (!Number.isFinite(value)) {
      stat.finite = false;
      continue;
    }

    if (value < stat.min) stat.min = value;
    if (value > stat.max) stat.max = value;
  }

  const fourth = record.fourth;
  fourthValues.set(
    fourth,
    (fourthValues.get(fourth) || 0) + 1
  );
}

console.log("\n=== NASA XYZI ANALYSIS ===\n");
console.log("Record count:", RECORD_COUNT);

console.log("\n=== FIRST 10 RECORDS ===\n");
console.table(records);

console.log("\n=== FIELD RANGES ===\n");
console.table(stats);

console.log("\n=== FOURTH FIELD FREQUENCIES ===\n");
console.table(
  [...fourthValues.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
);

console.log("\n=== ANALYSIS COMPLETE ===\n");
