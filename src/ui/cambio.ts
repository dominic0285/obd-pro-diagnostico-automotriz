/**
 * La aritmética de la luz de cambio, sin nada de React ni de pantalla.
 *
 * Está separada para poder comprobarla: lo que decide cuándo se enciende una
 * luz que alguien va a mirar conduciendo no debería vivir donde no se puede
 * probar.
 */

/** Ancho de la banda por debajo del punto de cambio. */
export const BANDA_CAMBIO = 1000;

/**
 * ¿Este cambio de marcha es una SUBIDA entre marchas de avance?
 *
 * Sale de la clase por dos motivos: tiene una trampa y se puede comprobar.
 * La trampa es la reversa, que en este módulo es el número 7. Sin este filtro,
 * meter la reversa desde 6ª contaría como una subida de 6ª a 7ª y metería un
 * punto de cambio falso en lo aprendido, que es lo que luego decide cuándo se
 * enciende la luz.
 */
export function esSubida(previa: number, actual: number): boolean {
  return actual > previa && previa >= 1 && previa <= 6 && actual <= 6;
}

/** Cuánto falta para el punto de cambio, de 0 a 1. */
export function calcularAviso(rpm: number | null, punto: number, banda = BANDA_CAMBIO): number {
  if (rpm === null || !Number.isFinite(rpm)) return 0;
  const desde = Math.max(700, punto - banda);
  return Math.min(1, Math.max(0, (rpm - desde) / Math.max(1, punto - desde)));
}

/** Corte de inyección del 4.6 V8 3V y principio de su zona roja. */
export const RPM_MAX = 8000;
export const RPM_ROJO = 5600;

/** Los tres colores del aviso de cambio. */
export const VERDE = '#2FA84F';
export const AMBAR = '#E8930C';
export const ROJO = '#FF3B2E';

/**
 * El color de la aguja del cuentavueltas.
 *
 * Verde mientras falta, ámbar cuando se acerca, rojo justo antes de cambiar.
 * El aviso va en la AGUJA y no en una fila de puntos arriba, porque una fila
 * arriba obliga a apartar la vista del reloj, que es lo que no se puede hacer
 * conduciendo.
 *
 * Por encima de la zona roja de la esfera manda la zona roja: esa es una
 * advertencia del fabricante sobre el motor, no una sugerencia de cuándo
 * cambiar de marcha, y no puede quedar tapada por la otra.
 */
export function colorAguja(rpm: number | null, aviso: number): string {
  if (rpm !== null && Number.isFinite(rpm) && rpm >= RPM_ROJO) return ROJO;
  if (aviso >= 0.85) return ROJO;
  if (aviso >= 0.5) return AMBAR;
  return VERDE;
}

/**
 * La mediana, no el promedio.
 *
 * Para datos como el nivel del tanque: un chapoteo del flotador en una curva es
 * un valor raro suelto. El promedio se lo traga y mueve la aguja; la mediana lo
 * ignora del todo y no retrasa los cambios de verdad.
 */
export function mediana(xs: number[]): number | null {
  const a = xs.filter(x => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
