/**
 * Biome Map System
 *
 * Defines the 2D ascii tile-based biome map:
 * '.' - Default / no biome specified (falls back to existing heuristic)
 * 'H' - Rolling Hills
 * 'h' - Rolling Hills (25% less tall than original)
 * 'M' - Rugged Mountain
 * 'm' - Mountain (25% less tall than original)
 * 'C' - Deep Canyon Slots
 * 'c' - Canyon (25% less deep than original)
 */

export const rawTerrain = `
MMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMM
MMMMMMMMHHHHHHHH
MMMMMMMMHHHHHHHH
MMMMMMMMHHHHHHHH
MMMMMMMMHHHHHHHH
MMMMMMMMHHHHHHHH
MMMMMMMMHHHHHHHH
MMMMMMMMHHHHHHHH
MMMMMMMMHHHHHHHH
MMMMMMMMHHHHHHHH
MMMMMMMMHHHHHHHH
HHHHHHHHMMMMMMMM
HHHHHHHHMMMMMMMM
HHHHHHHHMMMMMMMM
HHHHHHHHMMMMMMMM
HHHHHHHHMMMMMMMM
HHHHHHHHMMMMMMMM
HHHHHHHHMMMMMMMM
HHHHHHHHMMMMMMMM
HHHHHHHHMMMMMMMM
HHHHHHHHMMMMMMMM

MM MM MM MM MM MM MM MM
hh hh hh hh hh hh hh hh
hh hh hh hh hh hh hh hh
hh hh hh hh hh hh hh hh
hh hh hh hh hh hh hh hh
hh hh hh hh hh hh hh hh
hh hh hh hh hh hh hh hh
hh hh hh hh hh hh hh hh
hh hh hh hh hh hh hh hh
hh hh hh hh hh hh hh hh

MM MM MM MM MM MM MM MM
hh hh hh hh CC hh hh hh
hh hh hh hh CC hh hh hh
hh hh hh hh CC hh hh hh
hh hh hh hh CC hh hh hh
hh hh hh hh CC hh hh hh
hh hh hh hh CC hh hh hh
hh hh hh hh CC hh hh hh
hh hh hh hh CC hh hh hh
hh hh hh hh CC hh hh hh

MM MM MM MM MM MM MM MM
MM MM MM MM hh hh hh hh
MM MM MM MM hh hh hh hh
MM MM MM MM hh hh hh hh
MM MM MM MM hh hh hh hh
MM MM MM MM hh hh hh hh
MM MM MM MM hh hh hh hh
MM MM MM MM hh hh hh hh
MM MM MM MM hh hh hh hh
MM MM MM MM hh hh hh hh
`;
`hhhhhhhhhhHHHHHH
hhhhhhhhhhHHHHHH
hhhhhhhhhhHHHHHH
hhhhhhhhhhHHHHHH
hhhhhhhhhhHHHHHH
hhhhhhhhhhHHHHHH
hhhhhhhhhhHHHHHH
hhhhhhhhhhHHHHHH
hhhhhhhhhhHHHHHH
hhhhhhhhhhHHHHHH
hhhhhhhhhhHHHHHH
`;
`
MMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMM
MMMMMMMMMMMMMMMM
MMMMMMmmmmMMMMMM
MMMMMMmmmmMMMMMM
MMMMMMmmmmMMMMMM
MMMMMMmmmmMMMMMM
MMMMMMmmmmMMMMMM
MMMMMMmmmmMMMMMM
HHHHCCmmmmHHHHHH
HHHHCCmmmmHHHHHH
HHHHHCHHHHHHHHHH
HHHHCCHHHHMHHHHH
HHHHCCHHHHMHHHHH
HHHHCCHHHHMHHHHH
HHHHCCHHHHHHHHHH
hhhhhhHHHHHHHHHH
hhhhhhHHHHHHHHHH
hhhhhhHHHHMHHHHH
hhhhhhhhhhHHHHHH
hhhhhhhhhhHHHHHH
hhhhhhhhhhHHHHHH`;

/**
 * Initializes the biome terrain map from a multi-line ascii template literal.
 * Removes empty lines and whitespace within lines.
 * Returns an array representing the map grid (mapZ rows deep, mapX elements wide).
 */
export function init(raw: string = rawTerrain): string[][] {
  const lines = raw
    .split('\n')
    .map((line) => line.replace(/\s+/g, ''))
    .filter((line) => line.length > 0);

  return lines.map((line) => line.split(''));
}

// Initialized global map grid and dimensions
export const terrainMap: string[][] = init(rawTerrain);
export const mapZ: number = terrainMap.length;
export const mapX: number = terrainMap[0]?.length ?? 16;
export const TILE_SIZE: number = 25.0; // 25m by 25m per tile

/**
 * Maps world coordinates (x, z) onto the biome map grid according to constraints:
 * - Tile size: 25m x 25m
 * - World coordinates (0, 0) map to map coordinates (mapX / 2, mapZ)
 * - The player starts at the bottom center of the map and works upward as z increases
 * - Never returns null: when out of bounds or on '.', returns 'H' for 10 tiles, 'M' for 10 tiles, and 'C' for 10 tiles cycling (replicating old 250m cycle)
 */
export function getBiomeFromMap(
  x: number,
  z: number,
  grid: string[][] = terrainMap
): string {
  // Compute default fallback replicating old code:
  // 10 tiles H (0-250m), 10 tiles M (250-500m), 10 tiles C (500-750m) in a 30-tile (750m) cycle
  const tileIndex = Math.floor(z / TILE_SIZE);
  const cycleTile = ((tileIndex % 30) + 30) % 30;
  let defaultChar = 'H';
  if (cycleTile >= 20) {
    defaultChar = 'C';
  } else if (cycleTile >= 10) {
    defaultChar = 'M';
  }

  const mZ = grid.length;
  if (mZ === 0) return defaultChar;
  const mX = grid[0].length;
  if (mX === 0) return defaultChar;

  // World (0, 0) maps to (mX / 2, mZ) in map space
  // In the 3D world (camera looking down +Z), screen left is +x and screen right is -x.
  // We use - x / TILE_SIZE so that what appears on the player's screen left comes from the left of the map string,
  // and what appears on the player's screen right comes from the right of the map string.
  const mapXCoord = mX / 2 - x / TILE_SIZE;
  const mapZCoord = mZ - z / TILE_SIZE;

  const col = Math.floor(mapXCoord);
  // As z increases from 0, mapZCoord decreases from mZ towards 0.
  // At z = 0, player is at the bottom edge entering row (mZ - 1).
  let row = Math.floor(mapZCoord);
  if (row === mZ && z >= 0) {
    row = mZ - 1;
  }

  // Check bounds: off the map uses the default H (10 tiles) -> M (10 tiles) -> C (10 tiles)
  if (col < 0 || col >= mX || row < 0 || row >= mZ) {
    return defaultChar;
  }

  const char = grid[row][col];
  if (!char || char === '.') {
    return defaultChar;
  }

  return char;
}
