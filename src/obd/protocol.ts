/**
 * Decodificación de respuestas del ELM327. Funciones puras, sin dependencias
 * de React Native: se pueden ejecutar y verificar fuera del teléfono.
 */

import type { EnhancedPid } from '../profiles';

/**
 * Limpia una respuesta y devuelve solo el hexadecimal útil.
 * Maneja el formato multitrama que imprime el ELM327:
 *   "014\r0:490201314641\r1:42503038573036\r2:31383331353400"
 * (longitud total, luego "N:" + datos) y descarta "SEARCHING..." y similares.
 */
export function normalizeHex(raw: string): string {
  const lines = raw.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean)
    .filter(l => !/^SEARCHING/i.test(l) && !/^BUS INIT/i.test(l));
  const isMulti = lines.some(l => /^[0-9A-F]:/i.test(l));
  if (isMulti) {
    return lines
      .filter(l => /^[0-9A-F]:/i.test(l))
      .map(l => l.substring(2))
      .join('')
      .replace(/[^0-9A-F]/gi, '')
      .toUpperCase();
  }
  return lines.join('').replace(/[^0-9A-F]/gi, '').toUpperCase();
}

/** true si la respuesta no contiene datos aprovechables. */
export function isNegative(raw: string): boolean {
  const u = raw.toUpperCase().replace(/\s+/g, '');
  if (u.includes('NODATA') || u.includes('ERROR') || u.includes('UNABLETOCONNECT')
    || u.includes('STOPPED') || u.includes('CANERROR') || u.includes('BUSINIT')
    || u.includes('BUFFERFULL') || u.includes('?')) return true;
  return /^7F/.test(normalizeHex(raw));
}

/** Código de rechazo UDS (7F <servicio> <código>), o null. */
export function negativeCode(raw: string): string | null {
  const hex = normalizeHex(raw);
  const m = /^7F([0-9A-F]{2})([0-9A-F]{2})/.exec(hex);
  return m ? m[2] : null;
}

/** true si el módulo respondió "ese identificador no existe". */
export function isUnsupportedResponse(raw: string): boolean {
  const c = negativeCode(raw);
  return c === '31' || c === '11' || c === '12';
}

/** true si el módulo dijo "estoy ocupado / espera" (reintentable). */
export function isBusyResponse(raw: string): boolean {
  const c = negativeCode(raw);
  return c === '21' || c === '78';
}

export function hexToBytes(hex: string): number[] {
  return (hex.match(/.{2}/g) ?? []).map(b => parseInt(b, 16));
}

/** Decodifica el bitmask 41 00 / 41 20 / … en PIDs "01xx" soportados. */
export function decodeSupportMask(base: number, bytes: number[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < 4 && i < bytes.length; i++) {
    for (let bit = 0; bit < 8; bit++) {
      if (bytes[i] & (0x80 >> bit)) {
        out.push('01' + (base + i * 8 + bit + 1).toString(16).toUpperCase().padStart(2, '0'));
      }
    }
  }
  return out;
}

/**
 * Decodifica la respuesta a 03 / 07 / 0A.
 * En CAN la respuesta lleva un byte con el número de códigos: "43 NN AAAA…".
 * En las líneas K clásicas no lo lleva: "43 AAAA BBBB…".
 */
export function decodeDtcs(raw: string, replyByte: '43' | '47' | '4A', isCan: boolean): string[] {
  const hex = normalizeHex(raw);
  const codes: string[] = [];
  let idx = hex.indexOf(replyByte);
  while (idx !== -1) {
    let data = hex.substring(idx + 2);
    let count = -1;
    if (isCan) {
      count = parseInt(data.substring(0, 2), 16);
      data = data.substring(2);
    }
    const pairs = data.match(/.{4}/g) ?? [];
    const take = count >= 0 ? pairs.slice(0, count) : pairs;
    for (const p of take) {
      const w = parseInt(p, 16);
      if (!w) continue;
      codes.push(wordToCode(w));
    }
    if (take.length === 0) break;
    idx = hex.indexOf(replyByte, idx + 2 + (count >= 0 ? 2 : 0) + take.length * 4);
  }
  return [...new Set(codes)];
}

/** 2 bytes → "P0300" / "C1145" / "U0100". */
export function wordToCode(w: number): string {
  const type = ['P', 'C', 'B', 'U'][(w >> 14) & 3];
  const d1 = ((w >> 12) & 3).toString();
  const rest = (w & 0x0fff).toString(16).toUpperCase().padStart(3, '0');
  return `${type}${d1}${rest}`;
}

export interface ParsedPid {
  value: number;
  hex: string;
}

/**
 * Extrae el valor de un PID. Devuelve null si la respuesta no corresponde,
 * si es negativa, o si la fórmula produce algo que no es un número finito.
 *
 * Comprobación importante: se verifica que haya suficientes bytes de datos.
 * Una fórmula que espera dos bytes y recibe uno produciría NaN o un número
 * absurdo; preferimos "sin dato" antes que un valor inventado en pantalla.
 */
export function parsePidResponse(def: EnhancedPid, raw: string): ParsedPid | null {
  if (isNegative(raw)) return null;
  const hex = normalizeHex(raw);

  // Modo 06: la respuesta trae varios registros; se elige el del TID pedido.
  if (def.mode === '06') {
    const recs = decodeMode06(raw);
    if (!recs.length) return null;
    const mid = parseInt(def.command.substring(2), 16);
    const rec = recs.find(r => r.mid === mid && (def.tid === undefined || r.tid === def.tid));
    if (!rec) return null;
    let value: number;
    try { value = def.formula([rec.value >> 8, rec.value & 0xff]); } catch { return null; }
    if (!Number.isFinite(value)) return null;
    return { value: Math.round(value * 100) / 100, hex: rec.raw };
  }

  // Eco de la respuesta positiva: servicio + 0x40, seguido del identificador.
  const prefix =
    (def.mode === '01' ? '41' : def.mode === '21' ? '61' : '62') + def.command.substring(2);
  const idx = hex.indexOf(prefix);
  if (idx === -1) return null;
  const bytes = hexToBytes(hex.substring(idx + prefix.length));
  if (bytes.length === 0) return null;
  if (bytes.some(b => !Number.isFinite(b))) return null;

  let value: number;
  try {
    value = def.formula(bytes);
  } catch {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return { value: Math.round(value * 100) / 100, hex };
}

/**
 * Bytes hexadecimales -> texto legible, si lo es.
 *
 * Los números de pieza y calibración de Ford (F124, F188, F190) viajan como
 * caracteres ASCII dentro de la respuesta. Se descartan los bytes de relleno
 * y los de control; si lo que queda no parece texto, se devuelve vacío para
 * no inventar una cadena a partir de un dato numérico.
 */
export function hexToAscii(hex: string): string {
  const bytes = hexToBytes(hex);
  if (!bytes.length) return '';
  const txt = bytes.filter(b => b >= 0x20 && b < 0x7f).map(b => String.fromCharCode(b)).join('').trim();
  if (txt.length < 4) return '';
  const utiles = txt.replace(/[^A-Za-z0-9]/g, '').length;
  return utiles / txt.length >= 0.6 ? txt : '';
}

/** Extrae el VIN de una respuesta 09 02. */
export function parseVin(raw: string): string {
  const hex = normalizeHex(raw);
  const i = hex.indexOf('4902');
  if (i === -1) return '';
  let data = hex.substring(i + 4);
  if (data.startsWith('01')) data = data.substring(2);
  const vin = String.fromCharCode(...hexToBytes(data).filter(b => b > 0x1f && b < 0x7f));
  return vin.length >= 17 ? vin.substring(vin.length - 17) : vin.trim();
}

/**
 * ¿Esto parece un VIN de verdad?
 *
 * No basta con "17 caracteres válidos": un relleno de ceros (00000000000000000)
 * pasa ese filtro y es justo lo que devolvía el bus cuando varios módulos
 * contestaban a la vez. Un VIN real lleva el identificador del fabricante en
 * los tres primeros caracteres y nunca es un solo carácter repetido.
 */
export function looksLikeVin(v: string): boolean {
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(v)) return false;      // sin I, O ni Q
  if (/^(.)\1{16}$/.test(v)) return false;                 // 17 veces el mismo
  const letras = (v.match(/[A-Z]/g) ?? []).length;
  if (letras < 3) return false;                            // ningún VIN real tiene tan pocas
  if (/^0+$/.test(v.substring(0, 3))) return false;        // WMI de ceros = relleno
  return true;
}

/** Voltaje de ATRV ("12.4V" → 12.4). */
/** Fuera de esta ventana, lo que dijo el adaptador no es un voltaje de carro. */
export const VOLTAJE_PLAUSIBLE = { min: 5, max: 20 };

/**
 * El voltaje que dice medir el adaptador.
 *
 * Devuelve null si el número no puede ser el de una batería de carro. Esto no
 * es puntilloso: la primera ATRV se manda justo después del reinicio del
 * adaptador y a veces vuelve con basura pegada del eco anterior. En la prueba
 * de la EcoSport del 16/09 salió así "28.3 V" en la cabecera del informe
 * mientras la primera etapa, medida un segundo después, leía 13,7 V. Un
 * voltaje inventado en un informe de diagnóstico es peor que no tenerlo: manda
 * a buscar una avería eléctrica que no existe.
 */
export function parseVoltage(raw: string): number | null {
  const m = /(\d{1,2}(?:\.\d)?)\s*V/i.exec(raw.replace(/ATRV/i, ''));
  if (!m) return null;
  const v = parseFloat(m[1]);
  return v >= VOLTAJE_PLAUSIBLE.min && v <= VOLTAJE_PLAUSIBLE.max ? v : null;
}

// ─── Modo 06: resultados de los monitores a bordo ────────────────────────────
/**
 * El Modo 06 se autodescribe: se le pregunta al PCM qué monitores tiene y él
 * devuelve la lista. No hay que adivinar identificadores como en el Modo 22.
 * Es el mismo mecanismo del bitmask 0100 que ya se usa para el Modo 01.
 */

export interface Mode06Record {
  /** Monitor ID: qué se está midiendo (p. ej. un cilindro). */
  mid: number;
  /** Test ID: qué prueba concreta dentro de ese monitor. */
  tid: number;
  /** Identificador de unidad y escala (tabla SAE; Ford añade los suyos). */
  uasid: number;
  value: number;
  min: number;
  max: number;
  raw: string;
}

/** Decodifica la respuesta a 06<MID>: "46" + registros de 9 bytes. */
export function decodeMode06(raw: string): Mode06Record[] {
  const hex = normalizeHex(raw);
  const out: Mode06Record[] = [];
  const i = hex.indexOf('46');
  if (i === -1) return out;
  const data = hex.substring(i + 2);
  for (let p = 0; p + 18 <= data.length; p += 18) {
    const r = data.substring(p, p + 18);
    const b = hexToBytes(r);
    if (b.length < 9) break;
    out.push({
      mid: b[0], tid: b[1], uasid: b[2],
      value: b[3] * 256 + b[4],
      min: b[5] * 256 + b[6],
      max: b[7] * 256 + b[8],
      raw: r,
    });
  }
  return out;
}

/** Decodifica el bitmask de monitores soportados (respuesta a 0600, 0620, …). */
export function decodeMode06Support(base: number, raw: string): number[] {
  const hex = normalizeHex(raw);
  const prefix = '46' + base.toString(16).toUpperCase().padStart(2, '0');
  const i = hex.indexOf(prefix);
  if (i === -1) return [];
  const bytes = hexToBytes(hex.substring(i + 4, i + 12));
  const out: number[] = [];
  for (let k = 0; k < 4 && k < bytes.length; k++) {
    for (let bit = 0; bit < 8; bit++) {
      if (bytes[k] & (0x80 >> bit)) out.push(base + k * 8 + bit + 1);
    }
  }
  return out;
}

/**
 * Escala de los monitores de fallo de encendido de Ford: el valor crudo por
 * 0,0015 da el porcentaje de fallos. Fuente: FenderBender, "Ford Mode $06
 * Misfire Tests" (ejemplo: 420 × 0,0015 = 0,6 %).
 */
export function fordMisfirePercent(value: number): number {
  return Math.round(value * 0.0015 * 1000) / 1000;
}
