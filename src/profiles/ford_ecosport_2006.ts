/**
 * Ford EcoSport 2006 · 2.0 Duratec · caja sincrónica (PCM "4N15")
 *
 * De dónde sale cada cosa
 * ───────────────────────
 * Los identificadores y los valores salieron de las dos pruebas de
 * descubrimiento del 16/09/2026, con el carro delante. Los NOMBRES y las
 * ESCALAS se contrastaron con un catálogo técnico de parámetros Ford.
 *
 * Esas dos fuentes se comprueban una a la otra, y esa es la única razón por la
 * que este perfil se puede publicar sin haber tenido nunca un manual de este
 * PCM. El catálogo dice qué DEBERÍA ser cada número; el carro dice qué HACE.
 * Solo entra aquí lo que coincide en las dos. Cuando el catálogo ofrecía
 * varios candidatos para el mismo identificador —cosa habitual, porque la
 * correspondencia es por estrategia y hay decenas—, el que decide es el
 * comportamiento medido en las cinco condiciones de la prueba.
 *
 * Las comprobaciones más bonitas, por si alguien duda del método:
 *  - `221154` (mariposa) marcó 0,834 V al ralentí y `221169` (el valor de
 *    mariposa cerrada que el PCM tiene APRENDIDO) marcó 0,829 V. Cinco
 *    milivoltios. Dos identificadores distintos, dos entradas distintas del
 *    catálogo, el mismo pedal sin pisar.
 *  - `221135` (ralentí DESEADO) dio 864 rpm mientras el cuentavueltas marcaba
 *    868. Cuatro revoluciones.
 *  - `22114D` (señal del sensor de refrigerante) bajó de 0,615 V a 0,454 V
 *    cuando el refrigerante subió de 87 a 97 °C. Es un termistor NTC: tiene
 *    que bajar. Y `22114A` hace lo mismo con el aire de admisión.
 *  - `221172` (voltaje) subió con las revoluciones y bajó con las luces, el
 *    aire y el freno. Es una batería con su alternador, no una coincidencia.
 *
 * Lo que este carro NO tiene
 * ──────────────────────────
 *  - NO hay nivel de combustible por el PID estándar: la máscara `0100`
 *    (`BE3EB010`) no declara la página `0120`, así que `012F` no existe. Pero
 *    SÍ lo hay por el identificador Ford `2216C1`, el mismo que la Explorer.
 *  - NO hay Modo 06: contesta `460000000000`, o sea responde y no publica
 *    nada. Es de 2006 y en Brasil la detección de fallos de encendido no fue
 *    obligatoria hasta el OBDBr-2. A cambio el PCM lleva la cuenta por dentro
 *    y la publica en `221616`.
 *  - NO hay Modo 21: los 64 identificadores probados los rechazó todos.
 *  - NO hay MAF, ni VCT, ni presión de riel, ni sensor de presión del tanque,
 *    ni relación medida de caja. Todos existen en la Explorer y aquí el PCM
 *    contestó "no existe".
 *  - NO hay banco 2 ni sonda trasera: `220013` = 01, UNA sonda, y `221159`
 *    (lambda del banco 2) está clavado en 0x6000.
 *  - El sensor de presión del A/C y el ventilador variable contestan pero
 *    valieron `00` incluso con el aire encendido: ventilador de relé.
 *
 * Lo que este carro tiene intervenido
 * ───────────────────────────────────
 * Esto no sale en ningún informe y cambia cómo se leen varios datos, así que
 * va aquí arriba y no enterrado en una nota:
 *
 *  - El INTERRUPTOR DE REVERSA se quitó de la caja y el circuito se condenó.
 *    De ahí el P0812 guardado y de ahí que `220926` valga 1 siempre. No es una
 *    avería que perseguir y el código va a volver cada vez que se borre.
 *  - El INTERRUPTOR DE FRENO está averiado. Eso invalida cualquier conclusión
 *    sacada de la maniobra "pisar el embrague y el freno" del 16/09, y explica
 *    por qué en las dos pruebas no apareció ni un solo bit de freno en ningún
 *    identificador: el PCM no está recibiendo esa señal.
 *
 * Lo que cerró la prueba del 17/09
 * ────────────────────────────────
 * Siete condiciones separadas —el aire solo, las luces solas, reversa, subida
 * de vueltas, rodando y retención— leyendo siempre los mismos identificadores.
 * Cerró cuatro cosas y corrigió tres errores míos:
 *
 *  - `221156` estaba a la MITAD de escala. Leído en la misma tanda que el PID
 *    estándar, el número era exactamente el doble en cinco de siete
 *    condiciones y dentro del rango en las otras dos.
 *  - `221624` NO es la temperatura de culata en este PCM. Dio el mismo número
 *    que el refrigerante en las veintiuna lecturas, hasta el decimal.
 *  - `221103` no es un sí/no sino un byte de bits (0, 4 y 132).
 *  - `2211B5` resultó ser la velocidad de la RUEDA, no un cero de caja
 *    automática: 470-505 rpm a 54-61 km/h, que es justo lo que gira un
 *    205/65R15 a esa velocidad.
 *
 * Y dejó una cosa sin resolver que no se resuelve con el escáner: `220926`
 * valió 1 en las siete condiciones, incluida la de reversa metida. Ver su nota.
 *
 * Lo que se cayó del perfil
 * ─────────────────────────
 * `22098F` (velocidad cruda) valió 0 incluso rodando a 60 km/h, así que no es
 * lo que el catálogo dice o este PCM no lo llena. Y `221623`, `221675` y
 * `221676`, los tres que el catálogo no conocía, resultaron constantes en las
 * siete condiciones: no son datos en vivo. Fuera los cuatro: un identificador
 * que no informa de nada cuesta una pregunta por vuelta igual que uno bueno.
 */
import type { EnhancedPid, VehicleProfile } from './index';

/** Entero de 16 bits con signo, en complemento a dos. */
const sgn16 = (A: number, B: number) => {
  const v = (A * 256 + B) & 0xFFFF;
  return v >= 0x8000 ? v - 0x10000 : v;
};
const uint = ([A, B]: number[]) => (B === undefined ? A : A * 256 + B);
const SI_NO = { 0: 'no', 1: 'SÍ' };
/** Voltaje de sensor analógico de este PCM: 0-5 V repartidos en 16 bits. */
const volt5 = ([A, B]: number[]) => ((A * 256 + B) * 5) / 65536;
/** Temperatura con la escala Ford, más fina que el grado entero del PID. */
const tempFord = ([A]: number[]) => ((A - 16) * 10) / 9;

/**
 * Celda aprendida de aire en ralentí (KAM), escala /4096 lb/min con signo.
 *
 * La correspondencia está confirmada, y precisamente por ser un carro
 * sincrónico: las dos celdas de "en marcha" se quedaron en cero exacto en
 * todas las maniobras y las de "en neutro" llevaban valor y se movían. En un
 * carro sin automática no existe la condición "en marcha".
 */
const iacKam = (cmd: string, key: string, name: string): EnhancedPid => ({
  command: cmd, key, name, unit: 'lb/min', min: -2, max: 2, mode: '22', verified: true,
  note: 'IACKAM. Lo que el PCM tuvo que aprender para sostener el ralentí. Las celdas de "en marcha" marcan cero fijo porque esta caja es sincrónica.',
  formula: ([A, B]) => sgn16(A, B) / 4096,
});

/** Un byte de estado que el catálogo nombra y que aquí valió siempre cero. */
const estado = (cmd: string, key: string, name: string, nota: string): EnhancedPid => ({
  command: cmd, key, name, unit: '', min: 0, max: 255, mode: '22', verified: true, defaultOff: true,
  etiquetas: { ...SI_NO }, note: nota, formula: ([A]) => (A ? 1 : 0),
});

/** Uno de los tres que el catálogo de referencia no conoce. */
const sinIdentificar = (cmd: string, key: string, apunte: string): EnhancedPid => ({
  command: cmd, key, name: `${cmd.substring(2)} · sin identificar`, unit: '',
  min: 0, max: 65535, mode: '22', verified: false, defaultOff: true,
  note: `No está en el catálogo de referencia bajo ningún acrónimo. El 16/09: ${apunte}. Se enseña crudo y sin unidad a propósito: un número con unidad se cree, y este no se lo ha ganado.`,
  formula: uint,
});

export const FORD_ECOSPORT_2006_PROFILE: VehicleProfile = {
  id: 'ford_ecosport_2006',
  make: 'Ford',
  model: 'EcoSport',
  year: '2006',
  engine: '2.0 Duratec · sincrónica',
  description: 'PCM 4N15, calibración WNAGAM5. Quince PID estándar más las páginas propietarias 09xx, 11xx y 16xx, identificadas contra el catálogo de referencia y confirmadas con el carro delante.',
  hasEnhanced: true,
  preferredProtocol: '6',
  modules: [
    { id: 'pcm', name: 'PCM · Motor',   header: '7E0', rxHeader: '7E8', codeTypes: 'P / U', color: '#2C74D6' },
    { id: 'ipc', name: 'IPC · Tablero', header: '720', rxHeader: '728', codeTypes: 'U',     color: '#8E44AD' },
    { id: 'abs', name: 'ABS · Frenos',  header: '760', rxHeader: '768', codeTypes: 'C',     color: '#C25A12' },
    { id: 'rcm', name: 'RCM · Airbags', header: '737', rxHeader: '73F', codeTypes: 'B',     color: '#B03030' },
  ],
  moduleGroups: [
    // ══ OBD2 ESTÁNDAR ═══════════════════════════════════════════════════════
    {
      header: '',
      moduleName: 'PCM · Estándar',
      color: '#2C74D6',
      pids: [
        { command: '010C', key: '010C', name: 'RPM del motor',       unit: 'rpm',  min: 0,   max: 7000, mode: '01', verified: true, formula: ([A, B]) => (A * 256 + B) / 4 },
        { command: '010D', key: '010D', name: 'Velocidad',           unit: 'km/h', min: 0,   max: 200,  mode: '01', verified: true, formula: ([A]) => A },
        { command: '0105', key: '0105', name: 'Temp. refrigerante',  unit: '°C',   min: -40, max: 150,  mode: '01', verified: true, formula: ([A]) => A - 40 },
        { command: '0104', key: '0104', name: 'Carga del motor',     unit: '%',    min: 0,   max: 100,  mode: '01', verified: true, formula: ([A]) => (A * 100) / 255 },
        { command: '010B', key: '010B', name: 'Presión del colector', unit: 'kPa', min: 0,   max: 255,  mode: '01', verified: true,
          note: 'MAP. En este motor es LA medida del aire: no hay MAF. Al ralentí dio 49 kPa y a 2500 rpm en punto muerto bajó a 25, que es lo que tiene que hacer.',
          formula: ([A]) => A },
        { command: '0111', key: '0111', name: 'Posición acelerador', unit: '%',    min: 0,   max: 100,  mode: '01', verified: true, formula: ([A]) => (A * 100) / 255 },
        { command: '010F', key: '010F', name: 'Temp. aire admisión', unit: '°C',   min: -40, max: 120,  mode: '01', verified: true, formula: ([A]) => A - 40 },
        { command: '010E', key: '010E', name: 'Avance encendido',    unit: '°',    min: -64, max: 64,   mode: '01', verified: true, formula: ([A]) => A / 2 - 64 },
        { command: '0106', key: 'stft_b1', name: 'STFT Banco 1',     unit: '%',    min: -25, max: 25,   mode: '01', verified: true, formula: ([A]) => (A - 128) * 100 / 128 },
        { command: '0107', key: 'ltft_b1', name: 'LTFT Banco 1',     unit: '%',    min: -25, max: 25,   mode: '01', verified: true,
          note: 'Se movió entre -7,8 % y -1,6 % el 16/09. Negativo quiere decir que el PCM está quitando combustible.',
          formula: ([A]) => (A - 128) * 100 / 128 },
        { command: '0114', key: 'o2_b1s1', name: 'Sonda de oxígeno B1S1', unit: 'V', min: 0, max: 1.275, mode: '01', verified: true,
          note: 'La ÚNICA sonda que este PCM declara (220013 = 01).',
          formula: ([A]) => A / 200 },
        { command: '0103', key: 'fuelsys', name: 'Estado del combustible', unit: '', min: 0, max: 16, mode: '01', verified: true,
          etiquetas: { 1: 'lazo abierto · motor frío', 2: 'lazo cerrado', 4: 'lazo abierto · carga o retención', 8: 'lazo abierto · avería', 16: 'lazo cerrado con sonda averiada' },
          note: 'Valía 2 en todas las maniobras: lazo cerrado, el PCM corrigiendo por la sonda.',
          formula: ([A]) => A },
        { command: '0113', key: 'o2_presentes', name: 'Sondas declaradas', unit: '', min: 0, max: 255, mode: '01', verified: true, defaultOff: true,
          note: 'Máscara de sondas. Vale 01: solo B1S1. Es el dato que demuestra que las otras tres del espejo son relleno.',
          formula: ([A]) => A },
        { command: '011C', key: 'obd_std', name: 'Norma OBD declarada', unit: '', min: 0, max: 255, mode: '01', verified: true, defaultOff: true,
          etiquetas: { 1: 'OBD-II (California)', 2: 'OBD (federal)', 3: 'OBD y OBD-II', 4: 'OBD-I', 6: 'EOBD', 11: 'JOBD' },
          note: 'Devolvió 4, o sea OBD-I. No es un fallo: es un carro brasileño de 2006, de la primera fase del OBDBr, y explica de una sola vez por qué faltan el nivel de combustible estándar, el flujo de aire y el Modo 06.',
          formula: ([A]) => A },
      ],
    },

    // ══ MOTOR · SEÑALES FINAS (página 11xx) ══════════════════════════════════
    // La página que la primera prueba no llegó a barrer. Aquí está casi todo
    // lo bueno: las mismas magnitudes del Modo 01 con mucha más resolución, y
    // varias que el Modo 01 no publica en absoluto.
    {
      header: '7E0',
      rxHeader: '7E8',
      moduleName: 'Motor · señales finas',
      color: '#1E8E5A',
      pids: [
        { command: '221172', key: 'vbatt_pcm', name: 'Voltaje que ve el PCM', unit: 'V', min: 0, max: 18, mode: '22', verified: true,
          note: 'VPWR, escala /16. Confirmado en las condiciones separadas del 17/09: 13,94 V al ralentí con todo apagado, 13,81 V con las luces altas solas y 13,25 V con el aire solo. El adaptador medía 13,2 V. Que baje con la carga eléctrica y suba con las revoluciones es lo que hace una batería con su alternador. CORREGIDO: en el informe del 16/09 atribuí una caída a las luces de freno, y eso no valía — el interruptor de freno de este carro está averiado, así que no se sabe si esas luces llegaron a encender. La caída de aquella maniobra era del aire acondicionado, que seguía puesto de la maniobra anterior.',
          formula: ([A]) => A / 16 },
        { command: '221135', key: 'rpm_dsd', name: 'Ralentí que el PCM QUIERE', unit: 'rpm', min: 0, max: 2000, mode: '22', verified: true,
          note: 'DSDRPM, un byte × 16. Dio 864 rpm mientras el cuentavueltas marcaba 868. Este es EL dato para una caída de revoluciones: si el motor va por debajo de lo que este número pide, el PCM está PERDIENDO el ralentí; si los dos bajan juntos, es el PCM el que lo está bajando a propósito. Son dos averías distintas.',
          formula: ([A]) => A * 16 },
        { command: '221153', key: 'iac', name: 'Aire de ralentí mandado', unit: '%', min: 0, max: 100, mode: '22', verified: true,
          note: 'IAC. 24,5 % con todo apagado y 57,3 % con luces y aire: el PCM abriendo el paso de aire para sostener el ralentí con la carga encima. Si está alto con todo apagado, algo le está robando aire o par al motor.',
          formula: ([A, B]) => ((A * 256 + B) * 100) / 32768 },
        { command: '22116B', key: 'spark_fino', name: 'Avance de encendido · fino', unit: '°', min: -60, max: 60, mode: '22', verified: true,
          note: 'SPARKADV, con signo y escala /4 — el doble de resolución que el PID estándar. -1,25° al ralentí y +27,25° a 2500 rpm, contra los -0,5° y +26,5° del PID de un byte.',
          formula: ([A, B]) => sgn16(A, B) / 4 },
        { command: '221158', key: 'lambda', name: 'Mezcla · lambda', unit: '', min: 0, max: 2, mode: '22', verified: true,
          note: 'Escala /32768, o sea 32768 = 1,000 exacto. Al ralentí dio 1,0017: estequiométrico clavado, que es lo que se espera en lazo cerrado. 1,14 a 2500 rpm sin carga y 0,92 con el aire entrando. El gemelo del banco 2 está clavado en 0x6000 porque no hay banco 2.',
          formula: ([A, B]) => (A * 256 + B) / 32768 },
        { command: '221154', key: 'tp_v', name: 'Mariposa · señal del sensor', unit: 'V', min: 0, max: 5, mode: '22', verified: true,
          note: 'TP_V. 0,834 V al ralentí y 1,014 V a 2500 rpm. Comparado con el valor de mariposa cerrada que el PCM tiene aprendido (0,829 V), la diferencia es de cinco milivoltios.',
          formula: volt5 },
        { command: '221104', key: 'ac_clutch', name: 'Embrague del A/C', unit: '', min: 0, max: 1, mode: '22', verified: true,
          etiquetas: { 0: 'suelto', 1: 'PEGADO' },
          note: 'Valió 1 exactamente en las maniobras con el aire encendido y 0 en las de "todo apagado". Junto con 220906 y 221103 son tres identificadores que cuentan la misma historia por separado.',
          formula: ([A]) => (A ? 1 : 0) },
        { command: '221103', key: 'fan_bits', name: 'Ventilador y refrigeración · bits', unit: '', min: 0, max: 255, mode: '22', verified: true, defaultOff: true,
          etiquetas: { 0: 'todo parado', 4: 'ventilador EN MARCHA', 132: 'ventilador + rodando' },
          note: 'CORREGIDO el 18/09: no es un sí/no, es un byte de bits. Valió 0 con todo apagado, 4 con el aire encendido y 132 (0x84) rodando. El bit 2 es el ventilador —se enciende exactamente con el aire y no con las luces— y el bit 7 solo apareció con el carro en movimiento. Antes lo leía como "0 o distinto de 0" y esos dos estados se veían iguales.',
          formula: ([A]) => A },
        { command: '221139', key: 'ect_fino', name: 'Refrigerante · escala fina', unit: '°C', min: -20, max: 150, mode: '22', verified: true, defaultOff: true,
          note: 'ECT con la escala Ford (1,11 °C por cuenta en vez de 1 °C). Lee dos o tres grados por encima del PID estándar, esperable porque las dos lecturas van separadas unos veinticinco segundos y el motor seguía calentando.',
          formula: tempFord },
        { command: '221123', key: 'iat_fino', name: 'Aire de admisión · escala fina', unit: '°C', min: -20, max: 150, mode: '22', verified: true, defaultOff: true,
          note: 'IAT con la escala Ford. A 2500 rpm dio 83,3 °C contra los 84 del PID estándar.',
          formula: tempFord },
        { command: '22114D', key: 'ect_v', name: 'Refrigerante · señal del sensor', unit: 'V', min: 0, max: 5, mode: '22', verified: true, defaultOff: true,
          note: 'ECT_V. Bajó de 0,615 V a 0,454 V cuando el refrigerante subió de 87 a 97 °C: es un termistor NTC, a más calor menos voltaje. Sirve para pillar un sensor que miente, comparando la temperatura con su propio voltaje.',
          formula: volt5 },
        { command: '22114A', key: 'iat_v', name: 'Aire de admisión · señal del sensor', unit: 'V', min: 0, max: 5, mode: '22', verified: true, defaultOff: true,
          note: 'IAT_V. Mismo principio y mismo comportamiento: 1,20 V con el aire a 68 °C, y bajando según se calentaba.',
          formula: volt5 },
        { command: '221169', key: 'tp_cerrada', name: 'Mariposa cerrada · valor aprendido', unit: 'V', min: 0, max: 5, mode: '22', verified: true, defaultOff: true,
          note: 'TPCT. Constante en toda la prueba: 0,829 V. Es lo que el PCM tiene aprendido como "pedal suelto". Si se separa del valor real con el pedal suelto, el ralentí y las retenciones empiezan a portarse raro.',
          formula: volt5 },
        { command: '22115A', key: 'load_ford', name: 'Carga del motor · Ford', unit: '%', min: 0, max: 100, mode: '22', verified: true, defaultOff: true,
          note: 'LOAD. 25,2 % al ralentí, 15,3 % a 2500 rpm sin carga y 30,8 % con luces y aire. No da el mismo número que el PID 0104 —ese es la carga calculada normalizada— pero se mueve en el mismo sentido.',
          formula: ([A, B]) => ((A * 256 + B) * 100) / 32768 },
        { command: '221166', key: 'evap_purge', name: 'Purga del cánister', unit: '%', min: 0, max: 100, mode: '22', verified: true, defaultOff: true,
          note: 'EVAPCP, ciclo de trabajo de la electroválvula. CONFIRMADO el 17/09 en cuatro estados distintos: 100 % al ralentí caliente, 0 % subiendo de vueltas en punto muerto, 95 % rodando y 35 % en retención. Se mueve con todo, o sea que es un mando en vivo. Una purga pegada abierta mete vapores de gasolina sin control y es una causa clásica de ralentí inestable.',
          formula: ([A, B]) => ((A * 256 + B) * 100) / 32768 },
        { command: '221173', key: 'o2_b1s1_v', name: 'Sonda B1S1 · voltaje fino', unit: 'V', min: 0, max: 1.5, mode: '22', verified: true, defaultOff: true,
          note: 'O2S11_V, escala /1024. Se movió entre 0,31 y 0,88 V: la sonda está VIVA y oscilando, que es lo que tiene que hacer en lazo cerrado. Una sonda clavada en un valor es una sonda muerta.',
          formula: ([A, B]) => (A * 256 + B) / 1024 },
        { command: '2211B5', key: 'vel_rueda', name: 'Velocidad de la rueda', unit: 'rpm', min: 0, max: 2000, mode: '22', verified: true,
          note: 'CONFIRMADO rodando el 17/09, y resultó ser un dato de verdad y no un cero de caja automática. Dio 470 a 505 rpm mientras el carro iba a 54-61 km/h. Con un 205/65R15 (1,99 m de rodadura) esa velocidad son 452 a 511 vueltas por minuto de rueda: cuadra. En la Explorer este identificador es el eje de salida de la caja; aquí, sin caja automática, es el sensor de velocidad. Sirve para comparar con el velocímetro y para ver si el sensor patina.',
          formula: ([A, B]) => (A * 256 + B) / 4 },
        { command: '221165', key: 'rpm_fino', name: 'Revoluciones · copia', unit: 'rpm', min: 0, max: 7000, mode: '22', verified: true, defaultOff: true,
          note: 'La misma escala /4 del PID estándar y el mismo número (885 contra 882). No aporta nada sobre el 010C; está aquí porque confirma que la correspondencia de toda esta página es la correcta.',
          formula: ([A, B]) => (A * 256 + B) / 4 },
        { command: '221125', key: 'tp_modo', name: 'Mariposa · modo', unit: '', min: 0, max: 255, mode: '22', verified: true, defaultOff: true,
          etiquetas: { 0: 'abierta', 255: 'CERRADA (ralentí)' },
          note: 'TPMODE. Valió 255 en todas las maniobras de ralentí y 0 en la de 2500 rpm. Es el aviso de "el pedal está suelto" que usa el PCM para entrar en control de ralentí.',
          formula: ([A]) => A },
        { command: '221156', key: 'ltft_fino', name: 'Corrección larga · escala fina', unit: '%', min: -35, max: 35, mode: '22', verified: true,
          note: 'CONFIRMADO el 18/09, y la escala estaba a la mitad. Leyéndolo en la MISMA tanda que el PID estándar 0107, en siete condiciones, el número era exactamente el doble: crudo 00FE da -1,56 % y el PID decía -1,56; crudo 00F7 da -7,03 y el PID decía -7,03; crudo 00F9 da -5,47 y el PID decía -5,47. Cinco coincidencias exactas y dos dentro del rango de la misma tanda. La escala buena es /128, no /256. Esto es lo que valía leer las dos cosas a la vez en vez de con veinticinco segundos de diferencia.',
          formula: ([A, B]) => (((A * 256 + B) - 256) * 100) / 128 },
        { command: '2211C1', key: 'vss_ford', name: 'Velocidad · señal cruda', unit: 'mph', min: 0, max: 160, mode: '22', verified: true, defaultOff: true,
          note: 'CONFIRMADO rodando el 17/09: 34,7 a 37,1 mph mientras el PID estándar marcaba 54 a 61 km/h, que son 33,6 a 37,9 mph. La escala /512 del catálogo es la buena. Está apagado porque el PID estándar da lo mismo en km/h.',
          formula: ([A, B]) => (A * 256 + B) / 512 },
        { command: '221101', key: 'sw_bits', name: 'Interruptores · byte de estado', unit: '', min: 0, max: 255, mode: '22', verified: true, defaultOff: true,
          etiquetas: { 0: 'ralentí, nada pedido', 1: 'A/C pedido', 8: 'fuera de ralentí', 9: 'A/C y fuera de ralentí' },
          note: 'Dos bits confirmados el 17/09 con las condiciones separadas: el bit 0 se enciende SOLO con el aire (1 con el aire, 0 con las luces solas) y el bit 3 aparece al subir de vueltas (valió 8 en la subida a 3000 y osciló 1..9 rodando). El resto del byte no se movió en ninguna de las siete condiciones. No hay ningún bit de reversa aquí.',
          formula: ([A]) => A },
        { command: '221126', key: 'ast', name: 'Tiempo desde el arranque', unit: 's', min: 0, max: 255, mode: '22', verified: false, defaultOff: true,
          note: 'SIN CONFIRMAR. El catálogo lo da como tiempo desde el arranque y valió 255 fijo, que es lo que haría un contador de un byte saturado tras cuatro minutos de motor encendido. Se confirma arrancando en frío y mirándolo subir.',
          formula: ([A]) => A },
        estado('221106', 'sensores_f1', 'Sensores · estado (refrigerante, aire, mariposa)',
          'Byte de estado de sensores. Cero en toda la prueba: ninguno declarado en avería.'),
        estado('221107', 'sensores_f2', 'Sensores · estado (sonda, leva, tablas adaptativas)',
          'Byte de estado. Cero en toda la prueba.'),
      ],
    },

    // ══ CULATA, COMBUSTIBLE Y SONDA (página 16xx) ════════════════════════════
    {
      header: '7E0',
      rxHeader: '7E8',
      moduleName: 'Culata, combustible y sonda',
      color: '#B8860B',
      pids: [
        { command: '221624', key: 'cht', name: 'Culata (aquí es el refrigerante)', unit: '°C', min: -20, max: 150, mode: '22', verified: true, defaultOff: true,
          note: 'CORREGIDO el 18/09. En la Explorer este identificador es la temperatura de CULATA y va siempre unos grados por encima del refrigerante. Aquí NO: en las siete condiciones de la prueba de cierre dio exactamente el mismo número que 221139, el refrigerante, hasta el último decimal, y los dos siguieron al PID estándar 0105. Veintiuna lecturas idénticas no son una coincidencia: este motor no tiene sensor de culata propio y el PCM devuelve el del refrigerante. Por eso está apagado, y por eso los avisos de culata (221688, 221689) valen cero siempre. Yo lo había dado por bueno leyéndolo una sola vez, sin nada con que compararlo.',
          formula: ([A, B]) => ((A * 256 + B - 16) * 10) / 9 },
        { command: '2216BC', key: 'o2_b1s1_mv', name: 'Sonda B1S1', unit: 'mV', min: 0, max: 1200, mode: '22', verified: true,
          note: 'O2S11 en milivoltios. Se midió en 25, 170, 665, 675 y 810 mV: no son condiciones distintas, es la sonda oscilando entre rica y pobre varias veces por segundo. Esa oscilación ES la señal de que está sana.',
          formula: uint },
        { command: '2216C1', key: 'fuel_lvl', name: 'Nivel de combustible', unit: '%', min: 0, max: 100, mode: '22', verified: true,
          note: 'FLI, el mismo identificador Ford que la Explorer. Dio 55,7 % y se movió entre 55 y 61 % según la maniobra: no es el tanque vaciándose, es el flotador chapoteando. Por eso el tablero lo enseña con la mediana de las últimas lecturas.',
          formula: ([A, B]) => ((A * 256 + B) * 100) / 32768 },
        { command: '221672', key: 'fuel_pump', name: 'Bomba de combustible · mando', unit: '%', min: 0, max: 100, mode: '22', verified: true, defaultOff: true,
          note: 'FP. Clavado en 100 % en las cinco condiciones: aquí la bomba va a todo o nada. Lo que importaría es verlo caer.',
          formula: ([A, B]) => ((A * 256 + B) * 100) / 32768 },
        { command: '2216C3', key: 'octane', name: 'Octanaje aprendido', unit: '', min: 0, max: 255, mode: '22', verified: true, defaultOff: true,
          note: 'OCTANE. Valía 91, igual que la Explorer. Es lo que el PCM ha aprendido de la gasolina que le echas.',
          formula: ([A]) => A },
        { command: '221631', key: 'o2_htr_bits', name: 'Calefactores de sonda · mando', unit: '', min: 0, max: 15, mode: '22', verified: true, defaultOff: true,
          etiquetas: { 0: 'apagado', 1: 'el único, encendido' },
          note: 'HTR, un bit por sonda. Aquí vale 1 y en la Explorer 15: una sonda contra cuatro. Confirmación independiente de que este carro declara una sola.',
          formula: ([A]) => A },
        { command: '221605', key: 'o2_htr_reint', name: 'Calefactor de sonda · reintentos', unit: 'cnt', min: 0, max: 255, mode: '22', verified: true, defaultOff: true,
          note: 'HTRETMX11. Cero reintentos: el circuito del calefactor está sano. Si empieza a subir, el calefactor se está cortando y la sonda va a tardar en entrar en lazo cerrado.',
          formula: ([A]) => A },
        { command: '22160D', key: 'imrc', name: 'Admisión variable (IMRC)', unit: '', min: 0, max: 1, mode: '22', verified: true, defaultOff: true,
          etiquetas: { 0: 'cerrada', 1: 'ABIERTA' },
          note: 'IMRC. Valió 0 en las SIETE condiciones del 17/09, incluida una subida hasta 3174 rpm y rodando a 60 km/h. O abre más arriba de lo que se probó, o este motor no lleva el mecanismo y el identificador existe solo porque la estrategia lo contempla. En los Focus de esta familia es lo que se atasca y da los P2004-P2008. Se queda apagado: un cero eterno no informa de nada.',
          formula: ([A]) => (A ? 1 : 0) },
        { command: '221687', key: 'ftp_h2o', name: 'Presión del tanque', unit: 'inH2O', min: -30, max: 30, mode: '22', verified: true, defaultOff: true,
          note: 'FTP_H20, en pulgadas de columna de agua. Cero con el tapón puesto y el motor en marcha, que es lo correcto.',
          formula: ([A, B]) => sgn16(A, B) },
        estado('221688', 'cht_lamp', 'Testigo de temperatura de culata',
          'CHTIL. Apagado. Si se enciende, el PCM ha visto la culata por encima del límite y va a empezar a cortar cilindros para protegerla.'),
        estado('221689', 'cht_f', 'Sensor de culata · estado', 'CHT_F. Sin avería.'),
        estado('2216A9', 'fli_f', 'Sensor de nivel · estado',
          'FLI_F. Sin avería: el nivel de combustible que lee el PCM es de fiar.'),
        estado('2216D2', 'egr_mc', 'Mando del motor de EGR · estado', 'EGRMC1. Cero en toda la prueba.'),
        { command: '221602', key: 'ect_max', name: 'Refrigerante · máximo visto', unit: '', min: 0, max: 255, mode: '22', verified: true, defaultOff: true,
          note: 'ECT_MAXFF: el valor más alto que el filtro de averías ha visto en el sensor de refrigerante. Cero.',
          formula: ([A]) => A },
        { command: '221603', key: 'tp_max', name: 'Mariposa · máximo visto', unit: '', min: 0, max: 255, mode: '22', verified: true, defaultOff: true,
          note: 'TP_FF: lo mismo para la mariposa. Cero.', formula: ([A]) => A },
      ],
    },

    // ══ RALENTÍ, AIRE Y ESCAPE (página 09xx) ═════════════════════════════════
    {
      header: '7E0',
      rxHeader: '7E8',
      moduleName: 'Ralentí, aire y escape',
      color: '#C25A12',
      pids: [
        { command: '220974', key: 'o2_temp', name: 'Temperatura en la punta de la sonda', unit: '°C', min: 0, max: 1000, mode: '22', verified: true,
          note: 'O2S_TEMP, escala /8. La temperatura que el PCM CALCULA en la punta de la sonda, o sea la del escape. El 17/09, con el motor ya caliente: 455 °C al ralentí, 553 subiendo a 3000 rpm, 876 rodando a 60 km/h y 771 en retención. Sube con la carga y baja al levantar el pie, que es exactamente lo que hace un escape. Es la única ventana al escape que tiene este carro.',
          formula: ([A, B]) => (A * 256 + B) / 8 },
        { command: '220926', key: 'rev_sw', name: 'Interruptor de reversa', unit: '', min: 0, max: 1, mode: '22', verified: true,
          etiquetas: { 0: 'suelto', 1: 'ACTIVADO' },
          note: 'RESUELTO, y no por OBD: a este carro le QUITARON el interruptor de reversa de la caja y condenaron el circuito. Por eso el 17/09 valió 1 en las siete condiciones —punto muerto, reversa, rodando, todo— y por eso el PCM tiene guardado el P0812 "Reverse Input Circuit": está viendo una entrada que nunca cambia. El código no es una avería que perseguir, es el reflejo de una intervención hecha a propósito, y va a volver cada vez que se borre mientras el puente siga ahí. De paso, esto SÍ confirma que este identificador es el interruptor de reversa: es la única de las cuatro opciones del catálogo que encaja con lo que se le hizo al carro. El dato se queda encendido porque el día que se reponga el interruptor, este número tiene que empezar a cambiar: es la forma de comprobar que quedó bien.',
          formula: ([A]) => (A ? 1 : 0) },
        { command: '220900', key: 'map_v', name: 'Colector · señal del sensor', unit: 'V', min: 0, max: 5, mode: '22', verified: true,
          note: 'MAP_V, escala /1024. El voltaje crudo del sensor de colector: 1,96 V con 49 kPa, 1,01 V con 25 kPa, 2,14 V con 53 kPa. Cuadra con los cinco valores del PID estándar dentro de un kilopascal y tiene dieciséis veces más resolución, así que es donde se ve un colector que respira mal o un sensor que empieza a derivar.',
          formula: ([A, B]) => (A * 256 + B) / 1024 },
        { command: '220906', key: 'ac_allowed', name: 'Embrague del A/C · permiso', unit: '', min: 0, max: 255, mode: '22', verified: true,
          etiquetas: { 0: 'sin permiso', 128: 'PERMITIDO' },
          note: 'ACCLT_ALW. Valió 128 en las dos maniobras con el aire encendido y 0 en las dos de "todo apagado". OJO: en el primer informe leí esto como "el PCM corta el compresor al acelerar" y estaba MAL — lo que sigue es el interruptor del aire, no el acelerador. Lo delató la segunda corrida, donde también valía 0 con el motor al ralentí y todo apagado.',
          formula: ([A]) => A },
        iacKam('220976', 'iac_kam0', 'Ralentí aprendido · marcha, A/C off'),
        iacKam('220977', 'iac_kam1', 'Ralentí aprendido · marcha, A/C on'),
        iacKam('220978', 'iac_kam2', 'Ralentí aprendido · neutro, A/C on'),
        iacKam('220979', 'iac_kam3', 'Ralentí aprendido · neutro, A/C off'),
        { command: '22097A', key: 'iac_trim', name: 'Ralentí · corrección instantánea', unit: 'lb/min', min: -1, max: 1, mode: '22', verified: true,
          note: 'IACTRIM. Lo que el PCM está corrigiendo ahora mismo, antes de aprenderlo.',
          formula: ([A, B]) => sgn16(A, B) / 4096 },
        { command: '22097B', key: 'iac_mode', name: 'Ralentí · modo de control', unit: '', min: 0, max: 4, mode: '22', verified: true,
          note: 'IAC_MODE. Valía 1 al ralentí y pasó a 0 acelerando, igual que en la Explorer.',
          formula: ([A]) => A },
        { command: '220945', key: 'map_kpa', name: 'Colector · copia en kPa', unit: 'kPa', min: 0, max: 255, mode: '22', verified: true, defaultOff: true,
          note: 'MAP en kilopascales, un byte. Es el mismo dato que el PID 010B, así que está apagado: pedirlo dos veces gasta una pregunta por vuelta. Si algún día los dos dejan de coincidir, eso sí diría algo.',
          formula: ([A]) => A },
        { command: '220965', key: 'term_calef', name: 'Calefactor del termostato', unit: '', min: 0, max: 65535, mode: '22', verified: true, defaultOff: true,
          note: 'THTRC. Cero en toda la prueba.', formula: uint },
        { command: '22095E', key: 'tq_ctrl', name: 'Control de par solicitado', unit: '', min: 0, max: 255, mode: '22', verified: true, defaultOff: true,
          note: 'TQ_CNTRL. Cero: en un carro sin módulo de caja no hay quién pida reducción de par.',
          formula: ([A]) => A },
        estado('220959', 'sensores_f3', 'Sensores de régimen · estado',
          'Byte de estado de los sensores de vueltas. Cero en toda la prueba.'),
        { command: '22095D', key: 'monitores', name: 'Monitores completados', unit: '', min: 0, max: 65535, mode: '22', verified: true, defaultOff: true,
          note: 'Bits de qué monitores de emisiones ha terminado el PCM desde el último borrado. Valió 0x8012 y 0x8032. Es lo que decide si el carro pasa una revisión de emisiones.',
          formula: uint },
      ],
    },

    // ══ FALLOS DE ENCENDIDO ═════════════════════════════════════════════════
    // Lo más parecido a un Modo 06 que tiene este carro: el Modo 06 contesta
    // vacío, pero el PCM sí lleva la cuenta por dentro y la publica aquí.
    {
      header: '7E0',
      rxHeader: '7E8',
      moduleName: 'Fallos de encendido',
      color: '#8E44AD',
      pids: [
        { command: '221616', key: 'misfire_total', name: 'Fallos totales acumulados', unit: 'cnt', min: 0, max: 65535, mode: '22', verified: true,
          note: 'NM. Valía CERO. Este carro no publica el Modo 06 —no hay fallos por cilindro— pero sí este contador, así que se puede saber SI hay fallos aunque no en cuál cilindro.',
          formula: uint },
        { command: '221621', key: 'misfire_low', name: 'Fallos acumulados · palabra baja', unit: 'cnt', min: 0, max: 65535, mode: '22', verified: true, defaultOff: true,
          note: 'MISCNTL. Cero, igual que el contador de arriba.', formula: uint },
        { command: '221617', key: 'misfire_events', name: 'Eventos de la vuelta anterior', unit: 'cnt', min: 0, max: 65535, mode: '22', verified: true, defaultOff: true,
          note: 'TE. Cero.', formula: uint },
        { command: '221622', key: 'misfire_nmnc', name: 'Encendidos no evaluados', unit: 'cnt', min: 0, max: 65535, mode: '22', verified: true, defaultOff: true,
          note: 'NMNC. Cero: el PCM está evaluando todos los encendidos, no saltándose ninguno.', formula: uint },
        { command: '2216DD', key: 'mp_lrn', name: 'Perfil de la rueda dentada aprendido', unit: '', min: 0, max: 255, mode: '22', verified: true, defaultOff: true,
          etiquetas: { ...SI_NO },
          note: 'MP_LRN. Valía 1: aprendido. Importa porque si valiera 0, el contador de fallos sería mucho menos de fiar.',
          formula: ([A]) => (A ? 1 : 0) },
        { command: '2216DC', key: 'misfire_free_trips', name: 'Viajes sin fallos', unit: 'cnt', min: 0, max: 65535, mode: '22', verified: true, defaultOff: true, formula: uint },
        { command: '2216D3', key: 'mff_rpm', name: 'Fallo congelado · revoluciones', unit: 'rpm', min: 0, max: 8000, mode: '22', verified: true, defaultOff: true,
          note: 'Se llena si ocurre un fallo. Cero, coherente con que no hay congelado de datos.', formula: uint },
        { command: '2216D5', key: 'mff_vss', name: 'Fallo congelado · velocidad', unit: 'km/h', min: 0, max: 255, mode: '22', verified: true, defaultOff: true, formula: ([A]) => A },
        { command: '2216D6', key: 'mff_iat', name: 'Fallo congelado · temp. admisión', unit: '°C', min: -40, max: 120, mode: '22', verified: true, defaultOff: true, formula: ([A]) => A - 40 },
        { command: '2216D8', key: 'mff_run', name: 'Fallo congelado · tiempo de motor', unit: 's', min: 0, max: 65535, mode: '22', verified: true, defaultOff: true,
          note: 'MFF_RUN.', formula: uint },
        { command: '2216DA', key: 'mff_tp', name: 'Fallo congelado · mariposa', unit: '', min: 0, max: 65535, mode: '22', verified: true, defaultOff: true,
          note: 'MFF_TP.', formula: uint },
      ],
    },

    // ══ CONFIGURACIÓN ═══════════════════════════════════════════════════════
    {
      header: '7E0',
      rxHeader: '7E8',
      moduleName: 'Configuración',
      color: '#6C7A89',
      pids: [
        { command: '2216F0', key: 'tire_size', name: 'Tamaño de neumático', unit: 'rev/mi', min: 0, max: 2000, mode: '22', verified: true, defaultOff: true,
          note: 'TIRESIZE. Dio 797 vueltas por milla; un 205/65R15 da unas 805. Cuadra, y confirma de paso que la escala de la Explorer sirve en este PCM. Si algún día la velocidad del tablero deja de cuadrar con el GPS, se mira aquí.',
          formula: uint },
        { command: '2216EF', key: 'kam', name: 'Memoria permanente (KAM)', unit: '', min: 0, max: 255, mode: '22', verified: true, defaultOff: true,
          note: 'Si se pierde, el PCM olvida todo lo aprendido: las celdas de ralentí, las correcciones largas, el octanaje y la mariposa cerrada. Valía 128.',
          formula: ([A]) => A },
        { command: '22162E', key: 'flt_egr', name: 'Avería · regulador de EGR', unit: '', min: 0, max: 255, mode: '22', verified: true, defaultOff: true,
          etiquetas: { ...SI_NO }, note: 'Sin avería.', formula: ([A]) => (A ? 1 : 0) },
        { command: '22162F', key: 'flt_evap', name: 'Avería · purga del cánister', unit: '', min: 0, max: 255, mode: '22', verified: true, defaultOff: true,
          etiquetas: { ...SI_NO }, note: 'Sin avería.', formula: ([A]) => (A ? 1 : 0) },
        { command: '2216FC', key: 'bat_freeze', name: 'Voltaje en el congelado de datos', unit: 'V', min: 0, max: 25, mode: '22', verified: true, defaultOff: true,
          note: 'Cero: no hay congelado guardado, coherente con lo que devolvió el Modo 02.',
          formula: ([A, B]) => (A * 256 + B) / 1024 },
        { command: '220973', key: 'gear_max', name: 'Marcha más alta permitida', unit: '', min: 0, max: 10, mode: '22', verified: true, defaultOff: true,
          note: 'GEAR_MAX. Valía 8 y no se movió. En un carro sincrónico no significa nada, pero se deja porque contesta.',
          formula: ([A]) => A },
      ],
    },

  ],
};
