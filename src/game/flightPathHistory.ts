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
          let modified = false;
          this.flights = parsed
            .filter((f) => f && f.id !== 'active-live-flight')
            .map((f: RecordedFlightPath) => {
              const startDist = f.startDistance ?? ((f.startLevel ?? 0) * LEVEL_LENGTH);
              // Migrate legacy flights where distance recorded absolute path coordinate instead of distance flown
              if (startDist > 0 && f.distance >= startDist) {
                modified = true;
                return {
                  ...f,
                  distance: Math.max(1, f.distance - startDist),
                  maxLevel: Math.max(f.startLevel ?? 0, Math.floor(f.distance / LEVEL_LENGTH)),
                };
              }
              return f;
            });
          if (modified) {
            this.saveToStorage();
          }
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
 * 3. When a flight makes it past a decision point (at distance (L + 1) * LEVEL_LENGTH),
 *    both directions (LEFT and RIGHT) originating from that decision point junction are unlocked,
 *    even if the flight physically chose only one of them.
 * 4. Subsequent decision points along the flight's chosen trajectory continue to unlock both
 *    diverging branches for each decision point reached.
 */
export function getEnteredStartTiles(flights: RecordedFlightPath[]): Set<string> {
  const entered = new Set<string>();

  // Level 0 Ground Origin is always accessible
  entered.add('0-2');

  for (const flight of flights) {
    const startLvl = flight.startLevel ?? 0;
    const startCol = flight.startCol ?? 2;
    const startDist = flight.startDistance ?? (startLvl * LEVEL_LENGTH);
    const totalDist = startDist + Math.max(0, flight.distance);

    let lvl: number;
    let gx: number;

    if (startLvl === 0) {
      entered.add('0-2');
      lvl = 0;
      // Exit junction of Level 0 is at gx = 3
      gx = 3;
    } else {
      // Flight started at custom start tile
      entered.add(`${startLvl}-${startCol}`);

      const mapCol = startCol + 1;
      const isStartEven = (startLvl + mapCol) % 2 === 0;
      const expectedStartBranch: 'LEFT' | 'RIGHT' = isStartEven ? 'LEFT' : 'RIGHT';

      // Exit gx of the custom start level
      gx = expectedStartBranch === 'LEFT' ? startCol : startCol + 1;
      lvl = startLvl;
    }

    // Traverse decision points reached by this flight.
    // The player MUST reach the decision point at distance (lvl + 1) * LEVEL_LENGTH
    // for the two subsequent directions (left and right) to be unlocked:
    while (totalDist >= (lvl + 1) * LEVEL_LENGTH - 0.5) {
      const nextLvl = lvl + 1;

      // When the player makes it past the decision point at distance (lvl + 1) * LEVEL_LENGTH,
      // unlock BOTH directions (left and right) from junction gx:
      // Left direction:
      const leftCol = gx - 1;
      if (leftCol >= 0 && leftCol <= 5) {
        entered.add(`${nextLvl}-${leftCol}`);
      }

      // Right direction:
      const rightCol = gx;
      if (rightCol >= 0 && rightCol <= 5) {
        entered.add(`${nextLvl}-${rightCol}`);
      }

      // Determine which branch the flight actually followed to trace future decision points
      let nextBranch: 'LEFT' | 'RIGHT' = flight.branches?.[nextLvl] || 'RIGHT';
      if (gx <= 0) {
        nextBranch = 'RIGHT';
      } else if (gx >= 6) {
        nextBranch = 'LEFT';
      }

      gx = nextBranch === 'LEFT' ? gx - 1 : gx + 1;
      if (gx < 0 || gx > 6) {
        break;
      }
      lvl = nextLvl;
    }
  }

  return entered;
}
