/**
 * CommandPipeline — el único camino por el que un byte puede llegar al vehículo.
 *
 * Garantías que ofrece, verificadas con pruebas automáticas (tools/selftest):
 *
 *  G1  Un solo comando en vuelo. Nunca se escribe un comando mientras otro
 *      espera respuesta.
 *  G2  Sincronía con el prompt. Tras un timeout NO se envía el siguiente
 *      comando hasta ver el prompt '>' pendiente o agotar la ventana de
 *      resincronización. El datasheet del ELM327 lo exige: "wait for either
 *      the prompt character ('>' or hex 3E) ... before beginning to send the
 *      next command".
 *  G3  Techo de tasa. Separación mínima entre envíos y máximo por segundo,
 *      no configurables desde la interfaz.
 *  G4  Cola acotada. Si algo intentara encolar sin control, se rechaza.
 *  G5  Lista blanca obligatoria. Todo comando pasa por assertTransportAllowed.
 *  G6  Sin atribución cruzada. Una respuesta que llega tarde se descarta; no
 *      puede entregarse como resultado de otro comando.
 *  G7  Cortacircuitos. Tras N timeouts consecutivos el canal se detiene y
 *      avisa, en vez de seguir insistiendo indefinidamente.
 */

import { RateLimiter } from './limits';
import { assertTransportAllowed } from './safety';

// ── Topes duros. Deliberadamente no expuestos a la interfaz. ───────────────
export const HARD_LIMITS = {
  /** Separación mínima entre dos escrituras (ms). */
  MIN_GAP_MS: 25,
  /** Máximo de comandos por segundo hacia el adaptador. */
  MAX_PER_SECOND: 20,
  /** Máximo de comandos esperando en cola. */
  MAX_QUEUE: 32,
  /** Timeouts consecutivos antes de abrir el cortacircuitos. */
  MAX_CONSECUTIVE_TIMEOUTS: 12,
  /** Espera máxima del prompt pendiente tras un timeout (ms). */
  RESYNC_WINDOW_MS: 1200,
  /** Tamaño máximo del buffer de recepción antes de considerarlo basura. */
  MAX_RX_BUFFER: 8192,
} as const;

export interface PipelineHooks {
  /** Escribe la cadena (ya con el CR final) en el adaptador. */
  write: (payload: string) => Promise<void>;
  log?: (dir: 'tx' | 'rx' | 'sys', text: string) => void;
  /** Se llama cuando el cortacircuitos se abre. */
  onCircuitOpen?: (reason: string) => void;
  now?: () => number;
}

interface Job {
  id: number;
  cmd: string;
  timeoutMs: number;
  resolve: (r: string) => void;
  reject: (e: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export class CommandPipeline {
  private queue: Job[] = [];
  private inFlight: Job | null = null;
  private nextId = 1;
  private rx = '';
  private pumping = false;
  private open = true;                 // false = cortacircuitos abierto
  private strict = false;
  /** Nº de prompts que deben descartarse antes de aceptar una respuesta. */
  private pendingPrompts = 0;
  private resyncUntil = 0;
  private consecutiveTimeouts = 0;
  private readonly limiter: RateLimiter;
  private readonly now: () => number;

  // Contadores de diagnóstico
  readonly stats = { written: 0, resolved: 0, timeouts: 0, blocked: 0, dropped: 0, rejectedQueue: 0 };

  private readonly hooks: PipelineHooks;

  constructor(hooks: PipelineHooks) {
    this.hooks = hooks;
    this.now = hooks.now ?? Date.now;
    this.limiter = new RateLimiter(HARD_LIMITS.MIN_GAP_MS, HARD_LIMITS.MAX_PER_SECOND, this.now);
  }

  setStrict(v: boolean) { this.strict = v; }
  isOpen() { return this.open; }
  inFlightCount() { return this.inFlight ? 1 : 0; }
  queueLength() { return this.queue.length; }
  commandsLastSecond() { return this.limiter.recentCount(); }

  /** Reabre el canal tras un corte (al reconectar). */
  resetCircuit() {
    this.open = true;
    this.consecutiveTimeouts = 0;
    this.limiter.reset();
  }

  /**
   * Encola un comando. Rechaza —sin escribir nada— si no pasa la lista blanca,
   * si la cola está llena o si el cortacircuitos está abierto.
   */
  send(cmd: string, timeoutMs = 2000): Promise<string> {
    const clean = cmd.trim();
    try {
      assertTransportAllowed(clean, this.strict);
    } catch (e) {
      this.stats.blocked++;
      this.hooks.log?.('sys', `${clean} — ${(e as Error).message}`);
      return Promise.reject(e as Error);
    }
    if (!this.open) {
      return Promise.reject(new Error('Canal detenido por seguridad tras varios fallos seguidos. Reconecta el escáner.'));
    }
    if (this.queue.length >= HARD_LIMITS.MAX_QUEUE) {
      this.stats.rejectedQueue++;
      return Promise.reject(new Error('Cola de comandos llena; se descarta la petición para no saturar el adaptador.'));
    }
    return new Promise<string>((resolve, reject) => {
      this.queue.push({ id: this.nextId++, cmd: clean, timeoutMs, resolve, reject });
      void this.pump();
    });
  }

  /** Cancela lo pendiente (desconexión, cambio de perfil). */
  cancelAll(reason: string) {
    const pending = [...(this.inFlight ? [this.inFlight] : []), ...this.queue];
    this.queue = [];
    if (this.inFlight?.timer) clearTimeout(this.inFlight.timer);
    this.inFlight = null;
    this.rx = '';
    this.pendingPrompts = 0;
    pending.forEach(j => { if (j.timer) clearTimeout(j.timer); j.reject(new Error(reason)); });
  }

  /** Entrada de datos desde el enlace BLE. */
  feed(chunk: string) {
    this.rx += chunk;
    if (this.rx.length > HARD_LIMITS.MAX_RX_BUFFER) {
      this.rx = this.rx.slice(-1024);
      this.hooks.log?.('sys', 'buffer de recepción desbordado, se descarta lo antiguo');
    }

    for (;;) {
      const idx = this.rx.indexOf('>');
      if (idx === -1) return;
      const frame = this.rx.substring(0, idx).replace(/\0/g, '').trim();
      this.rx = this.rx.substring(idx + 1);

      // G6: prompts de comandos ya expirados se consumen y se tiran.
      if (this.pendingPrompts > 0) {
        this.pendingPrompts--;
        this.stats.dropped++;
        this.hooks.log?.('sys', `respuesta tardía descartada: ${frame.slice(0, 40)}`);
        if (this.pendingPrompts === 0) { this.resyncUntil = 0; void this.pump(); }
        continue;
      }

      this.hooks.log?.('rx', frame);
      const job = this.inFlight;
      if (!job) { this.stats.dropped++; continue; }
      if (job.timer) clearTimeout(job.timer);
      this.inFlight = null;
      this.consecutiveTimeouts = 0;
      this.stats.resolved++;
      job.resolve(frame);
      void this.pump();
    }
  }

  /**
   * Bombea la cola. Reentrante-seguro: `pumping` garantiza que solo una
   * instancia esté activa, y `inFlight` que solo haya un comando en vuelo.
   */
  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.open && !this.inFlight && this.queue.length > 0) {
        // G2: esperar el prompt pendiente antes de continuar.
        if (this.pendingPrompts > 0) {
          if (this.now() < this.resyncUntil) {
            setTimeout(() => void this.pump(), 50);
            return;
          }
          // Ventana agotada: damos por perdido el prompt y seguimos.
          this.hooks.log?.('sys', 'resincronización agotada, se continúa');
          this.pendingPrompts = 0;
          this.resyncUntil = 0;
          this.rx = '';
        }

        // G3: techo de tasa.
        const wait = this.limiter.delayNeeded();
        if (wait > 0) {
          setTimeout(() => void this.pump(), wait);
          return;
        }

        const job = this.queue.shift()!;
        this.inFlight = job;

        job.timer = setTimeout(() => this.onTimeout(job), job.timeoutMs);

        try {
          this.limiter.record();
          this.stats.written++;
          this.hooks.log?.('tx', job.cmd);
          await this.hooks.write(`${job.cmd}\r`);
        } catch (err) {
          if (job.timer) clearTimeout(job.timer);
          if (this.inFlight?.id === job.id) this.inFlight = null;
          job.reject(err as Error);
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  private onTimeout(job: Job) {
    if (this.inFlight?.id !== job.id) return;
    this.inFlight = null;
    this.stats.timeouts++;
    // El adaptador todavía puede contestar: reservamos un prompt para descartar.
    this.pendingPrompts++;
    this.resyncUntil = this.now() + HARD_LIMITS.RESYNC_WINDOW_MS;
    this.hooks.log?.('sys', `sin respuesta: ${job.cmd}`);
    job.reject(new Error(`"${job.cmd}" no respondió en ${job.timeoutMs} ms`));

    // G7: cortacircuitos.
    if (++this.consecutiveTimeouts >= HARD_LIMITS.MAX_CONSECUTIVE_TIMEOUTS) {
      this.open = false;
      const reason = 'El adaptador dejó de responder; se detiene la comunicación para no insistir sobre el bus.';
      this.hooks.log?.('sys', reason);
      this.hooks.onCircuitOpen?.(reason);
      this.cancelAll(reason);
      return;
    }
    void this.pump();
  }
}
