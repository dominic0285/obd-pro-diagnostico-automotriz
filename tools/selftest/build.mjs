/**
 * Prepara una copia ejecutable del código de seguridad fuera de React Native.
 * Copia los módulos puros, reescribe los import para Node y sustituye por
 * dobles las dos dependencias del teléfono (BLE y almacén de estado).
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import os from 'node:os';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '../..');
// Se construye fuera de la carpeta del proyecto: la copia es desechable y así
// no se ensucia el repositorio ni hacen falta permisos de borrado.
const out = path.join(os.tmpdir(), 'obdpro-selftest');

const COPY = [
  'src/obd/limits.ts', 'src/obd/safety.ts', 'src/obd/protocol.ts',
  'src/obd/pipeline.ts', 'src/obd/pollEngine.ts', 'src/obd/moduleScan.ts',
  'src/obd/pids.ts', 'src/obd/ObdGateway.ts', 'src/obd/report.ts', 'src/obd/dtcTextos.ts', 'src/obd/autoDiag.ts',
  'src/obd/nucleo.ts', 'src/obd/barridoExplorer.ts', 'src/obd/glosario.ts', 'src/obd/dtcComunes.ts', 'src/obd/dtcTextos.ts', 'src/obd/grabacion.ts', 'src/obd/pruebaCaja.ts',
  'src/ui/cambio.ts',
  'src/profiles/index.ts', 'src/profiles/generic_obd2.ts', 'src/profiles/ford_explorer_2010.ts',
  'src/profiles/ford_ecosport_2006.ts',
];

function rewrite(code) {
  // Node necesita la extensión explícita en los import relativos.
  return code.replace(/from '(\.[^']*)'/g, (m, spec) =>
    spec.endsWith('.ts') ? m : `from '${spec}.ts'`);
}

export function build() {
  try { fs.rmSync(out, { recursive: true, force: true }); } catch { /* se sobrescribe */ }
  for (const rel of COPY) {
    const dst = path.join(out, rel.replace(/^src\//, ''));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, rewrite(fs.readFileSync(path.join(root, rel), 'utf8')));
  }

  // ── Doble del enlace BLE: registra todo lo que se escribiría al carro ────
  fs.mkdirSync(path.join(out, 'ble'), { recursive: true });
  fs.writeFileSync(path.join(out, 'ble/BleManager.ts'), `
import { CommandPipeline } from '../obd/pipeline.ts';
export const spy = { written: [], connected: true, strict: false, sim: null };
const pipeline = new CommandPipeline({
  write: async (payload) => {
    const cmd = payload.replace(/\\r$/, '');
    spy.written.push({ cmd, t: Date.now() });
    spy.sim?.receive(cmd);
  },
});
export const bleManager = {
  sendCommand: (c, t) => {
    if (!spy.connected) return Promise.reject(new Error('No conectado'));
    return pipeline.send(c, t);
  },
  isConnected: () => spy.connected,
  setStrict: (v) => { spy.strict = v; pipeline.setStrict(v); },
  resetCircuit: () => pipeline.resetCircuit(),
  flushQueue: () => pipeline.cancelAll('Cancelado'),
  onCircuitOpen: () => () => {},
  getStats: () => ({ ...pipeline.stats }),
  feed: (chunk) => pipeline.feed(chunk),
  stats: () => pipeline.stats,
  queueLength: () => pipeline.queueLength(),
};
`);

  // ── Doble del almacén de estado ─────────────────────────────────────────
  fs.mkdirSync(path.join(out, 'store'), { recursive: true });
  // El doble del almacén de estado.
  //
  // El almacén real usa React y no se puede cargar aquí, así que hay un doble.
  // Un doble que se queda atrás es peor que no tener pruebas: la batería pasa en
  // verde mientras la app está rota. Ya pasó una vez —el motor empezó a llamar a
  // clavesActivas() y el doble no la tenía—, así que ahora:
  //
  //   1. La lógica de qué se pregunta NO se reimplementa aquí: se llama a la
  //      misma función pura que usa el almacén real (calcularActivas).
  //   2. setInitStatus apunta los errores mortales del bucle, y la sección E
  //      comprueba que no haya ninguno. Si el motor vuelve a llamar a algo que
  //      el doble no tiene, la batería falla en vez de escupir un aviso por la
  //      consola que nadie lee.
  //   3. Y desde la 3.9 hay una comprobación que LEE el código del motor,
  //      saca todos los st.loQueSea() que usa y exige que el doble los tenga.
  //      Los dos primeros avisan cuando el fallo ya ocurrió; este lo impide
  //      antes, que es donde hay que estar.
  fs.writeFileSync(path.join(out, 'store/useObdStore.ts'), `
import { ALL_PROFILES } from '../profiles/index.ts';
import { calcularActivas } from '../obd/nucleo.ts';
const state = {
  strictMode: false,
  selectedProfile: ALL_PROFILES[1],
  disabledPids: new Set(),
  unsupportedPids: new Set(),
  supportedMode01: null,
  pollIntervalMs: 200,
  visiblesPorPantalla: new Map(),
  generacionApp: 0,
  grabando: false,
  grabInicio: 0,
  grabClaves: new Set(),
  grabMuestras: [],
  history: new Map(),
  readings: new Map(),
  setReadings: (r) => { state.readings = r; },
  /** Errores mortales del bucle. Tiene que quedarse vacío. */
  fatales: [],
  setInitStatus: (m) => { if (m) state.fatales.push(m); },
  setAdapter: () => {}, setVin: () => {},
  setDtcCodes: () => {}, setPendingDtcCodes: () => {},
  setSupportedMode01: (s) => { state.supportedMode01 = s; },
  setVoltageWarning: () => {},
  resetUnsupported: () => { state.unsupportedPids = new Set(); },
  markUnsupported: (k) => { state.unsupportedPids.add(k); },
  pushHistory: () => {}, pushHistoryBatch: () => {},
  limpiarHistorial: () => {},
  setProfile: (id) => {
    const p = ALL_PROFILES.find(x => x.id === id);
    if (p) state.selectedProfile = p;
  },
  appAlFrente: () => { state.generacionApp++; },
  setVisibles: (dueño, claves) => { state.visiblesPorPantalla.set(dueño, new Set(claves)); },
  quitarVisibles: (dueño) => { state.visiblesPorPantalla.delete(dueño); },
  clavesActivas: () => calcularActivas(state.visiblesPorPantalla.values(), state.grabando, state.grabClaves),
  iniciarGrabacion: (claves) => {
    state.grabando = true; state.grabInicio = Date.now();
    state.grabClaves = new Set(claves); state.grabMuestras = [];
  },
  pararGrabacion: () => { state.grabando = false; },
  anotarGrabacion: (entries) => {
    if (!state.grabando) return;
    const t = Date.now();
    for (const e of entries) state.grabMuestras.push({ t, key: e.key, value: e.reading.value });
  },
};
export const useObdStore = {
  getState: () => state,
  setState: (patch) => Object.assign(state, patch),
  _state: state,
};
`);
  return out;
}

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  console.log('construido en', build());
}
