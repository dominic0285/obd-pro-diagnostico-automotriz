/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  GUARDIA DE SEGURIDAD — LISTA BLANCA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Filosofía: NO se bloquea lo peligroso, se permite ÚNICAMENTE lo que se sabe
 * inofensivo. Cualquier comando que no esté en estas listas se rechaza, aunque
 * sea nuevo, aunque venga de un error de programación, aunque lo escriba el
 * usuario en la terminal. Un fallo futuro no puede "colarse": tendría que
 * añadirse explícitamente a este archivo.
 *
 * Esta función se invoca dentro de CommandPipeline, es decir, en el último
 * punto antes de escribir en el adaptador. No hay ninguna ruta de código que
 * llegue al vehículo sin pasar por aquí.
 *
 * ── Por qué estos servicios son inofensivos ────────────────────────────────
 * Todos los permitidos son peticiones de lectura: el módulo devuelve un dato o
 * un rechazo (7F) y su estado interno no cambia.
 *   01 datos actuales      02 freeze frame        03 DTC almacenados
 *   05 test de sensores de oxígeno (lo usa un escáner genérico)
 *   06 resultados de test  07 DTC pendientes      09 info del vehículo (VIN)
 *   0A DTC permanentes     18 DTC por estado KWP  19 DTC por estado UDS
 *   21 leer dato por identificador local (KWP2000). Es el hermano viejo
 *      del 22: lo usan los módulos que no hablan UDS, como el ABS de este
 *      Explorer, que contesta a los códigos por KWP pero rechaza todos los
 *      identificadores del 22. Por norma KWP2000 es lectura pura: devuelve
 *      el bloque de datos pedido o un 7F, y no cambia nada del módulo.
 *      (Lo que SÍ escribe en KWP es el 3B, y ese sigue fuera.)
 *   22 leer dato por identificador (Ford enhanced)
 * Queda fuera el 08 ("control of on-board system"): acciona componentes.
 * Excepción controlada: 04 y 14 borran la memoria de fallos. No modifican
 * calibración ni activan nada; la interfaz siempre pide confirmación.
 *
 * ── Por qué se excluye todo lo demás ───────────────────────────────────────
 *   10 abre sesiones de diagnóstico/programación   11 reinicia el módulo
 *   27 acceso de seguridad    28 silencia módulos del bus
 *   2E escribe configuración  2F acciona salidas físicas (relés, solenoides)
 *   31 ejecuta rutinas        34-37 transfiere firmware
 *   3B/3D escribe memoria     85 desactiva registro de fallos
 *   A0-BF servicios propietarios Ford (varios escriben)
 *
 * ── Por qué se restringen los comandos AT ──────────────────────────────────
 * El ELM327 es un puente: con ciertos comandos deja de ser un lector y pasa a
 * ser un transmisor arbitrario en el bus del carro.
 *   ATSH fuera de 7xx  → transmite tramas con IDs de funcionamiento normal
 *                        (motor, frenos, dirección). Es el riesgo real.
 *   ATCAF0             → apaga el formateo ISO-TP; los bytes que enviamos
 *                        dejarían de empezar por el servicio y la lista de
 *                        servicios de arriba dejaría de significar nada.
 *   ATAL               → permite tramas de más de 7 bytes fuera de norma.
 *   ATCSM0             → el adaptador deja de ser un oyente silencioso y
 *                        empieza a generar ACKs en el bus.
 *   ATMA/ATMR/ATMT     → monitor continuo: satura el enlace BLE y deja el
 *                        adaptador sin responder a comandos.
 *   ATSPB/ATSPC/ATPB   → protocolos CAN con velocidad definida a mano; una
 *                        velocidad equivocada sobre un bus vivo sí perturba.
 *   ATBI               → salta la inicialización del protocolo.
 *   ATPP               → reprograma la memoria del propio adaptador.
 *   ATR0               → no esperar respuestas; rompería el control de flujo.
 * Ninguno está en la lista blanca, así que ninguno puede enviarse.
 */

// ── Servicios OBD/UDS permitidos (primer byte del comando) ─────────────────
export const READ_SERVICES = new Set(['01', '02', '03', '05', '06', '07', '09', '0A', '18', '19', '21', '22']);
/** Borran memoria de fallos: permitidos pero la interfaz exige confirmación. */
export const CLEAR_SERVICES = new Set(['04', '14']);

/**
 * Comandos AT permitidos (sin espacios, en mayúsculas).
 * Cualquier variante no listada se rechaza.
 */
const AT_WHITELIST = new RegExp(
  '^AT(' + [
    'Z',                    // reset del adaptador
    'WS',                   // warm start
    'D',                    // valores por defecto del adaptador
    'I',                    // identificación del firmware
    'RV',                   // voltaje de la batería (no toca el bus)
    'DP', 'DPN',            // protocolo actual
    'E[01]',                // eco
    'L[01]',                // saltos de línea
    'S[01]',                // espacios
    'H[01]',                // cabeceras en la respuesta
    'AT[0-2]',              // timing adaptativo
    'CAF1',                 // formateo ISO-TP: SOLO se permite activarlo
    'ST[0-9A-F]{1,2}',      // tiempo de espera del adaptador
    'SP[0-9A]',             // seleccionar protocolo estándar (no B/C)
    'TP[0-9A]',             // probar protocolo
    'SH7[0-9A-F]{2}',       // cabecera de envío: SOLO rango diagnóstico 700-7FF
    'CRA(7[0-9A-FX]{2})?',  // filtro de recepción (con o sin argumento)
    'AR',                   // restaurar filtro automático
  ].join('|') + ')$',
);

export type SafetyVerdict =
  | { ok: true; needsConfirm: false }
  | { ok: true; needsConfirm: true; reason: string }
  | { ok: false; reason: string };

/** Normaliza como lo hace el adaptador: sin espacios, en mayúsculas. */
export function normalizeCommand(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * MODO ESTRICTO: reduce el vocabulario a lo que envía un escáner genérico
 * un escáner genérico (modos 01/02/03/04/06/07/09/0A sobre la cabecera funcional 7DF).
 */
const STRICT_SERVICES = new Set(['01', '02', '03', '04', '05', '06', '07', '09', '0A']);
const STRICT_AT = new RegExp(
  '^AT(' + ['Z', 'WS', 'D', 'I', 'RV', 'DP', 'DPN', 'E[01]', 'L[01]', 'S[01]', 'H[01]',
            'AT[0-2]', 'CAF1', 'ST[0-9A-F]{1,2}', 'SP[0-9A]', 'TP[0-9A]',
            'SH7DF', 'CRA', 'AR'].join('|') + ')$',
);

/**
 * Verificación completa. `strict` limita al vocabulario de un escáner genérico.
 * Devuelve además si la acción necesita confirmación del usuario.
 */
export function checkCommandSafety(raw: string, strict = false): SafetyVerdict {
  const cmd = normalizeCommand(raw);
  if (!cmd) return { ok: false, reason: 'Comando vacío.' };
  if (cmd.length > 40) return { ok: false, reason: 'Comando demasiado largo.' };

  // ── Comandos del adaptador ──────────────────────────────────────────────
  if (/^(AT|ST)/.test(cmd)) {
    if (strict && !STRICT_AT.test(cmd)) {
      return { ok: false, reason: `Modo estricto: ${raw.trim()} no forma parte de lo que envía un escáner genérico.` };
    }
    if (!AT_WHITELIST.test(cmd)) {
      return { ok: false, reason: `${raw.trim()} no está en la lista de comandos permitidos. Solo se admiten comandos del adaptador que no puedan transmitir tramas arbitrarias al bus.` };
    }
    if (cmd === 'ATZ' || cmd === 'ATD' || cmd === 'ATWS') {
      return { ok: true, needsConfirm: true, reason: 'Reinicia el adaptador y cierra la sesión actual (hay que reconectar).' };
    }
    return { ok: true, needsConfirm: false };
  }

  // ── Peticiones al vehículo ──────────────────────────────────────────────
  if (!/^[0-9A-F]+$/.test(cmd)) {
    return { ok: false, reason: 'Solo se aceptan bytes hexadecimales (ej. 010C, 22160E) o comandos del adaptador (AT…).' };
  }
  if (cmd.length % 2 !== 0) {
    return { ok: false, reason: 'La petición debe tener un número par de dígitos (bytes completos).' };
  }
  if (cmd.length > 16) {
    return { ok: false, reason: 'Petición demasiado larga para un servicio de lectura.' };
  }

  const service = cmd.substring(0, 2);

  if (strict) {
    if (!STRICT_SERVICES.has(service)) {
      return { ok: false, reason: `Modo estricto: servicio ${service} desactivado (solo 01/02/03/04/06/07/09/0A).` };
    }
  } else if (!READ_SERVICES.has(service) && !CLEAR_SERVICES.has(service)) {
    return { ok: false, reason: `Servicio ${service} no permitido. Esta app solo emite servicios de lectura; los que escriben, accionan o programan la ECU están fuera de la lista blanca.` };
  }

  if (CLEAR_SERVICES.has(service)) {
    return { ok: true, needsConfirm: true, reason: 'Borra los códigos guardados, el freeze frame y reinicia los monitores de emisiones. No repara la avería.' };
  }
  return { ok: true, needsConfirm: false };
}

/**
 * Guardia dura del transporte. Se ejecuta inmediatamente antes de escribir en
 * el adaptador y LANZA si el comando no está permitido. Es el punto único e
 * inevitable: ninguna otra parte del programa puede hablar con el vehículo.
 *
 * A diferencia de checkCommandSafety, aquí no se distingue "necesita
 * confirmación": eso es responsabilidad de la interfaz. Aquí solo se responde
 * a "¿puede este comando dañar algo?".
 */
export function assertTransportAllowed(raw: string, strict = false): void {
  const v = checkCommandSafety(raw, strict);
  if (!v.ok) throw new Error(`[bloqueado] ${v.reason}`);
}

/** Cabecera CAN válida: solo el rango de diagnóstico de 11 bits. */
export function isSafeHeader(h: string): boolean {
  return /^7[0-9A-F]{2}$/i.test(h.trim());
}
