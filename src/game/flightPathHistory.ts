import { LEVEL_LENGTH } from './pathGenerator';

export interface RecordedFlightPath {
  id: string;
  flightNumber: number;
  timestamp: number;
  dateStr: string;
  score: number;
  distance: number;
  maxLevel: number;
  branches: Record<number, 'LEFT' | 'RIGHT'>;
  flapsCount?: number;
  durationSeconds?: number;
  startDistance?: number;
  startX?: number;
  startLevel?: number;
  startCol?: number;
}

const STORAGE_KEY = 'feather3d_flight_paths';
const MAX_SAVED_FLIGHTS = 80;

export class FlightPathHistoryManager {
  private flights: RecordedFlightPath[] = [];
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.flights = parsed;
          return;
        }
      }

      // If no recorded flight paths yet, check if there are legacy crashes in feather3d_prior_crashes
      // and seed initial flight path records so previous play sessions appear on the map!
      const legacyCrashRaw = localStorage.getItem('feather3d_prior_crashes');
      if (legacyCrashRaw) {
        const crashes = JSON.parse(legacyCrashRaw);
        if (Array.isArray(crashes) && crashes.length > 0) {
          this.flights = crashes.slice(0, 15).map((c: any, idx: number) => {
            const dist = typeof c.distance === 'number' ? Math.floor(c.distance) : 100;
            const lvl = Math.floor(dist / 250);
            const branchesObj: Record<number, 'LEFT' | 'RIGHT'> = {};
            if (lvl >= 1 && (c.branch === 'LEFT' || c.branch === 'RIGHT')) {
              branchesObj[1] = c.branch;
            }
            return {
              id: c.id || `legacy-${idx}-${Date.now()}`,
              flightNumber: idx + 1,
              timestamp: c.timestamp || (Date.now() - (crashes.length - idx) * 60000),
              dateStr: 'Prior Flight',
              score: Math.max(0, Math.floor(dist / 25)),
              distance: dist,
              maxLevel: lvl,
              branches: branchesObj,
            };
          });
          this.saveToStorage();
        }
      }
    } catch {
      this.flights = [];
    }
  }

  private saveToStorage() {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.flights));
    } catch {
      // Storage quota or privacy mode error ignored
    }
  }

  public recordFlight(data: {
    score: number;
    distance: number;
    maxLevel: number;
    branches: Record<number, 'LEFT' | 'RIGHT'>;
    flapsCount?: number;
    durationSeconds?: number;
    startDistance?: number;
    startX?: number;
    startLevel?: number;
    startCol?: number;
  }): RecordedFlightPath {
    const flightNum = this.flights.length + 1;
    const now = new Date();
    const dateStr = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    const newFlight: RecordedFlightPath = {
      id: `flight-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      flightNumber: flightNum,
      timestamp: Date.now(),
      dateStr,
      score: data.score,
      distance: Math.max(1, Math.floor(data.distance)),
      maxLevel: data.maxLevel,
      branches: { ...data.branches },
      flapsCount: data.flapsCount,
      durationSeconds: data.durationSeconds,
      startDistance: data.startDistance,
      startX: data.startX,
      startLevel: data.startLevel,
      startCol: data.startCol,
    };

    this.flights.push(newFlight);

    // Keep up to MAX_SAVED_FLIGHTS
    if (this.flights.length > MAX_SAVED_FLIGHTS) {
      this.flights.splice(0, this.flights.length - MAX_SAVED_FLIGHTS);
    }

    this.saveToStorage();
    this.notifyListeners();
    return newFlight;
  }

  public getAllFlightPaths(): RecordedFlightPath[] {
    return [...this.flights];
  }

  public getFlightCount(): number {
    return this.flights.length;
  }

  public getBestFlight(): RecordedFlightPath | null {
    if (this.flights.length === 0) return null;
    return this.flights.reduce((best, curr) => (curr.distance > best.distance ? curr : best), this.flights[0]);
  }

  public getLatestFlight(): RecordedFlightPath | null {
    if (this.flights.length === 0) return null;
    return this.flights[this.flights.length - 1];
  }

  public clearAll() {
    this.flights = [];
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Ignore
    }
    this.notifyListeners();
  }

  public subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notifyListeners() {
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch {
        // Ignore subscriber errors
      }
    });
  }
}

export const flightPathHistory = new FlightPathHistoryManager();

/**
 * Determines which map tiles the player has already entered the start of.
 *
 * A tile is identified by its key `${level}-${col}` (e.g. "0-2" for Level 0 Origin).
 *
 * Rules:
 * 1. Level 0 Origin ("0-2") is always entered / unlocked as the foundational start.
 * 2. If a flight started at a custom start tile, that tile is entered.
 * 3. A flight enters a subsequent tile (L, col) if and only if:
 *    - The flight physically reached the starting junction of (L, col) at distance L * LEVEL_LENGTH.
 *    - The flight actually flew into that tile along that tile's checkerboard branch trajectory.
 * 4. Mid-level slalom wiggles from adjacent tiles wandering across boundaries DO NOT count.
 */
export function getEnteredStartTiles(flights: RecordedFlightPath[]): Set<string> {
  const entered = new Set<string>();

  // Level 0 Ground Origin is always accessible
  entered.add('0-2');

  for (const flight of flights) {
    const startLvl = flight.startLevel ?? 0;
    const startCol = flight.startCol ?? 2;
    const totalDist = Math.max(0, flight.distance);

    if (startLvl === 0) {
      entered.add('0-2');

      // Check if this flight reached the end of Level 0 / start of Level 1 (250m)
      if (totalDist >= LEVEL_LENGTH) {
        // Exit of Level 0 is at gx = 3
        const currentGx = 3;
        const branch1 = flight.branches?.[1] || 'RIGHT';
        if (branch1 === 'LEFT') {
          // Column 3 (col = 2): lower-right start at gx = 3
          entered.add('1-2');
        } else {
          // Column 4 (col = 3): lower-left start at gx = 3
          entered.add('1-3');
        }

        // Trace subsequent levels reached by this flight
        let lvl = 1;
        let gx = branch1 === 'LEFT' ? currentGx - 1 : currentGx + 1; // 2 or 4

        while (totalDist >= (lvl + 1) * LEVEL_LENGTH) {
          const nextLvl = lvl + 1;
          let nextBranch: 'LEFT' | 'RIGHT' = flight.branches?.[nextLvl] || 'RIGHT';
          if (gx <= 0) {
            nextBranch = 'RIGHT';
          } else if (gx >= 6) {
            nextBranch = 'LEFT';
          }

          if (nextBranch === 'LEFT') {
            const nextCol = gx - 1;
            if (nextCol >= 0 && nextCol <= 5) {
              entered.add(`${nextLvl}-${nextCol}`);
              gx = gx - 1;
            } else {
              break;
            }
          } else {
            const nextCol = gx;
            if (nextCol >= 0 && nextCol <= 5) {
              entered.add(`${nextLvl}-${nextCol}`);
              gx = gx + 1;
            } else {
              break;
            }
          }
          lvl = nextLvl;
        }
      }
    } else {
      // Flight started at custom start tile
      entered.add(`${startLvl}-${startCol}`);

      const mapCol = startCol + 1;
      const isStartEven = (startLvl + mapCol) % 2 === 0;
      const expectedStartBranch: 'LEFT' | 'RIGHT' = isStartEven ? 'LEFT' : 'RIGHT';

      // Exit gx of the start level
      let gx = expectedStartBranch === 'LEFT' ? startCol : startCol + 1;
      let lvl = startLvl;

      while (totalDist >= (lvl + 1) * LEVEL_LENGTH) {
        const nextLvl = lvl + 1;
        let nextBranch: 'LEFT' | 'RIGHT' = flight.branches?.[nextLvl] || 'RIGHT';
        if (gx <= 0) {
          nextBranch = 'RIGHT';
        } else if (gx >= 6) {
          nextBranch = 'LEFT';
        }

        if (nextBranch === 'LEFT') {
          const nextCol = gx - 1;
          if (nextCol >= 0 && nextCol <= 5) {
            entered.add(`${nextLvl}-${nextCol}`);
            gx = gx - 1;
          } else {
            break;
          }
        } else {
          const nextCol = gx;
          if (nextCol >= 0 && nextCol <= 5) {
            entered.add(`${nextLvl}-${nextCol}`);
            gx = gx + 1;
          } else {
            break;
          }
        }
        lvl = nextLvl;
      }
    }
  }

  return entered;
}
