/**
 * Prueba de la caja de cambios, en carretera y sin escribir nada.
 *
 * La idea es simple y es la única forma honesta de saber si una caja
 * automática patina sin abrirla:
 *
 *   El módulo de la transmisión dice QUÉ MARCHA está ordenando.
 *   Los dos ejes dicen QUÉ ESTÁ PASANDO DE VERDAD.
 *
 * Dividiendo el eje de entrada entre el de salida sale la relación real. Si el
 * módulo ordena 3ª y la relación es 1,52, la caja obedece. Si ordena 3ª y la
 * relación es 1,8, algo está resbalando entre la entrada y la salida.
 *
 * Todo lo que hace esta prueba es LEER. No manda ninguna orden a la caja ni a
 * ningún otro módulo: los servicios de control de actuadores están bloqueados
 * en esta app y esta prueba no es una excepción.
 */
import type { VehicleProfile, ModuleGroup } from '../profiles';
import { obdGateway } from './ObdGateway';

/** Relaciones de fábrica del 6R80 / 6R60. */
export const RATIOS_6R80: Record<number, number> = {
  1: 4.17, 2: 2.34, 3: 1.52, 4: 1.14, 5: 0.87, 6: 0.69, 7: 3.40,
};

export const NOMBRE_MARCHA: Record<number, string> = {
  1: '1ª', 2: '2ª', 3: '3ª', 4: '4ª', 5: '5ª', 6: '6ª', 7: 'R',
};

export interface MuestraCaja {
  t: number;
  marcha: number | null;
  iss: number | null;
  oss: number | null;
  /** iss / oss, solo cuando la salida gira lo bastante para que signifique algo. */
  ratio: number | null;
  velocidad: number | null;
  rpm: number | null;
  desliz: number | null;
}

/**
 * Por debajo de esta velocidad del eje de salida la división no significa nada:
 * con la salida casi parada, cualquier ruido en la medida dispara el cociente.
 */
const OSS_MINIMA = 200;

/** Claves que la prueba necesita del perfil. */
const CLAVES = {
  tcm: ['gear', 'iss', 'oss', 'tcc_slip'],
  estandar: ['010D', '010C'],
};

export function gruposDePrueba(profile: VehicleProfile): ModuleGroup[] {
  const buscar = (claves: string[]) => {
    const out: ModuleGroup[] = [];
    for (const g of profile.moduleGroups) {
      const pids = g.pids.filter(p => claves.includes(p.key));
      if (pids.length) out.push({ ...g, pids });
    }
    return out;
  };
  // El orden importa: primero el módulo de la transmisión, después la cabecera
  // funcional. Así solo hay un cambio de cabecera por ronda.
  return [...buscar(CLAVES.tcm), ...buscar(CLAVES.estandar)];
}

/** ¿Están en el perfil todos los datos que la prueba necesita? */
export function faltantes(profile: VehicleProfile): string[] {
  const hay = new Set(profile.moduleGroups.flatMap(g => g.pids).map(p => p.key));
  return [...CLAVES.tcm, ...CLAVES.estandar].filter(k => !hay.has(k));
}

export async function correrPruebaCaja(opts: {
  profile: VehicleProfile;
  segundos: number;
  onMuestra: (m: MuestraCaja, total: number) => void;
  debeParar: () => boolean;
}): Promise<MuestraCaja[]> {
  const muestras: MuestraCaja[] = [];
  await obdGateway.muestrearContinuo({
    grupos: gruposDePrueba(opts.profile),
    segundos: opts.segundos,
    debeParar: opts.debeParar,
    // Dos muestras por segundo sobran para medir relaciones de marcha, y así la
    // prueba no consume todo el presupuesto de comandos durante cinco minutos.
    gapMs: 60,
    onMuestra: (v, t) => {
      const iss = v.get('iss') ?? null;
      const oss = v.get('oss') ?? null;
      const m: MuestraCaja = {
        t,
        marcha: v.get('gear') ?? null,
        iss, oss,
        ratio: iss !== null && oss !== null && oss >= OSS_MINIMA ? iss / oss : null,
        velocidad: v.get('010D') ?? null,
        rpm: v.get('010C') ?? null,
        desliz: v.get('tcc_slip') ?? null,
      };
      muestras.push(m);
      opts.onMuestra(m, muestras.length);
    },
  });
  return muestras;
}

// ─── Análisis ───────────────────────────────────────────────────────────────

export type Veredicto = 'bien' | 'revisar' | 'patina' | 'sin_datos';

export interface MarchaAnalizada {
  marcha: number;
  nombre: string;
  nominal: number;
  medida: number;
  errorPct: number;
  muestras: number;
  veredicto: Veredicto;
  velMin: number;
  velMax: number;
}

export interface ResultadoCaja {
  total: number;
  utiles: number;
  segundos: number;
  marchas: MarchaAnalizada[];
  /** Marchas que nunca llegaron a usarse durante la prueba. */
  sinProbar: number[];
  velMax: number;
  /** Deslizamiento del convertidor a velocidad de crucero. */
  deslizCrucero: number | null;
  muestrasCrucero: number;
  veredictoConvertidor: Veredicto;
  resumen: string;
}

function mediana(xs: number[]): number {
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * Los umbrales.
 *
 * Un 3 % de diferencia entre la relación de fábrica y la medida es ruido: los
 * dos sensores tienen su tolerancia y la medida se toma mientras el carro se
 * mueve. Un 8 % ya no se explica por tolerancias. Entre medias, merece una
 * segunda prueba antes de decir nada.
 */
const ERROR_BIEN = 3;
const ERROR_PATINA = 8;

export function analizarCaja(muestras: MuestraCaja[]): ResultadoCaja {
  const utiles = muestras.filter(m => m.ratio !== null && m.marcha !== null && RATIOS_6R80[m.marcha!]);
  const porMarcha = new Map<number, MuestraCaja[]>();
  for (const m of utiles) {
    const a = porMarcha.get(m.marcha!);
    if (a) a.push(m); else porMarcha.set(m.marcha!, [m]);
  }

  const marchas: MarchaAnalizada[] = [];
  for (const [marcha, lista] of [...porMarcha].sort((a, b) => a[0] - b[0])) {
    // Menos de ocho muestras en una marcha es un cambio de paso, no una marcha
    // sostenida: no se puede sacar una conclusión de ahí.
    if (lista.length < 8) continue;
    const nominal = RATIOS_6R80[marcha];
    const medida = mediana(lista.map(m => m.ratio!));
    const errorPct = ((medida - nominal) / nominal) * 100;
    const vel = lista.map(m => m.velocidad ?? 0);
    const abs = Math.abs(errorPct);
    marchas.push({
      marcha, nombre: NOMBRE_MARCHA[marcha], nominal,
      medida, errorPct, muestras: lista.length,
      veredicto: abs <= ERROR_BIEN ? 'bien' : abs <= ERROR_PATINA ? 'revisar' : 'patina',
      velMin: Math.min(...vel), velMax: Math.max(...vel),
    });
  }

  const probadas = new Set(marchas.map(m => m.marcha));
  const sinProbar = [1, 2, 3, 4, 5, 6].filter(g => !probadas.has(g));

  // El convertidor: a velocidad de crucero y con el pie estable, su embrague
  // debe estar bloqueado y el deslizamiento casi en cero.
  const crucero = muestras.filter(m =>
    (m.velocidad ?? 0) >= 60 && m.desliz !== null && (m.marcha ?? 0) >= 4);
  const deslizCrucero = crucero.length >= 8 ? mediana(crucero.map(m => m.desliz!)) : null;
  const veredictoConvertidor: Veredicto =
    deslizCrucero === null ? 'sin_datos'
    : Math.abs(deslizCrucero) <= 30 ? 'bien'
    : Math.abs(deslizCrucero) <= 80 ? 'revisar' : 'patina';

  const t0 = muestras[0]?.t ?? 0;
  const t1 = muestras[muestras.length - 1]?.t ?? t0;

  const malas = marchas.filter(m => m.veredicto === 'patina');
  const dudosas = marchas.filter(m => m.veredicto === 'revisar');
  let resumen: string;
  if (!marchas.length) {
    resumen = 'No hubo suficientes datos en marcha para sacar nada en claro. Hay que rodar de verdad, no solo arrancar y parar.';
  } else if (malas.length) {
    resumen = `${malas.map(m => m.nombre).join(', ')} no da la relación que debería. Eso es patinaje.`;
  } else if (veredictoConvertidor === 'patina') {
    resumen = 'Las marchas dan la relación correcta, pero el convertidor no se bloquea a velocidad de crucero.';
  } else if (dudosas.length || veredictoConvertidor === 'revisar') {
    resumen = `Las relaciones están cerca de lo correcto, con ${dudosas.length || 1} para mirar otra vez con una prueba más larga.`;
  } else {
    resumen = `Las ${marchas.length} marchas probadas dan la relación de fábrica${veredictoConvertidor === 'bien' ? ' y el convertidor se bloquea bien' : ''}.`;
  }

  return {
    total: muestras.length,
    utiles: utiles.length,
    segundos: Math.round((t1 - t0) / 1000),
    marchas, sinProbar,
    velMax: Math.max(0, ...muestras.map(m => m.velocidad ?? 0)),
    deslizCrucero, muestrasCrucero: crucero.length, veredictoConvertidor,
    resumen,
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

const TEXTO_VEREDICTO: Record<Veredicto, string> = {
  bien: 'BIEN',
  revisar: 'REVISAR',
  patina: 'PATINA',
  sin_datos: 'sin datos',
};

export function informeCaja(profile: VehicleProfile, r: ResultadoCaja): string {
  const L: string[] = [];
  L.push('PRUEBA DE LA CAJA DE CAMBIOS');
  L.push(new Date().toLocaleString());
  L.push(`${profile.make} ${profile.model} ${profile.year} — ${profile.engine}`);
  L.push('');
  L.push(r.resumen);
  L.push('');
  L.push(`Duración: ${r.segundos} s · ${r.total} muestras · ${r.utiles} con el carro rodando`);
  L.push(`Velocidad máxima alcanzada: ${r.velMax} km/h`);
  L.push('');
  L.push('Cómo se hace esta prueba: la caja dice qué marcha ORDENA y los dos ejes');
  L.push('dicen qué está pasando de verdad. La división entre el eje de entrada y');
  L.push('el de salida es la relación real. Si no coincide con la de fábrica, algo');
  L.push('resbala entre los dos. La app no le manda nada a la caja: solo lee.');
  L.push('');
  L.push('='.repeat(62));
  L.push('');
  L.push('MARCHA   DE FÁBRICA     MEDIDA    DIFERENCIA   MUESTRAS   VELOCIDAD      ');
  L.push('-'.repeat(72));
  for (const m of r.marchas) {
    L.push(
      `${m.nombre.padEnd(8)} ${String(r2(m.nominal)).padStart(10)} ${String(r2(m.medida)).padStart(10)} ` +
      `${(r2(m.errorPct) >= 0 ? '+' : '') + r2(m.errorPct) + ' %'}`.padStart(13) +
      `${String(m.muestras).padStart(11)}   ${m.velMin}-${m.velMax} km/h   ${TEXTO_VEREDICTO[m.veredicto]}`,
    );
  }
  if (!r.marchas.length) L.push('   (ninguna marcha se sostuvo el tiempo suficiente para medirla)');
  L.push('');
  if (r.sinProbar.length) {
    L.push(`Marchas que no llegaron a usarse: ${r.sinProbar.map(g => NOMBRE_MARCHA[g]).join(', ')}.`);
    L.push('Para probarlas hace falta rodar a la velocidad en la que entran.');
    L.push('');
  }
  L.push('-- Convertidor de par');
  if (r.deslizCrucero === null) {
    L.push('   Sin datos suficientes a velocidad de crucero. Hacen falta tramos por');
    L.push('   encima de 60 km/h con el pie estable y una marcha alta metida.');
  } else {
    L.push(`   Deslizamiento a velocidad de crucero: ${r2(r.deslizCrucero)} rpm  (${TEXTO_VEREDICTO[r.veredictoConvertidor]})`);
    L.push(`   Medido sobre ${r.muestrasCrucero} muestras por encima de 60 km/h en 4ª o superior.`);
    L.push('   Con el embrague del convertidor bloqueado tiene que quedarse casi en cero.');
    L.push('   Si se queda alto, el convertidor patina: eso se paga en consumo y en');
    L.push('   temperatura del aceite de la caja.');
  }
  L.push('');
  L.push('-- Cómo leer las diferencias');
  L.push(`   Hasta ±${ERROR_BIEN} % es tolerancia normal de los sensores.`);
  L.push(`   Entre ${ERROR_BIEN} % y ${ERROR_PATINA} % conviene repetir la prueba antes de concluir nada.`);
  L.push(`   Por encima de ${ERROR_PATINA} % no se explica por tolerancias.`);
  L.push('');
  L.push('FIN DE LA PRUEBA');
  return L.join('\n');
}
