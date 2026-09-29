/**
 * Glosario: qué significa cada abreviatura, en lenguaje llano.
 *
 * Los nombres que usa el mundo del diagnóstico son siglas inglesas que no
 * dicen nada a nadie que no las conozca ya. STFT, LTFT, VCT, ISS, HO2S. Un
 * número junto a una sigla que no entiendes no es información: es ruido.
 *
 * Aquí cada término lleva una frase que explica qué mide y, más importante,
 * QUÉ SIGNIFICA que suba o que baje. Un dato de diagnóstico solo sirve si
 * sabes hacia dónde mirar cuando se mueve.
 */

export interface Termino {
  /** Cómo se escribe la sigla. */
  sigla: string;
  /** Qué es, en una frase. */
  que: string;
  /** Qué quiere decir cuando se mueve. */
  comoSeLee?: string;
}

export const GLOSARIO: Record<string, Termino> = {
  rpm: {
    sigla: 'Revoluciones',
    que: 'Vueltas por minuto del cigüeñal.',
    comoSeLee: 'Al ralentí y en caliente un V8 de 4.6 se queda entre 650 y 800. Si sube y baja sola sin tocar el acelerador, hay una fuga de aire o el cuerpo de aceleración está sucio.',
  },
  velocidad: {
    sigla: 'Velocidad',
    que: 'La velocidad que calcula el motor a partir del eje de salida de la caja.',
    comoSeLee: 'Puede diferir un poco del velocímetro del tablero: este número no lleva el margen de seguridad que los fabricantes le meten a la aguja.',
  },
  refrigerante: {
    sigla: 'Temperatura del refrigerante',
    que: 'La temperatura del agua del motor.',
    comoSeLee: 'En marcha normal se estabiliza entre 85 y 95 °C. Si nunca pasa de 70, el termostato está abierto y se queda pegado; si sube de 110, hay un problema de refrigeración de verdad.',
  },
  carga: {
    sigla: 'Carga del motor',
    que: 'Qué porcentaje de todo lo que el motor puede dar está dando ahora mismo.',
    comoSeLee: 'Al ralentí ronda el 20-30 %. A fondo se acerca al 100 %. Es la referencia que usan casi todos los demás datos: un valor solo significa algo si sabes con cuánta carga se midió.',
  },
  acelerador: {
    sigla: 'Acelerador / mariposa',
    que: 'Cuánto está abierta la mariposa, o cuánto está pisado el pedal.',
    comoSeLee: 'El pedal lleva tres sensores y la mariposa dos, todos por seguridad. Tienen que moverse juntos: si uno se desvía de los otros, el motor se protege cortando potencia.',
  },
  iat: {
    sigla: 'Temperatura del aire de admisión',
    que: 'Lo caliente que está el aire que entra al motor.',
    comoSeLee: 'Con el carro rodando debe parecerse a la temperatura ambiente. Parado y en caliente sube mucho porque el motor calienta el aire quieto del compartimento, y eso es normal.',
  },
  avance: {
    sigla: 'Avance de encendido',
    que: 'Cuántos grados antes del punto muerto superior salta la chispa.',
    comoSeLee: 'Más avance da más potencia hasta que aparece el picado. Si el motor detecta detonación, retira avance para protegerse: un avance que baja solo bajo carga es señal de gasolina mala o de carbonilla.',
  },
  voltaje: {
    sigla: 'Voltaje',
    que: 'La tensión del sistema eléctrico.',
    comoSeLee: 'Con el motor apagado una batería sana da 12,4-12,7 V. Con el motor en marcha el alternador debe subirlo a 13,8-14,6 V. Por debajo de 13,5 en marcha, el alternador no está cumpliendo.',
  },
  aceite: {
    sigla: 'Temperatura del aceite',
    que: 'Lo caliente que está el aceite del motor.',
    comoSeLee: 'Va por detrás del refrigerante y tarda más en subir. Es el que de verdad dice si el motor ya está caliente para exigirle.',
  },
  nivel: {
    sigla: 'Nivel de combustible',
    que: 'Cuánta gasolina queda, en porcentaje del tanque.',
    comoSeLee: 'El flotador del tanque no es preciso en los extremos: cerca de lleno y cerca de vacío se mueve de forma irregular. En el medio sí es fiable.',
  },
  baro: {
    sigla: 'Presión barométrica',
    que: 'La presión del aire donde estás, que depende de la altitud.',
    comoSeLee: 'A nivel del mar ronda los 101 kPa y baja unos 12 kPa por cada mil metros de altura. El motor la usa para saber cuánto oxígeno trae el aire.',
  },
  contador: {
    sigla: 'Contadores del sistema de diagnóstico',
    que: 'Kilómetros y arranques desde que se encendió el testigo o desde el último borrado de códigos.',
    comoSeLee: 'Sirven para saber si un código es viejo o acaba de aparecer, y si alguien borró la memoria hace poco. Un carro de segunda mano con los contadores casi en cero es un carro al que le borraron los códigos justo antes de enseñarlo.',
  },
  congelado: {
    sigla: 'Congelado de datos',
    que: 'Las condiciones exactas del motor en el instante en que saltó un código.',
    comoSeLee: 'Es lo primero que mira un mecánico: saber que el fallo ocurrió a 87 % de carga y 56 km/h dice mucho más que el código solo.',
  },
  averia: {
    sigla: 'Bandera de avería',
    que: 'Un sí o un no: el motor tiene detectado un problema en esa pieza concreta.',
    comoSeLee: 'En cero es lo normal. Si alguna se enciende sin que haya un código guardado, el problema acaba de empezar y el motor todavía no lo ha confirmado.',
  },
  stft: {
    sigla: 'STFT',
    que: 'Corrección de combustible a corto plazo. Lo que el motor está sumando o restando de gasolina AHORA MISMO para que la mezcla salga correcta.',
    comoSeLee: 'Cerca de 0 % es lo normal. Positivo quiere decir que está metiendo gasolina de más porque la mezcla le sale pobre: entra aire que no está midiendo, o falta presión de combustible. Negativo es lo contrario. Por encima de ±10 % sostenido hay algo que buscar.',
  },
  ltft: {
    sigla: 'LTFT',
    que: 'Corrección de combustible a largo plazo. Lo mismo que la de corto plazo, pero aprendido: el promedio que el motor ya da por bueno.',
    comoSeLee: 'Es la memoria del problema. Si la de corto plazo va alta pero la de largo está en cero, el problema acaba de empezar. Si la de largo también está alta, lleva tiempo.',
  },
  o2: {
    sigla: 'Sonda de oxígeno (HO2S)',
    que: 'Mide cuánto oxígeno queda en el escape, y con eso el motor sabe si la mezcla va rica o pobre.',
    comoSeLee: 'Las DELANTERAS tienen que oscilar sin parar entre 0,1 y 0,9 V: si se quedan quietas, el motor está ciego de ese banco. Las TRASERAS, después del catalizador, deben estar mucho más tranquilas, alrededor de 0,6-0,75 V.',
  },
  vct: {
    sigla: 'VCT',
    que: 'Distribución variable: el motor puede girar el árbol de levas para adelantar o retrasar la apertura de las válvulas según le convenga.',
    comoSeLee: 'Al ralentí se queda cerca de cero y con revoluciones sube a 20-40 grados. Lo que importa es el ERROR: la diferencia entre el avance que el motor pide y el que consigue. Si se queda lejos de cero de forma sostenida, la cadena está estirada o el variador gastado.',
  },
  iss: {
    sigla: 'ISS / eje de entrada',
    que: 'A qué velocidad gira la turbina del convertidor, o sea la entrada de la caja de cambios.',
    comoSeLee: 'Parado en P o en N gira casi como el motor. Con una marcha metida y el freno pisado cae a cero, porque la turbina se cala contra el convertidor. Eso es normal y sano.',
  },
  oss: {
    sigla: 'OSS / eje de salida',
    que: 'A qué velocidad gira la salida de la caja, la que va a las ruedas.',
    comoSeLee: 'Cero con el carro parado. Dividiendo la entrada entre la salida sale la relación real de la marcha que está puesta.',
  },
  tcc: {
    sigla: 'Deslizamiento del convertidor',
    que: 'Cuántas vueltas pierde el convertidor entre lo que entra y lo que sale.',
    comoSeLee: 'Parado y al ralentí es normal que haya algo. Rodando estable, cuando el embrague del convertidor se bloquea, tiene que bajar casi a cero. Si se queda alto a velocidad de crucero, patina: eso se paga en consumo y en temperatura de la caja.',
  },
  frp: {
    sigla: 'Presión del riel',
    que: 'La presión de la gasolina en el tubo que alimenta a los inyectores.',
    comoSeLee: 'Hay dos números: la que el motor PIDE y la que MIDE. Tienen que ir juntas. Si la medida se queda por debajo y no vuelve, falta caudal: bomba, filtro o regulador.',
  },
  maf: {
    sigla: 'MAF',
    que: 'Cuánto aire está entrando al motor, en gramos por segundo.',
    comoSeLee: 'Al ralentí un V8 de 4.6 mueve del orden de 5 a 7 g/s. Si está muy por debajo con el motor caliente, el medidor está sucio o hay una fuga de aire después de él.',
  },
  cht: {
    sigla: 'CHT · temperatura de culata',
    que: 'La temperatura del metal de la culata, medida aparte del refrigerante.',
    comoSeLee: 'Va siempre un poco por encima del refrigerante. Es el sensor con el que el motor se protege si pierde agua, porque sigue midiendo aunque no quede líquido que medir.',
  },
  tft: {
    sigla: 'TFT · temperatura de la caja',
    que: 'La temperatura del aceite de la transmisión.',
    comoSeLee: 'En marcha normal se estabiliza entre 70 y 95 °C. Por encima de 120 sostenido el aceite se degrada rápido, y eso acorta la vida de la caja más que cualquier otra cosa.',
  },
  trs: {
    sigla: 'Posición de la palanca',
    que: 'En qué posición está el selector: P, R, N o D.',
  },
  gear: {
    sigla: 'Marcha comandada',
    que: 'Qué marcha está pidiendo el módulo de la transmisión.',
    comoSeLee: 'Compárala con la relación medida: si el módulo pide 3ª y la relación no es la de 3ª, la caja está patinando.',
  },
  ratio: {
    sigla: 'Relación medida',
    que: 'La división real entre el eje de entrada y el de salida. No es lo que la caja ordena, es lo que la caja está haciendo.',
    comoSeLee: 'En un 6R80: 4,17 en 1ª · 2,34 en 2ª · 1,52 en 3ª · 1,14 en 4ª · 0,87 en 5ª · 0,69 en 6ª · 3,40 en reversa. Parado no significa nada porque la salida está en cero.',
  },
  spark: {
    sigla: 'Duración de chispa',
    que: 'Cuánto tiempo dura el arco eléctrico en la bujía, en milésimas de segundo.',
    comoSeLee: 'El número suelto no dice nada: lo que vale es la comparación entre los ocho cilindros. Una mezcla pobre o una bujía gastada alargan la chispa. Si un cilindro es siempre el que se sale de la manada, ahí está el problema.',
  },
  misfire: {
    sigla: 'Fallos de encendido',
    que: 'Cuántas veces un cilindro no llegó a quemar la mezcla.',
    comoSeLee: 'Unos pocos repartidos entre los ocho no significan nada. Muchos concentrados en uno son bujía, bobina o inyector de ese cilindro. Muchos repartidos por igual suelen ser combustible o compresión.',
  },
  evap: {
    sigla: 'Evaporativos',
    que: 'El sistema que atrapa los vapores de gasolina del tanque para que no salgan al aire.',
    comoSeLee: 'Es el culpable habitual del testigo de motor cuando el carro anda perfectamente. El primer sospechoso siempre es la tapa del tanque mal cerrada.',
  },
  alternador: {
    sigla: 'Alternador',
    que: 'Lo que el motor le pide al alternador y el voltaje que consigue.',
    comoSeLee: 'El voltaje deseado y el medido tienen que ir juntos. Si el sistema pide 14 V y solo hay 12,5 con el motor en marcha, el alternador no está cumpliendo.',
  },
  freno: {
    sigla: 'Presión de freno',
    que: 'La presión hidráulica del circuito principal, medida por el módulo del ABS.',
    comoSeLee: 'Prácticamente cero con el pedal suelto. Un frenazo fuerte llega a 40-80 bar.',
  },
  ac: {
    sigla: 'Presión del A/C',
    que: 'La presión del gas del aire acondicionado, en el lado de alta.',
    comoSeLee: 'Con el aire apagado se queda en la presión de equilibrio, alrededor de 800 kPa. Comprimiendo sube a 1400-2400 kPa. Si apenas sube al encenderlo, falta gas o el compresor no está enganchando.',
  },
  calefactor: {
    sigla: 'Calefactor de sonda',
    que: 'La resistencia que calienta la sonda de oxígeno para que empiece a medir antes de que el escape se caliente solo.',
    comoSeLee: 'Si una sonda no da señal pero su calefactor sigue consumiendo corriente, el cableado está bien y lo que está muerto es el sensor. Si no consume, el problema es eléctrico.',
  },
  iac: {
    sigla: 'Ralentí aprendido',
    que: 'El aire de más o de menos que el motor tuvo que aprender a meter para sostener el ralentí.',
    comoSeLee: 'Cerca de cero quiere decir que el motor no está compensando nada raro. Valores grandes y positivos apuntan a una fuga de aire o a un cuerpo de aceleración sucio.',
  },
};

/** Reglas para saber qué término le toca a cada dato, por su clave. */
const REGLAS: [RegExp, string][] = [
  [/^010C$|^020C/, 'rpm'],
  [/^010D$|^020D/, 'velocidad'],
  [/^0105$|^0205/, 'refrigerante'],
  [/^0104$|^0204/, 'carga'],
  [/^0111$|^0211|^tp\d|^app\d|^etc_/, 'acelerador'],
  [/^010F$|^020F/, 'iat'],
  [/^010E$|^020E/, 'avance'],
  [/^0142$/, 'voltaje'],
  [/^015C$/, 'aceite'],
  [/^012F$|^fuel_lvl$/, 'nivel'],
  [/^0133$/, 'baro'],
  [/^0103$|^fuelsys$/, 'stft'],
  [/^011F$|^0121$|^0130$|^0131$/, 'contador'],
  [/^mff_|^bat_freeze$/, 'congelado'],
  [/^flt_|_fault$|^ac_allowed$/, 'averia'],
  [/^stft/, 'stft'], [/^ltft/, 'ltft'],
  [/^0106$|^0108$/, 'stft'], [/^0107$|^0109$/, 'ltft'],
  [/^o2_htr/, 'calefactor'],
  [/^o2_|^ro2ft/, 'o2'],
  [/^vct_/, 'vct'],
  [/^iss$/, 'iss'], [/^oss$/, 'oss'],
  [/^tcc_slip$/, 'tcc'],
  [/^frp/, 'frp'], [/^fuel_pump$/, 'frp'],
  [/^maf/, 'maf'], [/^0110$/, 'maf'],
  [/^cht/, 'cht'], [/^tft$/, 'tft'],
  [/^trs$/, 'trs'], [/^gear$/, 'gear'], [/^gear_ratio$/, 'ratio'],
  [/^spark_dur/, 'spark'],
  [/^misfire|^cyl\d+_m06$/, 'misfire'],
  [/^evap|^flt_evap$/, 'evap'],
  [/^gen_|^vbatt/, 'alternador'],
  [/^brake_/, 'freno'],
  [/^ac_press/, 'ac'],
  [/^iac_/, 'iac'],
];

/** Devuelve la explicación de un dato, o cadena vacía si no hay ninguna. */
export function explicar(pid: { key: string; note?: string }): string {
  for (const [re, id] of REGLAS) {
    if (re.test(pid.key)) {
      const t = GLOSARIO[id];
      return t.comoSeLee ? `${t.sigla} — ${t.que}\n\n${t.comoSeLee}` : `${t.sigla} — ${t.que}`;
    }
  }
  return pid.note ?? '';
}

/** La misma explicación pero corta, para caber debajo de un nombre. */
export function explicarCorto(clave: string): string {
  for (const [re, id] of REGLAS) {
    if (re.test(clave)) return GLOSARIO[id].que;
  }
  return '';
}

export function terminoDe(clave: string): Termino | null {
  for (const [re, id] of REGLAS) if (re.test(clave)) return GLOSARIO[id];
  return null;
}

export function totalTerminos(): number {
  return Object.keys(GLOSARIO).length;
}
