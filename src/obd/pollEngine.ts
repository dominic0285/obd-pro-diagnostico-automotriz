/**
 * PollEngine — el bucle de muestreo.
 *
 * El fallo clásico de este tipo de bucle es acabar con dos copias corriendo a
 * la vez (se para el bucle mientras está suspendido en un `await`, se vuelve a
 * arrancar, y el viejo despierta y sigue). Eso duplica la tasa de comandos y
 * es exactamente el "ciclo descontrolado" que hay que descartar.
 *
 * Aquí es imposible por construcción:
 *   - Cada arranque recibe un número de generación único.
 *   - En CADA punto de espera el bucle comprueba que su generación siga siendo
 *     la vigente; si no, termina de inmediato.
 *   - stop() incrementa la generación, así que cualquier bucle anterior muere
 *     en su siguiente comprobación aunque se vuelva a arrancar enseguida.
 *   - runExclusive() serializa con un mutex las operaciones que no pueden
 *     solaparse (leer DTC, escanear módulos, probar PIDs, terminal).
 */

import { Mutex, delay } from './limits';

export interface PollTask {
  /** Clave estable para deduplicar y reportar. */
  key: string;
  /** Comando a enviar. */
  command: string;
  /** Cabecera del módulo ('' = funcional). */
  header: string;
  rxHeader?: string;
}

export interface PollPlan {
  groups: { header: string; rxHeader?: string; tasks: PollTask[] }[];
  /** Pausa entre ciclos completos (ms). */
  intervalMs: number;
}

export interface PollEngineDeps {
  /** Envía un comando. Debe pasar por CommandPipeline. */
  send: (cmd: string, timeoutMs: number) => Promise<string>;
  /** Prepara la cabecera del grupo. Devuelve false si no se pudo. */
  ensureHeader: (header: string, rxHeader?: string) => Promise<boolean>;
  /** Plan vigente. Se relee en cada ciclo para reflejar cambios de la interfaz. */
  getPlan: () => PollPlan;
  isConnected: () => boolean;
  onResult: (task: PollTask, raw: string | null, error?: Error) => void;
  /** Se llama al final de cada grupo, para refrescar la interfaz una sola vez. */
  onCycle?: () => void;
  onFatal?: (e: Error) => void;
}

/** Pausa mínima entre PIDs dentro de un ciclo. El techo real lo pone el pipeline. */
const INTER_TASK_MS = 20;
/** Pausa cuando no hay nada que muestrear, para no girar en vacío. */
const IDLE_MS = 500;

export class PollEngine {
  private generation = 0;
  private running = false;
  private activeLoops = 0;
  /**
   * Interruptor general. Mientras esté en false, start() no hace nada — ni
   * siquiera el rearranque automático con el que runExclusive() devuelve el
   * bucle a su sitio. Sin esto, un reset() dado justo mientras corre una
   * operación exclusiva quedaba anulado por el rearranque de esa operación y
   * el bucle sobrevivía.
   */
  private enabled = true;
  private readonly mutex = new Mutex();

  private readonly deps: PollEngineDeps;

  constructor(deps: PollEngineDeps) {
    this.deps = deps;
  }

  isRunning() { return this.running; }
  /** ¿Hay una operación exclusiva en curso o esperando? */
  estaOcupado() { return this.mutex.busy; }
  /** Bucles realmente vivos. Debe ser 0 o 1, nunca más. */
  activeLoopCount() { return this.activeLoops; }

  start(): void {
    if (!this.enabled || this.running) return;
    this.running = true;
    const gen = ++this.generation;
    void this.loop(gen);
  }

  stop(): void {
    this.running = false;
    this.generation++;   // invalida cualquier bucle en vuelo
  }

  /** Para el bucle e impide cualquier rearranque hasta llamar a resume(). */
  shutdown(): void {
    this.enabled = false;
    this.stop();
  }

  /** Vuelve a permitir arranques. Solo desde una acción explícita. */
  resume(): void { this.enabled = true; }

  isEnabled(): boolean { return this.enabled; }

  /** Espera a que no quede ningún bucle vivo. */
  private async drain(timeoutMs = 4000): Promise<void> {
    const t0 = Date.now();
    while (this.activeLoops > 0 && Date.now() - t0 < timeoutMs) {
      await delay(20);
    }
  }

  /**
   * Ejecuta una operación en exclusiva: para el muestreo, espera a que el
   * bucle muera de verdad, ejecuta, y lo reanuda si estaba activo.
   * Serializado con mutex: dos llamadas simultáneas nunca se solapan.
   */
  runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    return this.mutex.run(async () => {
      const wasRunning = this.running;
      this.stop();
      await this.drain();
      try {
        return await fn();
      } finally {
        if (wasRunning) this.start();
      }
    });
  }

  private async loop(gen: number): Promise<void> {
    this.activeLoops++;
    try {
      while (this.alive(gen) && this.deps.isConnected()) {
        const plan = this.deps.getPlan();
        let worked = false;

        for (const group of plan.groups) {
          if (!this.alive(gen) || !this.deps.isConnected()) break;
          if (group.tasks.length === 0) continue;

          let ready = false;
          try {
            ready = await this.deps.ensureHeader(group.header, group.rxHeader);
          } catch {
            ready = false;
          }
          if (!this.alive(gen)) break;
          if (!ready) continue;

          for (const task of group.tasks) {
            if (!this.alive(gen) || !this.deps.isConnected()) break;
            worked = true;
            try {
              const raw = await this.deps.send(task.command, 1500);
              if (!this.alive(gen)) break;
              this.deps.onResult(task, raw);
            } catch (e) {
              if (!this.alive(gen)) break;
              this.deps.onResult(task, null, e as Error);
            }
            await delay(INTER_TASK_MS);
          }
          if (this.alive(gen)) this.deps.onCycle?.();
        }

        if (!this.alive(gen)) break;
        await delay(worked ? Math.max(50, plan.intervalMs) : IDLE_MS);
      }
    } catch (e) {
      // Un fallo inesperado nunca debe dejar el motor "encendido" de mentira.
      this.deps.onFatal?.(e as Error);
    } finally {
      this.activeLoops--;
      if (this.generation === gen) this.running = false;
    }
  }

  private alive(gen: number): boolean {
    return this.running && this.generation === gen;
  }
}
