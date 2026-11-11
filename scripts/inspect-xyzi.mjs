import fs from "node:fs";

const filePath = "scripts/Site04_final_adj.xyzi";
const buffer = fs.readFileSync(filePath);

console.log("\n=== XYZI FILE INSPECTION ===\n");

console.log("File size:", buffer.length, "bytes");

console.log("\nFirst 64 bytes (hex):");
console.log(buffer.subarray(0, 64).toString("hex"));

console.log("\nFirst 64 bytes (ASCII):");
console.log(
  buffer.subarray(0, 64).toString("ascii")
);

console.log("\n=== POSSIBLE FLOAT32 VALUES ===\n");

for (const endian of ["LE", "BE"]) {
  console.log(`\n${endian}:`);

  for (let offset = 0; offset < 32; offset += 4) {
    const value =
      endian === "LE"
        ? buffer.readFloatLE(offset)
        : buffer.readFloatBE(offset);

    console.log(`Offset ${offset}:`, value);
  }
}

console.log("\n=== INSPECTION COMPLETE ===\n");