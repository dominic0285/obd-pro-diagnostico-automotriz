/**
 * La grabadora: guardar el flujo entero de un trayecto y sacar un informe.
 *
 * Mientras la grabación corre, sus claves entran en el plan de muestreo aunque
 * no estén en pantalla. Es la única excepción a la regla de "solo se lee lo que
 * miras", y es deliberada: una grabación con huecos cada vez que cambias de
 * pestaña no serviría para nada.
 *
 * El informe no vuelca las muestras una por una —serían decenas de miles de
 * líneas que nadie va a leer— sino lo que de verdad sirve para diagnosticar:
 * mínimo, máximo, promedio y, sobre todo, CUÁNDO ocurrió el extremo. Saber que
 * la presión del riel bajó a 180 kPa no dice mucho; saber que bajó a 180 en el
 * segundo 412, cuando las revoluciones estaban en 3200, lo dice todo.
 */
import type { EnhancedPid, VehicleProfile } from '../profiles';
import { HARD_LIMITS } from './pipeline';

/** Una fila de la lista de "qué grabar". */
export interface Grabable {
  pid: EnhancedPid;
  grupo: string;
  color: string;
  /** Está apagado en los ajustes. Se puede grabar igual: se enciende solo. */
  apagado: boolean;
}

/**
 * Todo lo que se PUEDE grabar de este perfil, con su estado actual.
 *
 * Se queda fuera únicamente lo que el propio vehículo ha dicho que no tiene
 * —ni contesta ni va a contestar—, porque eso no es una preferencia sino un
 * hecho. Lo que está apagado a mano SÍ aparece, marcado como apagado: es la
 * gracia de esta lista, poder grabar algo que normalmente no quieres en
 * pantalla sin tener que ir a ajustes a encenderlo y acordarte de apagarlo.
 */
export function grabables(
  profile: VehicleProfile,
  apagados: ReadonlySet<string>,
  sinSoporte: ReadonlySet<string>,
  soportadosModo01?: ReadonlySet<string> | null,
): Grabable[] {
  const out: Grabable[] = [];
  for (const g of profile.moduleGroups) {
    for (const p of g.pids) {
      if (sinSoporte.has(p.key)) continue;
      if (p.mode === '01' && soportadosModo01 && !soportadosModo01.has(p.command)) continue;
      out.push({ pid: p, grupo: g.moduleName, color: g.color, apagado: apagados.has(p.key) });
    }
  }
  return out;
}

/**
 * Cuánto tarda una vuelta entera con estas claves, y por qué.
 *
 * Esto no es adorno: es el número que decide si una grabación sirve. Con veinte
 * datos cada uno se refresca tres veces por segundo y se ve un tirón del motor;
 * con ciento veinte, cada dato llega cada seis segundos y un tirón de dos
 * segundos puede no aparecer en la grabación. Enseñarlo ANTES de empezar es lo
 * que evita descubrirlo al leer el informe.
 *
 * Cada cambio de cabecera cuesta dos comandos de más (ATSH y ATCRA), así que se
 * cuentan los grupos distintos, no solo las lecturas.
 */
export function costeVuelta(profile: VehicleProfile, claves: Iterable<string>): {
  lecturas: number; comandos: number; segundos: number;
} {
  const set = new Set(claves);
  let lecturas = 0, grupos = 0;
  for (const g of profile.moduleGroups) {
    const n = g.pids.filter(p => set.has(p.key)).length;
    if (!n) continue;
    lecturas += n;
    if (g.header) grupos++;         // la cabecera funcional no se cambia
  }
  const comandos = lecturas + grupos * 2;
  return { lecturas, comandos, segundos: comandos / HARD_LIMITS.MAX_PER_SECOND };
}

export interface Muestra { t: number; key: string; value: number }

export interface Resumen {
  key: string;
  nombre: string;
  unidad: string;
  n: number;
  min: number;
  max: number;
  media: number;
  /** Segundo del trayecto en que ocurrió el mínimo y el máximo. */
  tMin: number;
  tMax: number;
  /** Última lectura. */
  ultimo: number;
}

export function resumir(profile: VehicleProfile, muestras: Muestra[], inicio: number): Resumen[] {
  const defs = new Map(profile.moduleGroups.flatMap(g => g.pids).map(p => [p.key, p]));
  const por = new Map<string, Muestra[]>();
  for (const m of muestras) {
    if (!Number.isFinite(m.value)) continue;
    const a = por.get(m.key);
    if (a) a.push(m); else por.set(m.key, [m]);
  }
  const out: Resumen[] = [];
  for (const [key, lista] of por) {
    const def = defs.get(key);
    if (!def || !lista.length) continue;
    let min = Infinity, max = -Infinity, suma = 0, tMin = 0, tMax = 0;
    for (const m of lista) {
      suma += m.value;
      if (m.value < min) { min = m.value; tMin = m.t; }
      if (m.value > max) { max = m.value; tMax = m.t; }
    }
    out.push({
      key, nombre: def.name, unidad: def.unit, n: lista.length,
      min, max, media: suma / lista.length,
      tMin: Math.round((tMin - inicio) / 1000),
      tMax: Math.round((tMax - inicio) / 1000),
      ultimo: lista[lista.length - 1].value,
    });
  }
  return out.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function reloj(seg: number): string {
  const m = Math.floor(seg / 60), s = seg % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function informeGrabacion(profile: VehicleProfile, muestras: Muestra[], inicio: number): string {
  const fin = muestras.length ? muestras[muestras.length - 1].t : inicio;
  const dur = Math.max(1, Math.round((fin - inicio) / 1000));
  const res = resumir(profile, muestras, inicio);
  const L: string[] = [];

  L.push('GRABACIÓN DEL FLUJO DE DATOS');
  L.push(new Date(inicio).toLocaleString());
  L.push(`${profile.make} ${profile.model} ${profile.year} — ${profile.engine}`);
  L.push('');
  L.push(`Duración: ${reloj(dur)} (${dur} s)`);
  L.push(`Lecturas guardadas: ${muestras.length}`);
  L.push(`Datos distintos: ${res.length}`);
  L.push(`Ritmo medio: ${r2(muestras.length / dur)} lecturas por segundo en total`);
  L.push('');
  L.push('Los tiempos van desde el inicio de la grabación, en minutos:segundos.');
  L.push('');
  L.push('='.repeat(62));
  L.push('');

  const ancho = Math.max(24, ...res.map(x => x.nombre.length));
  L.push(`${'DATO'.padEnd(ancho)}  ${'MÍNIMO'.padStart(12)} ${'en'.padStart(6)}  ${'MÁXIMO'.padStart(12)} ${'en'.padStart(6)}  ${'MEDIA'.padStart(10)}  ${'ÚLTIMO'.padStart(10)}   n`);
  L.push('-'.repeat(ancho + 70));
  for (const x of res) {
    L.push(
      `${x.nombre.padEnd(ancho)}  ${String(r2(x.min)).padStart(12)} ${reloj(x.tMin).padStart(6)}  ` +
      `${String(r2(x.max)).padStart(12)} ${reloj(x.tMax).padStart(6)}  ` +
      `${String(r2(x.media)).padStart(10)}  ${String(r2(x.ultimo)).padStart(10)}  ${x.n}` +
      (x.unidad ? `  ${x.unidad}` : ''),
    );
  }

  // Los datos que no se movieron en todo el trayecto. Que algo esté clavado
  // puede ser perfectamente normal (una constante de configuración) o la
  // avería entera (una sonda que no responde). Conviene verlos juntos.
  const quietos = res.filter(x => x.n > 5 && x.max === x.min);
  if (quietos.length) {
    L.push('');
    L.push('-- No se movieron ni una vez en todo el trayecto');
    L.push('   Puede ser normal (un dato de configuración) o ser la avería entera');
    L.push('   (un sensor que dejó de responder). Merece una mirada.');
    for (const x of quietos) L.push(`   ${x.nombre.padEnd(ancho)} siempre ${r2(x.min)} ${x.unidad}`);
  }

  L.push('');
  L.push('FIN DE LA GRABACIÓN');
  return L.join('\n');
}
