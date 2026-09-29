/**
 * Estado global (Zustand)
 */
import { create } from 'zustand';
import type { ObdReading } from '../obd/ObdGateway';
import type { ConnectionState } from '../ble/BleManager';
import type { Device } from 'react-native-ble-plx';
import type { ModuleScanResult } from '../obd/moduleScan';
import type { PidProbeResult } from '../obd/ObdGateway';
import { persist, type ProbeMeta } from './persist';
import { ALL_PROFILES, DEFAULT_PROFILE_ID, allPids, type VehicleProfile } from '../profiles';
import { calcularActivas } from '../obd/nucleo';

/** Muestras máximas de una grabación antes de empezar a soltar las viejas. */
const MAX_GRABACION = 40000;

export interface AdapterInfo {
  elmVersion: string;
  protocol: string;      // número ATSP usado
  protocolName: string;  // texto ATDP
  voltage: string;       // ATRV
}

interface ObdStore {
  connectionState: ConnectionState;
  connectedDevice: Device | null;
  deviceName: string | null;
  setConnectionState: (s: ConnectionState) => void;
  setConnectedDevice: (d: Device | null) => void;

  /** Último adaptador usado; permite reconectar sin escanear. */
  lastDevice: { id: string; name: string | null } | null;
  setLastDevice: (d: { id: string; name: string | null } | null) => void;

  adapter: AdapterInfo;
  setAdapter: (a: Partial<AdapterInfo>) => void;
  initStatus: string;
  setInitStatus: (s: string) => void;

  selectedProfile: VehicleProfile;
  setProfile: (id: string) => void;

  /** PIDs apagados por el usuario (clave) */
  disabledPids: Set<string>;
  togglePid: (key: string) => void;
  /** PIDs que el vehículo no soporta (0100 bitmask o respuesta 7F / NO DATA repetida) */
  unsupportedPids: Set<string>;
  markUnsupported: (key: string) => void;
  resetUnsupported: () => void;
  /** Bitmask de PIDs soportados en Modo 01 (de 0100/0120/…); null = no consultado */
  supportedMode01: Set<string> | null;
  setSupportedMode01: (s: Set<string> | null) => void;

  readings: Map<string, ObdReading>;
  setReadings: (r: Map<string, ObdReading>) => void;

  /**
   * Qué claves está mirando el usuario AHORA MISMO, por pantalla.
   *
   * Es lo que decide qué se le pregunta al vehículo. Antes se preguntaba el
   * perfil entero en cada vuelta: unos 130 identificadores, y con el techo de
   * 20 comandos por segundo eso son siete segundos por vuelta. La aguja que
   * estabas mirando se refrescaba una vez cada siete segundos mientras el bus
   * se llenaba de preguntas por datos que nadie tenía delante.
   *
   * Leyendo solo lo visible, la vuelta baja a un segundo y al vehículo le
   * llegan seis veces menos comandos. Las dos cosas a la vez, no una a costa
   * de la otra.
   */
  visiblesPorPantalla: Map<string, Set<string>>;
  /**
   * Sube cada vez que la app vuelve al frente.
   *
   * Existe por un fallo concreto: al irse a segundo plano se borran los
   * registros de visibilidad, pero `useFocusEffect` solo reacciona a los
   * eventos de navegación —entrar y salir de una pestaña— y volver del segundo
   * plano no es ninguno de los dos. Sin esto, la pantalla del panel se quedaba
   * congelada para siempre, leyendo solo los cuatro del núcleo, hasta que el
   * usuario cambiaba de pestaña y volvía.
   *
   * Metiendo este número en las dependencias del efecto de foco, volver al
   * frente hace que las tres pantallas se registren otra vez solas.
   */
  generacionApp: number;
  appAlFrente: () => void;
  setVisibles: (dueño: string, claves: string[]) => void;
  quitarVisibles: (dueño: string) => void;
  /** Todo lo que hay que preguntar: núcleo + lo visible + lo que se graba. */
  clavesActivas: () => Set<string>;

  /** Grabación del flujo: mientras corre, lo grabado se sigue preguntando. */
  grabando: boolean;
  grabInicio: number;
  grabClaves: Set<string>;
  grabMuestras: { t: number; key: string; value: number }[];
  iniciarGrabacion: (claves: string[]) => void;
  pararGrabacion: () => void;
  anotarGrabacion: (entries: { key: string; reading: ObdReading }[]) => void;

  dtcCodes: string[];
  pendingDtcCodes: string[];
  setDtcCodes: (c: string[]) => void;
  setPendingDtcCodes: (c: string[]) => void;

  moduleScan: ModuleScanResult[];
  setModuleScan: (r: ModuleScanResult[]) => void;

  /** Resultados de la última prueba de PIDs. Se guardan en disco. */
  probeResults: Map<string, PidProbeResult>;
  probeAt: number;
  /** Cuántos PIDs se esperaban en la última prueba. */
  probeExpected: number;
  /** true solo si la prueba recorrió TODOS los PIDs del perfil sin cortarse. */
  probeComplete: boolean;
  /** 'all' = se probó el perfil entero; 'partial' = solo un subconjunto. */
  probeScope: 'all' | 'partial';
  setProbeResults: (r: Map<string, PidProbeResult>, meta?: ProbeMeta) => void;
  /** Recupera del disco lo guardado en sesiones anteriores. */
  hydrate: () => Promise<void>;

  vin: string;
  setVin: (v: string) => void;

  voltageWarning: string;
  setVoltageWarning: (m: string) => void;

  history: Map<string, ObdReading[]>;
  /** Borra solo el rastro de unas claves concretas, no el historial entero. */
  limpiarHistorial: (claves: string[]) => void;
  pushHistory: (key: string, r: ObdReading) => void;
  /** Vuelca varias lecturas de una vez (un solo re-render por ciclo). */
  pushHistoryBatch: (entries: { key: string; reading: ObdReading }[]) => void;
  clearHistory: () => void;

  /** true = solo lo que hace un escáner genérico (Modo 01/03/04/07/09 en 7DF). Sin Modo 22 ni escaneo de módulos. */
  strictMode: boolean;
  setStrictMode: (b: boolean) => void;

  pollIntervalMs: number;
  setPollIntervalMs: (n: number) => void;
}

const MAX_HISTORY = 60;

/**
 * Interruptores que cambiaron de posición por defecto con la app ya instalada.
 *
 * La lista de datos apagados se calcula UNA vez, al elegir el perfil, y se
 * guarda en el teléfono. Así que si más adelante un dato pasa de apagado a
 * encendido por defecto, a quien ya tenga la app no le cambia nada: su lista
 * guardada lo sigue teniendo apagado. Esto lo enciende una sola vez y apunta
 * que ya se hizo, de forma que si después él lo apaga a mano, se queda apagado.
 */
export const MIGRACIONES: { version: number; encender: string[] }[] = [
  // 3.3 · Los ajustes de ralentí. Son los que dicen si el motor está
  // sosteniendo el ralentí a base de compensar una fuga de aire, que es
  // exactamente lo que se estaba mirando con la caída de revoluciones.
  { version: 1, encender: ['iac_kam0', 'iac_kam1', 'iac_kam2', 'iac_kam3', 'iac_trim', 'iac_mode'] },
];
export const VERSION_AJUSTES = MIGRACIONES.reduce((n, m) => Math.max(n, m.version), 0);

/** Preferencias que se guardan en disco. */
function prefsOf(st: ObdStore) {
  return {
    strictMode: st.strictMode,
    profileId: st.selectedProfile.id,
    pollIntervalMs: st.pollIntervalMs,
    disabledPids: [...st.disabledPids],
    ajustesVersion: VERSION_AJUSTES,
    lastDevice: st.lastDevice ?? undefined,
  };
}

export const useObdStore = create<ObdStore>((set, get) => ({
  connectionState: 'idle',
  connectedDevice: null,
  deviceName: null,
  setConnectionState: (connectionState) => set({ connectionState }),
  setConnectedDevice: (device) => set({ connectedDevice: device, deviceName: device?.name ?? null }),

  lastDevice: null,
  setLastDevice: (lastDevice) => {
    set({ lastDevice });
    void persist.savePrefs({ ...prefsOf(get()), lastDevice: lastDevice ?? undefined });
  },

  adapter: { elmVersion: '', protocol: '', protocolName: '', voltage: '' },
  setAdapter: (a) => set({ adapter: { ...get().adapter, ...a } }),
  initStatus: '',
  setInitStatus: (initStatus) => set({ initStatus }),

  selectedProfile: ALL_PROFILES.find(p => p.id === DEFAULT_PROFILE_ID) || ALL_PROFILES[0],
  setProfile: (id) => {
    const profile = ALL_PROFILES.find(p => p.id === id);
    if (!profile) return;
    // Arrancan apagados los no verificados y los marcados como consulta puntual
    const disabled = new Set(allPids(profile)
      .filter(p => p.verified === false || p.defaultOff)
      .map(p => p.key));
    set({ selectedProfile: profile, readings: new Map(), history: new Map(),
          disabledPids: disabled, unsupportedPids: new Set(),
          probeResults: new Map(), probeAt: 0, probeExpected: 0,
          probeComplete: false, probeScope: 'all', moduleScan: [] });
    void persist.savePrefs({ ...prefsOf(get()), profileId: id, disabledPids: [...disabled] });
  },

  disabledPids: new Set(),
  togglePid: (key) => {
    const next = new Set(get().disabledPids);
    if (next.has(key)) next.delete(key); else next.add(key);
    set({ disabledPids: next });
    void persist.savePrefs({ ...prefsOf(get()), disabledPids: [...next] });
  },
  unsupportedPids: new Set(),
  markUnsupported: (key) => {
    const next = new Set(get().unsupportedPids); next.add(key);
    set({ unsupportedPids: next });
  },
  resetUnsupported: () => set({ unsupportedPids: new Set() }),
  supportedMode01: null,
  setSupportedMode01: (supportedMode01) => set({ supportedMode01 }),

  readings: new Map(),
  setReadings: (readings) => set({ readings }),

  dtcCodes: [],
  pendingDtcCodes: [],
  setDtcCodes: (dtcCodes) => set({ dtcCodes }),
  setPendingDtcCodes: (pendingDtcCodes) => set({ pendingDtcCodes }),

  moduleScan: [],
  setModuleScan: (moduleScan) => {
    set({ moduleScan });
    void persist.saveScan(get().selectedProfile.id, moduleScan);
  },

  probeResults: new Map(),
  probeAt: 0,
  probeExpected: 0,
  probeComplete: false,
  probeScope: 'all',
  setProbeResults: (probeResults, meta = {}) => {
    const patch: Partial<ObdStore> = { probeResults, probeAt: Date.now() };
    if (meta.expected !== undefined) patch.probeExpected = meta.expected;
    if (meta.scope !== undefined) patch.probeScope = meta.scope;
    if (meta.complete !== undefined) patch.probeComplete = meta.complete;
    set(patch);
    if (meta.save && probeResults.size) {
      void persist.saveProbe(get().selectedProfile.id, probeResults, {
        expected: patch.probeExpected ?? get().probeExpected,
        complete: patch.probeComplete ?? get().probeComplete,
        scope: patch.probeScope ?? get().probeScope,
      });
    }
  },

  hydrate: async () => {
    const [probe, scan, prefs] = await Promise.all([
      persist.loadProbe(), persist.loadScan(), persist.loadPrefs(),
    ]);
    const patch: Partial<ObdStore> = {};
    if (prefs?.profileId) {
      const pr = ALL_PROFILES.find(x => x.id === prefs.profileId);
      if (pr) patch.selectedProfile = pr;
    }
    if (typeof prefs?.strictMode === 'boolean') patch.strictMode = prefs.strictMode;
    if (typeof prefs?.pollIntervalMs === 'number') patch.pollIntervalMs = prefs.pollIntervalMs;
    if (prefs?.disabledPids) patch.disabledPids = new Set(prefs.disabledPids);
    // Migraciones de interruptores: solo se aplican una vez por teléfono.
    const desdeVersion = prefs?.ajustesVersion ?? 0;
    const hayQueMigrar = !!prefs && desdeVersion < VERSION_AJUSTES;
    if (hayQueMigrar) {
      const apagados = new Set(patch.disabledPids ?? get().disabledPids);
      for (const m of MIGRACIONES) if (m.version > desdeVersion) for (const k of m.encender) apagados.delete(k);
      patch.disabledPids = apagados;
    }
    if (prefs?.lastDevice) patch.lastDevice = prefs.lastDevice;
    const activeId = patch.selectedProfile?.id ?? get().selectedProfile.id;
    if (probe && probe.profileId === activeId) {
      patch.probeResults = new Map(probe.results);
      patch.probeAt = probe.at;
      patch.probeExpected = probe.expected ?? probe.results.length;
      patch.probeComplete = probe.complete ?? false;
      patch.probeScope = probe.scope ?? 'all';
    }
    if (scan && scan.profileId === activeId) patch.moduleScan = scan.results;
    set(patch);
    if (hayQueMigrar) void persist.savePrefs(prefsOf(get()));
  },

  vin: '',
  setVin: (vin) => set({ vin }),

  voltageWarning: '',
  setVoltageWarning: (voltageWarning) => set({ voltageWarning }),

  visiblesPorPantalla: new Map(),
  generacionApp: 0,
  appAlFrente: () => set({ generacionApp: get().generacionApp + 1 }),
  setVisibles: (dueño, claves) => {
    const next = new Map(get().visiblesPorPantalla);
    next.set(dueño, new Set(claves));
    set({ visiblesPorPantalla: next });
  },
  quitarVisibles: (dueño) => {
    const actual = get().visiblesPorPantalla;
    if (!actual.has(dueño)) return;
    const next = new Map(actual);
    next.delete(dueño);
    set({ visiblesPorPantalla: next });
  },
  clavesActivas: () => {
    const st = get();
    return calcularActivas(st.visiblesPorPantalla.values(), st.grabando, st.grabClaves);
  },

  grabando: false,
  grabInicio: 0,
  grabClaves: new Set(),
  grabMuestras: [],
  iniciarGrabacion: (claves) => set({
    grabando: true, grabInicio: Date.now(),
    grabClaves: new Set(claves), grabMuestras: [],
  }),
  pararGrabacion: () => set({ grabando: false }),
  anotarGrabacion: (entries) => {
    const st = get();
    if (!st.grabando) return;
    // Tope duro: una grabación larga no puede comerse la memoria del teléfono.
    // Al llegar al tope se conserva la mitad más reciente y se sigue grabando.
    let muestras = st.grabMuestras;
    if (muestras.length + entries.length > MAX_GRABACION) {
      muestras = muestras.slice(-Math.floor(MAX_GRABACION / 2));
    }
    const t = Date.now();
    set({ grabMuestras: [...muestras, ...entries.map(e => ({ t, key: e.key, value: e.reading.value }))] });
  },

  history: new Map(),
  pushHistoryBatch: (entries) => {
    if (!entries.length) return;
    const next = new Map(get().history);
    for (const { key, reading } of entries) {
      next.set(key, [...(next.get(key) ?? []), reading].slice(-MAX_HISTORY));
    }
    set({ history: next });
  },
  pushHistory: (key, reading) => {
    const current = get().history;
    const next = new Map(current);
    next.set(key, [...(current.get(key) ?? []), reading].slice(-MAX_HISTORY));
    set({ history: next });
  },
  clearHistory: () => set({ history: new Map() }),
  limpiarHistorial: (claves) => {
    const next = new Map(get().history);
    for (const k of claves) next.delete(k);
    set({ history: next });
  },

  strictMode: true,
  setStrictMode: (strictMode) => {
    set({ strictMode });
    void persist.savePrefs({ ...prefsOf(get()), strictMode });
  },

  pollIntervalMs: 200,
  setPollIntervalMs: (n) => {
    const pollIntervalMs = Math.max(50, Math.min(5000, n));
    set({ pollIntervalMs });
    void persist.savePrefs({ ...prefsOf(get()), pollIntervalMs });
  },
}));
