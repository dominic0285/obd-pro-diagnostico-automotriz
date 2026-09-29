import type { VehicleProfile, EnhancedPid } from './index';

/**
 * Ford Explorer 2010 4.6L V8 3V — PCM 7E0, TCM 7E1, ABS 760. HS-CAN 500k.
 *
 * ─── DE DÓNDE SALEN ESTOS NÚMEROS ──────────────────────────────────────────
 *
 * Los identificadores Modo 22 se descubrieron con barridos sobre el vehículo y
 * se contrastaron con documentación técnica. Como un mismo identificador puede
 * admitir varias escalas, la escala que quedó aquí es siempre la que
 * se pudo comprobar contra una lectura real de ESTA camioneta, y la mayoría se
 * comprobó dos veces, por caminos independientes:
 *
 *  - El eje de entrada (2211B4) da 720 rpm con el motor a 748 en P, y cae a 0
 *    exacto en R y en D con el freno pisado. Eso es la turbina calándose
 *    contra el convertidor: confirma el sensor Y la escala a la vez.
 *  - La presión del riel real (22168C, 273 kPa) y la deseada (221670, 276 kPa)
 *    salieron de páginas distintas, con escalas distintas del catálogo, y
 *    coinciden dentro del 1 %.
 *  - El voltaje deseado del alternador (22097C, 13,94 V) coincide con el
 *    voltaje medido (221172, 14,0 V).
 *  - El nivel de combustible por Modo 22 (2216C1) coincidió con el PID
 *    estándar 012F en el mismo instante.
 *  - El estado del combustible (22163C = 2) coincide con el Modo 02 del
 *    congelado de datos.
 *  - La presión de freno (222915) pasó de 17 kPa con el pedal suelto a
 *    4149 kPa con el pedal a fondo.
 *  - La presión del A/C (221686) pasó de 786 kPa apagado a 2013 kPa
 *    encendido, que son los 114 y 292 psi que corresponden al R134a.
 *
 * Lo que sigue marcado verified:false es lo que NO se pudo cerrar así.
 * Arranca apagado y lleva escrito qué haría falta para decidirlo.
 *
 * Mediciones: 11, 12 y 13 de septiembre de 2026.
 */

/** Dos bytes con signo (complemento a dos de 16 bits). */
const sgn16 = (A: number, B: number) => {
  const v = A * 256 + B;
  return v > 32767 ? v - 65536 : v;
};

/** Entero sin signo de la longitud que venga, hasta 4 bytes. */
const u32 = (b: number[]) => b.reduce((a, x) => a * 256 + x, 0);

/**
 * Entero sin signo tolerante a la longitud: algunos identificadores de este
 * PCM devuelven un byte donde el catálogo supone dos. Con esto no sale NaN.
 */
const uint = (b: number[]) => (b.length >= 2 ? b[0] * 256 + b[1] : b[0] ?? NaN);

/** Un bit concreto de una respuesta de hasta 4 bytes, como 0 o 1. */
const bit = (n: number) => (b: number[]) => (u32(b) >> n) & 1;

const SI_NO = { 0: 'no', 1: 'SÍ' };

/**
 * Las cuatro sondas de oxígeno, en milivoltios y con signo.
 * La trasera del banco 1 es la del código P2270: el 13/09 marcó -65 mV al
 * ralentí y -15 mV a 1828 rpm, mientras las otras tres oscilaban.
 */
const sondaMv = (cmd: string, key: string, name: string, nota: string): EnhancedPid => ({
  command: cmd, key, name, unit: 'mV', min: -200, max: 1100, mode: '22', verified: true,
  note: nota, formula: ([A, B]) => sgn16(A, B),
});

/** Las mismas cuatro sondas por la otra página, en voltios (escala /1024). */
const sondaV = (cmd: string, key: string, name: string, nota: string): EnhancedPid => ({
  command: cmd, key, name, unit: 'V', min: 0, max: 1.2, mode: '22', verified: true,
  note: nota, formula: ([A, B]) => (A * 256 + B) / 1024,
});

/**
 * Corriente del calefactor de cada sonda. Escala /256 amperios.
 * El 13/09: 0,574 · 1,102 · 0,598 · 1,027 A. Las cuatro consumen, incluida la
 * del código: su calefactor está sano y lo que está muerto es el elemento.
 */
const calefactor = (cmd: string, key: string, name: string): EnhancedPid => ({
  command: cmd, key, name, unit: 'A', min: 0, max: 2.5, mode: '22', verified: true,
  note: 'HTRCM. Confirmado el 13/09. Si una baja a 0 mientras las otras consumen, ese calefactor está cortado.',
  formula: ([A, B]) => (A * 256 + B) / 256,
});

/** Celda aprendida de aire en ralentí (KAM). Escala /4096 lb/min, con signo. */
// Encendidos por defecto desde la 3.3: son cuatro números que cuentan de un
// vistazo si el motor está sosteniendo el ralentí con una fuga de aire, y en la
// EcoSport además son la prueba de que la correspondencia es la correcta (en un
// carro sincrónico las dos celdas de "en marcha" se quedan en cero).
const iacKam = (cmd: string, key: string, name: string): EnhancedPid => ({
  command: cmd, key, name, unit: 'lb/min', min: -2, max: 2, mode: '22', verified: true,
  note: 'IACKAM. Lo que el PCM tuvo que aprender para sostener el ralentí. El 13/09 las cuatro estaban casi en cero: el ralentí no está compensando ninguna fuga de aire.',
  formula: ([A, B]) => sgn16(A, B) / 4096,
});

export const FORD_EXPLORER_2010_PROFILE: VehicleProfile = {
  id: 'ford_explorer_2010',
  make: 'Ford',
  model: 'Explorer',
  year: '2010',
  engine: '4.6L V8 3V · 6 vel. (6R60/6R80)',
  description: 'PCM (7E0), TCM (7E1) y ABS (760) por Modo 22 UDS en HS-CAN 500k, más OBD2 estándar y Modo 06. Sondas de oxígeno, riel de combustible, VCT, transmisión y frenos.',
  hasEnhanced: true,
  preferredProtocol: '6',
  modules: [
    { id: 'pcm', name: 'PCM · Motor',                 header: '7E0', rxHeader: '7E8', codeTypes: 'P / U', bus: 'hs', color: '#2C74D6' },
    { id: 'tcm', name: 'TCM · Transmisión',           header: '7E1', rxHeader: '7E9', codeTypes: 'P / U', bus: 'hs', color: '#7A6BD0' },
    { id: 'abs', name: 'ABS · Frenos / AdvanceTrac',  header: '760', rxHeader: '768', codeTypes: 'C / U', bus: 'hs', color: '#C25A12' },
    { id: 'apim', name: 'APIM · SYNC',                header: '7D0', rxHeader: '7D8', codeTypes: 'B / U', bus: 'hs', color: '#B54A5A',
      note: 'Contesta por UDS y sin códigos. No es el ABS: esa dirección es la del módulo de SYNC.' },
    { id: 'rcm', name: 'RCM · Airbags',               header: '737', rxHeader: '73F', codeTypes: 'B / U', bus: 'hs', color: '#D81F14' },
    { id: 'ipc', name: 'IPC · Tablero',               header: '720', rxHeader: '728', codeTypes: 'B / U', bus: 'hs', color: '#E8930C' },
    { id: 'sjb', name: 'SJB/GEM · Caja de fusibles',  header: '726', rxHeader: '72E', codeTypes: 'B / U', bus: 'ms', color: '#2FA84F',
      note: 'Vive en el bus lento (MS-CAN). Con un adaptador estándar no contesta nunca, y eso no es una avería.' },
    { id: '4x4', name: '4WD · Caja de transferencia', header: '761', rxHeader: '769', codeTypes: 'C / U', bus: 'hs', color: '#6E6E78',
      note: 'Esta camioneta es 4x2: ese módulo no existe.' },
  ],
  moduleGroups: [
    // ══ CILINDROS ════════════════════════════════════════════════════════════
    {
      header: '',
      moduleName: 'Cilindros · Modo 06 (monitores del PCM)',
      color: '#2FA84F',
      pids: [
        ...Array.from({ length: 8 }, (_, i) => ({
          command: `06A${(i + 2).toString(16).toUpperCase()}`,
          key: `cyl${i + 1}_m06`,
          name: `Cilindro ${i + 1} · fallos`,
          unit: 'cnt', min: 0, max: 200,
          mode: '06' as const, tid: 0x0C,
          isCylinderData: true, cylinder: i + 1,
          verified: true,
          note: 'El Modo 06 se autodescribe: el PCM publica que tiene los monitores A2 a A9, uno por cilindro. Confirmado los días 11, 12 y 13.',
          formula: ([A, B]: number[]) => (A * 256) + B,
        })),
        { command: '06A1', key: 'misfire_general', name: 'Monitor general de fallos', unit: 'cnt', min: 0, max: 500,
          mode: '06', tid: 0x80, verified: true, formula: ([A, B]) => (A * 256) + B },
      ],
    },

    // ══ OBD2 ESTÁNDAR ════════════════════════════════════════════════════════
    {
      header: '',
      moduleName: 'Motor · OBD2 estándar (7DF)',
      color: '#2C74D6',
      pids: [
        { command: '010C', key: '010C', name: 'RPM',                 unit: 'rpm',  min: 0,   max: 7000, mode: '01', verified: true, formula: ([A, B]) => ((A * 256) + B) / 4 },
        { command: '010D', key: '010D', name: 'Velocidad',           unit: 'km/h', min: 0,   max: 200,  mode: '01', verified: true, formula: ([A]) => A },
        { command: '0105', key: '0105', name: 'Temp. refrigerante',  unit: '°C',   min: -40, max: 130,  mode: '01', verified: true, formula: ([A]) => A - 40 },
        { command: '0104', key: '0104', name: 'Carga del motor',     unit: '%',    min: 0,   max: 100,  mode: '01', verified: true, formula: ([A]) => (A * 100) / 255 },
        { command: '0111', key: '0111', name: 'Acelerador',          unit: '%',    min: 0,   max: 100,  mode: '01', verified: true, formula: ([A]) => (A * 100) / 255 },
        { command: '010F', key: '010F', name: 'Temp. aire admisión', unit: '°C',   min: -40, max: 120,  mode: '01', verified: true, formula: ([A]) => A - 40 },
        { command: '0110', key: '0110', name: 'Flujo MAF',           unit: 'g/s',  min: 0,   max: 200,  mode: '01', verified: true, formula: ([A, B]) => ((A * 256) + B) / 100 },
        { command: '010E', key: '010E', name: 'Avance encendido',    unit: '°',    min: -64, max: 64,   mode: '01', verified: true, formula: ([A]) => A / 2 - 64 },
        { command: '0106', key: 'stft_b1', name: 'STFT Banco 1',     unit: '%',    min: -25, max: 25,   mode: '01', verified: true, formula: ([A]) => (A - 128) * 100 / 128 },
        { command: '0107', key: 'ltft_b1', name: 'LTFT Banco 1',     unit: '%',    min: -25, max: 25,   mode: '01', verified: true, formula: ([A]) => (A - 128) * 100 / 128 },
        { command: '0108', key: 'stft_b2', name: 'STFT Banco 2',     unit: '%',    min: -25, max: 25,   mode: '01', verified: true, formula: ([A]) => (A - 128) * 100 / 128 },
        { command: '0109', key: 'ltft_b2', name: 'LTFT Banco 2',     unit: '%',    min: -25, max: 25,   mode: '01', verified: true, formula: ([A]) => (A - 128) * 100 / 128 },
        { command: '0142', key: '0142', name: 'Voltaje módulo',      unit: 'V',    min: 0,   max: 18,   mode: '01', verified: true, formula: ([A, B]) => ((A * 256) + B) / 1000 },
        { command: '015C', key: '015C', name: 'Temp. aceite',        unit: '°C',   min: -40, max: 150,  mode: '01', verified: true, formula: ([A]) => A - 40 },
        { command: '012F', key: '012F', name: 'Nivel combustible',   unit: '%',    min: 0,   max: 100,  mode: '01', verified: true, formula: ([A]) => (A * 100) / 255 },
        { command: '0133', key: '0133', name: 'Presión barométrica', unit: 'kPa',  min: 0,   max: 130,  mode: '01', verified: true, formula: ([A]) => A },
        { command: '0103', key: '0103', name: 'Estado del combustible', unit: '',  min: 0,   max: 16,   mode: '01', verified: true,
          etiquetas: { 1: 'lazo abierto · motor frío', 2: 'lazo cerrado', 4: 'lazo abierto · carga o retención', 8: 'lazo abierto · avería', 16: 'lazo cerrado con sonda averiada' },
          formula: ([A]) => A },
        { command: '011F', key: '011F', name: 'Tiempo desde el arranque', unit: 's', min: 0, max: 65535, mode: '01', verified: true, defaultOff: true, formula: ([A, B]) => (A * 256) + B },
        { command: '0121', key: '0121', name: 'Distancia con el testigo', unit: 'km', min: 0, max: 65535, mode: '01', verified: true, defaultOff: true, formula: ([A, B]) => (A * 256) + B },
        { command: '0131', key: '0131', name: 'Distancia desde el borrado', unit: 'km', min: 0, max: 65535, mode: '01', verified: true, defaultOff: true, formula: ([A, B]) => (A * 256) + B },
        { command: '0130', key: '0130', name: 'Calentamientos desde el borrado', unit: '', min: 0, max: 255, mode: '01', verified: true, defaultOff: true, formula: ([A]) => A },
      ],
    },

    // ══ SONDAS DE OXÍGENO ════════════════════════════════════════════════════
    {
      header: '7E0',
      rxHeader: '7E8',
      moduleName: 'Sondas de oxígeno · las cuatro',
      color: '#E8930C',
      pids: [
        sondaV('221173', 'o2_b1s1_v', 'Banco 1 · delantera', 'O2S11. El 13/09 marcó 0,733 V oscilando. Es la que decide la mezcla del banco 1.'),
        sondaV('221174', 'o2_b1s2_v', 'Banco 1 · TRASERA (P2270)', 'O2S12. El 13/09 marcó 0,000 V clavado. Esta es la sonda del código P2270 y está muerta: su calefactor consume 1,10 A pero el elemento no genera señal.'),
        sondaV('221175', 'o2_b2s1_v', 'Banco 2 · delantera', 'O2S21. El 13/09 marcó 0,650 V oscilando.'),
        sondaV('221176', 'o2_b2s2_v', 'Banco 2 · trasera', 'Este identificador no aparece en el catálogo, pero va justo detrás de los otros tres y el 13/09 marcó 0,748 V, que es lo que hace una sonda trasera sana. Muy probable, no confirmado.'),
        sondaMv('2216BC', 'o2_b1s1_mv', 'Banco 1 · delantera (mV)', 'La misma sonda por la otra página, en milivoltios. 651 mV al ralentí y 576 mV a 1828 rpm el 13/09.'),
        sondaMv('221699', 'o2_b1s2_mv', 'Banco 1 · TRASERA (mV)', 'La sonda del P2270. -65 mV al ralentí y -15 mV a 1828 rpm: no se mueve. Dos páginas distintas dicen lo mismo.'),
        sondaMv('2216BD', 'o2_b2s1_mv', 'Banco 2 · delantera (mV)', '61 mV y 638 mV en dos instantes: oscila como debe.'),
        sondaMv('22169A', 'o2_b2s2_mv', 'Banco 2 · trasera (mV)', '838 mV y 373 mV en dos instantes. Una trasera con el catalizador sano debería quedarse más quieta; conviene mirarla con el motor caliente y estable.'),
        calefactor('221679', 'o2_htr_b1s1', 'Calefactor B1 delantera'),
        calefactor('22167A', 'o2_htr_b1s2', 'Calefactor B1 trasera'),
        calefactor('22167B', 'o2_htr_b2s1', 'Calefactor B2 delantera'),
        calefactor('22167C', 'o2_htr_b2s2', 'Calefactor B2 trasera'),
        { command: '221631', key: 'o2_htr_bits', name: 'Calefactores · mando', unit: '', min: 0, max: 15, mode: '22', verified: true,
          etiquetas: { 0: 'los cuatro apagados', 15: 'los cuatro encendidos' },
          note: 'HTR. Cuatro bits, uno por sonda. El 13/09 valía 15 y las cuatro corrientes lo confirmaban.',
          formula: ([A]) => A },
        { command: '22163E', key: 'ro2ft_b1', name: 'Corrección por sonda trasera B1', unit: '%', min: -10, max: 10, mode: '22', verified: true,
          note: 'RO2FT1. El 13/09 valía 0,00 % exacto: el PCM desactivó esta corrección porque la sonda trasera del banco 1 no le da señal.',
          formula: ([A, B]) => (sgn16(A, B) * 100) / 8192 },
        { command: '22163F', key: 'ro2ft_b2', name: 'Corrección por sonda trasera B2', unit: '%', min: -10, max: 10, mode: '22', verified: true,
          note: 'RO2FT2. El 13/09 valía -0,15 %: el banco 2 sí está corrigiendo. Comparar los dos bancos es la forma rápida de ver si una trasera dejó de trabajar.',
          formula: ([A, B]) => (sgn16(A, B) * 100) / 8192 },
      ],
    },

    // ══ COMBUSTIBLE ══════════════════════════════════════════════════════════
    {
      header: '7E0',
      rxHeader: '7E8',
      moduleName: 'Combustible · riel, bomba y tanque',
      color: '#C2456E',
      pids: [
        { command: '22168C', key: 'frp', name: 'Presión del riel · real', unit: 'kPa', min: 0, max: 700, mode: '22', verified: true,
          note: 'FRP. El 13/09 dio 273 kPa (39,6 psi) y la deseada 276 kPa. Coinciden dentro del 1 %, y eso confirma las dos escalas de golpe.',
          formula: ([A, B]) => ((A * 256 + B) * 6895) / 128000 },
        { command: '221670', key: 'frp_dsd', name: 'Presión del riel · deseada', unit: 'kPa', min: 0, max: 700, mode: '22', verified: true,
          note: 'FRP_DSD. Lo que el PCM le pide a la bomba. Si la real se separa de esta y no vuelve, ahí está el problema de presión.',
          formula: ([A, B]) => ((A * 256 + B) * 6895) / 128000 },
        { command: '22168B', key: 'frp_v', name: 'Riel · señal del sensor', unit: 'V', min: 0, max: 5, mode: '22', verified: true,
          note: 'FRP_V. El voltaje crudo del sensor, antes de convertirlo a presión. El 13/09 dio 2,78 V. Con un sensor averiado (P0182 / P0193) este número se va a un extremo mientras la presión calculada se vuelve mentira.',
          formula: ([A, B]) => ((A * 256 + B) * 10) / 130944 },
        { command: '221672', key: 'fuel_pump', name: 'Bomba de combustible · mando', unit: '%', min: 0, max: 100, mode: '22', verified: true,
          note: 'FP. El 13/09 dio 21,1 % al ralentí. Si el PCM cree que sobra presión, baja este número; si lo baja a cero, el motor se apaga.',
          formula: ([A, B]) => ((A * 256 + B) * 100) / 32768 },
        { command: '221639', key: 'ftp_v', name: 'Presión del tanque · señal', unit: 'V', min: 0, max: 5, mode: '22', verified: true,
          note: 'FTP_V. Sensor de presión del tanque, el que usa el monitor de evaporativos. El 13/09 dio 1,43 V.',
          formula: ([A, B]) => ((A * 256 + B) * 10) / 130944 },
        { command: '2216C1', key: 'fuel_lvl', name: 'Nivel de combustible', unit: '%', min: 0, max: 100, mode: '22', verified: true,
          note: 'FLI. Confirmado contra el PID estándar 012F en el mismo instante: 66,9 % contra 66,67 %.',
          formula: ([A, B]) => ((A * 256 + B) * 100) / 32768 },
        { command: '22163C', key: 'fuelsys', name: 'Estado del sistema de combustible', unit: '', min: 0, max: 16, mode: '22', verified: true,
          etiquetas: { 1: 'lazo abierto · motor frío', 2: 'lazo cerrado', 4: 'lazo abierto · carga o retención', 8: 'lazo abierto · avería', 16: 'lazo cerrado con sonda averiada' },
          note: 'FUELSYS. El 13/09 valía 2 y el congelado de datos del Modo 02 decía lo mismo.',
          formula: ([A]) => A },
        { command: '220975', key: 'evap_sta', name: 'Monitor de evaporativos', unit: '', min: 0, max: 255, mode: '22', verified: true, defaultOff: true,
          note: 'EVAPSTA. El 13/09 valía 255.', formula: ([A]) => A },
        { command: '2216C3', key: 'octane', name: 'Octanaje aprendido', unit: '', min: 0, max: 255, mode: '22', verified: true, defaultOff: true,
          note: 'OCTANE. El 11/09 marcó 91.', formula: ([A]) => A },
      ],
    },

    // ══ AIRE, LEVAS Y ENCENDIDO ══════════════════════════════════════════════
    {
      header: '7E0',
      rxHeader: '7E8',
      moduleName: 'Aire, árboles de levas y encendido',
      color: '#2FA84F',
      pids: [
        { command: '221671', key: 'maf22', name: 'Flujo de aire (MAF)', unit: 'g/s', min: 0, max: 200, mode: '22', verified: true,
          note: 'MAF. El 13/09: 5,61 g/s al ralentí y 6,13 g/s a 1828 rpm. Coherente con el PID estándar 0110.',
          formula: ([A, B]) => (A * 256 + B) / 100 },
        { command: '221633', key: 'maf_v', name: 'MAF · señal del sensor', unit: 'V', min: 0, max: 5, mode: '22', verified: true,
          note: 'MAF_V. El voltaje crudo del medidor. El 13/09 dio 0,87-0,91 V al ralentí.',
          formula: ([A, B]) => ((A * 256 + B) * 5) / 65536 },
        { command: '22163B', key: 'gear_ratio', name: 'Relación medida', unit: ':1', min: 0, max: 10, mode: '22', verified: true,
          note: 'TRAN_RAT, escala /16384. CORREGIDO: vive en el PCM, no en el TCM — respondió en el barrido de la página 1600-163F con cabecera 7E0. Solo significa algo con el carro rodando: es la relación real entre los dos ejes, y comparada con la marcha que la caja ordena delata el patinaje.',
          formula: ([A, B]) => (A * 256 + B) / 16384 },
        { command: '221624', key: 'cht', name: 'Temp. de culata', unit: '°C', min: -20, max: 150, mode: '22', verified: true,
          note: 'CHT. El 13/09 dio 93,3 °C con el refrigerante en 88: la culata va siempre un poco por encima. Este es el sensor con el que el PCM protege el motor si se pierde refrigerante. CORREGIDO el 16/09: la respuesta trae DOS bytes y la fórmula leía solo el primero, así que en la grabación del 15/09 marcó -17,8 °C fijos (0x0064 = 100 leído como 0x00 = 0). Con los dos bytes ese mismo 100 vuelve a dar 93,3 °C.',
          formula: ([A, B]) => ((A * 256 + B - 16) * 10) / 9 },
        { command: '221685', key: 'cht_v', name: 'Culata · señal del sensor', unit: 'V', min: 0, max: 5, mode: '22', verified: true, defaultOff: true,
          note: 'CHT_V. El voltaje crudo del mismo sensor.',
          formula: ([A, B]) => ((A * 256 + B) * 5) / 65535 },
        { command: '2216CD', key: 'vct_adv_b1', name: 'VCT · avance de leva B1', unit: '°', min: -50, max: 62, mode: '22', verified: true,
          note: 'VCTADV. Escala /16, decidida el 13/09: a 1828 rpm dio 20,9° y el banco 2 dio 21,7°. La otra escala del catálogo habría dado 335°, imposible.',
          formula: ([A, B]) => sgn16(A, B) / 16 },
        { command: '2216CE', key: 'vct_err_b1', name: 'VCT · error de avance B1', unit: '°', min: -50, max: 50, mode: '22', verified: true,
          note: 'VCTADVERR. El 13/09 dio 0,00°: la leva está justo donde el PCM la pide. Si se queda lejos de cero de forma sostenida, es cadena o variador.',
          formula: ([A, B]) => sgn16(A, B) / 16 },
        { command: '2216CF', key: 'vct_dc_b1', name: 'VCT · solenoide B1', unit: '%', min: 0, max: 100, mode: '22', verified: true,
          note: 'VCTDC. El 13/09 dio 43,9 %.',
          formula: ([A, B]) => ((A * 256 + B) * 100) / 32768 },
        { command: '22091C', key: 'vct_adv_b2', name: 'VCT · avance de leva B2', unit: '°', min: -50, max: 62, mode: '22', verified: true,
          note: 'VCTADV2. Misma escala. Los dos bancos deben ir juntos: el 13/09 se llevaban 0,75°.',
          formula: ([A, B]) => sgn16(A, B) / 16 },
        { command: '22091D', key: 'vct_err_b2', name: 'VCT · error de avance B2', unit: '°', min: -50, max: 50, mode: '22', verified: true,
          note: 'VCTADVERR2. El 13/09 dio -0,19°.',
          formula: ([A, B]) => sgn16(A, B) / 16 },
        { command: '22091E', key: 'vct_dc_b2', name: 'VCT · solenoide B2', unit: '%', min: 0, max: 100, mode: '22', verified: true, defaultOff: true,
          formula: ([A, B]) => ((A * 256 + B) * 100) / 32768 },
        { command: '2216E6', key: 'knock1', name: 'Detonación · sensor 1', unit: '', min: 0, max: 65535, mode: '22', verified: true,
          note: 'KNOCK_1. Cuentas crudas: lo que importa es compararlo con el del otro banco. El 13/09: 94 contra 113.',
          formula: uint },
        { command: '2216E7', key: 'knock2', name: 'Detonación · sensor 2', unit: '', min: 0, max: 65535, mode: '22', verified: true,
          note: 'KNOCK_2.', formula: uint },
        ...Array.from({ length: 8 }, (_, i) => ({
          command: `2209E${(6 + i).toString(16).toUpperCase()}`,
          key: `spark_dur_${i + 1}`,
          name: `Cil ${i + 1} · duración de chispa`,
          unit: 'ms', min: 0, max: 4,
          mode: '22' as const,
          isCylinderData: true, cylinder: i + 1,
          verified: true,
          note: `SPKDUR_${i + 1}. Confirmado el 12/09: los ocho entre 1,6 y 2,1 ms al ralentí. Lo que vale es la comparación entre los ocho, no el número suelto.`,
          formula: ([A]: number[]) => (A * 1000) / 32000,
        })),
      ],
    },

    // ══ ACELERADOR ═══════════════════════════════════════════════════════════
    {
      header: '7E0',
      rxHeader: '7E8',
      moduleName: 'Acelerador electrónico',
      color: '#2C74D6',
      pids: [
        { command: '22091A', key: 'etc_dsd', name: 'Mariposa · pedida', unit: 'V', min: 0, max: 5, mode: '22', verified: true,
          note: 'ETC_DSD. Va en pareja con la real: si se separan, el cuerpo de aceleración no obedece.',
          formula: ([A, B]) => (A * 256 + B) / 1000 },
        { command: '22093C', key: 'etc_act', name: 'Mariposa · real', unit: 'V', min: 0, max: 5, mode: '22', verified: true,
          note: 'ETC_ACT. El 11/09 marcó 3,56 contra 3,44 pedidos, que es normal.',
          formula: ([A, B]) => (A * 256 + B) / 1000 },
        { command: '220917', key: 'tp1', name: 'Mariposa · sensor 1', unit: 'V', min: 0, max: 5, mode: '22', verified: true, defaultOff: true, formula: ([A, B]) => (A * 256 + B) / 1000 },
        { command: '220918', key: 'tp2', name: 'Mariposa · sensor 2', unit: 'V', min: 0, max: 5, mode: '22', verified: true, defaultOff: true, formula: ([A, B]) => (A * 256 + B) / 1000 },
        { command: '220914', key: 'app1', name: 'Pedal · sensor 1', unit: 'V', min: 0, max: 5, mode: '22', verified: true,
          note: 'APP1. Los tres sensores del pedal tienen que moverse juntos al pisar.',
          formula: ([A, B]) => (A * 256 + B) / 1000 },
        { command: '220915', key: 'app2', name: 'Pedal · sensor 2', unit: 'V', min: 0, max: 5, mode: '22', verified: true, formula: ([A, B]) => (A * 256 + B) / 1000 },
        { command: '220916', key: 'app3', name: 'Pedal · sensor 3', unit: 'V', min: 0, max: 5, mode: '22', verified: true, formula: ([A, B]) => (A * 256 + B) / 1000 },
        { command: '220927', key: 'app_fault', name: 'Avería · sensor del pedal', unit: '', min: 0, max: 255, mode: '22', verified: true, defaultOff: true, formula: ([A]) => A },
      ],
    },

    // ══ CARGA, CLIMA Y RALENTÍ ═══════════════════════════════════════════════
    {
      header: '7E0',
      rxHeader: '7E8',
      moduleName: 'Carga eléctrica, clima y ralentí',
      color: '#C25A12',
      pids: [
        { command: '221172', key: 'vbatt_pcm', name: 'Voltaje que ve el PCM', unit: 'V', min: 0, max: 18, mode: '22', verified: true,
          note: 'VPWR, escala /16. El 13/09 dio 14,0 V exactos, iguales a los del adaptador.',
          formula: ([A]) => A / 16 },
        { command: '22097C', key: 'gen_v_dsd', name: 'Alternador · voltaje deseado', unit: 'V', min: 10, max: 16, mode: '22', verified: true,
          note: 'GENVDSD. El 13/09 pedía 13,94 V y el sistema estaba en 14,0. Comparar estos dos es la forma directa de ver si el regulador cumple.',
          formula: ([A, B]) => (A * 256 + B) / 2048 },
        { command: '2216E8', key: 'gen_cmd', name: 'Alternador · comando', unit: '%', min: 0, max: 100, mode: '22', verified: true,
          note: 'GENCMD. El 13/09 dio 0 % incluso con las luces altas y el aire encendidos, que es raro y conviene volver a mirar con la batería más baja.',
          formula: ([A, B]) => ((A * 256 + B) * 100) / 32768 },
        { command: '220939', key: 'gen_mon', name: 'Alternador · excitación', unit: '%', min: 0, max: 100, mode: '22', verified: false, defaultOff: true,
          note: 'GEN_MON. PENDIENTE: solo se leyó CON carga (crudo 0x2B). El catálogo da tres escalas —0,34 · 16,8 % · 33,6 %— y hace falta una lectura SIN luces ni aire para elegir. La prueba automática la hace.',
          formula: ([A]) => (A * 78125) / 100000 },
        { command: '221686', key: 'ac_press', name: 'Presión del A/C', unit: 'kPa', min: 0, max: 3500, mode: '22', verified: true,
          note: 'ACP. El 13/09: 786 kPa (114 psi) con el aire apagado y 2013 kPa (292 psi) encendido. Esos son los valores de un R134a en reposo y comprimiendo.',
          formula: ([A]) => (A * 6895) / 500 },
        { command: '221638', key: 'ac_press_v', name: 'A/C · señal del sensor', unit: 'V', min: 0, max: 5, mode: '22', verified: true, defaultOff: true,
          note: 'ACP_V. El voltaje crudo del mismo sensor: 2,96 V el 13/09.',
          formula: ([A, B]) => ((A * 256 + B) * 10) / 130944 },
        { command: '2216AA', key: 'fan_duty', name: 'Ventilador variable', unit: '%', min: 0, max: 100, mode: '22', verified: true,
          note: 'FANDC. El 13/09 pasó de 0 % a 19,4 % al encender el aire. En este clima, un ventilador que no entra es una avería cara que no avisa.',
          formula: ([A]) => (A * 100) / 31 },
        { command: '220906', key: 'ac_allowed', name: 'Embrague del A/C permitido', unit: '', min: 0, max: 255, mode: '22', verified: true, defaultOff: true, formula: ([A]) => A },
        iacKam('220976', 'iac_kam0', 'Ralentí aprendido · marcha, A/C off'),
        iacKam('220977', 'iac_kam1', 'Ralentí aprendido · marcha, A/C on'),
        iacKam('220978', 'iac_kam2', 'Ralentí aprendido · neutro, A/C on'),
        iacKam('220979', 'iac_kam3', 'Ralentí aprendido · neutro, A/C off'),
        { command: '22097A', key: 'iac_trim', name: 'Ralentí · corrección instantánea', unit: 'lb/min', min: -1, max: 1, mode: '22', verified: true,
          note: 'IACTRIM. Lo que el PCM está corrigiendo ahora mismo, antes de aprenderlo.',
          formula: ([A, B]) => sgn16(A, B) / 4096 },
        { command: '22097B', key: 'iac_mode', name: 'Ralentí · modo de control', unit: '', min: 0, max: 4, mode: '22', verified: true,
          note: 'IAC_MODE. El 13/09 valía 1.', formula: ([A]) => A },
      ],
    },

    // ══ FALLOS DE ENCENDIDO Y CONTEXTO ═══════════════════════════════════════
    {
      header: '7E0',
      rxHeader: '7E8',
      moduleName: 'Fallos de encendido · contadores y contexto',
      color: '#7E9E2C',
      pids: [
        { command: '221616', key: 'misfire_total', name: 'Fallos totales acumulados', unit: 'cnt', min: 0, max: 65535, mode: '22', verified: true,
          note: 'NM · Total Number of Misfires.', formula: uint },
        { command: '221617', key: 'misfire_events', name: 'Eventos de cilindro, vuelta anterior', unit: 'cnt', min: 0, max: 65535, mode: '22', verified: true, defaultOff: true,
          note: 'TE.', formula: uint },
        { command: '221618', key: 'misfire_skipped', name: 'Encendidos no evaluados', unit: 'cnt', min: 0, max: 65535, mode: '22', verified: true, defaultOff: true,
          note: 'NMNC. Si este sube mucho, el detector de fallos está trabajando a ciegas parte del tiempo.', formula: uint },
        { command: '2216D3', key: 'mff_rpm', name: 'Fallo · revoluciones', unit: 'rpm', min: 0, max: 8000, mode: '22', verified: true, defaultOff: true,
          note: 'MFF_RPM. Se llena cuando ocurre un fallo.', formula: uint },
        { command: '2216D4', key: 'mff_load', name: 'Fallo · carga del motor', unit: '', min: 0, max: 65535, mode: '22', verified: true, defaultOff: true, formula: uint },
        { command: '2216D5', key: 'mff_vss', name: 'Fallo · velocidad', unit: 'km/h', min: 0, max: 255, mode: '22', verified: true, defaultOff: true, formula: ([A]) => A },
        { command: '2216D6', key: 'mff_iat', name: 'Fallo · temp. de admisión', unit: '°C', min: -40, max: 120, mode: '22', verified: true, defaultOff: true, formula: ([A]) => A - 40 },
        { command: '2216D7', key: 'mff_soak', name: 'Fallo · tiempo parado antes', unit: 'min', min: 0, max: 65535, mode: '22', verified: true, defaultOff: true, formula: uint },
        { command: '2216DC', key: 'misfire_free_trips', name: 'Viajes desde el último fallo', unit: 'cnt', min: 0, max: 65535, mode: '22', verified: true, defaultOff: true, formula: uint },
        { command: '2216DD', key: 'mp_lrn', name: 'Perfil de la rueda dentada aprendido', unit: '', min: 0, max: 255, mode: '22', verified: true, defaultOff: true,
          etiquetas: { ...SI_NO },
          note: 'MP_LRN. Si vale 0, el PCM todavía no aprendió el perfil y detecta los fallos con menos precisión.',
          formula: ([A]) => (A ? 1 : 0) },
      ],
    },

    // ══ CONFIGURACIÓN ════════════════════════════════════════════════════════
    {
      header: '7E0',
      rxHeader: '7E8',
      moduleName: 'Configuración del vehículo',
      color: '#6E6E78',
      pids: [
        { command: '2216F0', key: 'tire_size', name: 'Tamaño de neumático', unit: 'rev/mi', min: 0, max: 2000, mode: '22', verified: true, defaultOff: true,
          note: 'TIRESIZE. Confirmado: 706 giros por milla, lo que da un 245/65R17.', formula: uint },
        { command: '2216F1', key: 'axle_ratio', name: 'Relación del diferencial', unit: ':1', min: 0, max: 6, mode: '22', verified: true, defaultOff: true,
          note: 'AXLE. Dividido entre 1024 da 3,55 exacto, la corona de esta camioneta.',
          formula: ([A, B]) => (A * 256 + B) / 1024 },
        { command: '2216FC', key: 'bat_freeze', name: 'Voltaje en el congelado de datos', unit: 'V', min: 0, max: 25, mode: '22', verified: true, defaultOff: true,
          formula: ([A, B]) => (A * 256 + B) / 1024 },
        { command: '2216EF', key: 'kam', name: 'Memoria permanente (KAM)', unit: '', min: 0, max: 255, mode: '22', verified: true, defaultOff: true,
          note: 'Si se pierde, el PCM olvida todo lo aprendido.', formula: ([A]) => A },
        { command: '22162E', key: 'flt_egr', name: 'Avería · regulador de EGR', unit: '', min: 0, max: 255, mode: '22', verified: true, defaultOff: true,
          etiquetas: { ...SI_NO }, formula: ([A]) => (A ? 1 : 0) },
        { command: '22162F', key: 'flt_evap', name: 'Avería · purga del cánister', unit: '', min: 0, max: 255, mode: '22', verified: true, defaultOff: true,
          etiquetas: { ...SI_NO }, formula: ([A]) => (A ? 1 : 0) },
        { command: '221630', key: 'flt_ride', name: 'Avería · suspensión autonivelante', unit: '', min: 0, max: 255, mode: '22', verified: true, defaultOff: true,
          etiquetas: { ...SI_NO }, formula: ([A]) => (A ? 1 : 0) },
        { command: '22162D', key: 'flt_inj1', name: 'Avería · inyector 1', unit: '', min: 0, max: 255, mode: '22', verified: true, defaultOff: true,
          etiquetas: { ...SI_NO }, formula: ([A]) => (A ? 1 : 0) },
      ],
    },

    // ══ TRANSMISIÓN ══════════════════════════════════════════════════════════
    {
      header: '7E1',
      rxHeader: '7E9',
      moduleName: 'TCM · Transmisión',
      color: '#7A6BD0',
      pids: [
        { command: '2211B6', key: 'trs', name: 'Posición de la palanca', unit: '', min: 0, max: 255, mode: '22', verified: true,
          etiquetas: { 70: 'P', 60: 'R', 50: 'N', 46: 'D', 23: '3', 22: '2', 21: '1' },
          note: 'TR. Tabla completa, medida en el vehículo posición por posición: P=70, R=60, N=50, D=46, 3=23, 2=22, 1=21. Ojo al salto: de D a 3 el número cae de 46 a 23, o sea a la mitad, mientras que entre 3, 2 y 1 solo baja de uno en uno. Por eso ninguna fórmula del catálogo servía: esto no es una escala, es una tabla, y solo se saca del carro.',
          formula: ([A]) => A },
        { command: '2211B3', key: 'gear', name: 'Marcha comandada', unit: '', min: 0, max: 7, mode: '22', verified: true,
          etiquetas: { 1: '1ª', 2: '2ª', 3: '3ª', 4: '4ª', 5: '5ª', 6: '6ª', 7: 'R' },
          note: 'GEAR. El 13/09 dio 7 con la palanca en R y 1 en P, N y D con el carro parado. Marchas 1 a 6, reversa 7.',
          formula: ([A]) => A },
        { command: '2211B4', key: 'iss', name: 'Eje de ENTRADA (turbina)', unit: 'rpm', min: 0, max: 8000, mode: '22', verified: true,
          note: 'ISS, escala /4. Confirmado con física el 13/09: 720 rpm en P con el motor a 748, y 0 exacto en R y en D con el freno pisado, que es la turbina calándose contra el convertidor.',
          formula: ([A, B]) => (A * 256 + B) / 4 },
        { command: '2211B5', key: 'oss', name: 'Eje de SALIDA', unit: 'rpm', min: 0, max: 8000, mode: '22', verified: true,
          note: 'OSS, misma escala. Cero con el carro parado en las cuatro posiciones, como debe.',
          formula: ([A, B]) => (A * 256 + B) / 4 },
        { command: '2211B8', key: 'tcc_slip', name: 'Deslizamiento del convertidor', unit: 'rpm', min: -500, max: 1500, mode: '22', verified: true,
          note: 'SLIP_VALUE. Rodando con el convertidor acoplado tiene que bajar casi a cero; si se queda alto, el convertidor patina.',
          formula: ([A, B]) => sgn16(A, B) / 4 },
        { command: '221674', key: 'tft', name: 'Temp. del fluido de la caja', unit: '°C', min: -20, max: 150, mode: '22', verified: true,
          note: 'TFT. Escala del catálogo (crudo-256)*5/72. El 11/09 dio 33 °C con el motor frío.',
          formula: ([A, B]) => ((A * 256 + B - 256) * 5) / 72 },
      ],
    },

    // ══ FRENOS ═══════════════════════════════════════════════════════════════
    {
      header: '760',
      rxHeader: '768',
      moduleName: 'ABS · Frenos y AdvanceTrac',
      color: '#C25A12',
      pids: [
        { command: '222915', key: 'brake_press', name: 'Presión del freno principal', unit: 'kPa', min: 0, max: 20000, mode: '22', verified: true,
          note: 'MPRETDR, crudo = kPa CON SIGNO. Confirmado el 13/09: 17 kPa con el pedal suelto y 4149 kPa (41,5 bar / 602 psi) con el pedal a fondo. La otra escala del catálogo daba 881 kPa a fondo, demasiado poco para un frenazo. CORREGIDO el 16/09: con el pedal suelto el ABS devuelve valores justo por debajo de cero (0xFFF9 = -7 kPa) y sin signo salían 65529 kPa, un frenazo imaginario de 655 bar que además rompía la escala de la gráfica.',
          formula: ([A, B]) => sgn16(A, B) },
        { command: '222900', key: 'brake_sw', name: 'Pedal de freno', unit: '', min: 0, max: 1, mode: '22', verified: true,
          etiquetas: { 0: 'suelto', 1: 'PISADO' },
          note: 'Bit 15. El 13/09 pasó de 0x2000 a 0xA000 al pisar.',
          formula: ([A, B]) => ((A * 256 + B) >> 15) & 1 },
        { command: '222922', key: 'booster_sw', name: 'Interruptor del servofreno', unit: '', min: 0, max: 1, mode: '22', verified: true,
          etiquetas: { 0: 'suelto', 1: 'PISADO' },
          note: 'Bit 23, sensor de fuerza del servofreno. Confirmación independiente del pedal: el 13/09 pasó de 0x00000000 a 0x00800000.',
          formula: bit(23) },
        { command: '222927', key: 'hdc', name: 'Control de descenso (HDC)', unit: '', min: 0, max: 255, mode: '22', verified: true, defaultOff: true,
          note: 'HDC_ENABLE. Constante en 64 en todas las lecturas.', formula: ([A]) => A },
        ...['Del. izq.', 'Del. der.', 'Tras. izq.', 'Tras. der.'].map((n, i): EnhancedPid => ({
          command: '223987',
          key: `wss_${i}`,
          name: `Rueda ${n}`,
          unit: 'km/h', min: 0, max: 255, mode: '22', verified: false, defaultOff: true,
          note: 'PENDIENTE de confirmar rodando. 223987 es el único identificador vivo de esa página y devuelve cuatro bytes, que con el carro parado son cuatro ceros. El catálogo pone ahí las velocidades de rueda, pero hasta verlas moverse no es seguro que el orden sea este.',
          formula: (b: number[]) => b[i] ?? NaN,
        })),
      ],
    },
  ],
};
