/**
 * El cuentavueltas grande, con la marcha metida en el centro.
 *
 * Es la pieza que se mira de reojo conduciendo, así que manda sobre todo lo
 * demás en tamaño. Dentro lleva la marcha porque revoluciones y marcha solo
 * significan algo juntas: 2500 rpm en 2ª y 2500 rpm en 6ª son dos situaciones
 * distintas del mismo motor.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, G, Line, Text as SvgText } from 'react-native-svg';
import { C } from './theme';

const BARRIDO = 0.75;
const INICIO = 135;
/** Corte de inyección del 4.6 V8 3V. */
export const RPM_MAX = 7000;
export const RPM_ROJO = 5600;

export interface TacometroProps {
  rpm: number | null;
  marcha: string | null;
  tamano: number;
  /** 0 a 1. Enciende el aro exterior cuando se acerca el cambio. */
  aviso?: number;
}

function TacometroBase({ rpm, marcha, tamano, aviso = 0 }: TacometroProps) {
  const grosor = Math.round(tamano * 0.055);
  const r = (tamano - grosor) / 2 - 2;
  const c = tamano / 2;
  const circ = 2 * Math.PI * r;
  const pista = circ * BARRIDO;

  const hay = rpm !== null && Number.isFinite(rpm);
  const frac = hay ? Math.min(1, Math.max(0, rpm! / RPM_MAX)) : 0;
  const fracRojo = RPM_ROJO / RPM_MAX;
  const enRojo = hay && rpm! >= RPM_ROJO;

  // Un color por tramo. El rojo del final no es decoración: por encima de 5600
  // este motor está en la zona en la que no conviene sostenerlo.
  const color = enRojo ? C.rojoVivo : aviso > 0.66 ? C.ambar : C.rojo;

  // Los números del 0 al 7, colocados por fuera del arco.
  const rTexto = r - grosor - 13;
  const numeros = Array.from({ length: 8 }, (_, i) => {
    const ang = INICIO + (i / 7) * BARRIDO * 360;
    const rad = (ang * Math.PI) / 180;
    return { n: i, x: c + rTexto * Math.cos(rad), y: c + rTexto * Math.sin(rad) };
  });

  return (
    <View style={{ width: tamano, height: tamano }}>
      <Svg width={tamano} height={tamano}>
        <G rotation={INICIO} origin={`${c}, ${c}`}>
          {/* Aro exterior de aviso: se enciende al acercarse el cambio */}
          {aviso > 0 && (
            <Circle
              cx={c} cy={c} r={r + grosor * 0.85}
              stroke={aviso > 0.66 ? C.rojoVivo : C.ambar}
              strokeWidth={Math.max(2, grosor * 0.28)} fill="none"
              strokeDasharray={`${pista} ${circ}`}
              opacity={0.25 + 0.75 * aviso}
              strokeLinecap="round"
            />
          )}
          <Circle
            cx={c} cy={c} r={r}
            stroke={C.linea} strokeWidth={grosor} fill="none"
            strokeDasharray={`${pista} ${circ}`} strokeLinecap="round"
          />
          {/* La zona roja, siempre marcada aunque no se esté en ella */}
          <Circle
            cx={c} cy={c} r={r}
            stroke={C.rojoApagado} strokeWidth={grosor} fill="none"
            strokeDasharray={`${pista * (1 - fracRojo)} ${circ}`}
            strokeDashoffset={-pista * fracRojo}
          />
          {hay && frac > 0 && (
            <Circle
              cx={c} cy={c} r={r}
              stroke={color} strokeWidth={grosor} fill="none"
              strokeDasharray={`${pista * frac} ${circ}`} strokeLinecap="round"
            />
          )}
          {/* Marcas cada 200 rpm, más largas cada 1000 */}
          {Array.from({ length: 36 }, (_, i) => {
            const f = i / 35;
            const ang = f * BARRIDO * 360;
            const rad = (ang * Math.PI) / 180;
            const gorda = i % 5 === 0;
            const r1 = r - grosor / 2 - 3;
            const r2 = r1 - (gorda ? 9 : 5);
            const rojo = f >= fracRojo;
            return (
              <Line
                key={i}
                x1={c + r1 * Math.cos(rad)} y1={c + r1 * Math.sin(rad)}
                x2={c + r2 * Math.cos(rad)} y2={c + r2 * Math.sin(rad)}
                stroke={rojo ? C.rojo : gorda ? C.sub : C.muted}
                strokeWidth={gorda ? 2 : 1.1}
              />
            );
          })}
        </G>
        {numeros.map(({ n, x, y }) => (
          <SvgText
            key={n} x={x} y={y + 4} fill={n * 1000 >= RPM_ROJO ? C.rojo : C.sub}
            fontSize={Math.round(tamano * 0.058)} fontWeight="700" textAnchor="middle"
          >
            {n}
          </SvgText>
        ))}
      </Svg>

      <View style={[StyleSheet.absoluteFill, s.centro]}>
        <Text style={s.marchaEtiqueta}>MARCHA</Text>
        <Text style={[s.marcha, { fontSize: Math.round(tamano * 0.17) }]}>
          {marcha ?? '—'}
        </Text>
        <View style={s.raya} />
        <Text
          style={[s.rpm, { fontSize: Math.round(tamano * 0.155), color: enRojo ? C.rojoVivo : C.text }]}
          numberOfLines={1} adjustsFontSizeToFit
        >
          {hay ? Math.round(rpm!) : '—'}
        </Text>
        <Text style={s.rpmUnidad}>RPM</Text>
      </View>
    </View>
  );
}

export const Tacometro = React.memo(TacometroBase, (a, b) =>
  Math.round((a.rpm ?? -1) / 10) === Math.round((b.rpm ?? -1) / 10) &&
  a.marcha === b.marcha && a.tamano === b.tamano &&
  Math.round((a.aviso ?? 0) * 8) === Math.round((b.aviso ?? 0) * 8));

const s = StyleSheet.create({
  centro: { alignItems: 'center', justifyContent: 'center' },
  marchaEtiqueta: { color: C.muted, fontSize: 9, fontWeight: '800', letterSpacing: 2.4 },
  marcha: { color: C.text, fontWeight: '900', letterSpacing: -1, includeFontPadding: false },
  raya: { height: 1, width: '38%', backgroundColor: C.border, marginVertical: 5 },
  rpm: { fontWeight: '900', letterSpacing: -1.5, includeFontPadding: false },
  rpmUnidad: { color: C.sub, fontSize: 10, fontWeight: '700', letterSpacing: 2, marginTop: -1 },
});
