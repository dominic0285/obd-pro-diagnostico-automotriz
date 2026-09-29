/**
 * Tabla opcional de descripciones de códigos de avería (DTC) en inglés.
 *
 * En el repositorio público va vacía: cada código se explica con la tabla
 * propia en español de `dtcComunes.ts` o, si no está ahí, por su estructura
 * (familia y sistema según SAE J2012). Si tienes una tabla de descripciones
 * con licencia para usarla, cárgala aquí con el formato `'P0171': 'texto'`.
 */

export const DTC_TEXTO: Record<string, string> = {};

export function describirDtc(codigo: string): string {
  return DTC_TEXTO[codigo.toUpperCase()] ?? '';
}

export function totalDtcConocidos(): number {
  return Object.keys(DTC_TEXTO).length;
}
