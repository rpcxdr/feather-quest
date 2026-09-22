export interface MapTileCoord {
  tileX: number;
  tileZ: number;
}

export const MAP_TILE_SIZE = 25.0; // 25m x 25m per map tile

/**
 * Computes the discrete map tile coordinate for a given (x, z) world position.
 * Each tile spans 25m x 25m.
 * Math.floor is used so negative and positive coordinates seamlessly tile.
 */
export function getMapTileCoord(x: number, z: number, tileSize: number = MAP_TILE_SIZE): MapTileCoord {
  return {
    tileX: Math.floor(x / tileSize),
    tileZ: Math.floor(z / tileSize),
  };
}

/**
 * Formats a map tile coordinate as a readable string, e.g. "[0, 2]" or "Tile (0, 2)"
 */
export function formatMapTileCoord(tile: MapTileCoord): string {
  return `[${tile.tileX}, ${tile.tileZ}]`;
}
