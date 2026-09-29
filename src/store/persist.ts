/**
 * Guardado en disco de lo que no se debe perder.
 *
 * Los resultados de una prueba de PIDs cuestan una sesión con el carro
 * delante: no pueden vivir solo en la memoria de una pantalla. Aquí se
 * guardan en el almacenamiento del teléfono y se recuperan al abrir la app.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PidProbeResult } from '../obd/ObdGateway';
import type { ModuleScanResult } from '../obd/moduleScan';

const K = {
  probe: 'obdpro.probe.v1',
  scan: 'obdpro.scan.v1',
  prefs: 'obdpro.prefs.v1',
  diag: 'obdpro.diag.v1',
};

export interface ProbeMeta {
  save?: boolean;
  expected?: number;
  complete?: boolean;
  scope?: 'all' | 'partial';
}

export interface SavedProbe {
  at: number;
  profileId: string;
  results: [string, PidProbeResult][];
  expected?: number;
  complete?: boolean;
  scope?: 'all' | 'partial';
}

export interface SavedScan {
  at: number;
  profileId: string;
  results: ModuleScanResult[];
}

export interface SavedPrefs {
  /** Último adaptador usado, para reconectar sin escanear. */
  lastDevice?: { id: string; name: string | null };
  strictMode?: boolean;
  profileId?: string;
  pollIntervalMs?: number;
  disabledPids?: string[];
  /**
   * Hasta qué migración de interruptores se ha aplicado ya en este teléfono.
   * Sin esto, cambiar un dato de "apagado por defecto" a "encendido por
   * defecto" no le llega a nadie que ya tenga la app instalada: la lista de
   * apagados que se guardó el primer día lo sigue teniendo apagado para
   * siempre. Ver MIGRACIONES en useObdStore.
   */
  ajustesVersion?: number;
}

async function put(key: string, value: unknown) {
  try { await AsyncStorage.setItem(key, JSON.stringify(value)); }
  catch (e) { console.warn('[persist] no se pudo guardar', key, e); }
}

async function get<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (e) {
    console.warn('[persist] no se pudo leer', key, e);
    return null;
  }
}

export const persist = {
  saveProbe: (profileId: string, results: Map<string, PidProbeResult>,
              meta: { expected: number; complete: boolean; scope: 'all' | 'partial' }) =>
    put(K.probe, {
      at: Date.now(), profileId, results: [...results.entries()],
      expected: meta.expected, complete: meta.complete, scope: meta.scope,
    } satisfies SavedProbe),
  loadProbe: () => get<SavedProbe>(K.probe),

  saveScan: (profileId: string, results: ModuleScanResult[]) =>
    put(K.scan, { at: Date.now(), profileId, results } satisfies SavedScan),
  loadScan: () => get<SavedScan>(K.scan),

  /** Estado del diagnóstico automático. Se graba tras CADA etapa. */
  saveDiag: (state: unknown) => put(K.diag, state),
  loadDiag: <T>() => get<T>(K.diag),

  savePrefs: (p: SavedPrefs) => put(K.prefs, p),
  loadPrefs: () => get<SavedPrefs>(K.prefs),

  clearAll: async () => {
    try {
      await Promise.all([K.probe, K.scan, K.prefs, K.diag].map(k => AsyncStorage.removeItem(k)));
    } catch { /* nada que hacer */ }
  },
};
