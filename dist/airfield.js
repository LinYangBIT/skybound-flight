// Dimensions in world metres. Heading zero points towards negative Z.
export const RUNWAY_HALF_LENGTH = 1800;
export const RUNWAY_HALF_WIDTH = 45;
export const RUNWAY_START_Z = RUNWAY_HALF_LENGTH - 300;
export const RUNWAY_ELEVATION = 9;

export function runwayAt(x, z) {
  return Math.abs(x) <= RUNWAY_HALF_WIDTH && Math.abs(z) <= RUNWAY_HALF_LENGTH;
}
