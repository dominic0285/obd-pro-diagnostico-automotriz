/**
 * El cluster: la pantalla que se mira conduciendo.
 *
 * Aquí NO hay nada que no se mire de reojo. Seis datos y ni uno más:
 * revoluciones, marcha, palanca, velocidad, temperatura del refrigerante y el
 * nivel del tanque.
 *
 * El motivo no es estético, es de tiempo. Con los treinta y cinco anillos de la
 * pantalla anterior, una vuelta completa de preguntas al vehículo tardaba más de
 * dos segundos, así que las revoluciones llegaban con dos segundos de retraso y
 * la aguja iba a trompicones. Con seis identificadores la vuelta baja a medio
 * segundo largo. Todo lo que se quita de esta pantalla es tiempo que gana la
 * aguja.
 *
 * El resto de los datos está a un botón de distancia, en su propia pantalla, y
 * mientras no se abra no se pregunta ni uno.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useObdStore } from '../store/useObdStore';
import { textoLectura } from '../profiles';
import { C } from './theme';
import { Reloj } from './Reloj';
import { BarraLed } from './BarraLed';
import { useLuzDeCambio } from './ShiftLight';
import { colorAguja, mediana, RPM_MAX, RPM_ROJO } from './cambio';
import { useVisibles } from './useVisibles';

/** Lo único que se pregunta mientras esta pantalla está delante. */
const CLAVES = ['010C', '010D', '0105', 'gear', 'trs'];
/**
 * Las dos vías posibles para el nivel del tanque: el PID estándar y el
 * identificador Ford. Se preguntan las dos hasta que una conteste; a partir de
 * ahí solo se pregunta esa, para no gastar un comando por vuelta en la otra.
 */
const CLAVES_COMBUSTIBLE = ['012F', 'fuel_lvl'];
/** Cuántas lecturas entran en la mediana que se enseña. */
const MUESTRAS_COMBUSTIBLE = 5;

const POSICIONES = ['P', 'R', 'N', 'D', '3', '2', '1'];

function hora(t: number | undefined): string {
  if (!t) return '';
  const d = new Date(t);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function Cluster({ onSalir }: { onSalir: () => void }) {
  const router = useRouter();
  const readings = useObdStore(s => s.readings);
  const history = useObdStore(s => s.history);
  const perfil = useObdStore(s => s.selectedProfile);
  const dtcCodes = useObdStore(s => s.dtcCodes);
  const voltageWarning = useObdStore(s => s.voltageWarning);
  // Con el modo estricto la marcha, la palanca y el combustible de Ford nunca
  // se piden. Sin este aviso el tablero enseña rayas sin explicar por qué.
  const strictMode = useObdStore(s => s.strictMode);
  const { width, height } = useWindowDimensions();

  const defs = useMemo(() => {
    const m = new Map(perfil.moduleGroups.flatMap(g => g.pids).map(p => [p.key, p]));
    return m;
  }, [perfil]);

  /**
   * El combustible, en vivo como todo lo demás.
   *
   * Antes se pedía a ratos, con una ventana que se abría cada diez segundos y
   * se cerraba en cuanto llegaba una lectura. La idea era no gastarle vueltas a
   * la aguja por un dato que casi no cambia, pero en el teléfono el tanque no
   * llegaba a aparecer nunca: si el módulo tardaba más que la ventana, o la
   * ventana se cerraba en el momento equivocado, el número se quedaba en raya y
   * ahí seguía. Un dato que a veces no llega es peor que un dato que cuesta un
   * comando, así que ahora entra en la vuelta normal, para todos los perfiles.
   *
   * El precio es una lectura más por vuelta —de cinco identificadores a seis—,
   * unos cincuenta milisegundos. Los techos del bus no se tocan.
   *
   * Que salte con los baches se arregla aparte, con la mediana de las últimas
   * lecturas: un chapoteo suelto no mueve la mediana, un vaciado real sí.
   */
  const unsupported = useObdStore(s => s.unsupportedPids);
  const clavesComb = useMemo(
    () => CLAVES_COMBUSTIBLE.filter(k => defs.has(k) && !unsupported.has(k)),
    [defs, unsupported],
  );
  /** La primera que haya contestado. Mientras ninguna conteste, se piden todas. */
  const combViva = useMemo(
    () => clavesComb.find(k => readings.has(k)) ?? null,
    [clavesComb, readings],
  );
  const combFirma = (combViva ? [combViva] : clavesComb).join('|');

  const presentes = useMemo(
    () => [...CLAVES.filter(k => defs.has(k)), ...(combFirma ? combFirma.split('|') : [])],
    [defs, combFirma],
  );
  useVisibles('cluster', presentes);

  const val = (k: string) => readings.get(k)?.value ?? null;

  const comb = useMemo(() => {
    if (!combViva) return null;
    const h = history.get(combViva);
    if (h?.length) return mediana(h.slice(-MUESTRAS_COMBUSTIBLE).map(r => r.value));
    const v = readings.get(combViva)?.value;
    return v !== undefined && Number.isFinite(v) ? v : null;
  }, [combViva, history, readings]);

  const combT = combViva ? readings.get(combViva)?.timestamp : undefined;
  // Con el dato en vivo la hora sobra: solo se enseña cuando se ha quedado
  // atrás, que es justo cuando interesa saber de cuándo es.
  const combApunte = !clavesComb.length
    ? 'este vehículo no lo publica'
    : !combT ? 'leyendo…'
    : Date.now() - combT > 8000 ? hora(combT)
    : undefined;

  const rpm = val('010C');
  const vel = val('010D');
  const ect = val('0105');
  const marchaNum = val('gear');
  const trsCrudo = val('trs');

  const luz = useLuzDeCambio(rpm, marchaNum);
  const agujaRpm = colorAguja(rpm, luz.aviso);

  const defGear = defs.get('gear');
  const marcha = marchaNum !== null && defGear ? textoLectura(defGear, marchaNum) : '—';
  const defTrs = defs.get('trs');
  const trs = trsCrudo !== null && defTrs?.etiquetas ? defTrs.etiquetas[trsCrudo] ?? null : null;

  // Apaisado manda: es como se mira un tablero. En vertical se apilan.
  const apaisado = width > height;
  const alto = height - 130;
  const dial = apaisado
    ? Math.min(alto * 0.92, width * 0.31)
    : Math.min(width * 0.86, (height - 300) * 0.55);
  const dialChico = apaisado ? dial : dial * 0.62;

  const tacometro = (
    <Reloj
      valor={rpm} max={RPM_MAX} paso={1000} divisor={1000} tamano={dial}
      zonaRoja={RPM_ROJO} colorAguja={agujaRpm}
      centro={
        // La marcha va CENTRADA de verdad: sola en el flujo, con los dos
        // textos pequeños colocados encima y debajo en posición absoluta. Si
        // los tres fueran hermanos apilados, el grupo quedaría centrado pero la
        // marcha no, que es lo que se veía antes.
        <View style={[s.centroReloj, { width: dial * 0.52, height: dial * 0.52 }]}>
          <Text
            style={[s.marcha, { fontSize: dial * 0.21, lineHeight: dial * 0.24 }]}
            numberOfLines={1} adjustsFontSizeToFit
          >{marcha}</Text>
          <Text style={[s.centroSub, { position: 'absolute', top: dial * 0.055 }]}>x1000 rpm</Text>
          <Text style={[s.rpmTexto, { color: agujaRpm, position: 'absolute', bottom: dial * 0.045 }]}>
            {rpm !== null ? Math.round(rpm) : '—'}
          </Text>
        </View>
      }
    />
  );

  const velocimetro = (
    <Reloj
      valor={vel} max={200} paso={20} tamano={dialChico}
      centro={
        <View style={[s.centroReloj, { width: dialChico * 0.52, height: dialChico * 0.52 }]}>
          <Text
            style={[s.velocidad, { fontSize: dialChico * 0.27, lineHeight: dialChico * 0.30 }]}
            numberOfLines={1} adjustsFontSizeToFit
          >{vel !== null ? Math.round(vel) : '—'}</Text>
          <Text style={[s.centroSub, { position: 'absolute', bottom: dialChico * 0.05 }]}>km/h</Text>
        </View>
      }
    />
  );

  const selector = (
    <View style={s.selector}>
      {POSICIONES.map(p => {
        const on = trs === p;
        return (
          <View key={p} style={s.selHueco}>
            <Text style={[s.selLetra, on && s.selLetraOn]}>{p}</Text>
            <View style={[s.selRaya, on && { backgroundColor: C.rojoVivo }]} />
          </View>
        );
      })}
      {!trs && trsCrudo !== null && (
        <View style={s.selCrudo}><Text style={s.selCrudoTxt}>{trsCrudo}</Text></View>
      )}
    </View>
  );

  return (
    <View style={s.fondo}>
      <View style={s.barraSuperior}>
        <TouchableOpacity onPress={onSalir} hitSlop={10} style={s.iconoBtn}>
          <Ionicons name="power" size={16} color={C.rojo} />
        </TouchableOpacity>
        <View style={s.testigos}>
          {!!dtcCodes.length && (
            <View style={s.testigo}>
              <Ionicons name="warning" size={14} color={C.ambar} />
              <Text style={[s.testigoTxt, { color: C.ambar }]}>{dtcCodes.length}</Text>
            </View>
          )}
          {!!voltageWarning && <Ionicons name="battery-half" size={15} color={C.rojoVivo} />}
          {strictMode && (
            <View style={s.testigo}>
              <Ionicons name="lock-closed" size={12} color={C.ambar} />
              <Text style={[s.testigoTxt, { color: C.ambar }]}>ESTRICTO</Text>
            </View>
          )}
          <Text style={s.cadencia}>{luz.aprendidos ? `cambia ~${luz.punto} rpm` : 'aprendiendo el cambio'}</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/datos')} hitSlop={10} style={s.iconoBtn}>
          <Ionicons name="grid-outline" size={16} color={C.sub} />
        </TouchableOpacity>
      </View>

      {apaisado ? (
        <View style={s.filaApaisada}>
          {tacometro}
          <View style={s.centroApaisado}>{selector}</View>
          {velocimetro}
        </View>
      ) : (
        <View style={s.columnaVertical}>
          {tacometro}
          <View style={s.filaVertical}>
            {velocimetro}
            <View style={{ flex: 1, marginLeft: 12 }}>{selector}</View>
          </View>
        </View>
      )}

      <View style={s.barras}>
        <BarraLed
          titulo="REFRIGERANTE" valor={ect} min={40} max={130} unidad="°C"
          marcas={['40', '90', '130']} peligroDesde={0.78}
        />
        <View style={{ width: 16 }} />
        <BarraLed
          titulo="COMBUSTIBLE" valor={comb} min={0} max={100} unidad="%"
          marcas={['R', '1/2', '1/1']} peligroHasta={0.15}
          apunte={combApunte}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: '#060608', paddingHorizontal: 12, paddingBottom: 10 },

  barraSuperior: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 10 },
  iconoBtn: {
    width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.border, backgroundColor: C.card,
  },
  testigos: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  testigo: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  testigoTxt: { fontSize: 11, fontWeight: '900' },
  cadencia: { color: C.muted, fontSize: 9, letterSpacing: 0.5 },

  filaApaisada: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  centroApaisado: { flex: 1, paddingHorizontal: 10 },
  columnaVertical: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  filaVertical: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },

  centroReloj: { alignItems: 'center', justifyContent: 'center' },
  marcha: { color: '#FFFFFF', fontWeight: '900', letterSpacing: -1, includeFontPadding: false },
  centroSub: { color: C.sub, fontSize: 9, fontWeight: '700', letterSpacing: 1.6, marginTop: 1 },
  rpmTexto: { fontSize: 15, fontWeight: '900', marginTop: 3, letterSpacing: -0.5 },
  velocidad: { color: '#FFFFFF', fontWeight: '900', letterSpacing: -2, includeFontPadding: false },

  selector: {
    position: 'relative', flexDirection: 'row', backgroundColor: C.card,
    borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingVertical: 10,
  },
  selHueco: { flex: 1, alignItems: 'center' },
  selLetra: { color: C.muted, fontSize: 18, fontWeight: '800' },
  selLetraOn: { color: C.rojoVivo, fontSize: 21, fontWeight: '900' },
  selRaya: { height: 2, width: 15, borderRadius: 1, marginTop: 4, backgroundColor: 'transparent' },
  selCrudo: {
    position: 'absolute', right: 6, top: 4, backgroundColor: C.panel,
    borderRadius: 4, paddingHorizontal: 5, borderWidth: 1, borderColor: C.border,
  },
  selCrudoTxt: { color: C.sub, fontSize: 9, fontFamily: 'monospace' },

  barras: { flexDirection: 'row', marginTop: 10 },
});
