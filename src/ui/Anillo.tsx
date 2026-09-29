/**
 * Anillo: un valor dibujado como arco.
 *
 * Por qué un arco y no una barra: de reojo, con el carro en marcha, la POSICIÓN
 * del arco se lee sin tener que leer el número. Un número obliga a enfocar la
 * vista; un arco a tres cuartos de vuelta no.
 *
 * El arco va de 135° a 405°, o sea 270 grados con el hueco abajo. Es la
 * disposición de cualquier tablero, y hay un motivo: el hueco abajo deja sitio
 * para la etiqueta sin que se solape con el trazo.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, G, Line } from 'react-native-svg';
import { C } from './theme';

export interface Zona {
  /** Desde qué valor empieza esta zona. */
  desde: number;
  color: string;
}

export interface AnilloProps {
  valor: number | null;
  min: number;
  max: number;
  etiqueta: string;
  unidad?: string;
  /** Diámetro en puntos. */
  tamano?: number;
  color?: string;
  decimales?: number;
  /** Tramos con color propio, por ejemplo la zona roja del cuentavueltas. */
  zonas?: Zona[];
  /** Si el valor es un estado y no una medida: "D", "3ª", "PISADO". */
  texto?: string | null;
  /** Marcas alrededor del arco. Cuantas más, más fino se ve; también más caro. */
  marcas?: number;
  /** Texto pequeño debajo del número. */
  pie?: string;
}

const BARRIDO = 0.75;       // 270 de 360 grados
const INICIO = 135;         // grados, desde las 3 en punto

function AnilloBase({
  valor, min, max, etiqueta, unidad, tamano = 96, color = C.rojo,
  decimales = 0, zonas, texto, marcas = 0, pie,
}: AnilloProps) {
  const grosor = Math.max(5, Math.round(tamano * 0.075));
  const r = (tamano - grosor) / 2 - 1;
  const c = tamano / 2;
  const circunferencia = 2 * Math.PI * r;
  const pista = circunferencia * BARRIDO;

  const hay = valor !== null && Number.isFinite(valor);
  const rango = max - min || 1;
  const frac = hay ? Math.min(1, Math.max(0, (valor! - min) / rango)) : 0;

  // El color sale de la zona en la que caiga el valor. Así el cuentavueltas se
  // pone rojo solo por estar donde tiene que ponerse rojo, sin lógica aparte.
  let colorValor = color;
  if (hay && zonas) {
    for (const z of zonas) if (valor! >= z.desde) colorValor = z.color;
  }

  const numero = !hay ? '—'
    : texto ?? (decimales ? valor!.toFixed(decimales) : String(Math.round(valor!)));

  return (
    <View style={{ width: tamano, alignItems: 'center' }}>
      <View style={{ width: tamano, height: tamano }}>
        <Svg width={tamano} height={tamano}>
          <G rotation={INICIO} origin={`${c}, ${c}`}>
            {/* La pista: el recorrido completo, en gris */}
            <Circle
              cx={c} cy={c} r={r}
              stroke={C.linea} strokeWidth={grosor} fill="none"
              strokeDasharray={`${pista} ${circunferencia}`}
              strokeLinecap="round"
            />
            {/* Las zonas, pintadas por debajo del valor */}
            {zonas?.map((z, i) => {
              const f = Math.min(1, Math.max(0, (z.desde - min) / rango));
              return (
                <Circle
                  key={i} cx={c} cy={c} r={r}
                  stroke={z.color} strokeWidth={Math.max(2, grosor * 0.32)} fill="none"
                  strokeDasharray={`${pista * (1 - f)} ${circunferencia}`}
                  strokeDashoffset={-pista * f}
                  opacity={0.35}
                />
              );
            })}
            {/* El valor */}
            {hay && frac > 0 && (
              <Circle
                cx={c} cy={c} r={r}
                stroke={colorValor} strokeWidth={grosor} fill="none"
                strokeDasharray={`${pista * frac} ${circunferencia}`}
                strokeLinecap="round"
              />
            )}
            {/* Marcas finas, solo donde el tamaño las hace legibles */}
            {marcas > 0 && Array.from({ length: marcas + 1 }, (_, i) => {
              const ang = (i / marcas) * BARRIDO * 360;
              const rad = (ang * Math.PI) / 180;
              const r1 = r - grosor / 2 - 3;
              const r2 = r1 - (i % 5 === 0 ? 7 : 4);
              return (
                <Line
                  key={i}
                  x1={c + r1 * Math.cos(rad)} y1={c + r1 * Math.sin(rad)}
                  x2={c + r2 * Math.cos(rad)} y2={c + r2 * Math.sin(rad)}
                  stroke={i % 5 === 0 ? C.sub : C.muted}
                  strokeWidth={i % 5 === 0 ? 1.6 : 1}
                />
              );
            })}
          </G>
        </Svg>
        <View style={[StyleSheet.absoluteFill, s.centro]}>
          <Text
            style={[
              s.numero,
              { fontSize: Math.round(tamano * (texto ? 0.30 : 0.26)), color: hay ? C.text : C.muted },
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {numero}
          </Text>
          {!!unidad && !texto && (
            <Text style={[s.unidad, { fontSize: Math.max(8, Math.round(tamano * 0.10)) }]}>{unidad}</Text>
          )}
          {!!pie && <Text style={s.pie} numberOfLines={1}>{pie}</Text>}
        </View>
      </View>
      <Text style={s.etiqueta} numberOfLines={2}>{etiqueta}</Text>
    </View>
  );
}

/**
 * Memorizado por valor redondeado.
 *
 * Sin esto, cada anillo se redibujaría con cada vuelta del bucle de lectura
 * aunque su número no hubiera cambiado — y en esta pantalla hay más de treinta.
 */
export const Anillo = React.memo(AnilloBase, (a, b) => {
  const red = (v: number | null, d: number) =>
    v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d);
  return (
    red(a.valor, a.decimales ?? 0) === red(b.valor, b.decimales ?? 0) &&
    a.texto === b.texto && a.etiqueta === b.etiqueta &&
    a.min === b.min && a.max === b.max && a.color === b.color &&
    a.tamano === b.tamano && a.pie === b.pie
  );
});

const s = StyleSheet.create({
  centro: { alignItems: 'center', justifyContent: 'center' },
  numero: { fontWeight: '800', letterSpacing: -0.5, includeFontPadding: false },
  unidad: { color: C.sub, fontWeight: '600', marginTop: -1, letterSpacing: 0.3 },
  pie: { color: C.muted, fontSize: 8, marginTop: 1 },
  etiqueta: {
    color: C.sub, fontSize: 9.5, fontWeight: '700', textAlign: 'center',
    marginTop: 6, letterSpacing: 0.4, textTransform: 'uppercase',
  },
});
