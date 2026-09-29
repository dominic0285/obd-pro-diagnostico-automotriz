/**
 * Un reloj de tablero: esfera, graduación, números y aguja.
 *
 * La geometría sale del cluster que hizo el usuario: la aguja arranca a 140° y
 * barre 260°, que es la disposición de un tablero de verdad. El hueco de abajo
 * es donde va el texto central sin que la aguja lo tape nunca.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, G, Line, Polygon, Text as SvgText } from 'react-native-svg';
import { C } from './theme';

const INICIO = 140;
const BARRIDO = 260;

export interface RelojProps {
  valor: number | null;
  max: number;
  /** Cada cuánto va un número grande. */
  paso: number;
  /** Divide el número por esto al escribirlo (el cuentavueltas escribe miles). */
  divisor?: number;
  tamano: number;
  /** Desde dónde empieza la zona roja de la esfera. */
  zonaRoja?: number;
  /** Color de la aguja. En el cuentavueltas lo decide la luz de cambio. */
  colorAguja?: string;
  /** Lo grande del centro. */
  centro?: React.ReactNode;
}

const ang = (f: number) => INICIO + f * BARRIDO;
const rad = (g: number) => (g * Math.PI) / 180;

function RelojBase({
  valor, max, paso, divisor = 1, tamano, zonaRoja, colorAguja = C.rojoVivo, centro,
}: RelojProps) {
  const c = tamano / 2;
  const rTicks = tamano * 0.442;
  const rMayor = tamano * 0.392;
  const rMenor = tamano * 0.418;
  const rNum = tamano * 0.340;
  const rAro = tamano * 0.275;

  const hay = valor !== null && Number.isFinite(valor);
  const frac = hay ? Math.min(1, Math.max(0, valor! / max)) : 0;
  const aguja = rad(ang(frac));

  const pasos = Math.round(max / paso);
  const marcas: React.ReactNode[] = [];
  for (let i = 0; i <= pasos; i++) {
    const f = i / pasos;
    const a = rad(ang(f));
    const roja = zonaRoja !== undefined && f * max >= zonaRoja;
    marcas.push(
      <Line key={`M${i}`}
        x1={c + Math.cos(a) * rTicks} y1={c + Math.sin(a) * rTicks}
        x2={c + Math.cos(a) * rMayor} y2={c + Math.sin(a) * rMayor}
        stroke={roja ? C.rojoVivo : '#FFFFFF'} strokeWidth={tamano * 0.0105} />,
    );
    if (i < pasos) {
      const am = rad(ang(f + 0.5 / pasos));
      const rojaM = zonaRoja !== undefined && (f + 0.5 / pasos) * max >= zonaRoja;
      marcas.push(
        <Line key={`m${i}`}
          x1={c + Math.cos(am) * rTicks} y1={c + Math.sin(am) * rTicks}
          x2={c + Math.cos(am) * rMenor} y2={c + Math.sin(am) * rMenor}
          stroke={rojaM ? C.rojo : '#B9C4CC'} strokeWidth={tamano * 0.006} />,
      );
    }
  }

  const numeros: React.ReactNode[] = [];
  for (let i = 0; i <= pasos; i++) {
    const f = i / pasos;
    const a = rad(ang(f));
    const v = (i * paso) / divisor;
    const roja = zonaRoja !== undefined && i * paso >= zonaRoja;
    numeros.push(
      <SvgText key={i}
        x={c + Math.cos(a) * rNum} y={c + Math.sin(a) * rNum + tamano * 0.021}
        fill={roja ? C.rojoVivo : '#FFFFFF'} fontSize={tamano * 0.062}
        fontWeight="900" textAnchor="middle">{v}</SvgText>,
    );
  }

  // La aguja: un triángulo largo y afilado, como la del cluster de referencia.
  const largo = rTicks - tamano * 0.012;
  const base = rAro * 0.52;
  const ancho = tamano * 0.016;

  return (
    <View style={{ width: tamano, height: tamano }}>
      <Svg width={tamano} height={tamano}>
        <Circle cx={c} cy={c} r={tamano * 0.485} fill="#0B0B0E" stroke="#1F1F26" strokeWidth={1.5} />
        <Circle cx={c} cy={c} r={tamano * 0.462} fill="none" stroke="#2A2A33" strokeWidth={1} />

        {/* La zona roja de la esfera, la que marca el fabricante */}
        {zonaRoja !== undefined && (
          <Circle
            cx={c} cy={c} r={(rTicks + rAro) / 2}
            stroke={C.rojoApagado} strokeWidth={rTicks - rAro} fill="none"
            strokeDasharray={`${2 * Math.PI * ((rTicks + rAro) / 2) * (BARRIDO / 360) * (1 - zonaRoja / max)} ${2 * Math.PI * ((rTicks + rAro) / 2) * 4}`}
            strokeDashoffset={-2 * Math.PI * ((rTicks + rAro) / 2) * (BARRIDO / 360) * (zonaRoja / max)}
            transform={`rotate(${INICIO} ${c} ${c})`}
            opacity={0.55}
          />
        )}

        {marcas}
        {numeros}
        <Circle cx={c} cy={c} r={rAro} fill="none" stroke="#6E7C85" strokeWidth={2} />

        {hay && (
          <G rotation={ang(frac)} origin={`${c}, ${c}`}>
            <Polygon
              points={`${c + base},${c - ancho} ${c + largo - 4},${c - 0.9} ${c + largo},${c} ${c + largo - 4},${c + 0.9} ${c + base},${c + ancho}`}
              fill={colorAguja}
            />
          </G>
        )}
        <Circle cx={c} cy={c} r={tamano * 0.035} fill="#15151A" stroke="#6E7C85" strokeWidth={1.5} />
      </Svg>
      <View style={[StyleSheet.absoluteFill, s.centro]} pointerEvents="none">{centro}</View>
    </View>
  );
}

export const Reloj = React.memo(RelojBase, (a, b) =>
  Math.round((a.valor ?? -1) * 2) === Math.round((b.valor ?? -1) * 2) &&
  a.max === b.max && a.tamano === b.tamano && a.colorAguja === b.colorAguja &&
  a.centro === b.centro);

const s = StyleSheet.create({
  centro: { alignItems: 'center', justifyContent: 'center' },
});
