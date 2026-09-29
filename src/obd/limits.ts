/**
 * Primitivas de control de concurrencia y de tasa.
 *
 * Están aquí, sin ninguna dependencia de React Native, para poder ejecutarlas
 * y verificarlas fuera del teléfono (ver pruebas en tools/selftest).
 */

/** Exclusión mutua: garantiza que dos operaciones no se solapen jamás. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  private depth = 0;

  get busy() { return this.depth > 0; }

  run<T>(fn: () => Promise<T>): Promise<T> {
    this.depth++;
    const result = this.tail.then(fn, fn);
    // La cola sigue viva aunque fn falle: nunca se queda bloqueada.
    this.tail = result.then(() => undefined, () => undefined).then(() => { this.depth--; });
    return result;
  }
}

/**
 * Limitador de tasa con dos topes duros e independientes:
 *   - separación mínima entre dos envíos consecutivos (minGapMs)
 *   - número máximo de envíos por ventana de 1 s (maxPerSecond)
 *
 * No es configurable desde la interfaz a propósito: es el techo físico que
 * impide que cualquier fallo de lógica superior sature el bus del vehículo.
 */
export class RateLimiter {
  private timestamps: number[] = [];
  private lastAt = 0;

  readonly minGapMs: number;
  readonly maxPerSecond: number;
  private readonly now: () => number;

  constructor(minGapMs: number, maxPerSecond: number, now: () => number = Date.now) {
    this.minGapMs = minGapMs;
    this.maxPerSecond = maxPerSecond;
    this.now = now;
  }

  /**
   * Margen de la ventana. Entre que se decide enviar y que el byte sale de
   * verdad pasan uno o dos milisegundos, y esa deriva bastaba para que un
   * observador externo midiera un envío de más justo en el borde del segundo.
   * Contando la ventana un poco más ancha de lo que se promete, el techo se
   * cumple siempre, nunca "casi siempre".
   */
  private static readonly WINDOW_MS = 1050;

  /** Milisegundos que hay que esperar antes del próximo envío (0 = ya). */
  delayNeeded(): number {
    const t = this.now();
    this.timestamps = this.timestamps.filter(x => t - x < RateLimiter.WINDOW_MS);
    const gapWait = Math.max(0, this.lastAt + this.minGapMs - t);
    let windowWait = 0;
    if (this.timestamps.length >= this.maxPerSecond) {
      windowWait = Math.max(0, RateLimiter.WINDOW_MS - (t - this.timestamps[0]));
    }
    return Math.max(gapWait, windowWait);
  }

  /** Registra un envío. Llamar justo antes de escribir. */
  record(): void {
    const t = this.now();
    this.lastAt = t;
    this.timestamps.push(t);
    if (this.timestamps.length > this.maxPerSecond * 2) {
      this.timestamps = this.timestamps.slice(-this.maxPerSecond);
    }
  }

  /** Envíos registrados en el último segundo (para diagnóstico). */
  recentCount(): number {
    const t = this.now();
    return this.timestamps.filter(x => t - x < 1000).length;
  }

  /** Ventana real que aplica el limitador, en ms. */
  static get windowMs() { return RateLimiter.WINDOW_MS; }

  reset(): void { this.timestamps = []; this.lastAt = 0; }
}

export function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
