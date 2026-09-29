/**
 * Barrido de la Explorer: buscar lo que nunca se le preguntó.
 *
 * POR QUÉ EXISTE
 * ──────────────
 * El 21/09 un Launch X431 enseñó una pantalla de "Equilibrio de Poder" de esta
 * misma camioneta, con una línea por cilindro, CON EL CARRO RODANDO. O sea que
 * no corta inyectores: lee algo que el PCM ya calcula. El PCM mide, diente a
 * diente, cuánto acelera el cigüeñal después de que dispara cada cilindro —es
 * así como detecta los fallos de encendido— y ese dato se puede leer.
 *
 * En el catálogo de referencia está con ese nombre: `22063F`, "Misfire Monitor ·
 * Normalized Acceleration Data" para los cilindros 1 a 8, y `220210` y
 * siguientes, `PB_DOWN`, que son los tiempos del cigüeñal por tramo (PB es
 * Power Balance). A la Explorer no se le ha preguntado NINGUNO de los dos.
 *
 * Y el motivo de que no se le preguntara es un error de método mío, que es
 * justo lo que este barrido viene a corregir: armé la lista de objetivos
 * buscando en el catálogo por el NOMBRE —"balance", "contribution"— y eso
 * devolvió `2212B5`-`2212B9`, que son correcciones de caudal por inyector de
 * motores diésel. La Explorer los rechazó, y de ahí concluí que este PCM no
 * publicaba nada por cilindro. El dato bueno existe, pero no se llama
 * "balance", así que la búsqueda por nombre no lo encontró.
 *
 * Es el mismo error que ya cometí con el nivel de combustible de la EcoSport:
 * tratar "no apareció en lo que busqué" como "no existe". La diferencia es que
 * un barrido ciego no depende de que yo acierte con el nombre.
 *
 * QUÉ HACE, Y QUÉ NO
 * ──────────────────
 * No busca `22063F`. Busca TODO: llama a la puerta de las 256 páginas y barre
 * entera cada una que conteste. Si hay más cosas que se escaparon por el mismo
 * motivo, aparecen también.
 *
 * Se salta lo que la Explorer ya tiene barrido de verdad, que son dieciséis
 * rangos de cuatro sesiones de pruebas. Repetirlos costaría un tercio del
 * tiempo a cambio de nada.
 *
 * SE HACE RODANDO
 * ───────────────
 * No pide ninguna maniobra ni para a preguntar nada: se arranca, se deja el
 * teléfono y se conduce normal. Rodando además se ve más, porque un
 * identificador que existe devuelve un valor de verdad en vez del cero que
 * devolvería con el carro parado — que es exactamente lo que le pasó a la
 * EcoSport con la velocidad.
 *
 * Solo servicios de lectura, veinte comandos por segundo como máximo y
 * veinticinco milisegundos entre uno y otro, como siempre. En la práctica el
 * techo no lo pone eso sino la ida y vuelta del Bluetooth: unas tres preguntas
 * por segundo.
 */
import type { VehicleProfile } from '../profiles';
import type { DiagStep, DiagCtx } from './autoDiag';
import { obdGateway } from './ObdGateway';

/**
 * Nombres de los pocos identificadores que sabemos qué son antes de preguntar.
 *
 * El resto sale sin nombre a propósito: este barrido busca lo que NO está en
 * ninguna lista, y ponerle un nombre adivinado a un crudo que acaba de llegar
 * es justo el error que nos trajo hasta aquí. Los nombres se ponen después,
 * cruzando el informe con el catálogo, no durante la lectura.
 */
const NOMBRES: Record<string, string> = {
  '063F': 'MSFM_ACC · aceleración por cilindro',
  '0640': 'MSFM_ACC · continuación',
  '0641': 'MSFM_ACC · continuación',
  '1130': 'ACC_CRANK · aceleración en arranque',
  '032A': 'NM · total de fallos de encendido',
  '0345': 'NUM_MISFIRE · fallos del último ciclo',
};
function describirDid(did: string): string {
  const d = did.toUpperCase();
  if (NOMBRES[d]) return NOMBRES[d];
  const n = parseInt(d, 16);
  if (n >= 0x0210 && n <= 0x021F) return `PB_DOWN · tramo ${n - 0x0210 + 1} del cigüeñal`;
  return '';
}

export const BARRIDO_EXPLORER_VERSION = 1;

/** Solo tiene sentido con este perfil: los rangos ya barridos son suyos. */
export const PERFIL_EXPLORER = 'ford_explorer_2010';

const PCM = { header: '7E0', rxHeader: '7E8' };
const TANDA = 64;

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');
const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');

/**
 * Lo que la Explorer ya tiene barrido, de las sesiones del 11, 12 y 13 de
 * septiembre. Se salta entero.
 *
 * Están apuntados como pares [desde, hasta] inclusive. Si algún día se barre
 * un rango nuevo a mano, se añade aquí y el barrido deja de repetirlo.
 */
const YA_BARRIDO: [number, number][] = [
  [0x0000, 0x002F],   // espejo del Modo 01, a trozos
  [0x0200, 0x023F],
  [0x0900, 0x097F],
  [0x1170, 0x11EF],
  [0x1600, 0x16FF],
  [0x1E00, 0x1E3F],
  [0x2900, 0x297F],
  [0x2B00, 0x2B3F],
  [0x3980, 0x39BF],
];

function yaBarrido(desde: number, hasta: number): boolean {
  return YA_BARRIDO.some(([a, b]) => desde >= a && hasta <= b);
}

/** Trocea un rango en tandas que quepan en el tope por bloque. */
function tandas(desde: number, hasta: number, tam = TANDA): { a: number; b: number }[] {
  const out: { a: number; b: number }[] = [];
  for (let a = desde; a <= hasta; a += tam) out.push({ a, b: Math.min(hasta, a + tam - 1) });
  return out;
}

/** Los datos que vienen después del eco `62 DID`. */
function datosDe(raw: string, did4: string): string {
  const i = raw.toUpperCase().indexOf('62' + did4.toUpperCase());
  return i >= 0 ? raw.substring(i + 6) : raw;
}

/** Las páginas que contestaron, leídas de lo que dejaron las etapas anteriores. */
function paginasVivas(ctx: DiagCtx): string[] {
  const out: string[] = [];
  for (const [id, r] of ctx.results) {
    if (!id.startsWith('expl_paginas')) continue;
    for (const p of ((r.data?.vivas as string[] | undefined) ?? [])) {
      if (!out.includes(p)) out.push(p);
    }
  }
  return out.sort();
}

/**
 * Los TRAMOS que le tocan al barrido, no las páginas.
 *
 * La diferencia importa y cuesta tiempo real: de la página `09xx` solo se
 * barrió la primera mitad (0900-097F) y de la `29xx` lo mismo. Descartando por
 * página entera, esas dos se volverían a barrer completas; descartando por
 * tramos de 64, solo se barre la mitad que falta. Son cuatro tandas menos, o
 * sea 256 preguntas y unos dos minutos.
 */
function tramosPorBarrer(ctx: DiagCtx): { pagina: string; base: number }[] {
  const out: { pagina: string; base: number }[] = [];
  for (const p of paginasVivas(ctx)) {
    const inicio = parseInt(p, 16) * 256;
    for (let b = inicio; b < inicio + 256; b += TANDA) {
      if (!yaBarrido(b, b + TANDA - 1)) out.push({ pagina: p, base: b });
    }
  }
  return out;
}

async function barrer(ctx: DiagCtx, start: number, end: number, titulo: string) {
  const res = await obdGateway.scanDidBlock({
    ...PCM, start, end,
    onProgress: (r) => { if (r.status === 'ok') ctx.note(r.did); },
  });
  const con = res.filter(r => r.status === 'ok');
  const mudas = res.filter(r => r.status === 'no_response').length;
  const buenos = con.map(r => ({ did: r.did, datos: datosDe(r.raw, r.did.substring(2)) }));
  const lines = [
    titulo,
    '',
    `${res.length} preguntados · ${con.length} con datos · ${res.length - con.length - mudas} dijeron "no existe" · ${mudas} en silencio`,
  ];
  for (const b of buenos) {
    const nombre = describirDid(b.did.substring(2));
    lines.push(`SI ${b.did}  ${(nombre || '').padEnd(34)} crudo=${b.datos}`);
  }
  return { con, lines, buenos };
}

export function buildBarridoExplorer(_profile: VehicleProfile): DiagStep[] {
  const pasos: DiagStep[] = [];

  // ── 1 · Llamar a la puerta de las 256 páginas ────────────────────────
  // Dos golpes por página, con el primer y el último identificador. Si una
  // página existe es muy raro que no conteste a ninguno de los dos; con un
  // solo golpe se escaparían páginas vivas, que es como se escapó la 16xx de
  // la EcoSport la primera vez.
  for (const [golpe, sufijo] of [[0x00, '00'], [0x80, '80']] as [number, string][]) {
    for (const [i, { a, b }] of tandas(0x00, 0xFF).entries()) {
      pasos.push({
        id: `expl_paginas_${sufijo}_${i}`,
        title: `Buscar páginas vivas · golpe ${sufijo}, tanda ${i + 1} de 4`,
        detail: 'Llama a la puerta de cada página con un identificador. Las que contesten se barren enteras después; las que digan "no existe" quedan descartadas.',
        weight: TANDA,
        run: async (ctx) => {
          const dids = [];
          for (let p = a; p <= b; p++) dids.push(hex2(p) + sufijo);
          const res = await obdGateway.readDidList({
            ...PCM, dids,
            onProgress: (r) => { if (r.status === 'ok') ctx.note(r.did); },
          });
          const ok = res.filter(r => r.status === 'ok');
          const vivas = ok.map(r => r.did.substring(2, 4));
          const lines = [
            `Se llamó a ${dids.length} páginas con el identificador xx${sufijo}.`,
            vivas.length ? `PÁGINAS QUE CONTESTAN: ${vivas.map(p => p + 'xx').join(' ')}`
                         : 'Ninguna de estas páginas contestó con datos.',
            '',
          ];
          for (const r of ok) lines.push(`   SI ${r.did}  crudo=${datosDe(r.raw, r.did.substring(2))}`);
          return {
            status: vivas.length ? 'ok' : 'empty',
            summary: vivas.length ? `${vivas.length} páginas vivas` : 'ninguna',
            lines, data: { vivas },
          };
        },
      });
    }
  }

  // ── 2 · Barrer entera cada página viva que no conozcamos ─────────────
  // Estas etapas no saben qué van a barrer hasta que les toca: leen lo que
  // encontró el buscador. Si no hay nada nuevo, se saltan solas sin gastar
  // un comando.
  for (let n = 0; n < 40; n++) {
    pasos.push({
      id: `expl_barrer_${n}`,
      title: `Barrer tramo nuevo · tanda ${n + 1} de 40`,
      detail: 'Barre entero un tramo de 64 identificadores de una página que contestó y que no estuviera ya barrido. Cuál es se decide sobre la marcha.',
      weight: TANDA,
      when: (ctx) => {
        const tramos = tramosPorBarrer(ctx);
        return n < tramos.length
          ? { run: true, reason: '' }
          : { run: false, reason: tramos.length
              ? `solo quedan ${tramos.length} tramo(s) por barrer y esta tanda sobra`
              : 'el buscador no encontró ninguna página nueva que barrer' };
      },
      run: async (ctx) => {
        const { pagina, base } = tramosPorBarrer(ctx)[n];
        const r = await barrer(ctx, base, base + TANDA - 1,
          `Página ${pagina}xx: 22${hex4(base)}-22${hex4(base + TANDA - 1)}.`);
        return {
          status: r.con.length ? 'ok' : 'empty',
          summary: `${pagina}xx: ${r.con.length} con datos`,
          lines: r.lines, data: { buenos: r.buenos },
        };
      },
    });
  }

  // ── 3 · Los sospechosos con nombre y apellido ────────────────────────
  // Esta etapa va aparte del barrido y al final a propósito. El barrido de
  // arriba encuentra lo que exista aunque no sepamos cómo se llama; esta
  // pregunta por los que el catálogo dice que deberían ser el equilibrio de
  // potencia, con su nombre. Si el barrido ya los encontró, salen dos veces,
  // y eso no molesta: cuesta veinte preguntas y quita la duda.
  pasos.push({
    id: 'expl_equilibrio',
    title: 'Los identificadores del equilibrio de potencia',
    detail: 'Pregunta directamente por los que el catálogo de referencia da como aceleración del cigüeñal por cilindro. Es lo que dibuja el escáner profesional.',
    weight: 24,
    run: async (ctx) => {
      const dids = ['063F', '0640', '0641'];
      for (let d = 0x0210; d <= 0x021F; d++) dids.push(hex4(d));
      dids.push('1130', '032A', '0345');
      const res = await obdGateway.readDidList({
        ...PCM, dids,
        onProgress: (r) => { if (r.status === 'ok') ctx.note(r.did); },
      });
      const ok = res.filter(r => r.status === 'ok');
      const lines = [
        'Los candidatos del catálogo para el equilibrio de potencia:',
        '',
        '  22063F  MSFM_ACC_CYL1..8 · aceleración normalizada del cigüeñal por cilindro',
        '  220210+ PB_DOWN · tiempo del cigüeñal por tramo (PB = Power Balance)',
        '  221130  ACC_CRANK · aceleración en arranque',
        '  22032A  NM · total de fallos de encendido',
        '',
      ];
      for (const r of res) {
        const did = r.did.substring(2);
        if (r.status === 'ok') {
          lines.push(`SI ${r.did}  ${(describirDid(did) || '').padEnd(34)} crudo=${datosDe(r.raw, did)}`);
        } else {
          lines.push(`-- ${r.did}  ${(describirDid(did) || '').padEnd(34)} ${r.status === 'unsupported' ? 'no lo tiene' : 'sin respuesta'}`);
        }
      }
      if (ok.length) {
        lines.push('');
        lines.push('HAY DATOS. Si 22063F contestó, ahí está el equilibrio de potencia que');
        lines.push('dibuja el escáner profesional, y se puede tener en la app sin mandarle');
        lines.push('ninguna orden al motor.');
      }
      return {
        status: ok.length ? 'ok' : 'empty',
        summary: ok.length ? `${ok.length} de ${dids.length} contestaron` : 'ninguno contestó',
        lines, data: { buenos: ok.map(r => ({ did: r.did, datos: datosDe(r.raw, r.did.substring(2)) })) },
      };
    },
  });

  return pasos;
}

export function cabeceraBarridoExplorer(): string[] {
  return [
    'BARRIDO DE LA FORD EXPLORER 2010 · 4.6 V8 3V',
    '',
    'Esto no es un diagnóstico: es un mapa. Busca qué más sabe decir este PCM',
    'que nunca se le haya preguntado.',
    '',
    'Existe por una razón concreta. El 21/09 un escáner profesional enseñó un',
    '"Equilibrio de Poder" de esta camioneta, con una línea por cilindro y CON',
    'EL CARRO RODANDO. No corta inyectores: lee la aceleración que el cigüeñal',
    'coge después de cada cilindro, que es como el PCM detecta los fallos de',
    'encendido. En el catálogo de referencia ese dato es 22063F, y a esta',
    'camioneta no se le ha preguntado nunca.',
    '',
    'No se le preguntó por un error de método: la lista de objetivos se armó',
    'buscando por el nombre ("balance", "contribution"), y eso devolvió unos',
    'identificadores de motores diésel que el PCM rechazó. El dato bueno existe',
    'pero no se llama "balance". Un barrido ciego no depende de acertar con el',
    'nombre, y por eso se hace así.',
    '',
    'Se salta los dieciséis rangos que ya se barrieron el 11, 12 y 13 de',
    'septiembre: repetirlos costaría un tercio del tiempo a cambio de nada.',
    '',
    'SE HACE RODANDO. No pide ninguna maniobra ni para a preguntar nada:',
    'arráncalo, deja el teléfono y conduce normal un cuarto de hora. Rodando se',
    've más, porque los identificadores que dependen del movimiento devuelven un',
    'valor de verdad en vez del cero que darían con el carro parado.',
    '',
    'Mientras barre, el tablero de la app no se actualiza: el barrido usa el',
    'canal en exclusiva. Guíate por el tablero del carro.',
    '',
    'Los techos de siempre: solo servicios de lectura, 20 comandos por segundo',
    'y 25 ms entre uno y otro.',
  ];
}
