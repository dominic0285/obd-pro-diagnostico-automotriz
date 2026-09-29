/**
 * Qué significa un código de avería, en español y sin tener que salir a buscar.
 *
 * Cada código se explica en tres niveles, de más preciso a más
 * general, para que NINGÚN código se quede sin decir algo útil:
 *
 *  - Los COMUNES, escritos a mano en español: qué significa y qué mirar. Son
 *    los que de verdad salen, incluidos los de este garaje: el P2270 de la Explorer, el P0812 de
 *    la EcoSport y los P2004-P2008 de admisión variable.
 *  - Si no está entre los comunes, el título en inglés de la tabla opcional.
 *  - Y siempre, para cualquier código que exista o pueda existir, la FAMILIA
 *    deducida de su propia estructura: la letra dice el sistema, el segundo
 *    dígito si es genérico o del fabricante, y el tercero el subsistema. Eso
 *    no adivina la avería, pero sitúa el código, que ya es mucho más que un
 *    número suelto.
 */

export interface ExplicacionDtc {
  /** Título en español si lo hay; si no, el de la tabla opcional; si no, la familia. */
  titulo: string;
  /** Qué significa, en palabras. Solo para los comunes. */
  que?: string;
  /** Por dónde empezar a mirar. Solo para los comunes. */
  mirar?: string;
  /** De qué sistema y subsistema es. Siempre hay. */
  familia: string;
  /** Genérico de la norma o propio del fabricante. */
  generico: boolean;
  /** De dónde salió el título: útil para saber cuánto fiarse. */
  fuente: 'comunes' | 'tabla' | 'estructura';
}

const SISTEMA: Record<string, string> = {
  P: 'Motor y transmisión',
  C: 'Chasis: frenos, ABS, dirección y suspensión',
  B: 'Carrocería: airbags, luces, cierres, climatizador',
  U: 'Red: comunicación entre módulos',
};

/**
 * El tercer carácter de un código de motor dice de qué subsistema es.
 *
 * Esto es de la norma SAE J2012 y no cambia entre fabricantes, así que vale
 * para cualquier código de motor que aparezca, esté o no en ninguna tabla.
 */
const SUBSISTEMA_P: Record<string, string> = {
  '0': 'medición de aire y combustible, y controles auxiliares',
  '1': 'medición de aire y combustible',
  '2': 'medición de aire y combustible: inyectores',
  '3': 'encendido y fallos de encendido',
  '4': 'controles auxiliares de emisiones: EGR, catalizador, evaporativos',
  '5': 'control de velocidad, ralentí y entradas auxiliares',
  '6': 'la computadora y sus salidas',
  '7': 'transmisión',
  '8': 'transmisión',
  '9': 'transmisión y entradas de la norma',
  'A': 'propulsión híbrida',
  'B': 'propulsión híbrida',
  'C': 'propulsión híbrida',
};

/** ¿Es un código de la norma o se lo inventó el fabricante? */
function esGenerico(codigo: string): boolean {
  const l = codigo[0];
  const d = codigo[1];
  if (l === 'P') return d === '0' || d === '2';   // P0xxx y P2xxx son de la norma
  return d === '0';                                // B0/C0/U0 son de la norma
}

/**
 * Lo que se puede saber de un código sin conocerlo: por su propia estructura.
 *
 * Nunca falla y nunca inventa. Un código que no esté en ninguna tabla sigue
 * teniendo letra, dígito de origen y subsistema, y con eso ya se sabe a quién
 * preguntarle y por dónde no empezar.
 */
export function familiaDtc(codigo: string): string {
  const c = codigo.toUpperCase();
  const sistema = SISTEMA[c[0]] ?? 'Sistema desconocido';
  if (c[0] !== 'P') return sistema;
  const sub = SUBSISTEMA_P[c[2]];
  return sub ? `${sistema} · ${sub}` : sistema;
}

/**
 * Los códigos escritos a mano, en español.
 *
 * Formato: [título, qué significa, por dónde empezar a mirar].
 *
 * El tercer campo es el que de verdad ahorra el viaje a internet, y también el
 * que más cuidado pide: es una lista de sospechosos ORDENADA por probabilidad,
 * no un diagnóstico. Un código dice qué vio la computadora, no qué pieza hay
 * que cambiar, y el orden importa porque cambiar la pieza cara primero es como
 * se tira el dinero en un taller.
 */
const COMUNES: Record<string, [string, string, string]> = {
  // ── Mezcla ────────────────────────────────────────────────────────────
  P0171: ['Mezcla pobre · Banco 1',
    'El PCM ya está metiendo todo el combustible extra que puede y la sonda sigue viendo exceso de oxígeno. O entra aire que nadie midió, o falta gasolina.',
    'Fugas de admisión después del medidor (mangueras, junta del colector, el tubo del PCV), la purga del cánister pegada abierta, el MAF sucio o descalibrado, presión de riel baja, filtro de gasolina tapado. Mira primero las correcciones de combustible: si en ralentí son muy positivas y a ralentí alto se normalizan, es fuga de aire.'],
  P0172: ['Mezcla rica · Banco 1',
    'El PCM está quitando todo el combustible que puede y la sonda sigue viendo poco oxígeno. Entra más gasolina de la que debería, o menos aire.',
    'Filtro de aire tapado, inyectores goteando, presión de riel alta o regulador pegado, el MAF leyendo de más, la sonda envejecida, aceite en la admisión desde el PCV.'],
  P0174: ['Mezcla pobre · Banco 2', 'Lo mismo que el P0171 pero en el otro banco de cilindros.',
    'Si sale junto con el P0171, el problema es común a los dos bancos: admisión, MAF, presión de combustible. Si sale solo, es de ese lado: una junta, una manguera o un inyector de ese banco.'],
  P0175: ['Mezcla rica · Banco 2', 'Lo mismo que el P0172 pero en el otro banco.',
    'Si sale junto con el P0172, la causa es común a los dos bancos. Si sale solo, mira los inyectores y la sonda de ese lado.'],

  // ── Fallos de encendido ───────────────────────────────────────────────
  P0300: ['Fallo de encendido en varios cilindros',
    'La computadora detecta que el cigüeñal se frena un instante, y no siempre en el mismo cilindro. Cada fallo manda gasolina sin quemar al escape, que es lo que termina matando el catalizador.',
    'Cuando es en varios a la vez, la causa suele ser común: bujías gastadas todas por igual, presión de combustible baja, fuga de vacío grande, distribución fuera de punto o un fallo de masa. Si además sale un P030X de un cilindro concreto, empieza por ese.'],
  P0301: ['Fallo de encendido · Cilindro 1',
    'El cigüeñal se frena un instante cada vez que le toca a ese cilindro: no está quemando bien. La gasolina sin quemar se va al escape y ahí es donde termina muriendo el catalizador.',
    'La prueba barata y sin comprar nada: intercambia la bobina de ese cilindro con la de un vecino y borra el código. Si se muda al otro cilindro, era la bobina; si se queda, sigue con la bujía, después el inyector, y solo al final la compresión.'],
  P0302: ['Fallo de encendido · Cilindro 2',
    'El cigüeñal se frena un instante cada vez que le toca a ese cilindro: no está quemando bien. La gasolina sin quemar se va al escape y ahí es donde termina muriendo el catalizador.',
    'La prueba barata y sin comprar nada: intercambia la bobina de ese cilindro con la de un vecino y borra el código. Si se muda al otro cilindro, era la bobina; si se queda, sigue con la bujía, después el inyector, y solo al final la compresión.'],
  P0303: ['Fallo de encendido · Cilindro 3',
    'El cigüeñal se frena un instante cada vez que le toca a ese cilindro: no está quemando bien. La gasolina sin quemar se va al escape y ahí es donde termina muriendo el catalizador.',
    'La prueba barata y sin comprar nada: intercambia la bobina de ese cilindro con la de un vecino y borra el código. Si se muda al otro cilindro, era la bobina; si se queda, sigue con la bujía, después el inyector, y solo al final la compresión.'],
  P0304: ['Fallo de encendido · Cilindro 4',
    'El cigüeñal se frena un instante cada vez que le toca a ese cilindro: no está quemando bien. La gasolina sin quemar se va al escape y ahí es donde termina muriendo el catalizador.',
    'La prueba barata y sin comprar nada: intercambia la bobina de ese cilindro con la de un vecino y borra el código. Si se muda al otro cilindro, era la bobina; si se queda, sigue con la bujía, después el inyector, y solo al final la compresión.'],
  P0305: ['Fallo de encendido · Cilindro 5',
    'El cigüeñal se frena un instante cada vez que le toca a ese cilindro: no está quemando bien. La gasolina sin quemar se va al escape y ahí es donde termina muriendo el catalizador.',
    'La prueba barata y sin comprar nada: intercambia la bobina de ese cilindro con la de un vecino y borra el código. Si se muda al otro cilindro, era la bobina; si se queda, sigue con la bujía, después el inyector, y solo al final la compresión.'],
  P0306: ['Fallo de encendido · Cilindro 6',
    'El cigüeñal se frena un instante cada vez que le toca a ese cilindro: no está quemando bien. La gasolina sin quemar se va al escape y ahí es donde termina muriendo el catalizador.',
    'La prueba barata y sin comprar nada: intercambia la bobina de ese cilindro con la de un vecino y borra el código. Si se muda al otro cilindro, era la bobina; si se queda, sigue con la bujía, después el inyector, y solo al final la compresión.'],
  P0307: ['Fallo de encendido · Cilindro 7',
    'El cigüeñal se frena un instante cada vez que le toca a ese cilindro: no está quemando bien. La gasolina sin quemar se va al escape y ahí es donde termina muriendo el catalizador.',
    'La prueba barata y sin comprar nada: intercambia la bobina de ese cilindro con la de un vecino y borra el código. Si se muda al otro cilindro, era la bobina; si se queda, sigue con la bujía, después el inyector, y solo al final la compresión.'],
  P0308: ['Fallo de encendido · Cilindro 8',
    'El cigüeñal se frena un instante cada vez que le toca a ese cilindro: no está quemando bien. La gasolina sin quemar se va al escape y ahí es donde termina muriendo el catalizador.',
    'La prueba barata y sin comprar nada: intercambia la bobina de ese cilindro con la de un vecino y borra el código. Si se muda al otro cilindro, era la bobina; si se queda, sigue con la bujía, después el inyector, y solo al final la compresión.'],
  P0313: ['Fallo de encendido con poco combustible',
    'El motor falló mientras el tanque estaba casi vacío. Es un aviso, no una avería: el PCM lo marca para no culpar al encendido de algo que fue quedarse sin gasolina.',
    'Echa gasolina y borra. Si vuelve con el tanque lleno, entonces sí hay un fallo de encendido de verdad.'],
  P0316: ['Fallo de encendido al arrancar',
    'Falló en los primeros segundos después de encender, cuando el motor todavía está frío.',
    'Bujías, bobinas, o un inyector que gotea de noche y ahoga un cilindro al arrancar. Si el carro arranca con humo blanco o huele a gasolina al encender, mira los inyectores.'],

  // ── Catalizador y sondas ──────────────────────────────────────────────
  P0420: ['Rendimiento del catalizador bajo · Banco 1',
    'La sonda trasera está viendo casi lo mismo que la delantera. El catalizador ya no está limpiando el gas, o una de las dos sondas miente.',
    'ANTES de cambiar el catalizador, que es lo caro: comprueba la sonda trasera (tiene que dar un voltaje casi plano, no oscilante) y busca fugas de escape antes del catalizador, que meten aire y falsean la lectura. Un catalizador rara vez muere solo: suele matarlo un fallo de encendido o una mezcla rica que venía de antes.'],
  P0430: ['Rendimiento del catalizador bajo · Banco 2',
    'La sonda trasera del banco 2 ve casi lo mismo que la delantera: ese catalizador ya no limpia, o una de las dos sondas miente.',
    'Mismo orden que el P0420, y por la misma razón: comprueba la sonda trasera y busca fugas de escape antes del catalizador ANTES de comprar el catalizador, que es lo caro. Si sale junto con el P0420, sospecha de algo común a los dos bancos.'],
  P0130: ['Sonda de oxígeno B1S1 · circuito', 'La señal de la sonda delantera del banco 1 no es la que el PCM espera.',
    'Conector y cableado de la sonda, que pasan cerca del escape y se cuecen. Luego la sonda.'],
  P0133: ['Sonda B1S1 lenta', 'La sonda delantera responde, pero tarda demasiado en cambiar de rica a pobre. Envejecida.',
    'Normalmente es la sonda, que se cansa con los años. Antes de cambiarla, descarta fugas de escape y que no esté contaminada por aceite o refrigerante quemado.'],
  P0135: ['Calefactor de la sonda B1S1', 'El calentador interno de la sonda no consume lo que debería. Sin él, la sonda tarda en entrar en servicio.',
    'Fusible del calefactor, el relé, el cableado, y por último la sonda. Suele ser el fusible o la propia sonda.'],
  P0136: ['Sonda de oxígeno B1S2 · circuito', 'La señal de la sonda TRASERA del banco 1 no es la esperada.',
    'Conector y cable de la sonda trasera. Es la que vigila el catalizador, no la mezcla.'],
  P0137: ['Sonda B1S2 · voltaje bajo', 'La sonda trasera del banco 1 se quedó abajo.', 'Fuga de escape antes de la sonda, cable cortado, o la sonda muerta.'],
  P0138: ['Sonda B1S2 · voltaje alto', 'La sonda trasera del banco 1 se quedó arriba.', 'Cortocircuito a positivo en el cable de señal, o la sonda contaminada.'],
  P0140: ['Sonda B1S2 sin actividad', 'La sonda trasera no da señal: está plana.', 'Cable cortado, conector suelto, o la sonda muerta.'],
  P0141: ['Calefactor de la sonda B1S2', 'El calentador de la sonda trasera del banco 1 no consume.', 'Fusible, cableado y sonda, en ese orden.'],
  P0155: ['Calefactor de la sonda B2S1', 'El calentador de la sonda delantera del banco 2 no consume.', 'Fusible, cableado y sonda, en ese orden.'],
  P2270: ['Señal de sonda atascada en pobre · B1S2',
    'La sonda TRASERA del banco 1 está clavada en el lado pobre y no se mueve. Sin ella el PCM no puede juzgar el catalizador ni corregir con precisión.',
    'Casi siempre es la sonda, que se cansa. Antes de cambiarla, descarta una fuga de escape antes de ella —el aire que entra la deja viendo oxígeno siempre— y revisa el conector. Mira la señal en vivo: una sonda viva oscila, una muerta se queda plana.'],
  P2271: ['Señal de sonda atascada en rica · B1S2', 'La sonda trasera del banco 1 está clavada en el lado rico.',
    'Sonda contaminada (aceite, refrigerante, aditivos de silicona), o un cortocircuito en el cable de señal.'],
  P2272: ['Señal de sonda atascada en pobre · B2S2', 'Lo mismo que el P2270, en el otro banco.', 'Fuga de escape antes de la sonda, conector, y al final la sonda.'],
  P2273: ['Señal de sonda atascada en rica · B2S2',
    'La sonda trasera del banco 2 se quedó clavada en el lado rico y no se mueve, así que el PCM no puede juzgar ese catalizador.',
    'Sonda contaminada por aceite, refrigerante o aditivos con silicona; también un cortocircuito en el cable de señal. Mira la señal en vivo: una sonda viva oscila, una muerta se queda plana.'],

  // ── Sensores de admisión y temperatura ────────────────────────────────
  P0101: ['Medidor de aire (MAF) fuera de rango', 'El flujo que reporta el MAF no cuadra con lo que el PCM espera para esas revoluciones y esa mariposa.',
    'Límpialo con limpiador de MAF (nunca con otra cosa: el hilo es frágil). Después, fugas entre el MAF y la mariposa, y el filtro de aire. Un MAF sucio da mezcla pobre arriba y tirones.'],
  P0102: ['MAF · señal baja', 'El medidor de aire reporta menos flujo del posible.', 'Conector, cable cortado, MAF sucio, o una fuga grande de admisión aguas abajo.'],
  P0103: ['MAF · señal alta', 'El medidor reporta más flujo del posible.', 'Conector, cortocircuito, o el MAF averiado.'],
  P0106: ['Sensor de colector (MAP) fuera de rango', 'La presión que reporta el MAP no cuadra con la carga del motor.',
    'La manguera de vacío del MAP, que se endurece y se raja; el propio sensor; y fugas de vacío grandes.'],
  P0107: ['MAP · señal baja',
    'El sensor de presión del colector reporta un voltaje por debajo de lo que físicamente puede dar, así que el PCM lo descarta y usa un valor de emergencia.',
    'Conector desconectado o con verdín, cable de señal cortado o en corto a masa, y por último el sensor. Con este código el motor anda con un valor inventado: gasta más y responde mal.'],
  P0108: ['MAP · señal alta', 'El sensor de colector reporta un voltaje por encima de lo posible.', 'Manguera desconectada, corto a positivo, o el sensor.'],
  P0112: ['Temperatura de admisión · señal baja', 'El sensor de aire de admisión reporta un valor imposible por abajo.', 'Conector o cable en corto a masa; luego el sensor. Va integrado en el MAF en muchos motores.'],
  P0113: ['Temperatura de admisión · señal alta', 'El sensor de aire de admisión reporta un valor imposible por arriba, como si estuviera desconectado.',
    'Casi siempre el conector suelto o el cable cortado. Es de los más fáciles: desconecta y vuelve a conectar, y mira el valor en vivo.'],
  P0117: ['Temperatura de refrigerante · señal baja',
    'El sensor reporta un valor imposible por abajo: el PCM cree que el motor está congelado y le mete mezcla rica todo el tiempo.',
    'Conector o cable en corto a masa, y después el sensor. Se nota en el consumo y en humo negro; el ventilador también puede quedarse encendido de más.'],
  P0118: ['Temperatura de refrigerante · señal alta', 'El sensor de refrigerante reporta un valor imposible por arriba, como si estuviera desconectado.',
    'Conector o cable cortado. Ojo: con este código el PCM usa un valor de emergencia y el carro puede gastar más y arrancar mal en frío.'],
  P0125: ['El motor no calienta lo suficiente para lazo cerrado',
    'Pasó demasiado tiempo sin que el refrigerante llegara a la temperatura que permite corregir por la sonda.',
    'Termostato abierto o pegado, el sensor de refrigerante leyendo bajo, o simplemente mucho frío con muchos arranques cortos.'],
  P0128: ['El refrigerante no llega a temperatura · termostato',
    'El motor tarda más de lo permitido en calentar. El PCM compara la temperatura real con la que debería tener por tiempo y carga.',
    'El termostato, casi siempre pegado abierto. También un sensor de refrigerante que lee bajo, o un ventilador que se queda encendido. Gasta más gasolina y la calefacción no calienta.'],
  P0122: ['Sensor de mariposa · señal baja', 'La posición de mariposa reporta un voltaje por debajo de lo posible.', 'Conector, cable, o el sensor. En mariposa electrónica suele venir acompañado de otros P2Ixx.'],
  P0123: ['Sensor de mariposa · señal alta', 'La posición de mariposa reporta un voltaje por encima de lo posible.', 'Conector, corto a positivo, o el sensor.'],

  // ── Encendido, cigüeñal y levas ───────────────────────────────────────
  P0325: ['Sensor de detonación · circuito', 'El sensor que oye el picado no responde como debe. Sin él el PCM quita avance por precaución y el motor pierde fuerza.',
    'Conector y cable, que suelen ir bajo el colector. Luego el sensor. Comprueba también que esté bien apretado: un sensor flojo no oye.'],
  P0335: ['Sensor de cigüeñal · circuito', 'La señal del cigüeñal falta o llega mal. Es la señal más importante del motor: sin ella no hay chispa ni inyección.',
    'Si el carro no arranca o se apaga en caliente, este es el sospechoso número uno. Conector, cable y sensor. También la rueda dentada del cigüeñal si está dañada.'],
  P0340: ['Sensor de árbol de levas · circuito', 'La señal del árbol de levas falta o llega mal. El motor puede arrancar igual, pero tardando más.',
    'Conector, cable y sensor. Si sale junto con un P0016, mira la distribución antes de cambiar nada.'],
  P0016: ['Cigüeñal y levas fuera de correlación · Banco 1',
    'El PCM compara dónde está el cigüeñal con dónde está el árbol de levas y no cuadran. La distribución está corrida.',
    'OJO CON ESTE: puede ser la cadena o correa estirada, un tensor gastado, o el actuador de leva variable. No es un sensor. Conducir así puede terminar en válvulas dobladas.'],
  P0351: ['Bobina 1 · circuito primario', 'El PCM manda la chispa a esa bobina y no ve el consumo que espera.', 'Conector de la bobina, el cable de mando hasta el PCM, y la bobina.'],
  P0352: ['Bobina 2 · circuito primario', 'El PCM manda la chispa a esa bobina y no ve el consumo que espera.', 'Conector de la bobina, el cable de mando hasta el PCM, y la bobina.'],
  P0353: ['Bobina 3 · circuito primario', 'El PCM manda la chispa a esa bobina y no ve el consumo que espera.', 'Conector de la bobina, el cable de mando hasta el PCM, y la bobina.'],
  P0354: ['Bobina 4 · circuito primario', 'El PCM manda la chispa a esa bobina y no ve el consumo que espera.', 'Conector de la bobina, el cable de mando hasta el PCM, y la bobina.'],

  // ── Inyectores ────────────────────────────────────────────────────────
  P0201: ['Inyector 1 · circuito', 'El PCM no ve el consumo esperado al abrir ese inyector.', 'Conector del inyector, el cable, y la bobina interna del inyector (se mide con un multímetro: unos 12-16 ohmios en los de alta impedancia).'],
  P0202: ['Inyector 2 · circuito', 'El PCM no ve el consumo esperado al abrir ese inyector.', 'Conector, cable y resistencia del inyector.'],
  P0203: ['Inyector 3 · circuito', 'El PCM no ve el consumo esperado al abrir ese inyector.', 'Conector, cable y resistencia del inyector.'],
  P0204: ['Inyector 4 · circuito', 'El PCM no ve el consumo esperado al abrir ese inyector.', 'Conector, cable y resistencia del inyector.'],
  P0217: ['Sobrecalentamiento del motor',
    'El PCM vio la temperatura por encima del límite y está protegiéndose. Puede cortar cilindros para bajar el calor.',
    'PARA EL CARRO. Nivel de refrigerante, ventilador, termostato, bomba de agua, radiador tapado. Seguir andando con esto es como se parte una culata.'],

  // ── EGR y evaporativos ────────────────────────────────────────────────
  P0401: ['Flujo de EGR insuficiente', 'La válvula de recirculación no está dejando pasar el gas que el PCM le pide.',
    'Conductos y la propia válvula tapados de carbón: es lo más común y se limpia. Luego la válvula, el sensor de posición y el vacío que la manda.'],
  P0402: ['Flujo de EGR excesivo', 'Entra más gas recirculado del que debería, o entra cuando no toca.', 'Válvula pegada abierta por carbón, o el sensor de posición.'],
  P0441: ['Flujo de purga incorrecto', 'El sistema que recoge los vapores del tanque no está purgando como debe.',
    'La válvula de purga del cánister, pegada abierta o cerrada. Es barata y es la causa más común.'],
  P0442: ['Fuga pequeña en el sistema de evaporativos',
    'El sistema no aguanta la presión: hay una fuga por donde se escapan los vapores de gasolina.',
    'PRIMERO el tapón del tanque: apriétalo bien o cámbialo, resuelve la mitad de estos. Después mangueras resecas, el cánister y las válvulas de purga y ventilación.'],
  P0455: ['Fuga grande en el sistema de evaporativos', 'Fuga grande de vapores, o el sistema no sella en absoluto.',
    'El tapón del tanque, suelto o mal puesto, es la causa número uno. Luego una manguera desconectada o partida.'],
  P0456: ['Fuga muy pequeña en evaporativos', 'Una fuga mínima, de las que solo se detectan con humo.', 'Tapón del tanque, y después una prueba de humo: a simple vista no se ve.'],
  P0446: ['Válvula de ventilación del cánister · circuito', 'La válvula que deja entrar aire al cánister no responde.',
    'La válvula, que va cerca del tanque y se llena de tierra y agua. Conector y cable.'],
  P0443: ['Válvula de purga del cánister · circuito',
    'El PCM manda la válvula que deja pasar los vapores del tanque al motor y no ve el consumo eléctrico que espera.',
    'Conector y cable de la válvula, que va en el vano del motor y se cuece; después la válvula, que es barata. Si además el ralentí está inestable, sospecha de que esté pegada abierta.'],

  // ── Ralentí, velocidad y eléctrico ────────────────────────────────────
  P0500: ['Sensor de velocidad · sin señal', 'El PCM no está recibiendo la velocidad del vehículo.',
    'El sensor en la caja o en la rueda, su conector, y el cable. Sin velocidad el cambio de la automática se porta mal y el control de crucero no funciona.'],
  P0505: ['Control de ralentí · avería', 'El PCM no consigue sostener el ralentí donde quiere.',
    'Cuerpo de mariposa sucio de carbón (límpialo), la válvula de ralentí si el motor la lleva, y fugas de vacío. Después de limpiar, deja que el PCM reaprenda: unos minutos en ralentí sin tocar nada.'],
  P0506: ['Ralentí más bajo de lo esperado', 'El motor gira por debajo del ralentí que el PCM pide.',
    'Cuerpo de mariposa sucio, la válvula de ralentí pegada, o algo robándole par al motor. Compara el ralentí real con el deseado en la pantalla de datos: si el deseado está arriba y el real abajo, el motor no puede con la carga.'],
  P0507: ['Ralentí más alto de lo esperado', 'El motor gira por encima del ralentí que el PCM pide.',
    'Fuga de vacío, que es lo más común: mangueras, junta del colector, el PCV. También la mariposa mal ajustada o el cable del acelerador tenso.'],
  P0562: ['Voltaje del sistema bajo', 'La computadora está viendo menos voltaje del que necesita para trabajar bien.',
    'Batería, bornes sulfatados, correa del alternador, y el alternador. Con voltaje bajo salen códigos falsos por todos lados: arregla esto primero y borra el resto.'],
  P0563: ['Voltaje del sistema alto', 'La computadora está viendo más voltaje del que debería.',
    'El regulador del alternador. Un voltaje alto sostenido quema bombillos y módulos: no lo dejes.'],
  P0571: ['Interruptor de freno · circuito',
    'La señal del pedal de freno no llega o no es coherente. El PCM la usa para soltar el crucero y para la estrategia de ralentí.',
    'El interruptor detrás del pedal de freno, que se descalibra o se rompe; es barato. Comprueba primero si las luces de freno encienden: si no encienden, es el interruptor o su fusible.'],
  P0480: ['Ventilador 1 · circuito', 'El PCM manda el ventilador y no ve la respuesta esperada.', 'Relé del ventilador, fusible, conector y el motor del ventilador.'],

  // ── La computadora ────────────────────────────────────────────────────
  P0601: ['Error de memoria interna del PCM', 'La computadora no se pasa su propia prueba de memoria.',
    'Antes de condenar el PCM: revisa masas y voltaje de alimentación, que son la causa de la mayoría de estos. Un PCM realmente dañado es raro.'],
  P0603: ['Error de la memoria permanente (KAM)', 'El PCM perdió lo que tenía aprendido: correcciones, ralentí, octanaje.',
    'Suele venir de que se desconectó la batería, de un borne flojo o de un fusible de memoria. Si vuelve solo, busca el fallo de alimentación.'],
  P0606: ['Fallo del procesador del PCM', 'La computadora detecta un fallo en sí misma.', 'Masas y alimentación primero. Si están bien y el código persiste, el módulo.'],

  // ── Transmisión ───────────────────────────────────────────────────────
  P0700: ['La transmisión pide atención',
    'No es una avería en sí: es el módulo de la caja avisando al del motor de que ÉL tiene un código guardado. El código de verdad está en el módulo de transmisión.',
    'Escanea el módulo de transmisión aparte —el botón de "Escanear módulos" de esta misma pantalla— y mira qué código tiene. Este solo es el aviso.'],
  P0715: ['Sensor de turbina · circuito', 'El módulo de la caja no recibe bien la velocidad del eje de entrada.',
    'Conector y cable del sensor, y el sensor. Sin él la caja cambia a ciegas y con golpes.'],
  P0720: ['Sensor de eje de salida · circuito', 'El módulo de la caja no recibe bien la velocidad del eje de salida.',
    'Conector, cable y sensor. Suele venir con cambios bruscos y el velocímetro fallando.'],
  P0730: ['Relación de marcha incorrecta', 'La relación entre lo que entra y lo que sale de la caja no es la de ninguna marcha. Está patinando.',
    'Nivel y estado del aceite de la caja primero. Después solenoides y presión. Si el aceite está quemado y huele, la caja ya sufrió.'],
  P0741: ['Convertidor · no se bloquea', 'El embrague del convertidor no está bloqueando cuando debería. Se nota como falta de fuerza y más consumo en carretera.',
    'Aceite y filtro, el solenoide del convertidor, y la presión. En la app puedes verlo: la prueba de la caja mide el deslizamiento a velocidad de crucero.'],
  P0750: ['Solenoide A de cambio · circuito', 'El módulo de la caja no ve la respuesta esperada de ese solenoide.', 'Conector externo de la caja, el arnés interno y el solenoide.'],
  P0812: ['Entrada de reversa · circuito',
    'La computadora vigila la señal de "estoy en reversa" y ve algo que no cuadra: o no cambia nunca, o cambia cuando no debe.',
    'El interruptor de reversa, que en una caja sincrónica va roscado a la carcasa. Si alguien lo quitó y puenteó el circuito, este código es permanente y va a volver cada vez que lo borres: no es una avería, es la consecuencia. Comprueba si las luces de reversa encienden al meter la marcha.'],

  // ── Admisión variable y mariposa electrónica ──────────────────────────
  P2004: ['Mariposas de admisión variable atascadas abiertas · Banco 1',
    'El mecanismo que cierra los conductos largos de la admisión se quedó abierto. Se pierde par abajo.',
    'El eje de las mariposas se atasca con carbón: es lo típico en estos motores. Límpialo antes de comprar nada. Luego el actuador y su sensor de posición.'],
  P2005: ['Mariposas de admisión variable atascadas abiertas · Banco 2',
    'El mecanismo que cierra los conductos largos de la admisión del banco 2 se quedó abierto, así que se pierde par abajo.',
    'El eje de las mariposas se atasca con carbón: muévelo a mano con el motor apagado y límpialo antes de comprar nada. Después el actuador y su sensor de posición.'],
  P2006: ['Mariposas de admisión variable atascadas cerradas · Banco 1',
    'El mecanismo se quedó cerrado. Se pierde potencia arriba y el motor se ahoga a vueltas altas.',
    'Mismo eje con carbón. Muévelo a mano con el motor apagado: si está duro, ahí está.'],
  P2008: ['Mariposas de admisión variable · circuito del actuador', 'El PCM manda el actuador de admisión variable y no ve la respuesta.',
    'Conector y cable del actuador, y el actuador. Suele venir con los P2004-P2006.'],
  P2111: ['Mariposa electrónica atascada abierta', 'El cuerpo de mariposa no vuelve a la posición que el PCM le pide.',
    'Cuerpo de mariposa sucio o el motor interno gastado. Este pone el carro en modo de emergencia: apenas responde el acelerador.'],
  P2135: ['Sensores de mariposa en desacuerdo', 'Los dos sensores de posición del cuerpo de mariposa no dicen lo mismo, así que el PCM no se fía de ninguno.',
    'Conector del cuerpo de mariposa, y el cuerpo de mariposa. Suele mandar el carro a modo de emergencia.'],
  P2138: ['Sensores del pedal en desacuerdo', 'Los sensores del pedal del acelerador no coinciden entre ellos.',
    'Conector del pedal y el pedal completo. Igual que el anterior, deja el carro sin respuesta al acelerador.'],
  P2279: ['Fuga de aire en la admisión', 'Entra aire sin medir después del medidor de flujo.',
    'Mangueras, la junta del colector, el tubo del PCV y la caja del filtro mal cerrada. Suele salir junto con el P0171.'],

  // ── Presión de aceite y combustible ───────────────────────────────────
  P0521: ['Presión de aceite · fuera de rango', 'La presión de aceite que lee el sensor no es la que el PCM espera.',
    'ANTES de dar por buena la lectura, mide la presión real con un manómetro: el sensor miente más veces de las que el motor tiene poca presión. Nivel y viscosidad del aceite también.'],
  P0522: ['Presión de aceite · señal baja',
    'El sensor reporta una presión de aceite muy por debajo de lo normal. Puede ser el sensor mintiendo o puede ser de verdad, y la diferencia entre las dos cosas es un motor.',
    'NO lo dejes para después: mide la presión real con un manómetro antes de nada. Si es real y baja, APAGA EL MOTOR — seguir andando se lleva las bancadas. Si el manómetro dice que la presión está bien, entonces sí, es el sensor o su cable.'],
  P0087: ['Presión de riel demasiado baja', 'El combustible no llega con la presión que el motor pide.',
    'Filtro de gasolina tapado, bomba cansada, regulador, o una restricción en la línea. Se nota como falta de fuerza al exigirle.'],
  P0191: ['Sensor de presión de riel · fuera de rango', 'La presión del riel que reporta el sensor no es coherente.',
    'Conector y sensor. Compara la presión medida con la deseada en la pantalla de datos: si difieren mucho de forma estable, mira el sensor.'],
  P0463: ['Sensor de nivel de combustible · señal alta', 'El nivel del tanque reporta un valor imposible.',
    'El aforador dentro del tanque o su conector. La aguja del tablero suele fallar a la vez.'],

  // ── A/C y varios ──────────────────────────────────────────────────────
  P0532: ['Presión del A/C · señal baja', 'El sensor de presión del aire acondicionado reporta un valor muy bajo.',
    'Puede ser gas insuficiente de verdad —y entonces el compresor no va a enganchar, que es una protección— o el sensor. Mira la presión en vivo.'],

  // ── Red y comunicación ────────────────────────────────────────────────
  U0100: ['Sin comunicación con la computadora del motor',
    'El módulo que guardó este código dejó de oír al PCM por la red del carro.',
    'Alimentación y masas del PCM, fusibles, y los cables de la red CAN. Si aparece junto con muchos otros U0xxx, casi siempre es un módulo que arrastra el bus o un problema de alimentación común, no todos los módulos a la vez.'],
  U0101: ['Sin comunicación con el módulo de transmisión', 'Se perdió el diálogo con el módulo de la caja.', 'Alimentación y masas de ese módulo, conector y red CAN.'],
  U0121: ['Sin comunicación con el ABS', 'Se perdió el diálogo con el módulo de frenos.', 'Fusible y alimentación del ABS, conector, y la red.'],
  U0140: ['Sin comunicación con el módulo de carrocería',
    'El módulo que guardó este código dejó de oír al de carrocería, que es el que maneja luces, cierres, alarma y accesorios.',
    'Fusibles y alimentación de ese módulo, sus masas, y los dos cables de la red CAN. Si salen varios U0xxx a la vez, busca una causa común —un fusible o una masa— en vez de perseguir cada módulo por separado.'],
  U0155: ['Sin comunicación con el tablero',
    'Se perdió el diálogo con el cuadro de instrumentos, que además de mostrar cosas reparte información a otros módulos.',
    'Fusibles y alimentación del tablero, sus masas y la red CAN. Si el tablero se ve apagado o con las agujas caídas al dar contacto, empieza por la alimentación.'],
  U0401: ['Datos inválidos desde la computadora del motor', 'El PCM contesta, pero manda datos que el otro módulo considera incoherentes.',
    'Suele ser consecuencia de otro código en el PCM: lee primero los del motor y arregla esos.'],
};

/**
 * Todo lo que se puede decir de un código, ordenado de más a menos preciso.
 *
 * Nunca devuelve vacío: si el código no está en ninguna de las dos tablas,
 * queda la familia, que se deduce de la estructura del propio código y por
 * tanto existe siempre. Un "no sé qué es, pero es de la red y es propio del
 * fabricante" es información; un número pelado no lo es.
 */
export function explicarDtc(codigo: string, tituloTabla = ''): ExplicacionDtc {
  const c = codigo.toUpperCase().trim();
  const familia = familiaDtc(c);
  const generico = esGenerico(c);
  const comun = COMUNES[c];
  if (comun) {
    return { titulo: comun[0], que: comun[1], mirar: comun[2], familia, generico, fuente: 'comunes' };
  }
  if (tituloTabla) {
    return { titulo: tituloTabla, familia, generico, fuente: 'tabla' };
  }
  return { titulo: familia, familia, generico, fuente: 'estructura' };
}

/** Cuántos códigos están explicados en español. Para la pantalla de ajustes. */
export function totalComunes(): number {
  return Object.keys(COMUNES).length;
}

/** Para las autopruebas: la lista entera, sin exponer la tabla para escritura. */
export function clavesComunes(): string[] {
  return Object.keys(COMUNES);
}
