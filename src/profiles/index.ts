/**
 * Sistema de perfiles de vehículo.
 */

export interface ModuleGroup {
  /** ID CAN de petición (ATSH). Vacío = 7DF funcional (estándar OBD2). */
  header: string;
  /** ID CAN de respuesta (ATCRA). Si se omite se calcula header + 8. */
  rxHeader?: string;
  moduleName: string;
  color: string;
  pids: EnhancedPid[];
}

export interface EnhancedPid {
  /** Comando completo, p.ej. '010C' o '22160E' */
  command: string;
  /** Clave única en el store */
  key: string;
  name: string;
  unit: string;
  min: number;
  max: number;
  /**
   * '01' = OBD2 estándar
   * '22' = UDS ReadDataByIdentifier (Ford enhanced)
   * '06' = resultados de monitores a bordo. El Modo 06 se autodescribe: el
   *        módulo publica qué monitores tiene, así que aquí no se adivina nada.
   * '21' = KWP2000 ReadDataByLocalIdentifier. Para módulos viejos que no
   *        hablan UDS (el ABS de este Explorer). Identificador de 1 byte.
   */
  mode: '01' | '22' | '06' | '21';
  /** Solo Modo 06: qué prueba concreta del monitor se quiere leer. */
  tid?: number;
  isCylinderData?: boolean;
  cylinder?: number;
  /** Bytes de datos -> valor. Recibe SOLO los bytes después de 41xx / 62xxxx */
  formula: (bytes: number[]) => number;
  /** DID/fórmula confirmados con documentación pública. Los no verificados arrancan apagados. */
  verified?: boolean;
  /**
   * Arranca apagado aunque esté verificado. Para datos fiables pero de consulta
   * puntual, que no merece la pena preguntar en cada vuelta del bucle.
   */
  defaultOff?: boolean;
  /** Nota para la UI (fuente, dudas) */
  note?: string;
  /**
   * Para los valores que son un estado y no una medida: la palanca, la marcha,
   * el pedal de freno, el estado del combustible. Un numero suelto no dice
   * nada; "P" o "PISADO" si.
   */
  etiquetas?: Record<number, string>;
}

/** Como mostrar una lectura: con su etiqueta si la tiene, si no con su unidad. */
export function textoLectura(p: EnhancedPid, valor: number): string {
  const e = p.etiquetas?.[valor];
  if (e) return e;
  return `${valor}${p.unit ? ' ' + p.unit : ''}`;
}

/** Módulo al que se le pueden pedir códigos por UDS 19 / KWP 18 */
export interface DiagnosticModule {
  id: string;
  name: string;
  /** ID CAN de petición (11 bits, 7xx) */
  header: string;
  /** ID CAN de respuesta */
  rxHeader: string;
  /** Qué tipos de código suele guardar (para la UI) */
  codeTypes: string;
  color: string;
  /**
   * Bus en el que vive. Un ELM327 conectado al conector estándar solo alcanza
   * el HS-CAN (pines 6 y 14); los módulos de MS-CAN no contestarán nunca y eso
   * no es un fallo.
   */
  bus?: 'hs' | 'ms';
  note?: string;
}

export interface VehicleProfile {
  id: string;
  make: string;
  model: string;
  year: string;
  engine: string;
  description: string;
  hasEnhanced: boolean;
  /** Protocolo ELM preferido (ATSPn). Si falla se prueba el resto. */
  preferredProtocol?: string;
  moduleGroups: ModuleGroup[];
  /** Módulos para el escaneo de códigos (lectura por módulo) */
  modules?: DiagnosticModule[];
}

export { GENERIC_OBD2_PROFILE } from './generic_obd2';
export { FORD_EXPLORER_2010_PROFILE } from './ford_explorer_2010';
export { FORD_ECOSPORT_2006_PROFILE } from './ford_ecosport_2006';

import { GENERIC_OBD2_PROFILE } from './generic_obd2';
import { FORD_EXPLORER_2010_PROFILE } from './ford_explorer_2010';
import { FORD_ECOSPORT_2006_PROFILE } from './ford_ecosport_2006';

export const ALL_PROFILES: VehicleProfile[] = [
  GENERIC_OBD2_PROFILE,
  FORD_EXPLORER_2010_PROFILE,
  FORD_ECOSPORT_2006_PROFILE,
];

export const DEFAULT_PROFILE_ID = 'generic_obd2';

/** Todos los PIDs de un perfil, aplanados */
export function allPids(profile: VehicleProfile): EnhancedPid[] {
  return profile.moduleGroups.flatMap(g => g.pids);
}
