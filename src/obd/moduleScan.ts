/**
 * Escaneo de códigos por módulo (como el "Read DTCs" por módulo de los escáneres profesionales).
 *
 * Servicios usados, todos de LECTURA:
 *   19 02 <mask>   UDS ReadDTCInformation / reportDTCByStatusMask  (ISO 14229)
 *   18 00 FF 00    KWP ReadDiagnosticTroubleCodesByStatus (ISO 14230 sobre CAN, Ford ≤ ~2011)
 * Borrado (solo con confirmación explícita):
 *   14 FF FF FF    UDS ClearDiagnosticInformation (todos los grupos)
 *   14 FF 00       KWP ClearDiagnosticInformation
 */

export interface ModuleDtc {
  /** Código en formato SAE: P0300, C1145, B1318, U0100 */
  code: string;
  /** Byte de tipo de fallo Ford (p.ej. "2F" en C1145-2F). Vacío en KWP. */
  failureType: string;
  /** Byte de estado UDS/KWP crudo */
  status: number;
  /** Interpretación del byte de estado */
  active: boolean;     // testFailed (bit0) o testFailedThisCycle (bit1)
  confirmed: boolean;  // confirmedDTC (bit3)
  pending: boolean;    // pendingDTC (bit2)
  milOn: boolean;      // warningIndicatorRequested (bit7)
}

export type ModuleScanStatus = 'ok' | 'no_response' | 'unsupported' | 'error';

export interface ModuleScanResult {
  moduleId: string;
  status: ModuleScanStatus;
  /** 'uds' = respondió a 19 02, 'kwp' = respondió a 18 00 FF 00 */
  protocol?: 'uds' | 'kwp';
  dtcs: ModuleDtc[];
  raw: string;
  message?: string;
}

const TYPE = ['P', 'C', 'B', 'U'];

/** 2 bytes (16 bits) → "P0300" / "C1145" */
export function wordToCode(w: number): string {
  const t = TYPE[(w >> 14) & 3];
  const d1 = ((w >> 12) & 3).toString();
  const rest = (w & 0x0fff).toString(16).toUpperCase().padStart(3, '0');
  return `${t}${d1}${rest}`;
}

function statusToFlags(st: number) {
  return {
    active: !!(st & 0x01) || !!(st & 0x02),
    confirmed: !!(st & 0x08),
    pending: !!(st & 0x04),
    milOn: !!(st & 0x80),
  };
}

/** Respuesta UDS: 59 02 <availMask> [b1 b2 b3 status]* */
export function decodeUds1902(hex: string): ModuleDtc[] | null {
  const i = hex.indexOf('5902');
  if (i === -1) return null;
  const data = hex.substring(i + 4 + 2); // saltar availability mask
  const out: ModuleDtc[] = [];
  for (let p = 0; p + 8 <= data.length; p += 8) {
    const w = parseInt(data.substring(p, p + 4), 16);
    const ft = data.substring(p + 4, p + 6);
    const st = parseInt(data.substring(p + 6, p + 8), 16);
    if (!w && !st) continue;
    out.push({ code: wordToCode(w), failureType: ft, status: st, ...statusToFlags(st) });
  }
  return out;
}

/** Respuesta KWP: 58 NN [b1 b2 status]*   (Ford mete a veces un byte extra de tipo de fallo) */
export function decodeKwp18(hex: string): ModuleDtc[] | null {
  const i = hex.indexOf('58');
  if (i === -1) return null;
  const count = parseInt(hex.substring(i + 2, i + 4), 16);
  const data = hex.substring(i + 4);
  const out: ModuleDtc[] = [];
  // Formato estándar: 3 bytes por DTC. Si la longitud cuadra con 4 bytes/DTC, Ford incluyó failure type.
  const stride = count > 0 && data.length >= count * 8 && data.length < count * 8 + 8 && data.length % 8 === 0 ? 8 : 6;
  for (let p = 0, n = 0; p + stride <= data.length && (count === 0 || n < count); p += stride, n++) {
    const w = parseInt(data.substring(p, p + 4), 16);
    const ft = stride === 8 ? data.substring(p + 4, p + 6) : '';
    const st = parseInt(data.substring(p + stride - 2, p + stride), 16);
    if (!w) continue;
    out.push({ code: wordToCode(w), failureType: ft, status: st, ...statusToFlags(st) });
  }
  return out;
}

/** Texto corto para la UI a partir de los flags */
export function describeStatus(d: ModuleDtc): string {
  const parts: string[] = [];
  if (d.active) parts.push('activo ahora');
  if (d.confirmed) parts.push('confirmado');
  if (d.pending && !d.confirmed) parts.push('pendiente');
  if (!parts.length) parts.push('en memoria (histórico)');
  if (d.milOn) parts.push('testigo encendido');
  return parts.join(' · ');
}
