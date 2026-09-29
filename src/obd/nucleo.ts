/**
 * El núcleo: lo único que se sigue preguntando cuando no miras nada.
 *
 * La app lee solo lo que está en pantalla. Cuando no hay ninguna pantalla de
 * datos delante —la pestaña de códigos, la app en segundo plano— se podría no
 * preguntar nada en absoluto, pero entonces el historial y la gráfica se
 * llenarían de huecos cada vez que cambias de pestaña, y una grabación de un
 * viaje quedaría partida en trozos.
 *
 * El acuerdo es este: cuatro identificadores, los cuatro en cabecera funcional.
 *
 * Que sean los cuatro de la misma cabecera no es casualidad. Cambiar de
 * cabecera cuesta dos comandos de más (ATSH y ATCRA) cada vez, así que un
 * núcleo repartido entre módulos costaría más en cambios de cabecera que en
 * lecturas. Así son cuatro comandos por vuelta y ni uno más.
 */
export const NUCLEO: readonly string[] = ['010C', '010D', '0105', '0104'];

/**
 * Lo que enseña el tablero digital y NO está en el núcleo.
 *
 * Estas se leen solo cuando ninguna pantalla está pidiendo otra cosa. El caso
 * que importa es la pestaña de datos en vivo con todos los grupos cerrados: no
 * estás mirando ningún grupo, pero el tablero sigue siendo la pantalla
 * principal de la app y tiene que estar al día cuando vuelvas a él, no
 * rellenarse delante de tus ojos.
 *
 * En cuanto abres un grupo, estas salen del plan. Es deliberado: la vuelta se
 * queda corta y el grupo que SÍ estás mirando se refresca rápido, que es para
 * lo que lo abriste. La marcha y la palanca además viven en el TCM, así que
 * cuestan dos comandos más de cambio de cabecera; no es un dato que convenga
 * arrastrar mientras miras otra cosa.
 */
export const TABLERO: readonly string[] = ['gear', 'trs', '012F', 'fuel_lvl'];

/** ¿Es una de las cuatro que no se apagan? */
export function esDelNucleo(clave: string): boolean {
  return NUCLEO.includes(clave);
}

/** Para la interfaz: explicar por qué estos cuatro no se apagan nunca. */
export const NUCLEO_TEXTO =
  'Revoluciones, velocidad, refrigerante y carga. Se siguen leyendo aunque no ' +
  'estés mirando ninguna pantalla de datos, para que el historial y las ' +
  'grabaciones no queden con huecos. Son cuatro comandos por vuelta. Cuando ' +
  'además no hay ninguna pantalla pidiendo datos, se les suman las del tablero ' +
  '—marcha, palanca y combustible— para que esté al día al volver a él.';

/**
 * Qué hay que preguntarle al vehículo ahora mismo.
 *
 * Vive aquí, como función pura sin dependencias, por un motivo concreto: el
 * almacén de estado real usa React y no se puede cargar en las autopruebas, así
 * que estas corren contra un doble. Si esta decisión viviera dentro del almacén,
 * las autopruebas estarían comprobando el doble en vez de la app — y el doble
 * puede quedarse atrás sin que nadie se entere. Estando aquí, el almacén real y
 * el doble llaman los dos a esta misma función, y lo que se prueba es lo que
 * corre en el teléfono.
 *
 * @param visibles   las claves que declara cada pantalla que está delante
 * @param grabando   si hay una grabación en curso
 * @param grabClaves lo que esa grabación está guardando
 */
export function calcularActivas(
  visibles: Iterable<Iterable<string>>,
  grabando: boolean,
  grabClaves: Iterable<string>,
): Set<string> {
  const out = new Set<string>(NUCLEO);
  let alguienMira = false;
  for (const conjunto of visibles) {
    for (const k of conjunto) { out.add(k); alguienMira = true; }
  }
  // Nadie mirando nada concreto: se sostiene el tablero. Con cualquier pantalla
  // pidiendo datos, el tablero cede el sitio para que la vuelta sea corta.
  if (!alguienMira) for (const k of TABLERO) out.add(k);
  // La grabación es la única excepción a "solo se lee lo que miras": lo que se
  // está grabando se sigue pidiendo aunque no esté en pantalla, porque una
  // grabación con agujeros cada vez que cambias de pestaña no sirve de nada.
  if (grabando) for (const k of grabClaves) out.add(k);
  return out;
}

/** Cada cuánto comprueba el vigilante que lo declarado siga en pie. */
export const VIGILANTE_MS = 3000;

/**
 * ¿Lo que el almacén tiene registrado para esta pantalla es lo que la pantalla
 * declaró?
 *
 * Vive aquí, como función pura, por el mismo motivo que `calcularActivas`: para
 * que lo que comprueban las autopruebas sea lo que corre en el teléfono y no un
 * doble que puede quedarse atrás.
 *
 * Existe porque pasó de verdad. Conectando el escáner con la camioneta ya
 * andando, el tablero se quedó sin marcha y sin palanca, y la única forma de
 * recuperarlas era salir a otra pantalla y volver. La declaración de lo que la
 * pantalla necesita dependía de un solo evento, y ese evento se perdió. Este
 * vigilante no averigua por qué se perdió: se limita a notar que lo declarado
 * no está y volver a declararlo. No cuesta ni un comando al vehículo.
 *
 * @param actual lo que el almacén tiene ahora para esa pantalla
 * @param firma  lo que la pantalla dice que necesita, separado por '|'
 */
export function hayQueRedeclarar(actual: Iterable<string> | undefined, firma: string): boolean {
  if (!firma) return false;
  if (!actual) return true;
  // Se compara por CONTENIDO, no por orden: la pantalla puede reordenar su
  // lista sin que eso signifique que haya que tocar el plan de muestreo.
  const tiene = new Set(actual);
  const quiere = firma.split('|');
  if (tiene.size !== quiere.length) return true;
  for (const k of quiere) if (!tiene.has(k)) return true;
  return false;
}
