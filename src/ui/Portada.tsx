/**
 * La pantalla de datos: todo lo que NO va en el cluster.
 *
 * Vive aparte a propósito. El cluster se mira conduciendo y ahí cada
 * identificador de más es retraso en la aguja del cuentavueltas; aquí se mira
 * parado, con tiempo, y no importa que una vuelta tarde dos segundos.
 *
 * Mientras esta pantalla no esté abierta no se pregunta ni uno de estos datos.
 *
 * Cada bloque declara qué claves necesita en el MISMO sitio donde declara qué
 * anillos pinta. Esa es la lección de la revisión: cuando la lista de lo que se
 * pide y la lista de lo que se enseña son dos listas distintas, se desincronizan
 * y la pantalla muestra datos rancios sin avisar.
 *
 * Y como es una lista con seguimiento de scroll, solo se le pregunta al
 * vehículo por los bloques que están dentro de la pantalla.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { useObdStore } from '../store/useObdStore';
import { textoLectura, type EnhancedPid } from '../profiles';
import { C, TONO } from './theme';
import { Anillo } from './Anillo';
import { useVisibles } from './useVisibles';

// ─── Qué enseña cada bloque ─────────────────────────────────────────────────
// Una sola lista por bloque: lo que se pinta y lo que se pide son lo mismo.

interface Item {
  k: string;
  /** Decimales del número; si no se dice, se decide por el rango. */
  d?: number;
  /** Nombre corto para la etiqueta, cuando el del perfil es largo. */
  n?: string;
  /**
   * Rango del arco, cuando el del perfil no sirve para mirar.
   *
   * El perfil guarda el rango FÍSICO del sensor —la presión de freno llega a
   * 20.000 kPa— y con ese rango un frenazo normal mueve el arco un dedo. Aquí
   * se pone el rango ÚTIL: aquel en el que el valor se pasa la vida.
   */
  min?: number;
  max?: number;
}

interface Seccion {
  id: string;
  titulo: string;
  tono: string;
  nota?: string;
  items: Item[];
}

const SECCIONES: Seccion[] = [
  {
    id: 'motor', titulo: 'Motor', tono: TONO.motor,
    items: [
      { k: '0104', n: 'Carga' }, { k: '010E', n: 'Avance', d: 1 }, { k: '010F', n: 'Aire admisión' },
      { k: '0105', n: 'Refrigerante' }, { k: 'cht', n: 'Culata' }, { k: '015C', n: 'Aceite' },
      { k: 'maf22', n: 'Flujo de aire', d: 2, min: 0, max: 60 }, { k: '0133', n: 'Barométrica' }, { k: '0111', n: 'Acelerador' },
    ],
  },
  {
    id: 'combustible', titulo: 'Combustible', tono: TONO.combustible,
    nota: 'La presión real y la deseada tienen que ir juntas. Si la real se queda atrás y no vuelve, ahí está el problema.',
    items: [
      { k: 'frp', n: 'Riel real', min: 0, max: 500 }, { k: 'frp_dsd', n: 'Riel deseada', min: 0, max: 500 }, { k: 'fuel_pump', n: 'Bomba' },
      { k: 'stft_b1', n: 'STFT B1', d: 1 }, { k: 'ltft_b1', n: 'LTFT B1', d: 1 }, { k: 'fuelsys', n: 'Sistema' },
      { k: 'stft_b2', n: 'STFT B2', d: 1 }, { k: 'ltft_b2', n: 'LTFT B2', d: 1 }, { k: 'frp_v', n: 'Señal riel', d: 2 },
    ],
  },
  {
    id: 'sondas', titulo: 'Sondas de oxígeno', tono: TONO.sondas,
    nota: 'Las delanteras tienen que oscilar sin parar. Una quieta significa que el motor está ciego de ese banco.',
    items: [
      { k: 'o2_b1s1_v', n: 'B1 delantera', d: 2 }, { k: 'o2_b1s2_v', n: 'B1 trasera', d: 2 }, { k: 'ro2ft_b1', n: 'Corrección B1', d: 2 },
      { k: 'o2_b2s1_v', n: 'B2 delantera', d: 2 }, { k: 'o2_b2s2_v', n: 'B2 trasera', d: 2 }, { k: 'ro2ft_b2', n: 'Corrección B2', d: 2 },
      { k: 'o2_htr_b1s1', n: 'Calef. B1 del.', d: 2 }, { k: 'o2_htr_b1s2', n: 'Calef. B1 tras.', d: 2 }, { k: 'o2_htr_bits', n: 'Mando calef.' },
    ],
  },
  {
    id: 'transmision', titulo: 'Transmisión', tono: TONO.transmision,
    items: [
      { k: 'tft', n: 'Temp. caja' }, { k: 'iss', n: 'Eje entrada', min: 0, max: 4000 }, { k: 'oss', n: 'Eje salida', min: 0, max: 3000 },
      { k: 'tcc_slip', n: 'Deslizamiento', min: -100, max: 600 }, { k: 'gear_ratio', n: 'Relación', d: 2, min: 0, max: 5 }, { k: 'gear', n: 'Marcha' },
    ],
  },
  {
    id: 'levas', titulo: 'Árboles de levas', tono: TONO.motor,
    nota: 'El error de avance tiene que quedarse cerca de cero. Lejos y sostenido es cadena o variador.',
    items: [
      { k: 'vct_adv_b1', n: 'Avance B1', d: 1 }, { k: 'vct_err_b1', n: 'Error B1', d: 2 }, { k: 'vct_dc_b1', n: 'Solenoide B1', d: 1 },
      { k: 'vct_adv_b2', n: 'Avance B2', d: 1 }, { k: 'vct_err_b2', n: 'Error B2', d: 2 }, { k: 'knock1', n: 'Detonación 1', min: 0, max: 400 },
    ],
  },
  {
    id: 'electrico', titulo: 'Carga eléctrica y clima', tono: TONO.electrico,
    items: [
      { k: 'vbatt_pcm', n: 'Voltaje', d: 2 }, { k: 'gen_v_dsd', n: 'Pedido', d: 2 }, { k: 'gen_cmd', n: 'Comando', d: 1 },
      { k: 'ac_press', n: 'Presión A/C', min: 0, max: 2600 }, { k: 'fan_duty', n: 'Ventilador', d: 1 }, { k: '012F', n: 'Combustible' },
    ],
  },
  {
    id: 'frenos', titulo: 'Frenos', tono: TONO.frenos,
    items: [
      { k: 'brake_press', n: 'Presión', min: 0, max: 6000 }, { k: 'brake_sw', n: 'Pedal' }, { k: 'booster_sw', n: 'Servofreno' },
    ],
  },
];

/** Lo que se lee siempre mientras esta pantalla esté delante. */
const CLAVES_CABECERA = ['010C', '010D', '0105', '012F', 'gear', 'trs', 'vbatt_pcm'];

/** Las posiciones del selector, en el orden en que están en la palanca. */
const POSICIONES = ['P', 'R', 'N', 'D', '3', '2', '1'];

// ─── Piezas ─────────────────────────────────────────────────────────────────

function Panel({ etiqueta, valor, unidad, color = C.text, ancho }: {
  etiqueta: string; valor: string; unidad?: string; color?: string; ancho?: boolean;
}) {
  return (
    <View style={[s.panel, ancho && { flex: 1 }]}>
      <Text style={s.panelEtiqueta}>{etiqueta}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text style={[s.panelValor, { color }]} numberOfLines={1} adjustsFontSizeToFit>{valor}</Text>
        {!!unidad && <Text style={s.panelUnidad}>{unidad}</Text>}
      </View>
    </View>
  );
}

function SelectorBase({ activa, crudo }: { activa: string | null; crudo: number | null }) {
  const conocida = activa !== null && POSICIONES.includes(activa);
  return (
    <View style={s.selector}>
      {POSICIONES.map(p => {
        const on = conocida && p === activa;
        return (
          <View key={p} style={s.selectorHueco}>
            <Text style={[s.selectorLetra, on && s.selectorLetraOn]}>{p}</Text>
            <View style={[s.selectorRaya, on && { backgroundColor: C.rojoVivo }]} />
          </View>
        );
      })}
      {!conocida && crudo !== null && (
        <View style={s.selectorDesconocido}>
          <Text style={s.selectorDesconocidoTxt}>{crudo}</Text>
        </View>
      )}
    </View>
  );
}
const Selector = React.memo(SelectorBase);

// ─── Portada ────────────────────────────────────────────────────────────────

/**
 * Fuera del componente a propósito: si se escribe dentro del render, cada
 * dibujado crea un objeto nuevo y React Native rehace el vigilante de
 * visibilidad. En una pantalla que se redibuja con cada vuelta de lecturas eso
 * termina en filas que nunca se leen.
 */
const VISIBILIDAD = { itemVisiblePercentThreshold: 15 };

export function PantallaDatos() {
  const {
    readings, selectedProfile, deviceName, adapter, dtcCodes, voltageWarning,
    disabledPids, unsupportedPids,
  } = useObdStore();

  const defs = useMemo(() => {
    const m = new Map<string, EnhancedPid>();
    for (const g of selectedProfile.moduleGroups) for (const p of g.pids) m.set(p.key, p);
    return m;
  }, [selectedProfile]);

  // Los bloques que este perfil puede enseñar de verdad. Un bloque cuyos datos
  // no existen en el perfil no se pinta: mejor que no esté a que esté vacío.
  const secciones = useMemo(
    () => SECCIONES
      .map(sec => ({ ...sec, items: sec.items.filter(i => defs.has(i.k)) }))
      .filter(sec => sec.items.length > 0),
    [defs],
  );

  const [visibles, setVisibles] = useState<string[]>([]);
  const visiblesRef = useRef<string[]>([]);

  const claves = useMemo(() => {
    const out = new Set(CLAVES_CABECERA.filter(k => defs.has(k)));
    for (const id of visibles) {
      const sec = secciones.find(x => x.id === id);
      if (sec) for (const i of sec.items) out.add(i.k);
    }
    return [...out];
  }, [visibles, secciones, defs]);

  useVisibles('principal', claves);

  const onVisibles = useRef(({ viewableItems }: { viewableItems: { item: Seccion | { id: string } }[] }) => {
    const ids = viewableItems.map(v => v.item.id).filter(x => x !== 'cabecera');
    if (ids.join('|') !== visiblesRef.current.join('|')) {
      visiblesRef.current = ids;
      setVisibles(ids);
    }
  }).current;

  const val = useCallback((k: string) => readings.get(k)?.value ?? null, [readings]);

  const anillo = (i: Item, tono: string) => {
    const d = defs.get(i.k);
    if (!d) return null;
    const v = val(i.k);
    const apagado = disabledPids.has(i.k) || unsupportedPids.has(i.k);
    const texto = v !== null && d.etiquetas ? (d.etiquetas[v] ?? null) : null;
    const min = i.min ?? d.min;
    const max = i.max ?? d.max;
    const dec = i.d ?? (max - min <= 5 ? 2 : max - min <= 50 ? 1 : 0);
    return (
      <Anillo
        key={i.k}
        valor={apagado ? null : v}
        min={min} max={max}
        etiqueta={i.n ?? d.name}
        unidad={texto ? undefined : d.unit}
        texto={texto}
        decimales={dec}
        color={tono}
        tamano={96}
      />
    );
  };

  const cabecera = (
    <View style={s.marca}>
      <View style={{ flex: 1 }}>
        <Text style={s.marcaTitulo}>DATOS</Text>
        <Text style={s.marcaSub}>TODO LO QUE NO VA EN EL CLUSTER</Text>
      </View>
    </View>
  );

  const datos = useMemo(() => [{ id: 'cabecera' } as any, ...secciones], [secciones]);

  return (
    <FlatList
      style={s.fondo}
      data={datos}
      keyExtractor={(x: any) => x.id}
      onViewableItemsChanged={onVisibles}
      viewabilityConfig={VISIBILIDAD}
      contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
      initialNumToRender={3}
      windowSize={7}
      renderItem={({ item }: any) => {
        if (item.id === 'cabecera') return cabecera;
        const sec = item as Seccion;
        return (
          <View style={s.seccion}>
            <View style={s.seccionCabecera}>
              <View style={[s.seccionMarca, { backgroundColor: sec.tono }]} />
              <Text style={s.seccionTitulo}>{sec.titulo.toUpperCase()}</Text>
            </View>
            {!!sec.nota && <Text style={s.seccionNota}>{sec.nota}</Text>}
            <View style={s.rejilla}>{sec.items.map(i => anillo(i, sec.tono))}</View>
          </View>
        );
      }}
    />
  );
}

const s = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: C.bg },

  marca: { flexDirection: 'row', alignItems: 'center' },
  marcaTitulo: { color: C.text, fontSize: 19, fontWeight: '900', letterSpacing: 3.5 },
  marcaSub: { color: C.muted, fontSize: 8.5, fontWeight: '700', letterSpacing: 3.2, marginTop: 2 },
  salir: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.rojoApagado, backgroundColor: C.card,
  },

  estadoFila: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 8 },
  estadoTxt: { color: C.muted, fontSize: 10, flex: 1, fontFamily: 'monospace' },
  pastilla: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, borderWidth: 1 },
  pastillaBuena: { borderColor: '#1D3A26' },
  pastillaMala: { borderColor: C.rojoApagado },
  pastillaTxt: { fontSize: 9, fontWeight: '900', letterSpacing: 1 },

  aviso: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10,
    backgroundColor: '#2A1E06', borderRadius: 8, padding: 9,
  },
  avisoTxt: { color: C.ambar, fontSize: 11, flex: 1 },

  filaPrincipal: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 14, marginBottom: 4,
  },

  velocidad: {
    backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    alignItems: 'center', paddingVertical: 10, marginTop: 10,
    borderLeftWidth: 3, borderLeftColor: C.rojo,
  },
  velocidadEtiqueta: { color: C.muted, fontSize: 9, fontWeight: '800', letterSpacing: 3 },
  velocidadValor: { color: C.text, fontSize: 46, fontWeight: '900', letterSpacing: -2, includeFontPadding: false },
  velocidadUnidad: { color: C.sub, fontSize: 13, fontWeight: '700', marginLeft: 6 },

  selector: {
    flexDirection: 'row', backgroundColor: C.card, borderRadius: 12,
    borderWidth: 1, borderColor: C.border, paddingVertical: 9, marginTop: 10,
  },
  selectorHueco: { flex: 1, alignItems: 'center' },
  selectorLetra: { color: C.muted, fontSize: 17, fontWeight: '800', letterSpacing: 1 },
  selectorLetraOn: { color: C.rojoVivo, fontSize: 19, fontWeight: '900' },
  selectorRaya: { height: 2, width: 14, borderRadius: 1, marginTop: 4, backgroundColor: 'transparent' },
  selectorDesconocido: {
    position: 'absolute', right: 8, top: 6,
    backgroundColor: C.panel, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1,
    borderWidth: 1, borderColor: C.border,
  },
  selectorDesconocidoTxt: { color: C.sub, fontSize: 9, fontFamily: 'monospace' },

  paneles: { flexDirection: 'row', gap: 10, marginTop: 10 },
  panel: {
    backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    paddingVertical: 9, paddingHorizontal: 12,
  },
  panelEtiqueta: { color: C.muted, fontSize: 8.5, fontWeight: '800', letterSpacing: 1.8 },
  panelValor: { fontSize: 24, fontWeight: '900', letterSpacing: -1, includeFontPadding: false, marginTop: 1 },
  panelUnidad: { color: C.sub, fontSize: 11, fontWeight: '700', marginLeft: 4 },

  seccion: {
    marginTop: 18, backgroundColor: C.card2, borderRadius: 14,
    borderWidth: 1, borderColor: C.border, padding: 12,
  },
  seccionCabecera: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  seccionMarca: { width: 3, height: 14, borderRadius: 2, marginRight: 8 },
  seccionTitulo: { color: C.text, fontSize: 11.5, fontWeight: '900', letterSpacing: 2.2 },
  seccionNota: { color: C.muted, fontSize: 10, lineHeight: 14, marginBottom: 8, marginTop: 2 },
  rejilla: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14 },
});
