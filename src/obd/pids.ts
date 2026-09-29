/**
 * Definiciones OBD2 estándar (SAE J1979 Modo 01) y secuencia de inicio ELM327.
 * (ATZ, ATE1, ATL0, ATS0, ATRV, ATH0, ATSPn, 0100, 03, 07, 0A, 015E, 0902, 0100, 0120…).
 * Diferencias intencionales:
 *   - ATE0 en vez de ATE1: con eco activado se deduce a qué comando
 *     responde el ELM; aquí lo sabemos por la cola (un comando a la vez).
 *   - ATAT1 + ATST32: timing adaptativo y timeout de 200 ms para respuestas rápidas.
 */

export interface PidDefinition {
  mode: string;
  pid: string;
  name: string;
  unit: string;
  min: number;
  max: number;
  formula: (bytes: number[]) => number;
}

export const PIDS: PidDefinition[] = [
  { mode: '01', pid: '04', name: 'Carga del motor',       unit: '%',    min: 0,   max: 100,    formula: ([A]) => (A * 100) / 255 },
  { mode: '01', pid: '05', name: 'Temp. refrigerante',    unit: '°C',   min: -40, max: 215,    formula: ([A]) => A - 40 },
  { mode: '01', pid: '06', name: 'STFT Banco 1',          unit: '%',    min: -100,max: 99.2,   formula: ([A]) => (A - 128) * 100 / 128 },
  { mode: '01', pid: '07', name: 'LTFT Banco 1',          unit: '%',    min: -100,max: 99.2,   formula: ([A]) => (A - 128) * 100 / 128 },
  { mode: '01', pid: '08', name: 'STFT Banco 2',          unit: '%',    min: -100,max: 99.2,   formula: ([A]) => (A - 128) * 100 / 128 },
  { mode: '01', pid: '09', name: 'LTFT Banco 2',          unit: '%',    min: -100,max: 99.2,   formula: ([A]) => (A - 128) * 100 / 128 },
  { mode: '01', pid: '0A', name: 'Presión combustible',   unit: 'kPa',  min: 0,   max: 765,    formula: ([A]) => A * 3 },
  { mode: '01', pid: '0B', name: 'MAP admisión',          unit: 'kPa',  min: 0,   max: 255,    formula: ([A]) => A },
  { mode: '01', pid: '0C', name: 'RPM',                   unit: 'rpm',  min: 0,   max: 16383,  formula: ([A, B]) => ((A * 256) + B) / 4 },
  { mode: '01', pid: '0D', name: 'Velocidad',             unit: 'km/h', min: 0,   max: 255,    formula: ([A]) => A },
  { mode: '01', pid: '0E', name: 'Avance encendido',      unit: '°',    min: -64, max: 63.5,   formula: ([A]) => A / 2 - 64 },
  { mode: '01', pid: '0F', name: 'Temp. aire admisión',   unit: '°C',   min: -40, max: 215,    formula: ([A]) => A - 40 },
  { mode: '01', pid: '10', name: 'Flujo MAF',             unit: 'g/s',  min: 0,   max: 655.35, formula: ([A, B]) => ((A * 256) + B) / 100 },
  { mode: '01', pid: '11', name: 'Posición acelerador',   unit: '%',    min: 0,   max: 100,    formula: ([A]) => (A * 100) / 255 },
  { mode: '01', pid: '1F', name: 'Tiempo encendido',      unit: 's',    min: 0,   max: 65535,  formula: ([A, B]) => A * 256 + B },
  { mode: '01', pid: '21', name: 'Distancia con MIL',     unit: 'km',   min: 0,   max: 65535,  formula: ([A, B]) => A * 256 + B },
  { mode: '01', pid: '23', name: 'Presión riel',          unit: 'kPa',  min: 0,   max: 655350, formula: ([A, B]) => ((A * 256) + B) * 10 },
  { mode: '01', pid: '2F', name: 'Nivel combustible',     unit: '%',    min: 0,   max: 100,    formula: ([A]) => (A * 100) / 255 },
  { mode: '01', pid: '31', name: 'Dist. desde borrado',   unit: 'km',   min: 0,   max: 65535,  formula: ([A, B]) => A * 256 + B },
  { mode: '01', pid: '33', name: 'Presión barométrica',   unit: 'kPa',  min: 0,   max: 255,    formula: ([A]) => A },
  { mode: '01', pid: '42', name: 'Voltaje módulo',        unit: 'V',    min: 0,   max: 65.535, formula: ([A, B]) => ((A * 256) + B) / 1000 },
  { mode: '01', pid: '43', name: 'Carga absoluta',        unit: '%',    min: 0,   max: 25700,  formula: ([A, B]) => ((A * 256) + B) * 100 / 255 },
  { mode: '01', pid: '44', name: 'Lambda comandado',      unit: 'λ',    min: 0,   max: 2,      formula: ([A, B]) => ((A * 256) + B) / 32768 },
  { mode: '01', pid: '46', name: 'Temp. ambiente',        unit: '°C',   min: -40, max: 215,    formula: ([A]) => A - 40 },
  { mode: '01', pid: '5C', name: 'Temp. aceite',          unit: '°C',   min: -40, max: 210,    formula: ([A]) => A - 40 },
  { mode: '01', pid: '5E', name: 'Consumo',               unit: 'L/h',  min: 0,   max: 3212,   formula: ([A, B]) => ((A * 256) + B) * 0.05 },
];

export const PID_MAP = new Map(PIDS.map(p => [`${p.mode}${p.pid}`, p]));

/** Header de difusión OBD2 estándar (todos los módulos de emisiones responden en 7E8-7EF) */
export const FUNCTIONAL_HEADER = '7DF';

/**
 * Secuencia de inicio del ELM327. ATZ se manda varias
 * veces (algunos clones ignoran la primera después de encender).
 */
export const AT_INIT_SEQUENCE: { cmd: string; timeout: number; optional?: boolean }[] = [
  { cmd: 'ATZ',   timeout: 3000 },                 // reset (respuesta: "ELM327 v1.5")
  { cmd: 'ATZ',   timeout: 3000, optional: true },
  { cmd: 'ATE0',  timeout: 1500 },                 // eco off
  { cmd: 'ATL0',  timeout: 1500 },                 // sin linefeeds
  { cmd: 'ATS0',  timeout: 1500 },                 // sin espacios
  { cmd: 'ATH0',  timeout: 1500 },                 // sin headers en las respuestas
  // Formateo ISO-TP activado. Es imprescindible: con CAF0 el primer byte que
  // enviamos dejaría de ser el número de servicio y la lista blanca de
  // servicios perdería su sentido. Por eso CAF0 no existe en la lista blanca
  // y aquí se fuerza CAF1 en cada arranque.
  { cmd: 'ATCAF1', timeout: 1500 },
  { cmd: 'ATAT1', timeout: 1500, optional: true }, // timing adaptativo
  { cmd: 'ATST32',timeout: 1500, optional: true }, // timeout ELM ≈ 200 ms
  { cmd: 'ATRV',  timeout: 1500, optional: true }, // voltaje batería
];

/**
 * Orden de prueba de protocolos (rotación habitual en escáneres ELM327:
 * 6 → 7 → 8 → 9 → 5 → 4 → 3 → 2 → 1). Un Explorer 2010 es el 6.
 */
export const PROTOCOL_ORDER = ['6', '7', '8', '9', '5', '4', '3', '2', '1', '0'];
export const PROTOCOL_NAMES: Record<string, string> = {
  '0': 'Automático', '1': 'SAE J1850 PWM', '2': 'SAE J1850 VPW', '3': 'ISO 9141-2',
  '4': 'ISO 14230-4 KWP (5 baud)', '5': 'ISO 14230-4 KWP (fast)',
  '6': 'ISO 15765-4 CAN 11 bit 500 kbps', '7': 'ISO 15765-4 CAN 29 bit 500 kbps',
  '8': 'ISO 15765-4 CAN 11 bit 250 kbps', '9': 'ISO 15765-4 CAN 29 bit 250 kbps',
  'A': 'SAE J1939 CAN',
};
