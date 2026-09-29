/**
 * Diagnóstico automático: un solo botón que recorre un plan de etapas.
 *
 * A partir de la 3.0 esto es un diagnóstico y nada más. Los barridos de
 * páginas, la prueba de candidatos del catálogo y el explorador de bloques
 * eran andamio para averiguar qué tiene este vehículo dentro, y ya cumplieron:
 * lo que encontraron está en el perfil, con nombre y escala. Preguntar otra
 * vez lo que ya se sabe es tiempo del conductor tirado a la basura.
 *
 * Queda una sola medición que necesita a la persona: la del alternador, que
 * hay que leer dos veces, con y sin carga eléctrica, para decidir su escala.
 *
 * Ideas de diseño que siguen en pie:
 *  - Etapas cortas con descanso entre ellas. El bus nunca recibe una ráfaga
 *    larga; recibe tandas pequeñas separadas por pausas.
 *  - Todo se guarda según avanza. Si se corta la conexión o se cierra la app,
 *    lo hecho no se pierde y se puede continuar donde quedó.
 */

import { obdGateway, type PidProbeResult } from './ObdGateway';
import type { Mode06Record } from './protocol';
import { fordMisfirePercent } from './protocol';
import type { VehicleProfile, EnhancedPid } from '../profiles';
import type { ModuleScanResult } from './moduleScan';
import { delay } from './limits';
import { hexToBytes, decodeDtcs } from './protocol';
import { describirDtc, totalDtcConocidos } from './dtcTextos';

export type StepStatus = 'pending' | 'running' | 'ok' | 'empty' | 'failed' | 'skipped';

export interface StepResult {
  id: string;
  status: StepStatus;
  summary: string;
  /** Líneas que van al informe. */
  lines: string[];
  /** Datos que las etapas siguientes consultan para decidir. */
  data?: Record<string, unknown>;
  seconds?: number;
}

export interface DiagCtx {
  profile: VehicleProfile;
  results: Map<string, StepResult>;
  note: (s: string) => void;
}

/**
 * Una etapa puede pedirle algo al conductor antes de medir.
 *
 * Hay datos que no se pueden sacar con el carro quieto y en ralentí: la
 * posición de la palanca solo se descifra viéndola en cada marcha, el avance
 * del árbol de levas solo se mueve con revoluciones, y la presión de freno
 * solo aparece pisando. Para eso la app para, dice qué hacer, y espera a que
 * la persona conteste que ya está.
 *
 * `seguro` es lo que se muestra como aviso cuando la maniobra pide cuidado.
 */
export interface Peticion {
  titulo: string;
  instruccion: string;
  seguro?: string;
}

export interface DiagStep {
  id: string;
  title: string;
  /** Si está, la etapa se detiene y pide una maniobra antes de medir. */
  prompt?: Peticion;
  /** Qué hace y por qué, en una línea, para mostrarlo en pantalla. */
  detail: string;
  /** Preguntas aproximadas, para estimar la duración. */
  weight: number;
  /** Si devuelve false, la etapa se salta y se anota por qué. */
  when?: (ctx: DiagCtx) => { run: boolean; reason: string };
  run: (ctx: DiagCtx) => Promise<Omit<StepResult, 'id'>>;
}

/**
 * Identificadores estándar de identificación de módulo (UDS ISO 14229).
 * Todos son de LECTURA y los implementa casi cualquier módulo moderno; los que
 * no, contestan con un rechazo y ya está. Ford guarda aquí los números de
 * pieza y de calibración en texto ASCII.
 */
export const IDENT_DIDS = [
  { did: 'F124', nombre: 'Calibración #1' },
  { did: 'F188', nombre: 'Nº de pieza del software' },
  { did: 'F190', nombre: 'VIN' },
  { did: 'F111', nombre: 'Nº de pieza ECU' },
  { did: 'F113', nombre: 'Nº de pieza del sistema' },
];

/** A qué módulos se les pregunta. Todos dentro del rango de diagnóstico 7xx. */
export const IDENT_MODULOS = [
  { nombre: 'PCM · motor',        header: '7E0', rxHeader: '7E8' },
  { nombre: 'TCM · transmisión',  header: '7E1', rxHeader: '7E9' },
  { nombre: 'ABS · frenos',       header: '760', rxHeader: '768' },
  { nombre: 'Módulo en 7D0',      header: '7D0', rxHeader: '7D8' },
  { nombre: 'IPC · tablero',      header: '720', rxHeader: '728' },
  { nombre: 'RCM · airbags',      header: '737', rxHeader: '73F' },
];

/**
 * A quién se le pide el Modo 09. Uno por uno y con cabecera fija: si se
 * pregunta en funcional, PCM y TCM contestan a la vez y el texto sale mezclado.
 */
const MODULOS_ID = [
  { id: 'pcm', nombre: 'PCM · motor',       header: '7E0', rxHeader: '7E8' },
  { id: 'tcm', nombre: 'TCM · transmisión', header: '7E1', rxHeader: '7E9' },
];

/** Modo 09: identificación del vehículo y de la calibración. */
const MODO09 = [
  { cmd: '0902', nombre: 'VIN' },
  { cmd: '0904', nombre: 'CALID · calibración' },
  { cmd: '0906', nombre: 'CVN · verificación' },
  { cmd: '090A', nombre: 'Nombre del módulo' },
  { cmd: '0908', nombre: 'Datos de rendimiento' },
  { cmd: '090B', nombre: 'Rendimiento en uso' },
];

/**
 * Modo 02: las condiciones del instante en que saltó el código. El tercer byte
 * es el número de trama; el 00 es la única que guarda un PCM de esta época.
 */
const FREEZE_PIDS: { cmd: string; nombre: string; unidad: string; formula: (b: number[]) => number }[] = [
  { cmd: '020200', nombre: 'Código que lo generó', unidad: '', formula: ([A, B]) => A * 256 + B },
  { cmd: '020300', nombre: 'Estado del combustible', unidad: '', formula: ([A]) => A },
  { cmd: '020400', nombre: 'Carga del motor', unidad: '%', formula: ([A]) => (A * 100) / 255 },
  { cmd: '020500', nombre: 'Temp. refrigerante', unidad: '°C', formula: ([A]) => A - 40 },
  { cmd: '020600', nombre: 'STFT banco 1', unidad: '%', formula: ([A]) => ((A - 128) * 100) / 128 },
  { cmd: '020700', nombre: 'LTFT banco 1', unidad: '%', formula: ([A]) => ((A - 128) * 100) / 128 },
  { cmd: '020800', nombre: 'STFT banco 2', unidad: '%', formula: ([A]) => ((A - 128) * 100) / 128 },
  { cmd: '020900', nombre: 'LTFT banco 2', unidad: '%', formula: ([A]) => ((A - 128) * 100) / 128 },
  { cmd: '020B00', nombre: 'Presión del colector', unidad: 'kPa', formula: ([A]) => A },
  { cmd: '020C00', nombre: 'Revoluciones', unidad: 'rpm', formula: ([A, B]) => (A * 256 + B) / 4 },
  { cmd: '020D00', nombre: 'Velocidad', unidad: 'km/h', formula: ([A]) => A },
  { cmd: '020E00', nombre: 'Avance de encendido', unidad: '°', formula: ([A]) => A / 2 - 64 },
  { cmd: '020F00', nombre: 'Temp. aire admisión', unidad: '°C', formula: ([A]) => A - 40 },
  { cmd: '021000', nombre: 'Flujo MAF', unidad: 'g/s', formula: ([A, B]) => (A * 256 + B) / 100 },
  { cmd: '021100', nombre: 'Mariposa', unidad: '%', formula: ([A]) => (A * 100) / 255 },
];

/**
 * PIDs estándar que la app no leía y que merecen la pena. Solo se piden los
 * que el propio PCM anuncia en su mapa de soporte: nada a ciegas.
 */
const EXTRA_01: { cmd: string; nombre: string; unidad: string; formula: (b: number[]) => number }[] = [
  { cmd: '0103', nombre: 'Estado del sistema de combustible', unidad: '', formula: ([A]) => A },
  { cmd: '010B', nombre: 'Presión del colector', unidad: 'kPa', formula: ([A]) => A },
  { cmd: '0114', nombre: 'Sonda B1S1 · voltaje', unidad: 'V', formula: ([A]) => A / 200 },
  { cmd: '0115', nombre: 'Sonda B1S2 · voltaje', unidad: 'V', formula: ([A]) => A / 200 },
  { cmd: '0118', nombre: 'Sonda B2S1 · voltaje', unidad: 'V', formula: ([A]) => A / 200 },
  { cmd: '0119', nombre: 'Sonda B2S2 · voltaje', unidad: 'V', formula: ([A]) => A / 200 },
  { cmd: '011F', nombre: 'Tiempo desde el arranque', unidad: 's', formula: ([A, B]) => A * 256 + B },
  { cmd: '0121', nombre: 'Distancia con el testigo encendido', unidad: 'km', formula: ([A, B]) => A * 256 + B },
  { cmd: '012E', nombre: 'Purga del cánister', unidad: '%', formula: ([A]) => (A * 100) / 255 },
  { cmd: '0130', nombre: 'Calentamientos desde el borrado', unidad: '', formula: ([A]) => A },
  { cmd: '0131', nombre: 'Distancia desde el borrado', unidad: 'km', formula: ([A, B]) => A * 256 + B },
  { cmd: '0133', nombre: 'Presión barométrica', unidad: 'kPa', formula: ([A]) => A },
  // Presión del riel por la vía genérica. Sirve de CONTRASTE contra lo que
  // dice el sensor por Modo 22: si las dos vías no cuentan lo mismo, el
  // problema está en el sensor y no en la presión real.
  { cmd: '010A', nombre: 'Presión de combustible', unidad: 'kPa', formula: ([A]) => A * 3 },
  { cmd: '0122', nombre: 'Presión del riel (rel. al colector)', unidad: 'kPa', formula: ([A, B]) => (A * 256 + B) * 0.079 },
  { cmd: '0123', nombre: 'Presión del riel (manométrica)', unidad: 'kPa', formula: ([A, B]) => (A * 256 + B) * 10 },
  { cmd: '013C', nombre: 'Temp. catalizador B1S1', unidad: '°C', formula: ([A, B]) => (A * 256 + B) / 10 - 40 },
  { cmd: '013D', nombre: 'Temp. catalizador B2S1', unidad: '°C', formula: ([A, B]) => (A * 256 + B) / 10 - 40 },
  { cmd: '013E', nombre: 'Temp. catalizador B1S2', unidad: '°C', formula: ([A, B]) => (A * 256 + B) / 10 - 40 },
  { cmd: '013F', nombre: 'Temp. catalizador B2S2', unidad: '°C', formula: ([A, B]) => (A * 256 + B) / 10 - 40 },
  { cmd: '0146', nombre: 'Temperatura ambiente', unidad: '°C', formula: ([A]) => A - 40 },
  { cmd: '014F', nombre: 'Máximos de los sensores', unidad: '', formula: ([A]) => A },
  { cmd: '0151', nombre: 'Tipo de combustible', unidad: '', formula: ([A]) => A },
  { cmd: '0159', nombre: 'Presión absoluta del riel', unidad: 'kPa', formula: ([A, B]) => (A * 256 + B) * 10 },
  { cmd: '015E', nombre: 'Consumo de combustible', unidad: 'L/h', formula: ([A, B]) => (A * 256 + B) / 20 },
];

/**
 * Mediciones que piden una maniobra del conductor.
 *
 * Cada una existe porque el dato NO se puede sacar con el carro quieto en
 * ralentí: o el valor no se mueve, o el catálogo ofrece varias escalas y la
 * única forma de elegir es ver el número en una condición conocida.
 *
 * El valor se guarda en crudo a propósito. La escala se decide después,
 * comparando las lecturas de las distintas maniobras entre sí.
 */
/**
 * La única medición que todavía necesita a la persona.
 *
 * 220939 es la excitación del alternador y el catálogo ofrece tres escalas
 * posibles para el mismo byte. Con una sola lectura no hay forma de elegir:
 * cualquiera de las tres da un número que parece razonable. La única prueba
 * que separa unas de otras es leerlo dos veces, primero sin nada encendido y
 * después con las luces altas y el aire al máximo, y ver cuánto sube.
 *
 * Se leen también sus vecinos, porque la misma maniobra los mueve y sirven de
 * control: si el ventilador y la presión del A/C cambian, la maniobra se hizo
 * de verdad.
 */
const CARGA_DIDS = [
  { did: '0939', nombre: 'Alternador · excitación' },
  { did: '16E8', nombre: 'Alternador · comando' },
  { did: '097C', nombre: 'Alternador · voltaje deseado' },
  { did: '1172', nombre: 'Voltaje que ve el PCM' },
  { did: '16AA', nombre: 'Ventilador variable' },
  { did: '1686', nombre: 'Presión del A/C' },
];

/** Lee los seis identificadores de la carga eléctrica y los deja en crudo. */
async function leerCarga(ctx: DiagCtx): Promise<{ lines: string[]; valores: Record<string, string> }> {
  const lines: string[] = [];
  const valores: Record<string, string> = {};
  const res = await obdGateway.readDidList({
    header: '7E0', rxHeader: '7E8', dids: CARGA_DIDS.map(d => d.did),
    onProgress: (r) => { if (r.status === 'ok') ctx.note(r.did); },
  });
  for (const r of res) {
    const def = CARGA_DIDS.find(x => ('22' + x.did).toUpperCase() === r.did)!;
    if (r.status === 'ok') {
      const datos = r.raw.substring(r.raw.indexOf('62' + r.did.substring(2)) + 6);
      lines.push(`   SI ${r.did}  ${def.nombre.padEnd(30)} crudo=${datos}`);
      valores[r.did] = datos;
    } else {
      lines.push(`   -- ${r.did}  ${def.nombre.padEnd(30)} ${r.status === 'unsupported' ? 'no lo tiene' : 'sin respuesta'}`);
    }
  }
  return { lines, valores };
}

/** Las tres escalas que el catálogo ofrece para 220939, para compararlas. */
function escalasAlternador(crudo: string): string[] {
  const A = parseInt(crudo.substring(0, 2), 16);
  if (!Number.isFinite(A)) return [];
  return [
    `   escala A (x100/128)  -> ${(Math.round((A * 78125) / 1000) / 100).toFixed(2)} %`,
    `   escala B (x100/255)  -> ${(Math.round((A * 39126) / 1000) / 100).toFixed(2)} %`,
    `   escala C (/128)      -> ${(Math.round((A * 1000) / 128) / 1000).toFixed(3)} (relación 0-2)`,
  ];
}

/** Dos lecturas estándar para anotar en qué estado estaba el motor. */
const CONTEXTO_PIDS: EnhancedPid[] = [
  { command: '010C', key: '010C', name: 'RPM', unit: 'rpm', min: 0, max: 8000, mode: '01', verified: true,
    formula: ([A, B]) => ((A * 256) + B) / 4 },
  { command: '0105', key: '0105', name: 'Refrigerante', unit: '°C', min: -40, max: 130, mode: '01', verified: true,
    formula: ([A]) => A - 40 },
];

/** Descanso entre etapas: le da aire al bus entre tandas. */
export const REST_MS = 2500;

const ok = (r: PidProbeResult | undefined) => r?.status === 'ok';

// ─── Plan para el Ford Explorer ──────────────────────────────────────────────
export function buildPlan(profile: VehicleProfile): DiagStep[] {
  return [
    // ── 1 · Estado del canal ────────────────────────────────────────────
    {
      id: 'canal',
      title: 'Comprobar el canal',
      detail: 'Voltaje del adaptador antes de empezar. Con la batería baja los módulos responden mal.',
      weight: 1,
      run: async () => {
        const v = await obdGateway.readVoltage();
        const num = parseFloat(v);
        const bajo = Number.isFinite(num) && num < 11.5;
        // Dos PIDs estándar para dejar anotado en qué condiciones se corrió:
        // un informe sin saber si el motor estaba frío o caliente se interpreta mal.
        const ctx = await obdGateway.probePids(
          [{ header: '', moduleName: 'contexto', color: '', pids: CONTEXTO_PIDS }],
        ).catch(() => new Map());
        const rpm = ctx.get('010C'), ect = ctx.get('0105');
        return {
          status: bajo ? 'empty' : 'ok',
          summary: `Voltaje ${v}` +
            (rpm?.status === 'ok' ? ` · ${rpm.value} rpm` : '') +
            (ect?.status === 'ok' ? ` · ${ect.value} °C` : '') +
            (bajo ? ' — BAJO, arranca el motor' : ''),
          lines: [
            `Voltaje del adaptador: ${v}`,
            rpm?.status === 'ok' ? `Revoluciones: ${rpm.value} rpm` : 'Revoluciones: sin lectura (¿motor apagado?)',
            ect?.status === 'ok' ? `Temperatura del refrigerante: ${ect.value} °C` : '',
            bajo ? 'AVISO: por debajo de 11,5 V los resultados no son fiables.' : '',
            '',
            'Este informe es un diagnóstico, no una exploración: pregunta lo que sirve',
            'para saber cómo está el vehículo. Los barridos de páginas que buscaban',
            'identificadores nuevos ya cumplieron y lo que encontraron está en el perfil.',
          ].filter(Boolean),
          data: { voltage: num },
        };
      },
    },

    // ── 2 · El motor se autodescribe ────────────────────────────────────
    {
      id: 'mode06',
      title: 'Preguntar al PCM sus monitores (Modo 06)',
      detail: 'El Modo 06 lleva su propio índice: el módulo dice qué monitores tiene. Sin adivinar nada.',
      weight: 14,
      run: async (ctx) => {
        const r = await obdGateway.scanMode06();
        const lines: string[] = [];
        lines.push(`Monitores anunciados: ${r.supported.length ? r.supported.map(x => x.toString(16).toUpperCase().padStart(2, '0')).join(' ') : 'ninguno'}`);
        let registros = 0;
        for (const [mid, recs] of r.records) {
          for (const rec of recs) {
            registros++;
            lines.push(`  MID ${mid.toString(16).toUpperCase().padStart(2, '0')} TID ${rec.tid.toString(16).toUpperCase().padStart(2, '0')}` +
              ` valor=${rec.value} (${fordMisfirePercent(rec.value)} % si es fallo) min=${rec.min} max=${rec.max} crudo=${rec.raw}`);
          }
        }
        lines.push('', 'Peticiones en crudo:', ...r.raw.map(x => '  ' + x));
        // Los monitores de fallo de Ford viven en la zona A0-B0
        const zonaFallos = r.supported.filter(m => m >= 0xA0 && m <= 0xB0);
        return {
          status: r.supported.length ? 'ok' : 'empty',
          summary: r.supported.length
            ? `${r.supported.length} monitores, ${registros} registros${zonaFallos.length ? `, ${zonaFallos.length} en la zona de fallos` : ''}`
            : 'El PCM no anunció monitores (prueba con el motor caliente)',
          lines,
          data: { supported: r.supported, misfireMids: zonaFallos, registros },
        };
      },
    },

    // ── Modos estándar que nunca habíamos usado ─────────────────────────
    // El 09, el 02 y el 0A llevan en la lista blanca desde el primer día y no
    // se habían pedido nunca. Son OBD2 genérico: cualquier vehículo
    // certificado los implementa, así que aquí no se adivina nada.
    {
      id: 'estandar',
      title: 'Modos estándar sin estrenar (09, 02, 0A)',
      detail: 'Identificación de la calibración, el congelado de datos del código que tienes guardado, y los códigos permanentes.',
      weight: MODO09.length + FREEZE_PIDS.length + 3,
      run: async (ctx) => {
        const lines: string[] = [];
        const data: Record<string, unknown> = {};

        // ── Modo 09: identificación, MÓDULO POR MÓDULO ────────────────────
        // ARREGLADO en la 3.0: antes se preguntaba en cabecera funcional y
        // contestaban el PCM y el TCM a la vez. El ELM327 entregaba las dos
        // respuestas intercaladas y el número de calibración salía entreverado:
        // el 13/09 dio "9L2P-7J104-AGIJPCH1A4.HEX" en una corrida y
        // "9L2P-7J104IJPC-AGH1A4.HEX" en la siguiente, que son la misma pareja
        // de respuestas mezcladas de dos formas distintas. Con cabecera fija
        // cada módulo habla solo y el texto sale entero.
        lines.push('-- Modo 09 · identificación, módulo por módulo');
        lines.push('   Se pregunta con la cabecera fija de cada módulo, no en funcional.');
        lines.push('   Si se pregunta a los dos a la vez, el adaptador mezcla las tramas y el');
        lines.push('   número de calibración sale entreverado. Eso pasó dos veces el 13/09.');
        for (const mod of MODULOS_ID) {
          lines.push('', `   ${mod.nombre}  [${mod.header} -> ${mod.rxHeader}]`);
          const r09 = await obdGateway.readStandardList({
            cmds: MODO09.map(m => m.cmd),
            header: mod.header, rxHeader: mod.rxHeader,
            onProgress: (c, ok) => { if (ok) ctx.note(`${mod.header} ${c}`); },
          }).catch(() => []);
          if (!r09.length) { lines.push('     no contestó nada'); continue; }
          for (const r of r09) {
            const et = MODO09.find(m => m.cmd === r.cmd)!;
            if (r.ok) {
              const txt = r.ascii ? `"${r.ascii}"` : '(no es texto)';
              lines.push(`     SI ${r.cmd}  ${et.nombre.padEnd(28)} ${txt}   crudo=${r.hex}`);
              if (r.ascii) data[`${mod.id}_${et.cmd}`] = r.ascii;
            } else {
              lines.push(`     -- ${r.cmd}  ${et.nombre.padEnd(28)} ${r.hex || r.raw || 'sin respuesta'}`);
            }
          }
          await delay(400);
        }
        lines.push('');
        await delay(500);

        // ── Modo 02: el congelado de datos ────────────────────────────────
        lines.push('-- Modo 02 · congelado de datos');
        lines.push('   Las condiciones exactas del instante en que saltó el código guardado.');
        lines.push('   Es lo primero que mira un mecánico cuando ve un código, y no lo teníamos.');
        const r02 = await obdGateway.readStandardList({
          cmds: FREEZE_PIDS.map(f => f.cmd),
          onProgress: (c, ok) => { if (ok) ctx.note(`congelado ${c}`); },
        });
        let hayFreeze = 0;
        for (const r of r02) {
          const f = FREEZE_PIDS.find(x => x.cmd === r.cmd)!;
          // Respuesta: 42 <pid> <trama> <datos>
          const eco = '42' + r.cmd.substring(2, 4) + r.cmd.substring(4, 6);
          const i = r.hex.indexOf(eco);
          if (r.ok && i >= 0) {
            const bytes = hexToBytes(r.hex.substring(i + eco.length));
            if (bytes.length) {
              hayFreeze++;
              let v: string;
              try {
                const n = f.formula(bytes);
                v = Number.isFinite(n) ? `${Math.round(n * 100) / 100} ${f.unidad}`.trim() : r.hex;
              } catch { v = r.hex; }
              lines.push(`   SI ${r.cmd}  ${f.nombre.padEnd(30)} ${v}   crudo=${r.hex}`);
              continue;
            }
          }
          lines.push(`   -- ${r.cmd}  ${f.nombre.padEnd(30)} sin dato`);
        }
        if (!hayFreeze) {
          lines.push('   El PCM no devolvió congelado. Pasa cuando los códigos guardados no son de');
          lines.push('   los que lo generan, o cuando se borró la memoria después del último fallo.');
        }
        data.freeze = hayFreeze;
        lines.push('');
        await delay(500);

        // ── Modo 0A y 05 ──────────────────────────────────────────────────
        lines.push('-- Modo 0A · códigos permanentes  /  Modo 05 · sondas');
        const otros = await obdGateway.readStandardList({ cmds: ['0A', '0500', '0100'] });
        for (const r of otros) {
          if (r.cmd === '0A') {
            const perm = decodeDtcs(r.raw, '4A', true);
            lines.push(perm.length
              ? `   Códigos permanentes: ${perm.map(c => `${c}${describirDtc(c) ? ' — ' + describirDtc(c) : ''}`).join(' · ')}`
              : '   Códigos permanentes: ninguno.');
            lines.push('   (Son los que no se borran hasta que el monitor correspondiente vuelva a pasar.)');
            data.permanentes = perm;
          } else if (r.cmd === '0500') {
            lines.push(r.ok
              ? `   Modo 05: responde. crudo=${r.hex}`
              : '   Modo 05: sin respuesta, que es lo correcto en un vehículo CAN.');
            lines.push('   En CAN la norma retiró el Modo 05 y su función pasó al Modo 06, que ya leemos.');
          } else if (r.ok) {
            lines.push(`   Mapa de PIDs estándar (0100): ${r.hex}`);
          }
        }
        lines.push('');

        const calib = (data['pcm_0904'] as string) ?? (data['tcm_0904'] as string) ?? '';
        return {
          status: (calib || hayFreeze) ? 'ok' : 'empty',
          summary: calib
            ? `Calibración: ${calib}`
            : (hayFreeze ? `${hayFreeze} datos del congelado` : 'Ni calibración ni congelado'),
          lines,
          data,
        };
      },
    },

    // ── Los PIDs estándar que el PCM dice tener y no leíamos ─────────────
    {
      id: 'estandar_extra',
      title: 'PIDs estándar que no estábamos leyendo',
      detail: 'El PCM publica la lista de los que soporta. Leíamos 15 de los que anuncia; aquí se piden los que faltan.',
      weight: 24,
      run: async (ctx) => {
        const sop = obdGateway.getSupportedMode01();
        if (!sop || !sop.size) {
          return { status: 'empty', summary: 'El PCM no publicó su mapa de PIDs', lines: [
            'No se pudo leer el mapa de PIDs soportados (0100/0120/0140/0160).',
            'Sin él no se sabe qué más tiene el módulo, así que no se pregunta a ciegas.',
          ] };
        }
        const yaLeidos = new Set(profile.moduleGroups.flatMap(g => g.pids).filter(p => p.mode === '01').map(p => p.command));
        const faltan = EXTRA_01.filter(e => sop.has(e.cmd) && !yaLeidos.has(e.cmd));
        const lines = [
          `El PCM anuncia ${sop.size} PIDs estándar. La app leía ${yaLeidos.size}.`,
          `De los interesantes que anuncia y no leíamos, se preguntan ${faltan.length}.`,
          '',
        ];
        if (!faltan.length) {
          lines.push('No queda ninguno de la lista por pedir.');
          return { status: 'ok', summary: 'Nada nuevo que pedir', lines };
        }
        const res = await obdGateway.readStandardList({
          cmds: faltan.map(f => f.cmd),
          onProgress: (c, ok) => { if (ok) ctx.note(`${c} responde`); },
        });
        let n = 0;
        for (const r of res) {
          const f = faltan.find(x => x.cmd === r.cmd)!;
          const eco = '41' + r.cmd.substring(2);
          const i = r.hex.indexOf(eco);
          if (r.ok && i >= 0) {
            const bytes = hexToBytes(r.hex.substring(i + eco.length));
            let v = r.hex;
            try {
              const x = f.formula(bytes);
              if (Number.isFinite(x)) { v = `${Math.round(x * 100) / 100} ${f.unidad}`.trim(); n++; }
            } catch { /* se deja el crudo */ }
            lines.push(`   SI ${r.cmd}  ${f.nombre.padEnd(34)} ${v}   crudo=${r.hex}`);
          } else {
            lines.push(`   -- ${r.cmd}  ${f.nombre.padEnd(34)} sin dato`);
          }
        }
        return { status: n ? 'ok' : 'empty', summary: `${n} de ${faltan.length} con dato`, lines, data: { n } };
      },
    },

    // ── La única medición que necesita al conductor ──────────────────────
    // Dos lecturas del mismo identificador en dos condiciones conocidas. La
    // primera pide apagar todo; la segunda, encenderlo. La comparación entre
    // las dos es lo que decide la escala: un número suelto no decide nada.
    {
      id: 'alt_sin',
      title: 'Alternador · sin carga eléctrica',
      detail: 'Lectura de referencia con todo apagado. Sin ella la lectura con carga no sirve para nada.',
      prompt: {
        titulo: 'Apaga las luces y el aire',
        instruccion: 'Con el motor encendido, apaga las luces, el aire acondicionado y la radio. Déjalo todo apagado durante la medición.',
        seguro: 'Sin riesgo: el carro se queda quieto y en P.',
      },
      weight: CARGA_DIDS.length + 2,
      run: async (ctx) => {
        const { lines, valores } = await leerCarga(ctx);
        const crudo = valores['220939'];
        const salida = ['Maniobra pedida: todo apagado.', '', ...lines];
        if (crudo) {
          salida.push('', 'Con este crudo, las tres escalas del catálogo darían:', ...escalasAlternador(crudo));
        }
        salida.push('', 'Esta es la referencia. La etapa siguiente repite la lectura con carga.');
        return {
          status: crudo ? 'ok' : 'empty',
          summary: crudo ? `excitación en crudo ${crudo}` : 'sin lectura del alternador',
          lines: salida, data: { valores },
        };
      },
    },
    {
      id: 'alt_con',
      title: 'Alternador · con carga eléctrica',
      detail: 'La misma lectura con las luces altas y el aire al máximo. La diferencia con la anterior es la que decide la escala.',
      prompt: {
        titulo: 'Enciende las luces altas y el aire',
        instruccion: 'Enciende las luces altas y el aire acondicionado al máximo. Déjalos encendidos durante la medición.',
        seguro: 'Sin riesgo: es solo carga eléctrica con el carro parado.',
      },
      weight: CARGA_DIDS.length + 2,
      run: async (ctx) => {
        const { lines, valores } = await leerCarga(ctx);
        const antes = (ctx.results.get('alt_sin')?.data?.valores ?? {}) as Record<string, string>;
        const salida = ['Maniobra pedida: luces altas y aire al máximo.', '', ...lines, ''];

        if (Object.keys(antes).length) {
          salida.push('-- Comparación entre las dos lecturas');
          for (const d of CARGA_DIDS) {
            const k = ('22' + d.did).toUpperCase();
            const a = antes[k], b = valores[k];
            if (!a && !b) continue;
            const igual = a === b;
            salida.push(`   ${k}  ${d.nombre.padEnd(30)} apagado=${(a ?? '--').padEnd(10)} encendido=${(b ?? '--').padEnd(10)} ${igual ? '(no cambió)' : '<-- CAMBIÓ'}`);
          }
          salida.push('');
        } else {
          salida.push('No hay lectura de referencia: la etapa anterior se saltó o falló.');
          salida.push('Sin las dos lecturas la escala del alternador no se puede decidir.');
          salida.push('');
        }

        const crudo = valores['220939'];
        if (crudo) {
          salida.push('Con carga, las tres escalas del catálogo darían:', ...escalasAlternador(crudo));
          salida.push('');
          salida.push('Cómo se lee: la escala buena es la que suba en proporción con la carga y se');
          salida.push('quede por debajo de 100. Si el ventilador y la presión del A/C también');
          salida.push('cambiaron, la maniobra se hizo bien y la comparación vale.');
        }
        return {
          status: crudo ? 'ok' : 'empty',
          summary: crudo ? `excitación en crudo ${crudo}` : 'sin lectura del alternador',
          lines: salida, data: { valores, antes },
        };
      },
    },

    // ── Final · Códigos de todos los módulos ────────────────────────────
    {
      id: 'dtc',
      title: 'Leer códigos de todos los módulos',
      detail: `Servicios de lectura 19 y 18, módulo por módulo. Cada código sale con su descripción en español o, si no, con su familia y sistema.`,
      weight: (profile.modules?.length ?? 0) * 2,
      run: async (ctx) => {
        const mods = profile.modules ?? [];
        if (!mods.length) return { status: 'skipped', summary: 'El perfil no define módulos', lines: [] };
        const res = await obdGateway.scanModules(mods, (r) => ctx.note(`${r.moduleId}: ${r.status}`));
        const lines: string[] = [];
        let conCodigos = 0;
        for (const m of mods) {
          const r = res.find(x => x.moduleId === m.id);
          if (!r) continue;
          lines.push(`-- ${m.name} [${m.header} -> ${m.rxHeader}] ${r.status}${r.protocol ? ' via ' + r.protocol.toUpperCase() : ''}`);
          if (r.message) lines.push(`   ${r.message}`);
          for (const d of r.dtcs) {
            conCodigos++;
            const texto = describirDtc(d.code);
            lines.push(`   ${d.code}${d.failureType ? '-' + d.failureType : ''}  estado=${d.status.toString(16).padStart(2, '0')}` +
              (texto ? `  ${texto}` : '  (sin descripción en la tabla)'));
          }
        }
        const abs = res.find(x => x.moduleId === 'abs');
        return {
          status: 'ok',
          summary: `${res.filter(r => r.status === 'ok').length}/${mods.length} módulos responden · ${conCodigos} códigos`,
          lines,
          data: { absAlive: abs?.status === 'ok', res },
        };
      },
    },
  ];
}

// ─── Motor del plan ──────────────────────────────────────────────────────────

/**
 * Versión del plan de etapas. Sube cada vez que se añaden, quitan o reordenan
 * etapas. Una sesión guardada con otra versión NO se puede reanudar: los
 * índices ya no significan lo mismo y se saltarían etapas nuevas sin avisar.
 */
export const PLAN_VERSION = 7;

export interface DiagRunState {
  /** Con qué versión del plan se guardó. Sin esto, reanudar sería una lotería. */
  planVersion?: number;
  at: number;
  profileId: string;
  /** Índice de la siguiente etapa pendiente. */
  index: number;
  results: StepResult[];
  finished: boolean;
}

export interface RunHooks {
  onStepStart: (index: number, step: DiagStep) => void;
  onStepEnd: (index: number, result: StepResult) => void;
  onNote: (text: string) => void;
  /** Se llama tras CADA etapa: es lo que permite continuar si algo se corta. */
  onSave: (state: DiagRunState) => void;
  shouldStop: () => boolean;
  onRest: (seconds: number) => void;
  /**
   * Pide una maniobra al conductor y espera. Devuelve true si la hizo, false
   * si prefirió saltarse esa etapa. Si no está definido, las etapas que piden
   * maniobra se saltan solas, que es lo correcto cuando nadie está mirando.
   */
  onPrompt?: (step: DiagStep, index: number) => Promise<boolean>;
}

/**
 * Ejecuta el plan desde `from`, con descanso entre etapas y guardando después
 * de cada una. Si algo falla, la etapa se marca como fallida, se anota el
 * motivo en el informe y el plan CONTINÚA: un tropiezo no tumba la sesión.
 */
export async function runPlan(
  steps: DiagStep[],
  profile: VehicleProfile,
  hooks: RunHooks,
  from = 0,
  prior: StepResult[] = [],
  /**
   * Qué plan se está corriendo. Va guardado con la sesión: si se reanuda una
   * sesión de OTRO plan, los números de etapa no significan lo mismo y el
   * informe saldría mezclado sin decirlo.
   */
  versionPlan = PLAN_VERSION,
): Promise<DiagRunState> {
  const results = new Map<string, StepResult>(prior.map(r => [r.id, r]));
  const list: StepResult[] = [...prior];

  const state = (): DiagRunState => ({
    at: Date.now(), profileId: profile.id, planVersion: versionPlan,
    index: list.length, results: list, finished: false,
  });

  for (let i = from; i < steps.length; i++) {
    if (hooks.shouldStop()) break;
    const step = steps[i];
    hooks.onStepStart(i, step);

    const ctx: DiagCtx = { profile, results, note: hooks.onNote };
    let result: StepResult;
    const t0 = Date.now();

    // Maniobra pedida al conductor: la etapa espera a que conteste.
    if (step.prompt) {
      const hecho = hooks.onPrompt ? await hooks.onPrompt(step, i) : false;
      if (hooks.shouldStop()) break;
      if (!hecho) {
        const r: StepResult = {
          id: step.id, status: 'skipped', summary: 'Saltada por el conductor',
          lines: [`Se pidió: ${step.prompt.instruccion}`,
                  'No se hizo, así que esta medición queda pendiente para otra vez.'],
        };
        results.set(step.id, r); list.push(r);
        hooks.onStepEnd(i, r); hooks.onSave(state());
        continue;
      }
    }

    // Condición: si no toca, se anota el motivo y se sigue.
    const cond = step.when?.(ctx);
    if (cond && !cond.run) {
      result = { id: step.id, status: 'skipped', summary: 'Omitida', lines: [`Omitida: ${cond.reason}`] };
    } else {
      try {
        const r = await step.run(ctx);
        result = { id: step.id, ...r, seconds: Math.round((Date.now() - t0) / 100) / 10 };
        if (cond?.reason) result.lines = [`Se ejecuta porque: ${cond.reason}`, '', ...result.lines];
      } catch (e: any) {
        // Un fallo se documenta y el plan continúa con la etapa siguiente.
        result = {
          id: step.id, status: 'failed',
          summary: `Falló: ${e?.message ?? e}`,
          lines: [`ERROR: ${e?.message ?? e}`,
                  'El plan continúa con la etapa siguiente.'],
          seconds: Math.round((Date.now() - t0) / 100) / 10,
        };
      }
    }

    results.set(step.id, result);
    list.push(result);
    hooks.onStepEnd(i, result);
    hooks.onSave(state());

    // Descanso entre tandas para no encadenar tráfico.
    if (i < steps.length - 1 && !hooks.shouldStop() && result.status !== 'skipped') {
      hooks.onRest(REST_MS / 1000);
      await delay(REST_MS);
    }
  }

  const final: DiagRunState = { ...state(), finished: list.length >= steps.length };
  hooks.onSave(final);
  return final;
}

/** Preguntas aproximadas y minutos estimados del plan completo. */
export function planEstimate(steps: DiagStep[]): { questions: number; minutes: number } {
  const questions = steps.reduce((n, s) => n + s.weight, 0);
  const seconds = questions * 0.16 + steps.length * (REST_MS / 1000);
  return { questions, minutes: Math.ceil(seconds / 60) };
}

// ─── Informe ─────────────────────────────────────────────────────────────────

const MARK: Record<StepStatus, string> = {
  pending: '· ', running: '> ', ok: 'OK', empty: '--', failed: 'XX', skipped: '..',
};

export function buildDiagReport(opts: {
  profile: VehicleProfile;
  results: StepResult[];
  steps: DiagStep[];
  finished: boolean;
  adapterLine: string;
  vin: string;
  /** Cabecera propia, para los planes que no son el diagnóstico de siempre. */
  cabecera?: string[];
  titulo?: string;
}): string {
  const L: string[] = [];
  if (opts.cabecera?.length) L.push(...opts.cabecera);
  L.push((opts.titulo ?? 'DIAGNOSTICO AUTOMATICO') + (opts.finished ? ' — COMPLETO' : ' — INCOMPLETO'));
  L.push(new Date().toLocaleString());
  L.push(`${opts.profile.make} ${opts.profile.model} ${opts.profile.year} — ${opts.profile.engine}`);
  L.push(opts.vin
    ? `VIN: ${opts.vin}`
    : 'VIN: no se pudo leer (no afecta al resto del informe)');
  L.push(opts.adapterLine);
  L.push('');
  L.push(`Etapas: ${opts.results.length} de ${opts.steps.length}`);
  L.push('');

  // La identidad de los módulos va arriba del todo: es el dato más útil del
  // informe y el que hay que poder encontrar sin leerse las 300 líneas.
  const ident = opts.results.find(r => r.id === 'identidad');
  const hallado = (ident?.data?.hallado ?? {}) as Record<string, Record<string, string>>;
  if (Object.keys(hallado).length) {
    L.push('*** IDENTIDAD DE LOS MODULOS — ESTO ES LO IMPORTANTE ***');
    for (const [mod, datos] of Object.entries(hallado)) {
      L.push(`  ${mod}`);
      for (const [que, valor] of Object.entries(datos)) L.push(`     ${que.padEnd(26)} ${valor}`);
    }
    L.push('');
    L.push('  Con estos numeros se filtra el catalogo de identificadores al juego');
    L.push('  exacto de este vehiculo, y se deja de probar candidatos a ciegas.');
    L.push('');
  } else if (ident) {
    L.push('*** IDENTIDAD DE LOS MODULOS: ningun modulo devolvio su numero de calibracion ***');
    L.push('  Mira el detalle de esa etapa mas abajo para ver que contesto cada uno.');
    L.push('');
  }

  L.push('RESUMEN');
  for (const r of opts.results) {
    const st = opts.steps.find(s => s.id === r.id);
    L.push(`  ${MARK[r.status]} ${(st?.title ?? r.id).padEnd(46)} ${r.summary}`);
  }
  L.push('');
  L.push('='.repeat(60));

  for (const r of opts.results) {
    const st = opts.steps.find(s => s.id === r.id);
    L.push('');
    L.push(`## ${st?.title ?? r.id}  [${r.status}${r.seconds ? `, ${r.seconds}s` : ''}]`);
    if (st?.detail) L.push(`   ${st.detail}`);
    L.push('');
    r.lines.filter(x => x !== undefined).forEach(x => L.push(x));
  }

  L.push('');
  L.push(opts.finished ? 'FIN DEL INFORME (completo)' : `FIN DEL INFORME (INCOMPLETO: ${opts.results.length} de ${opts.steps.length} etapas)`);
  return L.join('\n');
}
