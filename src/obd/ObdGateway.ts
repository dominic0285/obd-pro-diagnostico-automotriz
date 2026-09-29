/**
 * ObdGateway — orquesta la sesión con el vehículo.
 *
 * Reparto de responsabilidades:
 *   safety.ts     decide qué comando puede existir (lista blanca)
 *   pipeline.ts   garantiza uno a la vez, techo de tasa, sincronía de prompt
 *   pollEngine.ts garantiza un único bucle y exclusión mutua
 *   protocol.ts   interpreta las respuestas
 *   este archivo  decide QUÉ preguntar y CUÁNDO
 *
 * Ninguna función de aquí escribe en el adaptador por su cuenta: todo pasa por
 * bleManager.sendCommand → CommandPipeline → lista blanca.
 */

import { bleManager } from '../ble/BleManager';
import { AT_INIT_SEQUENCE, PROTOCOL_ORDER, PROTOCOL_NAMES, FUNCTIONAL_HEADER } from './pids';
import { isSafeHeader, checkCommandSafety } from './safety';
import { PollEngine, type PollPlan, type PollTask } from './pollEngine';
import { esDelNucleo } from './nucleo';
import { delay } from './limits';
import {
  normalizeHex, isNegative, isUnsupportedResponse, isBusyResponse, hexToBytes,
  decodeSupportMask, decodeDtcs, parsePidResponse, parseVin, looksLikeVin, parseVoltage,
  decodeMode06, decodeMode06Support, hexToAscii, type Mode06Record,
} from './protocol';
import { useObdStore } from '../store/useObdStore';
import type { EnhancedPid, ModuleGroup, DiagnosticModule } from '../profiles';
import { decodeUds1902, decodeKwp18, type ModuleScanResult } from './moduleScan';

export { normalizeHex, isNegative, decodeDtcs } from './protocol';

export interface ObdReading {
  pid: string;
  name: string;
  value: number;
  unit: string;
  rawHex: string;
  timestamp: number;
}

export type ObdDataListener = (readings: Map<string, ObdReading>) => void;

export interface DidBlockResult {
  /** Comando completo, p. ej. '2216CD'. */
  did: string;
  status: 'ok' | 'unsupported' | 'no_response' | 'error';
  raw: string;
  /** Bytes de datos devueltos: da una pista del tipo de dato. */
  bytes: number;
}

export interface PidProbeResult {
  status: 'ok' | 'unsupported' | 'no_response' | 'error';
  raw: string;
  value: number | null;
  message?: string;
}

/** Fallos seguidos antes de retirar un PID del bucle. */
/**
 * Ritmo del muestreo continuo.
 *
 * El techo duro sigue siendo el del pipeline (20 comandos por segundo) y esto
 * no lo toca. Lo que hace es no gastarlo entero: una prueba de cinco minutos a
 * tope son unos seis mil comandos, y para medir relaciones de marcha con dos
 * muestras por segundo sobra.
 */
const MUESTREO_GAP_MS = 60;
/** Pausa mínima pase lo que pase: la garantía de que este bucle nunca gira en vacío. */
const MUESTREO_GAP_MIN_MS = 20;
/** Respiro entre rondas completas. */
const MUESTREO_RONDA_MS = 150;

const MAX_FAILS = 3;
/** Tope duro de identificadores por tanda del explorador. */
export const MAX_BLOCK = 64;
/** Pausa entre preguntas del explorador (≈6 por segundo). */
const BLOCK_GAP_MS = 150;
/** Voltaje por debajo del cual avisamos: comunicar con módulos con la batería
 *  baja es la causa más común de códigos U fantasma. */
const LOW_VOLTAGE = 11.5;

class ObdGateway {
  private readings = new Map<string, ObdReading>();
  private listeners: ObdDataListener[] = [];
  private currentHeader: string | null = null;   // null = desconocido
  private failCount = new Map<string, number>();
  private pidByKey = new Map<string, EnhancedPid>();
  private isCan = true;

  private readonly engine = new PollEngine({
    send: (cmd, t) => bleManager.sendCommand(cmd, t),
    ensureHeader: (h, rx) => this.applyHeader(h, rx),
    getPlan: () => this.buildPlan(),
    isConnected: () => bleManager.isConnected(),
    onResult: (task, raw, err) => this.handleResult(task, raw, err),
    onCycle: () => this.notifyListeners(),
    onFatal: (e) => {
      console.warn('[OBD] bucle detenido por error inesperado:', e);
      this.fatales.push(String(e?.message ?? e));
      this.st().setInitStatus('El muestreo se detuvo por un error interno. Reconecta el escáner.');
    },
  });

  /**
   * Errores que mataron el bucle. Tiene que quedarse vacío siempre.
   *
   * Existe porque un bucle muerto solo se notaba por un aviso en la consola que
   * nadie lee, y la app se quedaba con las agujas congeladas sin explicar por
   * qué. Las autopruebas lo comprueban: si el motor llama a algo que el estado
   * no tiene, la batería falla en vez de pasar en verde.
   */
  private fatales: string[] = [];
  __fatalesParaPruebas(): string[] { return [...this.fatales]; }

  private st() { return useObdStore.getState(); }

  // ─── Envío controlado ────────────────────────────────────────────────────
  /**
   * Envío con verificación de confirmación. La lista blanca se aplica igual
   * dentro del pipeline; esto añade la regla de interfaz "esto pide permiso".
   */
  async send(cmd: string, timeoutMs = 2000, confirmed = false): Promise<string> {
    const v = checkCommandSafety(cmd, this.st().strictMode);
    if (!v.ok) throw new Error(v.reason);
    if (v.needsConfirm && !confirmed) throw new Error(`Requiere confirmación: ${v.reason}`);
    return bleManager.sendCommand(cmd, timeoutMs);
  }

  /**
   * Envío desde la terminal: en exclusiva, para que la respuesta que se ve sea
   * la del comando tecleado y no la de un PID del bucle.
   */
  sendExclusive(cmd: string, timeoutMs = 5000, confirmed = false): Promise<string> {
    return this.engine.runExclusive(() => this.send(cmd, timeoutMs, confirmed));
  }

  // ─── Inicialización ─────────────────────────────────────────────────────
  async initialize(): Promise<void> {
    const store = this.st();
    bleManager.setStrict(store.strictMode);
    bleManager.resetCircuit();
    this.engine.resume();
    store.resetUnsupported();
    this.failCount.clear();
    this.readings.clear();
    this.currentHeader = null;

    store.setInitStatus('Reiniciando adaptador…');
    for (const step of AT_INIT_SEQUENCE) {
      try {
        const res = await bleManager.sendCommand(step.cmd, step.timeout);
        if (step.cmd === 'ATZ' && /ELM|OBD|v\d/i.test(res)) {
          store.setAdapter({ elmVersion: res.replace(/ATZ/i, '').trim() });
        }
        if (step.cmd === 'ATRV') {
          const v = parseVoltage(res);
          // Solo se guarda si es un voltaje creíble. Si no lo es, se deja en
          // blanco y lo rellena la siguiente lectura, que ya se hace con el
          // adaptador asentado.
          if (v !== null) store.setAdapter({ voltage: res.replace(/ATRV/i, '').trim() });
          if (v !== null && v < LOW_VOLTAGE) {
            store.setVoltageWarning(
              `El adaptador mide ${v.toFixed(1)} V. Por debajo de ${LOW_VOLTAGE} V algunos módulos responden mal y pueden registrar códigos de comunicación. Arranca el motor o carga la batería antes de diagnosticar.`);
          } else {
            store.setVoltageWarning('');
          }
        }
        await delay(step.cmd === 'ATZ' ? 800 : 80);
      } catch (err) {
        if (!step.optional) console.warn(`[OBD] ${step.cmd} falló:`, err);
      }
    }

    // ── Protocolo ──────────────────────────────────────────────────────────
    store.setInitStatus('Buscando protocolo…');
    const preferred = store.selectedProfile.preferredProtocol;
    const order = preferred ? [preferred, ...PROTOCOL_ORDER.filter(p => p !== preferred)] : PROTOCOL_ORDER;
    let found: string | null = null;
    for (const p of order) {
      if (!bleManager.isConnected()) throw new Error('Se perdió la conexión durante la inicialización.');
      try {
        await bleManager.sendCommand(`ATSP${p}`, 1500);
        const res = await bleManager.sendCommand('0100', p === '0' ? 8000 : 4000);
        if (normalizeHex(res).includes('4100')) { found = p; break; }
      } catch { /* siguiente protocolo */ }
      await delay(120);
    }
    if (!found) {
      store.setInitStatus('');
      throw new Error('Ningún protocolo respondió a 0100. Pon el contacto (llave en ON) o arranca el motor y vuelve a intentar.');
    }

    let protoName = PROTOCOL_NAMES[found] ?? found;
    try {
      const dp = await bleManager.sendCommand('ATDPN', 1500);
      const n = dp.replace(/ATDPN/i, '').replace(/A/i, '').trim();
      if (n && PROTOCOL_NAMES[n]) { protoName = PROTOCOL_NAMES[n]; found = n; }
    } catch { /* nos quedamos con el detectado */ }
    this.isCan = ['6', '7', '8', '9'].includes(found);
    store.setAdapter({ protocol: found, protocolName: protoName });

    // ── PIDs soportados ────────────────────────────────────────────────────
    store.setInitStatus('Leyendo PIDs soportados…');
    const supported = new Set<string>();
    for (const base of [0x00, 0x20, 0x40, 0x60]) {
      const cmd = '01' + base.toString(16).toUpperCase().padStart(2, '0');
      try {
        const res = await bleManager.sendCommand(cmd, 3000);
        const hex = normalizeHex(res);
        const i = hex.indexOf('41' + cmd.substring(2));
        if (i === -1) break;
        const list = decodeSupportMask(base, hexToBytes(hex.substring(i + 4, i + 12)));
        list.forEach(p => supported.add(p));
        const next = '01' + (base + 0x20).toString(16).toUpperCase().padStart(2, '0');
        if (!list.includes(next)) break;
      } catch { break; }
    }
    store.setSupportedMode01(supported.size ? supported : null);

    // ── Datos iniciales ────────────────────────────────────────────────────
    store.setInitStatus('Leyendo VIN y códigos…');
    try { store.setVin(await this.readVIN()); } catch { /* opcional */ }
    try { store.setDtcCodes(await this.readDTCs()); } catch { /* opcional */ }
    try { store.setPendingDtcCodes(await this.readPendingDTCs()); } catch { /* opcional */ }

    store.setInitStatus('');
    this.startPolling();
  }

  // ─── Cabeceras ───────────────────────────────────────────────────────────
  /**
   * Cambia el módulo destino. Devuelve false si no se pudo, para que el bucle
   * salte ese grupo en vez de preguntar al módulo equivocado.
   * Solo se da por buena si el adaptador confirma con OK.
   */
  private async applyHeader(header: string, rxHeader?: string): Promise<boolean> {
    const target = header || '';
    if (this.currentHeader === target) return true;

    const tx = target || FUNCTIONAL_HEADER;
    if (!isSafeHeader(tx)) {
      console.warn(`[OBD] cabecera rechazada: ${tx}`);
      return false;
    }
    try {
      const res = await bleManager.sendCommand(`ATSH ${tx}`, 1500);
      if (!/OK/i.test(res)) { this.currentHeader = null; return false; }

      if (target) {
        const rx = rxHeader ?? (parseInt(target, 16) + 8).toString(16).toUpperCase().padStart(3, '0');
        if (isSafeHeader(rx)) await bleManager.sendCommand(`ATCRA ${rx}`, 1500).catch(() => {});
      } else {
        await bleManager.sendCommand('ATCRA', 1500).catch(() => {});
      }
      this.currentHeader = target;
      await delay(50);
      return true;
    } catch {
      this.currentHeader = null;   // no sabemos dónde quedó: se reintentará
      return false;
    }
  }

  // ─── Plan de muestreo ────────────────────────────────────────────────────
  /**
   * Solo para las autopruebas: el plan que se enviaría en este instante.
   * Sin esto no habría forma de comprobar desde fuera que el motor respeta lo
   * que está en pantalla, y esa garantía es la que hace que la app sea rápida
   * sin cargar el bus del vehículo.
   */
  __planParaPruebas(): PollPlan { return this.buildPlan(); }

  private buildPlan(): PollPlan {
    const st = this.st();
    const { selectedProfile, disabledPids, unsupportedPids, supportedMode01,
            pollIntervalMs, strictMode } = st;

    // Solo se pregunta lo que alguien está mirando, más el núcleo, más lo que
    // se esté grabando. Preguntar por un dato que nadie tiene delante es
    // tráfico en el bus del vehículo a cambio de nada.
    const activas = st.clavesActivas();

    this.pidByKey.clear();
    const groups: PollPlan['groups'] = [];

    for (const g of selectedProfile.moduleGroups) {
      // En modo estricto solo se usa la cabecera funcional (7DF) y el vocabulario
      // de un escáner genérico: Modo 01 y Modo 06. El 06 entra porque un escáner genérico
      // también lo enviaba y porque es OBD2 estándar sobre la misma cabecera; es
      // lo que da los fallos por cilindro de este PCM.
      if (strictMode && g.header) continue;
      const tasks: PollTask[] = [];
      for (const p of g.pids) {
        if (strictMode && p.mode !== '01' && p.mode !== '06') continue;
        // El núcleo no se apaga a mano: es lo que sostiene el historial cuando
        // no miras ninguna pantalla, y apagarlo sin querer dejaría agujeros que
        // nadie relacionaría con haber tocado un interruptor. Que el VEHÍCULO
        // diga que no lo tiene sí se respeta: esa no es una preferencia.
        if (unsupportedPids.has(p.key)) continue;
        // Lo que se está grabando se pregunta aunque esté apagado en los
        // ajustes. Es deliberado y es lo que promete la lista de la grabadora:
        // marcas ahí un dato que normalmente no quieres en pantalla, se lee
        // mientras dura la grabación, y al parar vuelve a su sitio sin que
        // hayas tenido que tocar ningún interruptor ni acordarte de devolverlo.
        const forzadaPorGrabacion = st.grabando && st.grabClaves.has(p.key);
        if (disabledPids.has(p.key) && !esDelNucleo(p.key) && !forzadaPorGrabacion) continue;
        if (!activas.has(p.key)) continue;
        if (p.mode === '01' && supportedMode01 && !supportedMode01.has(p.command)) continue;
        this.pidByKey.set(p.key, p);
        tasks.push({ key: p.key, command: p.command, header: g.header, rxHeader: g.rxHeader });
      }
      if (tasks.length) groups.push({ header: g.header, rxHeader: g.rxHeader, tasks });
    }
    return { groups, intervalMs: pollIntervalMs };
  }

  private pendingHistory: { key: string; reading: ObdReading }[] = [];

  private handleResult(task: PollTask, raw: string | null, err?: Error) {
    const def = this.pidByKey.get(task.key);
    if (!def) return;

    if (raw === null) { this.registerFail(def, err?.message ?? ''); return; }

    // "Estoy ocupado": no cuenta como fallo, se reintenta en el próximo ciclo.
    if (isBusyResponse(raw)) return;

    const parsed = parsePidResponse(def, raw);
    if (!parsed) { this.registerFail(def, raw); return; }

    this.failCount.set(task.key, 0);
    const reading: ObdReading = {
      pid: def.command, name: def.name, value: parsed.value,
      unit: def.unit, rawHex: parsed.hex, timestamp: Date.now(),
    };
    this.readings.set(task.key, reading);
    this.pendingHistory.push({ key: task.key, reading });
  }

  private registerFail(def: EnhancedPid, res: string) {
    // El módulo dice que ese identificador no existe: retirar de inmediato.
    if (res && isUnsupportedResponse(res)) {
      this.st().markUnsupported(def.key);
      this.readings.delete(def.key);
      return;
    }
    const n = (this.failCount.get(def.key) ?? 0) + 1;
    this.failCount.set(def.key, n);
    if (n >= MAX_FAILS) {
      this.st().markUnsupported(def.key);
      this.readings.delete(def.key);
    }
  }

  // ─── Bucle ───────────────────────────────────────────────────────────────
  /** Arranque explícito: reactiva el motor si un reset() lo había apagado. */
  startPolling() { this.engine.resume(); this.engine.start(); }
  stopPolling() { this.engine.stop(); }
  isPolling() { return this.engine.isRunning(); }
  /** Diagnóstico: debe ser 0 ó 1 siempre. */
  activeLoops() { return this.engine.activeLoopCount(); }

  // ─── DTC / VIN ───────────────────────────────────────────────────────────
  /**
   * Los PIDs estándar que el propio PCM dijo que soporta al conectar.
   * Es su propia lista, no una suposición nuestra.
   */
  getSupportedMode01(): Set<string> | null {
    return this.st().supportedMode01;
  }

  private functional<T>(fn: () => Promise<T>): Promise<T> {
    return this.engine.runExclusive(async () => {
      const ok = await this.applyHeader('', undefined);
      if (!ok) throw new Error('No se pudo volver a la cabecera estándar.');
      return fn();
    });
  }

  readDTCs(): Promise<string[]> {
    return this.functional(async () => decodeDtcs(await bleManager.sendCommand('03', 5000), '43', this.isCan));
  }

  readPendingDTCs(): Promise<string[]> {
    return this.functional(async () => decodeDtcs(await bleManager.sendCommand('07', 5000), '47', this.isCan));
  }

  async clearDTCs(confirmed: boolean): Promise<boolean> {
    if (!confirmed) return false;
    return this.functional(async () => {
      const res = await this.send('04', 6000, true);
      return normalizeHex(res).includes('44');
    });
  }

  /**
   * VIN. Se pide directamente al PCM (7E0) en vez de por difusión: en 7DF
   * contestan varios módulos a la vez y sus tramas se entrelazan, que es lo que
   * hacía salir un VIN de ceros.
   */
  readVIN(): Promise<string> {
    return this.engine.runExclusive(async () => {
      try {
        const ok = await this.applyHeader('7E0', '7E8');
        if (ok) {
          // Dos intentos: la primera petición tras cambiar de cabecera a veces
          // llega mientras el adaptador aún está montando el control de flujo.
          for (let i = 0; i < 2; i++) {
            const vin = parseVin(await bleManager.sendCommand('0902', 6000));
            if (looksLikeVin(vin)) return vin;
            await delay(200);
          }
        }
      } catch { /* se intenta por difusión */ }
      finally {
        this.currentHeader = null;
        await this.applyHeader('', undefined).catch(() => {});
      }
      // Último recurso: por difusión. Aquí pueden solaparse varios módulos, así
      // que lo que salga tiene que pasar el mismo filtro; si no, se admite que
      // no se pudo leer en vez de inventar un VIN de relleno.
      const vin = parseVin(await bleManager.sendCommand('0902', 6000));
      return looksLikeVin(vin) ? vin : '';
    });
  }

  /** Voltaje del adaptador. No toca el bus del vehículo. */
  // ─── Explorador de bloques de identificadores ────────────────────────────
  /**
   * Recorre un rango CORTO y acotado de identificadores en un módulo concreto.
   *
   * No se barren los 65.536 posibles: eso sería tráfico inútil y puede hacer
   * que un módulo empiece a responder despacio. Ford agrupa las variables
   * relacionadas en bloques consecutivos, así que se explora solo alrededor de
   * los identificadores que YA se sabe que responden.
   *
   * El tope MAX_BLOCK es duro: por construcción esto no puede convertirse en
   * un barrido completo, ni por error ni a propósito.
   */
  async scanDidBlock(opts: {
    header: string;
    rxHeader?: string;
    start: number;
    end: number;
    onProgress?: (r: DidBlockResult, done: number, total: number) => void;
  }): Promise<DidBlockResult[]> {
    if (this.st().strictMode) throw new Error('Modo estricto activo: el explorador usa Modo 22. Apágalo en Ajustes → Seguridad.');
    if (!bleManager.isConnected()) throw new Error('No hay conexión con el escáner.');
    if (!isSafeHeader(opts.header)) throw new Error(`Dirección ${opts.header} fuera del rango de diagnóstico.`);

    const start = Math.max(0, Math.min(0xffff, opts.start));
    const end = Math.max(start, Math.min(0xffff, opts.end));
    const total = end - start + 1;
    if (total > MAX_BLOCK) {
      throw new Error(`El bloque son ${total} identificadores y el máximo por tanda es ${MAX_BLOCK}. Divídelo en trozos.`);
    }

    return this.engine.runExclusive(async () => {
      // Se limpia AQUÍ, ya con el canal tomado, no antes de encolarse. Es una
      // sola bandera compartida por todas las operaciones largas: si se
      // limpiara al pedir el turno, una operación que acaba de encolarse
      // borraría una cancelación dirigida a la que está corriendo, y esa
      // seguiría preguntándole al vehículo con alguien esperando a que pare.
      this.probeCancelled = false;
      const out: DidBlockResult[] = [];
      try {
        const ready = await this.applyHeader(opts.header, opts.rxHeader);
        if (!ready) throw new Error('El adaptador no aceptó la dirección del módulo.');

        for (let did = start; did <= end; did++) {
          if (this.probeCancelled || !bleManager.isConnected()) break;
          const cmd = '22' + did.toString(16).toUpperCase().padStart(4, '0');
          let r: DidBlockResult;
          try {
            const raw = await bleManager.sendCommand(cmd, 1800);
            const hex = normalizeHex(raw);
            const echo = '62' + cmd.substring(2);
            if (hex.includes(echo)) {
              const data = hex.substring(hex.indexOf(echo) + echo.length);
              r = { did: cmd, status: 'ok', raw: hex, bytes: Math.floor(data.length / 2) };
            } else if (isUnsupportedResponse(raw) || /^7F/.test(hex)) {
              r = { did: cmd, status: 'unsupported', raw: hex, bytes: 0 };
            } else if (isNegative(raw)) {
              r = { did: cmd, status: 'no_response', raw: raw.trim().replace(/\s+/g, ' '), bytes: 0 };
            } else {
              r = { did: cmd, status: 'ok', raw: hex, bytes: 0 };
            }
          } catch {
            r = { did: cmd, status: 'no_response', raw: '', bytes: 0 };
          }
          out.push(r);
          opts.onProgress?.(r, out.length, total);
          await delay(BLOCK_GAP_MS);
        }
      } finally {
        this.currentHeader = null;
        await this.applyHeader('', undefined).catch(() => {});
      }
      return out;
    });
  }

  // ─── Comandos estándar sueltos sobre la cabecera funcional ───────────────
  /**
   * Manda una lista corta de comandos OBD2 estándar por difusión (7DF) y
   * devuelve lo que conteste cada uno, en crudo.
   *
   * Es para los modos que no son 01 ni 22 y que hasta ahora no usábamos: el 09
   * (identificación del vehículo y de la calibración), el 02 (el congelado de
   * datos del momento en que saltó un código), el 0A (códigos permanentes) y
   * el 05. Todos son de lectura y todos están en la lista blanca desde el
   * principio; lo único que faltaba era pedirlos.
   */
  async readStandardList(opts: {
    cmds: string[];
    gapMs?: number;
    timeoutMs?: number;
    /**
     * Cabecera fija para hablar con UN módulo. Sin esto la pregunta sale en
     * cabecera funcional y contestan varios a la vez: el ELM327 mezcla las
     * tramas y el texto sale entreverado. Le pasó al 0904 dos veces.
     */
    header?: string;
    rxHeader?: string;
    onProgress?: (cmd: string, ok: boolean, done: number, total: number) => void;
  }): Promise<{ cmd: string; raw: string; hex: string; ok: boolean; ascii: string }[]> {
    if (!bleManager.isConnected()) throw new Error('No hay conexión con el escáner.');
    if (opts.cmds.length > 96) throw new Error('Demasiados comandos en una tanda.');
    const gap = Math.max(80, opts.gapMs ?? 150);

    const conCabecera = <T,>(fn: () => Promise<T>): Promise<T> =>
      opts.header
        ? this.engine.runExclusive(async () => {
            const ok = await this.applyHeader(opts.header!, opts.rxHeader);
            if (!ok) throw new Error('El adaptador no aceptó la dirección del módulo.');
            return fn();
          })
        : this.functional(fn);

    return conCabecera(async () => {
      // Se limpia AQUÍ, ya con el canal tomado, no antes de encolarse. Es una
      // sola bandera compartida por todas las operaciones largas: si se
      // limpiara al pedir el turno, una operación que acaba de encolarse
      // borraría una cancelación dirigida a la que está corriendo, y esa
      // seguiría preguntándole al vehículo con alguien esperando a que pare.
      this.probeCancelled = false;
      const out: { cmd: string; raw: string; hex: string; ok: boolean; ascii: string }[] = [];
      for (const cmd of opts.cmds) {
        if (this.probeCancelled || !bleManager.isConnected()) break;
        let raw = '', hex = '', ok = false;
        try {
          raw = await bleManager.sendCommand(cmd, opts.timeoutMs ?? 4000);
          hex = normalizeHex(raw);
          // Respuesta positiva = servicio + 0x40 al principio.
          const eco = (parseInt(cmd.substring(0, 2), 16) + 0x40).toString(16).toUpperCase().padStart(2, '0');
          ok = hex.startsWith(eco) && !isNegative(raw) && !isUnsupportedResponse(raw);
        } catch { /* se anota como sin respuesta */ }
        const datos = ok ? hex.substring(2) : '';
        out.push({ cmd, raw: raw.trim().replace(/\s+/g, ' '), hex, ok, ascii: ok ? hexToAscii(datos) : '' });
        opts.onProgress?.(cmd, ok, out.length, opts.cmds.length);
        await delay(gap);
      }
      return out;
    });
  }

  // ─── Lectura de una lista concreta de identificadores ────────────────────
  /**
   * Pregunta unos pocos identificadores sueltos a un módulo concreto.
   *
   * No es un barrido: se le da la lista exacta y pregunta esos y nada más. Lo
   * usa la etapa de identidad del diagnóstico, que necesita leer el número de
   * calibración de cada módulo, y la maniobra del alternador.
   *
   * Devuelve también el texto ASCII cuando la respuesta son caracteres
   * legibles: los números de pieza de Ford viajan así.
   */
  async readDidList(opts: {
    header: string;
    rxHeader?: string;
    dids: string[];
    gapMs?: number;
    onProgress?: (r: DidBlockResult, done: number, total: number) => void;
  }): Promise<(DidBlockResult & { ascii: string })[]> {
    if (this.st().strictMode) throw new Error('Modo estricto activo: esta lectura usa Modo 22. Apágalo en Ajustes → Seguridad.');
    if (!bleManager.isConnected()) throw new Error('No hay conexión con el escáner.');
    if (!isSafeHeader(opts.header)) throw new Error(`Dirección ${opts.header} fuera del rango de diagnóstico.`);
    if (opts.dids.length > MAX_BLOCK) {
      throw new Error(`Son ${opts.dids.length} identificadores y el máximo por tanda es ${MAX_BLOCK}.`);
    }
    const gap = Math.max(BLOCK_GAP_MS, opts.gapMs ?? BLOCK_GAP_MS);

    return this.engine.runExclusive(async () => {
      // Se limpia AQUÍ, ya con el canal tomado, no antes de encolarse. Es una
      // sola bandera compartida por todas las operaciones largas: si se
      // limpiara al pedir el turno, una operación que acaba de encolarse
      // borraría una cancelación dirigida a la que está corriendo, y esa
      // seguiría preguntándole al vehículo con alguien esperando a que pare.
      this.probeCancelled = false;
      const out: (DidBlockResult & { ascii: string })[] = [];
      try {
        const ready = await this.applyHeader(opts.header, opts.rxHeader);
        if (!ready) throw new Error('El adaptador no aceptó la dirección del módulo.');

        for (const did of opts.dids) {
          if (this.probeCancelled || !bleManager.isConnected()) break;
          const cmd = ('22' + did).toUpperCase().replace(/^2222/, '22');
          let r: DidBlockResult & { ascii: string };
          try {
            const raw = await bleManager.sendCommand(cmd, 3000);
            const hex = normalizeHex(raw);
            const echo = '62' + cmd.substring(2);
            if (hex.includes(echo)) {
              const data = hex.substring(hex.indexOf(echo) + echo.length);
              r = { did: cmd, status: 'ok', raw: hex, bytes: Math.floor(data.length / 2), ascii: hexToAscii(data) };
            } else if (isUnsupportedResponse(raw) || /^7F/.test(hex)) {
              r = { did: cmd, status: 'unsupported', raw: hex, bytes: 0, ascii: '' };
            } else if (isNegative(raw)) {
              r = { did: cmd, status: 'no_response', raw: raw.trim().replace(/\s+/g, ' '), bytes: 0, ascii: '' };
            } else {
              r = { did: cmd, status: 'ok', raw: hex, bytes: 0, ascii: '' };
            }
          } catch {
            r = { did: cmd, status: 'no_response', raw: '', bytes: 0, ascii: '' };
          }
          out.push(r);
          opts.onProgress?.(r, out.length, opts.dids.length);
          await delay(gap);
        }
      } finally {
        this.currentHeader = null;
        await this.applyHeader('', undefined).catch(() => {});
      }
      return out;
    });
  }

  // ─── Explorador KWP (servicio 21) ────────────────────────────────────────
  /**
   * Igual que el explorador de bloques, pero en KWP2000: servicio 21,
   * identificador de UN byte.
   *
   * Por qué existe: el ABS de este Explorer contesta a los códigos por KWP
   * (servicio 18) y rechaza TODOS los identificadores del 22 con 7F 22 31.
   * Eso no es un módulo muerto, es un módulo que habla otro idioma. El 21 es
   * el "leer dato" de ese idioma.
   *
   * Sigue siendo lectura pura y pasa por la misma lista blanca y el mismo
   * limitador de ritmo que todo lo demás: el tope MAX_BLOCK impide por
   * construcción que esto se convierta en un barrido de los 256 posibles.
   */
  async scanLidBlock(opts: {
    header: string;
    rxHeader?: string;
    start: number;
    end: number;
    onProgress?: (r: DidBlockResult, done: number, total: number) => void;
  }): Promise<DidBlockResult[]> {
    if (this.st().strictMode) throw new Error('Modo estricto activo: el explorador KWP usa el servicio 21. Apágalo en Ajustes → Seguridad.');
    if (!bleManager.isConnected()) throw new Error('No hay conexión con el escáner.');
    if (!isSafeHeader(opts.header)) throw new Error(`Dirección ${opts.header} fuera del rango de diagnóstico.`);

    const start = Math.max(0, Math.min(0xff, opts.start));
    const end = Math.max(start, Math.min(0xff, opts.end));
    const total = end - start + 1;
    if (total > MAX_BLOCK) {
      throw new Error(`El bloque son ${total} identificadores y el máximo por tanda es ${MAX_BLOCK}. Divídelo en trozos.`);
    }

    return this.engine.runExclusive(async () => {
      // Se limpia AQUÍ, ya con el canal tomado, no antes de encolarse. Es una
      // sola bandera compartida por todas las operaciones largas: si se
      // limpiara al pedir el turno, una operación que acaba de encolarse
      // borraría una cancelación dirigida a la que está corriendo, y esa
      // seguiría preguntándole al vehículo con alguien esperando a que pare.
      this.probeCancelled = false;
      const out: DidBlockResult[] = [];
      try {
        const ready = await this.applyHeader(opts.header, opts.rxHeader);
        if (!ready) throw new Error('El adaptador no aceptó la dirección del módulo.');

        for (let lid = start; lid <= end; lid++) {
          if (this.probeCancelled || !bleManager.isConnected()) break;
          const cmd = '21' + lid.toString(16).toUpperCase().padStart(2, '0');
          let r: DidBlockResult;
          try {
            const raw = await bleManager.sendCommand(cmd, 1800);
            const hex = normalizeHex(raw);
            const echo = '61' + cmd.substring(2);
            if (hex.includes(echo)) {
              const data = hex.substring(hex.indexOf(echo) + echo.length);
              r = { did: cmd, status: 'ok', raw: hex, bytes: Math.floor(data.length / 2) };
            } else if (isUnsupportedResponse(raw) || /^7F/.test(hex)) {
              r = { did: cmd, status: 'unsupported', raw: hex, bytes: 0 };
            } else if (isNegative(raw)) {
              r = { did: cmd, status: 'no_response', raw: raw.trim().replace(/\s+/g, ' '), bytes: 0 };
            } else {
              r = { did: cmd, status: 'ok', raw: hex, bytes: 0 };
            }
          } catch {
            r = { did: cmd, status: 'no_response', raw: '', bytes: 0 };
          }
          out.push(r);
          opts.onProgress?.(r, out.length, total);
          await delay(BLOCK_GAP_MS);
        }
      } finally {
        this.currentHeader = null;
        await this.applyHeader('', undefined).catch(() => {});
      }
      return out;
    });
  }

  // ─── Modo 06: el motor se autodescribe ───────────────────────────────────
  /**
   * Pregunta al PCM qué monitores a bordo tiene y luego lee cada uno.
   *
   * Aquí no se adivina: el Modo 06 lleva su propio índice. Primero se piden
   * los bitmasks de soporte (0600, 0620, …) y el módulo contesta con la lista
   * exacta; después se lee solo esa lista. Es el camino limpio para encontrar
   * los fallos por cilindro sin probar identificadores a ciegas.
   */
  async scanMode06(onProgress?: (mid: number, recs: Mode06Record[]) => void): Promise<{
    supported: number[];
    records: Map<number, Mode06Record[]>;
    raw: string[];
  }> {
    if (!bleManager.isConnected()) throw new Error('No hay conexión con el escáner.');

    return this.engine.runExclusive(async () => {
      const raw: string[] = [];
      const supported: number[] = [];
      const records = new Map<number, Mode06Record[]>();
      try {
        await this.applyHeader('', undefined);

        for (const base of [0x00, 0x20, 0x40, 0x60, 0x80, 0xA0]) {
          const cmd = '06' + base.toString(16).toUpperCase().padStart(2, '0');
          let res: string;
          try { res = await bleManager.sendCommand(cmd, 4000); }
          catch { break; }
          raw.push(`${cmd} -> ${res.trim()}`);
          const list = decodeMode06Support(base, res);
          if (!list.length) break;
          list.forEach(m => { if (m !== base + 0x20) supported.push(m); });
          if (!list.includes(base + 0x20)) break;
          await delay(80);
        }

        for (const mid of supported) {
          if (!bleManager.isConnected()) break;
          const cmd = '06' + mid.toString(16).toUpperCase().padStart(2, '0');
          try {
            const res = await bleManager.sendCommand(cmd, 4000);
            raw.push(`${cmd} -> ${res.trim()}`);
            const recs = decodeMode06(res);
            records.set(mid, recs);
            onProgress?.(mid, recs);
          } catch {
            raw.push(`${cmd} -> sin respuesta`);
          }
          await delay(BLOCK_GAP_MS);
        }
      } finally {
        this.currentHeader = null;
        await this.applyHeader('', undefined).catch(() => {});
      }
      return { supported, records, raw };
    });
  }

  async readVoltage(): Promise<string> {
    const res = await bleManager.sendCommand('ATRV', 1500);
    const limpio = res.replace(/ATRV/i, '').trim();
    // Cada lectura buena refresca la del almacén, que es la que sale en la
    // cabecera de los informes. Antes la cabecera se quedaba con la primera de
    // todas aunque después se midiera diez veces más.
    if (parseVoltage(res) !== null) this.st().setAdapter({ voltage: limpio });
    return limpio;
  }

  // ─── Escaneo de códigos por módulo ───────────────────────────────────────
  async scanModules(modules: DiagnosticModule[], onProgress?: (r: ModuleScanResult) => void): Promise<ModuleScanResult[]> {
    if (this.st().strictMode) {
      throw new Error('Modo estricto activo: el escaneo por módulo usa los servicios de lectura 19/18, que un escáner genérico no envía. Desactívalo en Ajustes → Seguridad.');
    }
    if (!bleManager.isConnected()) throw new Error('No hay conexión con el escáner.');

    return this.engine.runExclusive(async () => {
      const results: ModuleScanResult[] = [];
      try {
        for (const m of modules) {
          if (!bleManager.isConnected()) break;
          const r = await this.scanOneModule(m);
          results.push(r);
          onProgress?.(r);
        }
      } finally {
        this.currentHeader = null;
        await this.applyHeader('', undefined).catch(() => {});
      }
      return results;
    });
  }

  private async scanOneModule(m: DiagnosticModule): Promise<ModuleScanResult> {
    if (!isSafeHeader(m.header) || !isSafeHeader(m.rxHeader)) {
      return { moduleId: m.id, status: 'error', dtcs: [], raw: '', message: 'Dirección fuera del rango de diagnóstico.' };
    }
    const ok = await this.applyHeader(m.header, m.rxHeader);
    if (!ok) return { moduleId: m.id, status: 'error', dtcs: [], raw: '', message: 'El adaptador no aceptó la dirección del módulo.' };

    // 1) UDS 19 02 AF — todos los estados relevantes
    const raw1 = await bleManager.sendCommand('1902AF', 5000).catch(e => `__ERR__ ${e.message}`);
    const hex1 = normalizeHex(raw1);
    if (hex1.includes('5902')) {
      return { moduleId: m.id, status: 'ok', protocol: 'uds', dtcs: decodeUds1902(hex1) ?? [], raw: raw1 };
    }
    await delay(80);

    // 2) KWP 18 00 FF 00 — Ford de esta época
    const raw2 = await bleManager.sendCommand('1800FF00', 5000).catch(e => `__ERR__ ${e.message}`);
    const hex2 = normalizeHex(raw2);
    if (/^58/.test(hex2)) {
      return { moduleId: m.id, status: 'ok', protocol: 'kwp', dtcs: decodeKwp18(hex2) ?? [], raw: `${raw1} | ${raw2}` };
    }

    const silent1 = raw1.startsWith('__ERR__') || (isNegative(raw1) && !/^7F/.test(hex1));
    const silent2 = raw2.startsWith('__ERR__') || (isNegative(raw2) && !/^7F/.test(hex2));
    if (silent1 && silent2) {
      return { moduleId: m.id, status: 'no_response', dtcs: [], raw: `${raw1} | ${raw2}`,
               message: 'No contestó. El módulo no existe en este vehículo, está apagado, o está en el bus MS-CAN que este adaptador no alcanza.' };
    }
    return { moduleId: m.id, status: 'unsupported', dtcs: [], raw: `${raw1} | ${raw2}`,
             message: /^7F/.test(hex1) || /^7F/.test(hex2)
               ? `Responde pero rechaza la lectura de códigos (${(hex1 || hex2).substring(0, 6)}).`
               : 'Respondió algo que no se pudo interpretar.' };
  }

  async clearModuleDtcs(m: DiagnosticModule, protocol: 'uds' | 'kwp', confirmed: boolean): Promise<boolean> {
    if (!confirmed || this.st().strictMode) return false;
    if (!isSafeHeader(m.header)) return false;
    return this.engine.runExclusive(async () => {
      try {
        const ok = await this.applyHeader(m.header, m.rxHeader);
        if (!ok) return false;
        const res = await this.send(protocol === 'uds' ? '14FFFFFF' : '14FF00', 6000, true);
        return /^54/.test(normalizeHex(res));
      } finally {
        this.currentHeader = null;
        await this.applyHeader('', undefined).catch(() => {});
      }
    });
  }

  // ─── Prueba puntual de PIDs ──────────────────────────────────────────────
  private probeCancelled = false;
  /**
   * Cancela la operación larga que esté corriendo; su bucle termina en el PID
   * actual. Cada operación limpia esta bandera cuando toma el canal, no cuando
   * pide el turno, para que arrancar una nueva no desactive una cancelación
   * dirigida a la que sigue en marcha.
   */
  cancelProbe() { this.probeCancelled = true; }
  /**
   * ¿Hay una operación larga ocupando el canal? Las pantallas lo consultan para
   * no lanzar una segunda encima: hasta la 3.1 se podían apilar varias pruebas
   * de cinco minutos, cada una esperando a la anterior sin decírselo a nadie.
   */
  estaOcupado(): boolean { return this.engine.estaOcupado(); }

  /**
   * Pregunta UNA vez cada PID indicado y reporta qué respondió. Solo lectura.
   *
   * `gapMs` marca el ritmo. Por defecto 150 ms entre preguntas, es decir unas
   * 6 por segundo: bastante por debajo del techo de 20/s del canal, y mucho
   * menos tráfico del que genera el muestreo normal, que pregunta lo mismo en
   * bucle sin parar. Cada identificador se pregunta una sola vez; no hay
   * reintentos.
   */
  async probePids(
    groups: ModuleGroup[],
    onProgress?: (key: string, r: PidProbeResult) => void,
    gapMs = 150,
  ): Promise<Map<string, PidProbeResult>> {
    if (this.st().strictMode) {
      throw new Error('Modo estricto activo: desactívalo en Ajustes → Seguridad para probar PIDs de Modo 22.');
    }
    if (!bleManager.isConnected()) throw new Error('No hay conexión con el escáner.');

    return this.engine.runExclusive(async () => {
      // Se limpia AQUÍ, ya con el canal tomado, no antes de encolarse. Es una
      // sola bandera compartida por todas las operaciones largas: si se
      // limpiara al pedir el turno, una operación que acaba de encolarse
      // borraría una cancelación dirigida a la que está corriendo, y esa
      // seguiría preguntándole al vehículo con alguien esperando a que pare.
      this.probeCancelled = false;
      const out = new Map<string, PidProbeResult>();
      try {
        for (const g of groups) {
          if (!g.pids.length || !bleManager.isConnected() || this.probeCancelled) continue;
          const ready = await this.applyHeader(g.header, g.rxHeader);
          if (!ready) {
            g.pids.forEach(p => {
              const r: PidProbeResult = { status: 'error', raw: '', value: null, message: 'No se pudo seleccionar el módulo.' };
              out.set(p.key, r); onProgress?.(p.key, r);
            });
            continue;
          }
          for (const pid of g.pids) {
            if (!bleManager.isConnected() || this.probeCancelled) break;
            let r: PidProbeResult;
            try {
              const raw = await bleManager.sendCommand(pid.command, 2500);
              const hex = normalizeHex(raw);
              const parsed = parsePidResponse(pid, raw);
              if (parsed) r = { status: 'ok', raw: hex, value: parsed.value };
              else if (isUnsupportedResponse(raw)) r = { status: 'unsupported', raw: hex, value: null, message: 'El módulo dice que ese identificador no existe.' };
              else if (isBusyResponse(raw)) r = { status: 'no_response', raw: hex, value: null, message: 'El módulo estaba ocupado; vuelve a probar.' };
              else if (/^7F/.test(hex)) r = { status: 'unsupported', raw: hex, value: null, message: `Rechazo ${hex.substring(0, 6)}.` };
              // Respuestas de texto ("NO DATA", "STOPPED"...): se guarda el texto tal
              // cual, no su extracción hexadecimal, que sería ruido sin sentido.
              else if (isNegative(raw)) r = { status: 'no_response', raw: raw.trim().replace(/\s+/g, ' '), value: null, message: 'Sin respuesta del módulo.' };
              else r = { status: 'unsupported', raw: hex, value: null, message: 'Respondió pero no se pudo decodificar con esta fórmula.' };
            } catch (e: any) {
              r = { status: 'no_response', raw: '', value: null, message: 'Sin respuesta (tiempo agotado).' };
            }
            out.set(pid.key, r);
            onProgress?.(pid.key, r);
            await delay(gapMs);
          }
          if (this.probeCancelled) break;
          await delay(gapMs);   // respiro al cambiar de módulo
        }
      } finally {
        this.currentHeader = null;
        await this.applyHeader('', undefined).catch(() => {});
      }
      return out;
    });
  }

  // ─── Muestreo continuo para una prueba en carretera ──────────────────────
  /**
   * Lee un puñado de datos una y otra vez durante un rato, dentro de UNA sola
   * operación exclusiva.
   *
   * Esto existe porque la alternativa —llamar a probePids doscientas veces—
   * pararía y rearrancaría el bucle de muestreo doscientas veces, con su drenaje
   * y su rearranque cada vez. Aquí el bucle se para una vez, se toman todas las
   * muestras y se devuelve al final.
   *
   * El techo de comandos por segundo sigue siendo el del pipeline: esto no lo
   * toca ni puede tocarlo. Lo único que hace es no desperdiciar comandos.
   */
  async muestrearContinuo(opts: {
    grupos: ModuleGroup[];
    segundos: number;
    onMuestra: (valores: Map<string, number>, tMs: number) => void;
    debeParar: () => boolean;
    gapMs?: number;
  }): Promise<number> {
    if (this.st().strictMode) {
      throw new Error('Modo estricto activo: desactívalo en Ajustes → Seguridad para leer el módulo de la transmisión.');
    }
    if (!bleManager.isConnected()) throw new Error('No hay conexión con el escáner.');
    // Nunca cero. Si un comando se rechaza de forma SÍNCRONA —por ejemplo
    // porque alguien activó el modo estricto mientras la prueba corría— el
    // catch se lo traga y sin pausa el bucle se convierte en un giro de
    // microtareas que congela la interfaz entera hasta agotar el tiempo.
    const gap = Math.max(MUESTREO_GAP_MIN_MS, opts.gapMs ?? MUESTREO_GAP_MS);
    const limite = Date.now() + opts.segundos * 1000;
    return this.engine.runExclusive(async () => {
      // Se limpia AQUÍ, ya con el canal tomado, no antes de encolarse. Es una
      // sola bandera compartida por todas las operaciones largas: si se
      // limpiara al pedir el turno, una operación que acaba de encolarse
      // borraría una cancelación dirigida a la que está corriendo, y esa
      // seguiría preguntándole al vehículo con alguien esperando a que pare.
      this.probeCancelled = false;
      let rondas = 0;
      try {
        while (Date.now() < limite && !opts.debeParar() && !this.probeCancelled
               && bleManager.isConnected()) {
          const valores = new Map<string, number>();
          for (const g of opts.grupos) {
            if (!g.pids.length) continue;
            if (opts.debeParar() || this.probeCancelled || !bleManager.isConnected()) break;
            if (!(await this.applyHeader(g.header, g.rxHeader))) continue;
            for (const pid of g.pids) {
              if (opts.debeParar() || this.probeCancelled || !bleManager.isConnected()) break;
              try {
                const raw = await bleManager.sendCommand(pid.command, 1500);
                const parsed = parsePidResponse(pid, raw);
                if (parsed && Number.isFinite(parsed.value)) valores.set(pid.key, parsed.value);
              } catch { /* una muestra perdida no rompe la prueba */ }
              await delay(gap);
            }
          }
          rondas++;
          opts.onMuestra(valores, Date.now());
          // Respiro entre rondas, igual que hace el bucle de muestreo normal.
          // Sin esto esta era la única ruta de la app que consumía todo el
          // presupuesto del limitador de forma sostenida durante minutos.
          await delay(MUESTREO_RONDA_MS);
        }
      } finally {
        this.currentHeader = null;
        await this.applyHeader('', undefined).catch(() => {});
      }
      return rondas;
    });
  }

  // ─── Suscripción ─────────────────────────────────────────────────────────
  subscribe(l: ObdDataListener) {
    this.listeners.push(l);
    return () => { this.listeners = this.listeners.filter(x => x !== l); };
  }

  private notifyListeners() {
    const st = this.st();
    // Un solo volcado al historial por ciclo, en vez de uno por lectura.
    if (this.pendingHistory.length) {
      st.pushHistoryBatch(this.pendingHistory);
      // La grabadora se alimenta de lo mismo que el historial, pero sin el tope
      // corto: el historial guarda los últimos puntos para dibujar, la
      // grabación guarda el viaje entero para el informe.
      if (st.grabando) st.anotarGrabacion(this.pendingHistory);
      this.pendingHistory = [];
    }
    const snap = new Map(this.readings);

    // Las lecturas entran en el almacén DESDE AQUÍ, sin intermediarios.
    //
    // Hasta la 3.8 no era así: el único que copiaba las lecturas al almacén era
    // un efecto dentro de la pestaña Panel. O sea que si esa pantalla concreta
    // dejaba de estar viva —y en Android eso pasa: el sistema congela o suelta
    // las pantallas que no estás mirando, y cada versión lo hace a su manera—
    // el motor seguía preguntándole al carro, las respuestas seguían llegando,
    // y NADIE las guardaba. El resultado visible era exactamente este: las
    // filas que ya tenían valor se quedaban con el suyo, y las que nunca lo
    // tuvieron decían "leyendo…" para siempre, aunque el bus estuviera
    // trabajando perfectamente.
    //
    // Apareció en un teléfono con Android 14 y no en uno con Android 16, con el
    // MISMO apk, que es la firma de este tipo de fallo: no depende de la app
    // sino de cuándo el sistema decide soltar una pantalla. Por eso la solución
    // no es adivinar qué versión de Android hace qué, sino que el dato no pase
    // por ninguna pantalla para llegar a su sitio.
    st.setReadings(snap);

    // Los suscriptores siguen existiendo para quien quiera enterarse además,
    // pero ya no son el camino por el que los datos llegan a la interfaz.
    for (const l of this.listeners) {
      try { l(snap); } catch (e) { console.warn('[OBD] listener falló:', e); }
    }
  }

  reset() {
    // Freno de emergencia. Tiene que parar TODO, incluidas las operaciones
    // largas: hasta la 3.1 no tocaba probeCancelled, así que un muestreo
    // continuo de cinco minutos sobrevivía a un reset() y seguía preguntándole
    // al vehículo. Funcionaba de milagro porque reset() se llamaba siempre a la
    // vez que una desconexión, y era la desconexión la que paraba el bucle.
    this.probeCancelled = true;
    // shutdown(), no stop(): así ni siquiera una operación exclusiva que esté
    // terminando en este instante puede volver a levantar el bucle.
    this.engine.shutdown();
    // Además se cancela el comando que estuviera en vuelo, para que el bucle
    // no se quede esperando hasta su timeout antes de darse por terminado.
    bleManager.flushQueue();
    this.readings.clear();
    this.failCount.clear();
    this.pendingHistory = [];
    this.pidByKey.clear();
    this.currentHeader = null;
  }
}

export const obdGateway = new ObdGateway();
