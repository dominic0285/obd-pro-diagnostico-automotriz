/**
 * Barra de segmentos, como la de temperatura y combustible de un tablero.
 *
 * Se lee mejor que un número cuando vas conduciendo: no hace falta leer, basta
 * con ver cuántos segmentos quedan encendidos y de qué color está el último.
 * Pero el número también hace falta cuando quieres el dato exacto, así que va
 * al lado en pequeño.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C } from './theme';

const SEGMENTOS = 16;

export interface BarraLedProps {
  titulo: string;
  valor: number | null;
  min: number;
  max: number;
  /** Unidad del valor real. Si es '%', el porcentaje no se repite. */
  unidad: string;
  /** Etiquetas bajo la barra, repartidas a lo ancho. */
  marcas: string[];
  /** Por encima de esta fracción los segmentos salen en rojo. */
  peligroDesde?: number;
  /** Por debajo de esta fracción salen en rojo (para el combustible). */
  peligroHasta?: number;
  /** Texto pequeño a la derecha, como la hora de la última lectura. */
  apunte?: string;
  decimales?: number;
}

function BarraBase({
  titulo, valor, min, max, unidad, marcas, peligroDesde, peligroHasta, apunte, decimales = 0,
}: BarraLedProps) {
  const hay = valor !== null && Number.isFinite(valor);
  const f = hay ? Math.min(1, Math.max(0, (valor! - min) / (max - min || 1))) : 0;
  const encendidos = hay ? Math.max(1, Math.round(f * SEGMENTOS)) : 0;
  const pct = Math.round(f * 100);

  // En rojo cuando el propio valor está en la zona mala, no solo el último
  // segmento: así el número avisa igual que la barra.
  const enPeligro = hay && ((peligroDesde !== undefined && f > peligroDesde)
                         || (peligroHasta !== undefined && f <= peligroHasta));

  return (
    <View style={s.caja}>
      <View style={s.cabecera}>
        <Text style={s.titulo}>{titulo}</Text>
        <Text style={[s.valor, enPeligro && { color: C.rojoVivo }]}>
          {hay ? `${valor!.toFixed(decimales)}${unidad ? ' ' + unidad : ''}` : '—'}
        </Text>
        {unidad !== '%' && (
          <Text style={[s.pct, enPeligro && { color: C.rojoVivo }]}>{hay ? `${pct} %` : ''}</Text>
        )}
        {!!apunte && <Text style={s.apunte}>{apunte}</Text>}
      </View>
      <View style={s.barra}>
        {Array.from({ length: SEGMENTOS }, (_, i) => {
          const fi = (i + 1) / SEGMENTOS;
          const on = i < encendidos;
          const rojo = (peligroDesde !== undefined && fi > peligroDesde)
                    || (peligroHasta !== undefined && fi <= peligroHasta);
          return (
            <View key={i} style={[
              s.seg,
              { backgroundColor: on ? (rojo ? C.rojoVivo : '#CFE0E8') : '#1B1B21' },
            ]} />
          );
        })}
      </View>
      <View style={s.marcas}>
        {marcas.map((m, i) => (
          <Text key={i} style={[
            s.marca,
            i === 0 && peligroHasta !== undefined ? { color: C.rojo } : null,
            i === marcas.length - 1 && peligroDesde !== undefined ? { color: C.rojo } : null,
          ]}>{m}</Text>
        ))}
      </View>
    </View>
  );
}

export const BarraLed = React.memo(BarraBase, (a, b) =>
  Math.round((a.valor ?? -1) * 10) === Math.round((b.valor ?? -1) * 10) && a.apunte === b.apunte);

const s = StyleSheet.create({
  caja: { flex: 1 },
  cabecera: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 4, gap: 7 },
  titulo: { color: C.sub, fontSize: 10, fontWeight: '900', letterSpacing: 2 },
  valor: { color: C.text, fontSize: 14, fontWeight: '900', letterSpacing: -0.4 },
  pct: { color: C.sub, fontSize: 11, fontWeight: '700' },
  apunte: { color: C.muted, fontSize: 8.5, flex: 1, textAlign: 'right' },
  barra: { flexDirection: 'row', gap: 2, height: 12 },
  seg: { flex: 1, borderRadius: 1.5 },
  marcas: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 },
  marca: { color: C.muted, fontSize: 8.5, fontWeight: '700' },
});
