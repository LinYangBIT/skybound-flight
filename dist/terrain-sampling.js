/** Height queries for the exact indexed triangles used by the island meshes. */
export function createTerrainSurface(positions, segmentsX, segmentsZ) {
  return {
    positions, segmentsX, segmentsZ, stride: segmentsX + 1,
    minX: positions[0], maxX: positions[segmentsX * 3],
    minZ: positions[2], maxZ: positions[segmentsZ * (segmentsX + 1) * 3 + 2],
  };
}

export function sampleTerrainSurface(surface, x, z) {
  const { positions, segmentsX, segmentsZ, stride, minX, maxX, minZ, maxZ } = surface;
  if (!Number.isFinite(x) || !Number.isFinite(z) || x < minX || x > maxX || z < minZ || z > maxZ) return -Infinity;
  let ix = Math.min(segmentsX - 1, Math.floor((x - minX) / (maxX - minX) * segmentsX));
  let iz = Math.min(segmentsZ - 1, Math.floor((z - minZ) / (maxZ - minZ) * segmentsZ));
  // Coordinates were rounded to Float32 for rendering. Use those same cell
  // boundaries so ridge and coastline contacts agree even far from the origin.
  while (ix > 0 && x < positions[ix * 3]) ix--;
  while (ix < segmentsX - 1 && x > positions[(ix + 1) * 3]) ix++;
  while (iz > 0 && z < positions[iz * stride * 3 + 2]) iz--;
  while (iz < segmentsZ - 1 && z > positions[(iz + 1) * stride * 3 + 2]) iz++;
  const a = (iz * stride + ix) * 3, b = a + stride * 3;
  const fx = (x - positions[a]) / (positions[a + 3] - positions[a]);
  const fz = (z - positions[a + 2]) / (positions[b + 2] - positions[a + 2]);
  const h00 = positions[a + 1], h10 = positions[a + 4];
  const h01 = positions[b + 1], h11 = positions[b + 4];
  // Mesh indices are (a,b,a+1), (a+1,b,b+1). Bilinear interpolation
  // would invent curved terrain inside the cell and miss narrow ridge edges.
  return fx + fz <= 1
    ? h00 + (h10 - h00) * fx + (h01 - h00) * fz
    : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
}

export function sampleTerrainHeight(surfaces, x, z, seaLevel = 0) {
  let height = seaLevel;
  for (const surface of surfaces) height = Math.max(height, sampleTerrainSurface(surface, x, z));
  return height;
}
