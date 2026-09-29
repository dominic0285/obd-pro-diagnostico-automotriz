/**
 * Enlace BLE con adaptadores ELM327 (CY614 / V613 / V614 / V011 / NEXPOW).
 *
 * Perfil "FFE0" (la mayoría de clones):
 *   Servicio 0000ffe0   NOTIFY(RX) = ffe1   WRITE(TX) = ffe2
 * Perfil "FFF0" (V613 / V614 / NEXPOW):
 *   Servicio 0000fff0   NOTIFY(RX) = fff1   WRITE(TX) = fff2
 *
 * Esta clase solo se ocupa del enlace (permisos, escaneo, conexión,
 * características, bytes). Toda la disciplina de comandos —lista blanca,
 * un comando a la vez, techo de tasa, resincronización— vive en
 * CommandPipeline, y esta clase no ofrece ninguna forma de saltárselo.
 */

import {
  BleManager as RNBleManager, Device, Characteristic, BleError, State,
} from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import { PermissionsAndroid, Platform } from 'react-native';
import { CommandPipeline, HARD_LIMITS } from '../obd/pipeline';

// ─── UUIDs ───────────────────────────────────────────────────────────────────
export const BLE_UUIDS = {
  SVC_FFE0:  '0000ffe0-0000-1000-8000-00805f9b34fb',
  FFE0_RX:   '0000ffe1-0000-1000-8000-00805f9b34fb',
  FFE0_TX:   '0000ffe2-0000-1000-8000-00805f9b34fb',
  SVC_FFF0:  '0000fff0-0000-1000-8000-00805f9b34fb',
  FFF0_RX:   '0000fff1-0000-1000-8000-00805f9b34fb',
  FFF0_TX:   '0000fff2-0000-1000-8000-00805f9b34fb',
} as const;

/** Nombres de adaptador aceptados al escanear. */
const KNOWN_NAMES = ['V011', 'NEXPOW', 'BDS21', 'DA100', 'DT500', 'V614', 'V613', 'OBD', 'VLINK', 'CY6', 'ELM'];

export type ConnectionState =
  | 'idle' | 'scanning' | 'connecting' | 'initializing'
  | 'connected' | 'disconnected' | 'error';

export interface UuidProfile { service: string; write: string; notify: string; label: string; }
export interface LogEntry { t: number; dir: 'tx' | 'rx' | 'sys'; text: string; }

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

class OBDBleManager {
  private manager = new RNBleManager();
  private device: Device | null = null;
  private writeChar: Characteristic | null = null;
  private writeWithResponse = true;
  private profile: UuidProfile | null = null;
  private monitorSub: { remove: () => void } | null = null;

  private state: ConnectionState = 'idle';
  private stateListeners: ((s: ConnectionState) => void)[] = [];

  private log: LogEntry[] = [];
  private logListeners: ((l: LogEntry[]) => void)[] = [];
  private static MAX_LOG = 300;

  private circuitListeners: ((reason: string) => void)[] = [];

  /** Último adaptador al que se conectó, para poder volver sin escanear. */
  private lastDevice: { id: string; name: string | null } | null = null;
  getLastDevice() { return this.lastDevice; }
  setLastDevice(d: { id: string; name: string | null } | null) { this.lastDevice = d; }

  /** Único canal hacia el vehículo. */
  private readonly pipeline = new CommandPipeline({
    write: async (payload: string) => {
      const char = this.writeChar;
      if (!char) throw new Error('No conectado');
      const data = Buffer.from(payload, 'ascii').toString('base64');
      if (this.writeWithResponse) await char.writeWithResponse(data);
      else await char.writeWithoutResponse(data);
    },
    log: (dir, text) => this.addLog(dir, text),
    onCircuitOpen: (reason) => {
      this.setState('error');
      this.circuitListeners.forEach(l => l(reason));
    },
  });

  // ─── Estado ─────────────────────────────────────────────────────────────
  onStateChange(l: (s: ConnectionState) => void) {
    this.stateListeners.push(l);
    return () => { this.stateListeners = this.stateListeners.filter(x => x !== l); };
  }
  onCircuitOpen(l: (reason: string) => void) {
    this.circuitListeners.push(l);
    return () => { this.circuitListeners = this.circuitListeners.filter(x => x !== l); };
  }
  private setState(s: ConnectionState) {
    if (this.state === s) return;
    this.state = s;
    this.stateListeners.forEach(l => l(s));
  }
  getState() { return this.state; }
  isConnected() { return this.state === 'connected' || this.state === 'initializing'; }
  getDevice() { return this.device; }
  getProfile() { return this.profile; }

  /** Contadores del canal, para la pantalla de diagnóstico. */
  getStats() {
    return {
      ...this.pipeline.stats,
      queue: this.pipeline.queueLength(),
      inFlight: this.pipeline.inFlightCount(),
      perSecond: this.pipeline.commandsLastSecond(),
      channelOpen: this.pipeline.isOpen(),
      limits: HARD_LIMITS,
    };
  }

  /** Limita el vocabulario a los modos OBD-II estándar. */
  setStrict(v: boolean) { this.pipeline.setStrict(v); }

  // ─── Log ────────────────────────────────────────────────────────────────
  onLog(l: (log: LogEntry[]) => void) {
    this.logListeners.push(l);
    l(this.log);
    return () => { this.logListeners = this.logListeners.filter(x => x !== l); };
  }
  private addLog(dir: LogEntry['dir'], text: string) {
    this.log = [...this.log.slice(-(OBDBleManager.MAX_LOG - 1)), { t: Date.now(), dir, text }];
    this.logListeners.forEach(l => l(this.log));
  }
  getLog() { return this.log; }
  clearLog() { this.log = []; this.logListeners.forEach(l => l(this.log)); }

  // ─── Permisos ───────────────────────────────────────────────────────────
  /**
   * Sin esto, en Android 12+ el escaneo falla con "BLUETOOTH_SCAN permission"
   * y en Android 10-11 no aparece ningún dispositivo, aunque el manifiesto
   * declare los permisos.
   */
  async requestPermissions(): Promise<void> {
    if (Platform.OS !== 'android') return;
    const api = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
    const needed: string[] = api >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
    const res = await PermissionsAndroid.requestMultiple(needed as any);
    const denied = needed.filter(k => (res as any)[k] !== PermissionsAndroid.RESULTS.GRANTED);
    if (denied.length) {
      throw new Error(api >= 31
        ? 'Faltan permisos de "Dispositivos cercanos". Actívalos en Ajustes de Android → Aplicaciones → OBD Pro → Permisos.'
        : 'Falta el permiso de Ubicación (Android lo exige para buscar dispositivos Bluetooth LE).');
    }
  }

  async waitForPoweredOn(timeoutMs = 5000): Promise<void> {
    const s = await this.manager.state();
    if (s === State.PoweredOn) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { sub.remove(); reject(new Error('El Bluetooth está apagado.')); }, timeoutMs);
      const sub = this.manager.onStateChange(st => {
        if (st === State.PoweredOn) { clearTimeout(timer); sub.remove(); resolve(); }
      }, true);
    });
  }

  // ─── Escaneo ────────────────────────────────────────────────────────────
  /**
   * Escanea SIN filtro de UUID (muchos clones no anuncian el servicio) y
   * filtra por nombre.
   */
  async scan(onDeviceFound: (devices: Device[]) => void, timeoutMs = 12000): Promise<Device[]> {
    await this.requestPermissions();
    await this.waitForPoweredOn();
    this.manager.stopDeviceScan();
    this.setState('scanning');
    const found = new Map<string, Device>();

    return new Promise((resolve, reject) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.manager.stopDeviceScan();
        if (this.state === 'scanning') this.setState('idle');
        resolve([...found.values()]);
      };
      const timer = setTimeout(finish, timeoutMs);

      this.manager.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
        if (done) return;
        if (error) {
          done = true;
          clearTimeout(timer);
          this.manager.stopDeviceScan();
          this.setState('error');
          reject(error as BleError);
          return;
        }
        if (!device) return;
        const name = (device.name ?? device.localName ?? '').toUpperCase();
        const svc = (device.serviceUUIDs ?? []).map(u => u.toLowerCase());
        const isOBD = KNOWN_NAMES.some(k => name.includes(k))
          || svc.includes(BLE_UUIDS.SVC_FFE0) || svc.includes(BLE_UUIDS.SVC_FFF0);
        if (isOBD && !found.has(device.id)) {
          found.set(device.id, device);
          onDeviceFound([...found.values()]);
        }
      });
    });
  }

  stopScan() {
    this.manager.stopDeviceScan();
    if (this.state === 'scanning') this.setState('idle');
  }

  // ─── Conexión ───────────────────────────────────────────────────────────
  /** Secuencia que se ejecuta al conectar con el adaptador. */
  resolveUUIDs(deviceName: string | null): UuidProfile {
    const n = (deviceName ?? '').toUpperCase().trim();
    if (n.includes('NEXPOW') || n === 'V614' || n === 'V613') {
      return { service: BLE_UUIDS.SVC_FFF0, write: BLE_UUIDS.FFF0_TX, notify: BLE_UUIDS.FFF0_RX, label: 'FFF0 (RX fff1 / TX fff2)' };
    }
    return { service: BLE_UUIDS.SVC_FFE0, write: BLE_UUIDS.FFE0_TX, notify: BLE_UUIDS.FFE0_RX, label: 'FFE0 (RX ffe1 / TX ffe2)' };
  }

  /**
   * Conecta a un dispositivo ya descubierto por el escaneo.
   */
  async connectToDevice(device: Device): Promise<void> {
    this.manager.stopDeviceScan();
    return this.connectToAddress(device.id, device.name ?? device.localName);
  }

  /**
   * Conecta por DIRECCIÓN, sin necesidad de escanear.
   *
   * Esto resuelve el problema de tener que abrir otra app primero. Estos
   * adaptadores BLE baratos anuncian su presencia de forma intermitente y, si
   * se quedan en un estado raro, el escaneo no los ve aunque estén ahí. Pero
   * conectar por dirección no depende del anuncio: Android se encarga de
   * enganchar en cuanto el aparato dé señales.
   *
   * Se intenta en escalera:
   *   1. Si Android ya lo tiene conectado, se reaprovecha esa conexión.
   *   2. Se limpia cualquier conexión colgada de una sesión anterior.
   *   3. Conexión directa, dos intentos.
   *   4. Conexión en espera (autoConnect), que aguanta hasta que aparezca.
   */
  async connectToAddress(id: string, name?: string | null): Promise<void> {
    await this.requestPermissions();
    await this.waitForPoweredOn();
    this.manager.stopDeviceScan();
    this.setState('connecting');
    this.addLog('sys', `Conectando a ${name ?? id}…`);

    // 1) ¿Ya está conectado a nivel de sistema? (otra app pudo dejarlo abierto)
    try {
      if (await this.manager.isDeviceConnected(id)) {
        const [known] = await this.manager.devices([id]);
        if (known) {
          this.addLog('sys', 'El sistema ya lo tenía conectado; se reaprovecha.');
          await this.attach(known, name);
          return;
        }
      }
    } catch { /* seguimos con el camino normal */ }

    // 2) Limpiar un enganche colgado: es la causa habitual del error
    //    "Device ... is not connected" nada más intentar conectar.
    try { await this.manager.cancelDeviceConnection(id); } catch { /* no había nada */ }

    const intentos: { opts: { autoConnect: boolean; timeout: number }; etiqueta: string }[] = [
      { opts: { autoConnect: false, timeout: 12000 }, etiqueta: 'conexión directa' },
      { opts: { autoConnect: false, timeout: 12000 }, etiqueta: 'segundo intento' },
      { opts: { autoConnect: true,  timeout: 25000 }, etiqueta: 'esperando a que el adaptador anuncie' },
    ];

    let ultimo: Error | null = null;
    for (const intento of intentos) {
      try {
        this.addLog('sys', `Intentando: ${intento.etiqueta}`);
        const dev = await this.manager.connectToDevice(id, intento.opts);
        await this.attach(dev, name);
        return;
      } catch (e: any) {
        ultimo = e as Error;
        this.addLog('sys', `${intento.etiqueta} falló: ${e?.message ?? e}`);
        try { await this.manager.cancelDeviceConnection(id); } catch { /* nada */ }
        await new Promise(r => setTimeout(r, 600));
      }
    }

    this.cleanup();
    this.setState('error');
    throw new Error(
      `No se pudo conectar con ${name ?? id}. ${ultimo?.message ?? ''}\n\n` +
      'Prueba a desenchufar el adaptador del conector y volverlo a poner con el contacto apagado: ' +
      'estos aparatos a veces se quedan colgados y solo se recuperan quitándoles la corriente.');
  }

  /** Descubre servicios, elige el perfil de características y abre el canal. */
  private async attach(device: Device, name?: string | null): Promise<void> {
    try {
      let dev = device;
      try { dev = await dev.requestMTU(185); } catch { /* algunos clones no lo soportan */ }
      await dev.discoverAllServicesAndCharacteristics();
      this.device = dev;

      const services = await dev.services();
      const svcIds = services.map(x => x.uuid.toLowerCase());

      let profile = this.resolveUUIDs(name ?? dev.name);
      if (!svcIds.includes(profile.service)) {
        if (svcIds.includes(BLE_UUIDS.SVC_FFF0)) profile = this.resolveUUIDs('V614');
        else if (svcIds.includes(BLE_UUIDS.SVC_FFE0)) profile = this.resolveUUIDs('');
        else throw new Error(`El dispositivo no expone FFE0 ni FFF0. Servicios: ${svcIds.join(', ')}`);
      }

      const svc = services.find(x => eq(x.uuid, profile.service))!;
      const chars = await svc.characteristics();
      const tx = chars.find(c => eq(c.uuid, profile.write));
      const rx = chars.find(c => eq(c.uuid, profile.notify));
      if (!tx) throw new Error(`Falta la característica de escritura ${profile.write}`);
      if (!rx) throw new Error(`Falta la característica de notificación ${profile.notify}`);
      if (!rx.isNotifiable && !rx.isIndicatable) throw new Error(`${profile.notify} no admite notificaciones`);
      if (!tx.isWritableWithResponse && !tx.isWritableWithoutResponse) throw new Error(`${profile.write} no admite escritura`);

      this.writeWithResponse = tx.isWritableWithResponse;
      this.writeChar = tx;
      this.profile = profile;
      this.pipeline.cancelAll('Nueva conexión');
      this.pipeline.resetCircuit();

      this.monitorSub = dev.monitorCharacteristicForService(
        profile.service, profile.notify,
        (error, char) => {
          if (error || !char?.value) return;
          this.pipeline.feed(Buffer.from(char.value, 'base64').toString('latin1'));
        },
      );

      dev.onDisconnected(() => {
        this.addLog('sys', 'Dispositivo desconectado');
        this.cleanup();
        this.setState('disconnected');
      });

      this.lastDevice = { id: dev.id, name: name ?? dev.name ?? null };
      this.addLog('sys', `Conectado. Perfil ${profile.label}. Escritura ${this.writeWithResponse ? 'con' : 'sin'} respuesta.`);
      this.setState('connected');
    } catch (err) {
      this.cleanup();
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    try { await this.device?.cancelConnection(); } catch { /* ya estaba fuera */ }
    this.cleanup();
    this.setState('idle');
  }

  private cleanup() {
    this.monitorSub?.remove();
    this.monitorSub = null;
    this.device = null;
    this.writeChar = null;
    this.profile = null;
    this.pipeline.cancelAll('Desconectado');
  }

  // ─── Comandos ───────────────────────────────────────────────────────────
  /**
   * ÚNICA salida hacia el vehículo en toda la aplicación.
   * Pasa obligatoriamente por la lista blanca y por los topes de tasa.
   */
  sendCommand(cmd: string, timeoutMs = 2000): Promise<string> {
    if (!this.writeChar) return Promise.reject(new Error('No conectado'));
    return this.pipeline.send(cmd, timeoutMs);
  }

  flushQueue() { this.pipeline.cancelAll('Cancelado'); }
  resetCircuit() { this.pipeline.resetCircuit(); }
}

export const bleManager = new OBDBleManager();
