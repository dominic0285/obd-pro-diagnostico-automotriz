import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Dimensions, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useObdStore } from '../../src/store/useObdStore';
import { useVisibles } from '../../src/ui/useVisibles';
import { C } from '../../src/ui/theme';

const { width } = Dimensions.get('window');
const CHART_WIDTH = width - 64;
const CHART_HEIGHT = 160;

/**
 * Ocho colores para ocho cilindros. Tienen que distinguirse entre sí de un
 * vistazo, así que no pueden ser todos rojos; pero sin neón: bajados de
 * saturación para que en una pantalla al sol no vibren unos contra otros.
 */
const CYLINDER_COLORS = [
  '#D81F14', // Cil 1
  '#C25A12', // Cil 2
  '#B8901A', // Cil 3
  '#5E9B3A', // Cil 4
  '#2C8FA8', // Cil 5
  '#2C74D6', // Cil 6
  '#7A6BD0', // Cil 7
  '#B4508A', // Cil 8
];

/** 4.6L V8 Ford: banco 1 = cilindros 1-4, banco 2 = cilindros 5-8. */
const BANK_OF = (cyl: number) => (cyl <= 4 ? 1 : 2);

/**
 * Orden de encendido del 4.6 modular. Los escáneres de taller dibujan el
 * balance en ESTE orden y no en el numérico, porque así los picos salen en la
 * misma secuencia en que el motor los produce y un cilindro flojo se ve como
 * un diente hundido en vez de como un dato suelto.
 */
const FIRING_ORDER = [1, 3, 7, 2, 6, 5, 4, 8];

type Metric = 'fallos' | 'chispa' | 'equilibrio' | 'vct';

function fmt(v: number | undefined, unit: string, digits = 1): string {
  if (v === undefined || !Number.isFinite(v)) return '—';
  return `${Number(v.toFixed(digits))}${unit ? ' ' + unit : ''}`;
}

export default function CylindersScreen() {
  const { connectionState, selectedProfile, readings, history, strictMode, limpiarHistorial } = useObdStore();
  const isConnected = connectionState === 'connected';
  const isFord = selectedProfile.id === 'ford_explorer_2010';
  const [selectedMetric, setSelectedMetric] = useState<Metric>('fallos');

  // Solo se le pregunta al vehículo por lo que muestra la pestaña abierta.
  // Cambiar de pestaña cambia lo que se lee; no hay nada leyéndose de fondo.
  // OJO al tocar esto: esta lista tiene que contener TODO lo que la pestaña
  // pinta. Si se queda corta, el dato que falta no se pide y la pantalla lo
  // muestra en blanco o con el valor rancio de hace diez minutos, sin avisar.
  // Ya pasó: la pestaña de equilibrio enseñaba las correcciones de combustible
  // de los dos bancos e invitaba a compararlas, y no las estaba pidiendo.
  const CIL = Array.from({ length: 8 }, (_, i) => `cyl${i + 1}_m06`);
  const CLAVES: Record<Metric, string[]> = {
    fallos: [...CIL, 'misfire_general', 'misfire_total', 'mp_lrn'],
    chispa: Array.from({ length: 8 }, (_, i) => `spark_dur_${i + 1}`),
    equilibrio: [...CIL, 'stft_b1', 'ltft_b1', 'stft_b2', 'ltft_b2'],
    vct: ['vct_adv_b1', 'vct_err_b1', 'vct_dc_b1', 'vct_adv_b2', 'vct_err_b2', 'vct_dc_b2'],
  };
  useVisibles('cilindros', isConnected && isFord ? CLAVES[selectedMetric] : []);

  if (!isConnected) {
    return (
      <View style={[styles.container, styles.center]}>
        <Ionicons name="hardware-chip-outline" size={60} color="#131317" />
        <Text style={styles.notConnected}>Sin Conexión</Text>
        <Text style={styles.notConnectedSub}>Conecta el escáner para ver el diagnóstico de cilindros</Text>
      </View>
    );
  }

  if (!isFord) {
    return (
      <View style={[styles.container, styles.center]}>
        <Ionicons name="alert-circle-outline" size={60} color="#C25A12" />
        <Text style={styles.notConnected}>Perfil no compatible</Text>
        <Text style={styles.notConnectedSub}>
          Selecciona el perfil "Ford Explorer 2010" con el botón del vehículo en el Panel.
        </Text>
      </View>
    );
  }

  // ── Datos por cilindro: Modo 06, monitores A2..A9, prueba 0C ──────────────
  // Confirmado en el vehículo el 11/09/2026. El Modo 06 se autodescribe: el PCM
  // publica qué monitores tiene, así que aquí no se adivina ningún identificador.
  const cylKeys = Array.from({ length: 8 }, (_, i) => `cyl${i + 1}_m06`);
  const cylHistories = cylKeys.map(k => history.get(k) || []);
  const cylValues = cylKeys.map(k => readings.get(k)?.value);
  const anyCylData = cylValues.some(v => v !== undefined);

  const allValues = cylHistories.flatMap(h => h.map(r => r.value));
  const maxVal = Math.max(10, ...allValues);

  // ── Equilibrio pasivo ────────────────────────────────────────────────────
  const known = cylValues.map(v => (v === undefined ? 0 : v));
  const totalMisfires = known.reduce((a, b) => a + b, 0);
  const meanMisfires = totalMisfires / 8;
  const maxCyl = Math.max(...known);
  const worstIdx = known.indexOf(maxCyl);
  const bank1 = known.slice(0, 4).reduce((a, b) => a + b, 0);
  const bank2 = known.slice(4).reduce((a, b) => a + b, 0);

  const stftB1 = readings.get('stft_b1')?.value;
  const ltftB1 = readings.get('ltft_b1')?.value;
  const stftB2 = readings.get('stft_b2')?.value;
  const ltftB2 = readings.get('ltft_b2')?.value;
  const totB1 = (stftB1 ?? 0) + (ltftB1 ?? 0);
  const totB2 = (stftB2 ?? 0) + (ltftB2 ?? 0);

  let verdict = 'Aún no hay datos suficientes. Deja el motor encendido unos minutos con la app leyendo.';
  let verdictColor = '#56565F';
  if (anyCylData) {
    if (totalMisfires === 0) {
      verdict = 'Ningún cilindro acumula fallos. Con el motor caliente y al ralentí, esto es lo que se espera de un motor sano.';
      verdictColor = '#2FA84F';
    } else if (maxCyl >= 10 && maxCyl > meanMisfires * 3) {
      verdict = `El cilindro ${worstIdx + 1} concentra ${Math.round((maxCyl / totalMisfires) * 100)} % de los fallos. Cuando un solo cilindro destaca así, lo habitual es bobina, bujía o inyector de ESE cilindro, no un problema general.`;
      verdictColor = '#D81F14';
    } else if (bank1 > 0 && bank2 === 0 && bank1 >= 10) {
      verdict = 'Los fallos están todos en el banco 1 (cilindros 1-4). Un banco entero apunta a algo común a ese lado: sensor de leva/VCT de ese banco, entrada de aire falsa, o combustible.';
      verdictColor = '#C25A12';
    } else if (bank2 > 0 && bank1 === 0 && bank2 >= 10) {
      verdict = 'Los fallos están todos en el banco 2 (cilindros 5-8). Un banco entero apunta a algo común a ese lado: sensor de leva/VCT de ese banco, entrada de aire falsa, o combustible.';
      verdictColor = '#C25A12';
    } else if (totalMisfires < 10) {
      verdict = 'Hay algún fallo suelto repartido. Cantidades pequeñas son normales tras un arranque en frío o al pisar y soltar el acelerador.';
      verdictColor = '#E8930C';
    } else {
      verdict = 'Los fallos están repartidos entre varios cilindros. Eso apunta más a algo común a todo el motor (presión de combustible, distribución/cadenas, fugas de vacío, MAF) que a una pieza de un solo cilindro.';
      verdictColor = '#C25A12';
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Selector de vista */}
      <View style={styles.metricTabs}>
        {([
          ['fallos', 'Fallos'],
          ['chispa', 'Chispa'],
          ['equilibrio', 'Equilibrio'],
          ['vct', 'VCT'],
        ] as [Metric, string][]).map(([id, label]) => (
          <TouchableOpacity
            key={id}
            style={[styles.metricTab, selectedMetric === id && styles.metricTabActive]}
            onPress={() => setSelectedMetric(id)}
          >
            <Text style={[styles.metricTabText, selectedMetric === id && styles.metricTabTextActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ══ FALLOS ══════════════════════════════════════════════════════════ */}
      {selectedMetric === 'fallos' && (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Fallos de encendido por cilindro</Text>
            <Text style={styles.cardSub}>
              Modo 06 · monitores A2–A9, prueba 0C. Confirmado en tu Explorer el 11/09/2026.
              Es un contador acumulado que el PCM lleva por su cuenta.
            </Text>

            {!anyCylData && (
              <View style={styles.infoBox}>
                <Text style={styles.infoText}>
                  Todavía no llega ningún valor. Estos datos solo existen con el motor en marcha:
                  arranca y espera una vuelta o dos del bucle de lectura.
                </Text>
              </View>
            )}

            <View style={[styles.chartContainer, { width: CHART_WIDTH, height: CHART_HEIGHT }]}>
              <View style={styles.gridLine} />
              <View style={[styles.gridLine, { top: CHART_HEIGHT / 2 }]} />

              {cylHistories.map((h, cylIdx) => {
                if (h.length < 2) return null;
                const color = CYLINDER_COLORS[cylIdx];
                const step = CHART_WIDTH / Math.max(1, h.length - 1);

                return (
                  <View key={cylIdx} style={StyleSheet.absoluteFill}>
                    {h.slice(0, -1).map((pt, i) => {
                      const x1 = i * step;
                      const y1 = CHART_HEIGHT - (pt.value / maxVal) * (CHART_HEIGHT - 10) - 5;
                      const x2 = (i + 1) * step;
                      const y2 = CHART_HEIGHT - (h[i + 1].value / maxVal) * (CHART_HEIGHT - 10) - 5;
                      const dx = x2 - x1;
                      const dy = y2 - y1;
                      const length = Math.sqrt(dx * dx + dy * dy);
                      const angle = Math.atan2(dy, dx) * (180 / Math.PI);

                      return (
                        <View
                          key={i}
                          style={{
                            position: 'absolute',
                            left: x1,
                            top: y1,
                            width: length,
                            height: 2.5,
                            backgroundColor: color,
                            transform: [{ rotate: `${angle}deg` }],
                            transformOrigin: '0 0',
                          }}
                        />
                      );
                    })}
                  </View>
                );
              })}
            </View>

            <View style={styles.legendGrid}>
              {Array.from({ length: 8 }, (_, i) => {
                const v = cylValues[i];
                const color = CYLINDER_COLORS[i];
                return (
                  <View key={i} style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: color }]} />
                    <Text style={styles.legendText}>Cil {i + 1}:</Text>
                    <Text style={[styles.legendValue, { color }]}>
                      {v === undefined ? '—' : `${v} cnt`}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Totales del motor</Text>
            <Text style={styles.cardSub}>Contadores globales, para contrastar con la suma por cilindro.</Text>
            <Row label="Monitor general (Modo 06 · A1)" value={fmt(readings.get('misfire_general')?.value, 'cnt', 0)} />
            <Row label="Suma de los 8 cilindros" value={anyCylData ? `${totalMisfires} cnt` : '—'} />
            <Row label="Acumulador total (221616)" value={fmt(readings.get('misfire_total')?.value, 'cnt', 0)} />
            <Row label="Perfil de la rueda aprendido" value={readings.get('mp_lrn') ? (readings.get('mp_lrn')!.value ? 'sí' : 'todavía no') : '—'} />
          </View>
        </>
      )}

      {/* ══ CHISPA ══════════════════════════════════════════════════════════ */}
      {selectedMetric === 'chispa' && (() => {
        const keys = FIRING_ORDER.map(n => `spark_dur_${n}`);
        const hist = keys.map(k => history.get(k) ?? []);
        const vals = keys.map(k => readings.get(k)?.value);
        const hay = vals.some(v => v !== undefined);
        const n = Math.min(...hist.map(h => h.length));
        const todos = hist.flatMap(h => h.map(r => r.value)).concat(vals.filter((v): v is number => v !== undefined));
        const lo = todos.length ? Math.min(...todos) : 0;
        const hi = todos.length ? Math.max(...todos) : 1;
        const margen = Math.max(0.08, (hi - lo) * 0.25);
        const min = lo - margen, max = hi + margen;
        const colW = CHART_WIDTH / 8;
        const px = (i: number) => colW * i + colW / 2;
        const py = (v: number) => CHART_HEIGHT - ((v - min) / Math.max(0.0001, max - min)) * (CHART_HEIGHT - 16) - 8;
        const muestras = Math.min(n, 60);

        return (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Balance de chispa</Text>
              <Text style={styles.cardSub}>
                En orden de encendido — 1, 3, 7, 2, 6, 5, 4, 8 — igual que lo dibujan los
                escáneres de taller.{'\n'}{'\n'}
                CADA LÍNEA ES UNA LECTURA COMPLETA de los ocho cilindros en un mismo instante,
                no un cilindro a lo largo del tiempo. La línea azul gruesa es la de ahora
                mismo; las grises son las anteriores, y se van borrando cuanto más viejas son.
                Si las grises y la azul se apilan, el motor es estable.
              </Text>

              {!hay ? (
                <View style={styles.infoBox}>
                  <Text style={styles.infoText}>
                    Todavía no llegan datos. La duración de chispa solo existe con el motor en
                    marcha. Arranca y deja la app leyendo medio minuto para que se acumulen
                    líneas suficientes.
                  </Text>
                </View>
              ) : (
                <View style={[styles.chartContainer, { width: CHART_WIDTH, height: CHART_HEIGHT }]}>
                  {[0.25, 0.5, 0.75].map(f => (
                    <View key={f} style={[styles.gridLine, { top: CHART_HEIGHT * f }]} />
                  ))}
                  {Array.from({ length: 7 }, (_, i) => (
                    <View key={`v${i}`} style={[styles.gridCol, { left: colW * (i + 1) }]} />
                  ))}

                  {Array.from({ length: muestras }, (_, s) => {
                    const idx = n - muestras + s;
                    const ultima = s === muestras - 1;
                    return (
                      <View key={s} style={StyleSheet.absoluteFill}>
                        {hist.slice(0, -1).map((h, i) => {
                          const a = h[idx]?.value, b = hist[i + 1][idx]?.value;
                          if (a === undefined || b === undefined) return null;
                          const x1 = px(i), y1 = py(a), x2 = px(i + 1), y2 = py(b);
                          const dx = x2 - x1, dy = y2 - y1;
                          const len = Math.sqrt(dx * dx + dy * dy);
                          return (
                            <View key={i} style={{
                              position: 'absolute', left: x1, top: y1, width: len,
                              height: ultima ? 3 : 1,
                              // La última lectura en color vivo; la estela en gris
                              // azulado y desvaneciéndose con la antigüedad, para
                              // que se distinga de un vistazo qué es AHORA y qué
                              // es el rastro de antes.
                              backgroundColor: ultima ? C.rojo : '#6E6E78',
                              opacity: ultima ? 1 : 0.06 + 0.20 * (s / Math.max(1, muestras - 1)),
                              transform: [{ rotate: `${Math.atan2(dy, dx) * (180 / Math.PI)}deg` }],
                              transformOrigin: '0 0',
                            }} />
                          );
                        })}
                      </View>
                    );
                  })}
                </View>
              )}

              <View style={styles.firingRow}>
                {FIRING_ORDER.map((cyl, i) => (
                  <View key={cyl} style={[styles.firingCell, { width: colW }]}>
                    <Text style={[styles.firingNum, { color: CYLINDER_COLORS[cyl - 1] }]}>{cyl}</Text>
                    <Text style={styles.firingVal}>{vals[i] === undefined ? '—' : vals[i]!.toFixed(2)}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.pieRow}>
                <Text style={[styles.hint, { flex: 1 }]}>
                  Lecturas acumuladas: {n}. Milisegundos de arco en cada bujía.
                </Text>
                <TouchableOpacity
                  style={styles.btnLimpiar}
                  onPress={() => limpiarHistorial(keys)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="refresh" size={13} color={C.rojo} />
                  <Text style={styles.btnLimpiarTexto}>Limpiar estela</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Cómo se lee</Text>
              <Text style={styles.hint}>
                Esto NO es una prueba de corte: la app no le manda nada al motor, solo lee un
                dato que el PCM ya calcula. Por eso se puede hacer rodando.{'\n'}{'\n'}
                • Lo que importa no es el número, es la forma. Con ocho cilindros sanos las
                líneas se apilan casi encima unas de otras.{'\n'}
                • Un cilindro que siempre queda por encima suele tener mezcla pobre o la bujía
                gastada: la chispa tarda más en quemar.{'\n'}
                • Uno que siempre queda por debajo, lo contrario: mezcla rica o exceso de
                conductividad.{'\n'}
                • Una sola lectura no dice nada. Lo que vale es que el mismo cilindro se
                despegue en muchas lecturas seguidas.
              </Text>
            </View>
          </>
        );
      })()}

      {/* ══ EQUILIBRIO ══════════════════════════════════════════════════════ */}
      {selectedMetric === 'equilibrio' && (
        <>
          <View style={[styles.card, styles.warnCard]}>
            <Text style={styles.warnTitle}>Qué es esto y qué no es</Text>
            <Text style={styles.warnText}>
              El escáner del taller hace una prueba ACTIVA: le ordena al PCM cortar un inyector o una
              bobina y mide cuánto caen las RPM. Esa orden usa servicios de control de actuadores
              (2F / 31), y esos están bloqueados en esta app a propósito: son escritura sobre el
              motor, y es justo lo que acordamos no tocar.
            </Text>
            <Text style={styles.warnText}>
              Lo de abajo es la versión PASIVA: el mismo diagnóstico, deducido de datos que el PCM ya
              calcula solo. No corta nada, no escribe nada. Es más lento de interpretar, pero señala
              al mismo sitio.
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Reparto de fallos entre cilindros</Text>
            <Text style={styles.cardSub}>
              Barras comparadas con el peor cilindro. Lo que importa no es el número, es si uno se
              despega de los demás.
            </Text>
            {Array.from({ length: 8 }, (_, i) => {
              const v = cylValues[i];
              const val = v ?? 0;
              const pct = maxCyl > 0 ? (val / maxCyl) * 100 : 0;
              const bad = maxCyl >= 10 && val === maxCyl && val > meanMisfires * 3;
              return (
                <View key={i} style={styles.barRow}>
                  <Text style={styles.barLabel}>Cil {i + 1}</Text>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        { width: `${Math.max(pct, val > 0 ? 3 : 0)}%`, backgroundColor: bad ? '#D81F14' : CYLINDER_COLORS[i] },
                      ]}
                    />
                  </View>
                  <Text style={[styles.barValue, bad && { color: '#D81F14' }]}>
                    {v === undefined ? '—' : val}
                  </Text>
                  <Text style={styles.barBank}>B{BANK_OF(i + 1)}</Text>
                </View>
              );
            })}

            <View style={[styles.verdictBox, { borderLeftColor: verdictColor }]}>
              <Text style={[styles.verdictText, { color: verdictColor }]}>{verdict}</Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Combustible por banco</Text>
            <Text style={styles.cardSub}>
              Cuánto está corrigiendo el PCM. Positivo = está metiendo más gasolina porque la mezcla
              le sale pobre. Por encima de ±10 % ya es una pista seria; por encima de ±25 % salta un código.
            </Text>
            <View style={styles.fuelRow}>
              <View style={styles.bankCard}>
                <Text style={styles.bankTitle}>BANCO 1 · Cil 1-4</Text>
                <Text style={styles.fuelValue}>STFT: {fmt(stftB1, '%')}</Text>
                <Text style={styles.fuelValue}>LTFT: {fmt(ltftB1, '%')}</Text>
                <Text style={[styles.fuelTotal, Math.abs(totB1) > 10 && { color: '#C25A12' }]}>
                  Total: {stftB1 === undefined && ltftB1 === undefined ? '—' : fmt(totB1, '%')}
                </Text>
                <Text style={styles.bankMisfire}>Fallos del banco: {anyCylData ? bank1 : '—'}</Text>
              </View>
              <View style={styles.bankCard}>
                <Text style={styles.bankTitle}>BANCO 2 · Cil 5-8</Text>
                <Text style={styles.fuelValue}>STFT: {fmt(stftB2, '%')}</Text>
                <Text style={styles.fuelValue}>LTFT: {fmt(ltftB2, '%')}</Text>
                <Text style={[styles.fuelTotal, Math.abs(totB2) > 10 && { color: '#C25A12' }]}>
                  Total: {stftB2 === undefined && ltftB2 === undefined ? '—' : fmt(totB2, '%')}
                </Text>
                <Text style={styles.bankMisfire}>Fallos del banco: {anyCylData ? bank2 : '—'}</Text>
              </View>
            </View>
            <Text style={styles.hint}>
              Si un banco corrige mucho más que el otro, el problema es de ese lado. Si los dos
              corrigen igual y mucho, es algo común: presión de combustible, MAF o una fuga de vacío.
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Cómo leerlo junto</Text>
            <Text style={styles.hint}>
              • Un cilindro con fallos y su banco corrigiendo normal → pieza de ese cilindro (bobina,
              bujía, inyector).{'\n'}
              • Un banco entero con fallos y ese banco corrigiendo mucho → aire falso, inyectores
              sucios o el VCT de ese lado (míralo en la pestaña de al lado).{'\n'}
              • Fallos repartidos por los ocho y los dos bancos corrigiendo igual → combustible o
              distribución, no una pieza suelta.
            </Text>
          </View>
        </>
      )}

      {/* ══ VCT ═════════════════════════════════════════════════════════════ */}
      {selectedMetric === 'vct' && (
        strictMode ? (
          <View style={[styles.card, styles.warnCard]}>
            <Text style={styles.warnTitle}>Modo estricto activo</Text>
            <Text style={styles.warnText}>
              Los datos de árbol de levas van por Modo 22 (lectura ampliada de Ford), que el modo
              estricto no envía. Desactívalo en Ajustes → Seguridad si quieres verlos. Los fallos por
              cilindro de las otras pestañas SÍ funcionan en modo estricto: usan Modo 06, que es OBD2
              estándar.
            </Text>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Árboles de levas (VCT 3V)</Text>
            <Text style={styles.cardSub}>
              DIDs confirmados en tu vehículo el 11/09. En el 4.6L 3V el desgaste de los tensores y
              los fasers es un clásico: si el "error de avance" se queda lejos de cero con el motor
              caliente, ese lado no está llegando donde el PCM le pide.
            </Text>
            {[1, 2].map(b => (
              <View key={b} style={styles.vctBlock}>
                <Text style={styles.vctBank}>BANCO {b} · Cilindros {b === 1 ? '1-4' : '5-8'}</Text>
                <Row label="Avance de leva" value={fmt(readings.get(`vct_adv_b${b}`)?.value, '° cig')} />
                <Row
                  label="Error de avance"
                  value={fmt(readings.get(`vct_err_b${b}`)?.value, '° leva')}
                  danger={Math.abs(readings.get(`vct_err_b${b}`)?.value ?? 0) > 5}
                />
                <Row label="Ciclo del solenoide" value={fmt(readings.get(`vct_dc_b${b}`)?.value, '%')} />
              </View>
            ))}
            <Text style={styles.hint}>
              Con el motor caliente y al ralentí lo normal es avance cerca de 0, error cerca de 0 y
              el solenoide trabajando poco. Un error grande y sostenido en un solo banco, junto con
              fallos en los cilindros de ese banco, es la firma típica de cadena o faser gastado.
            </Text>
          </View>
        )
      )}
    </ScrollView>
  );
}

function Row({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, danger && { color: '#D81F14' }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pieRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  btnLimpiar: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10,
                paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#D81F1455' },
  btnLimpiarTexto: { color: '#D81F14', fontSize: 11, fontWeight: '700' },
  container: { flex: 1, backgroundColor: '#08080A', padding: 16 },
  center: { justifyContent: 'center', alignItems: 'center' },
  notConnected: { color: '#F2F2F5', fontSize: 18, fontWeight: '700', marginTop: 16 },
  notConnectedSub: { color: '#56565F', fontSize: 13, marginTop: 8, textAlign: 'center', maxWidth: 280 },
  metricTabs: { flexDirection: 'row', gap: 6, marginBottom: 14 },
  metricTab: { flex: 1, paddingVertical: 10, backgroundColor: '#131317', borderRadius: 8, alignItems: 'center' },
  metricTabActive: { backgroundColor: '#D81F14' },
  metricTabText: { color: '#93939E', fontSize: 11, fontWeight: '700' },
  metricTabTextActive: { color: '#08080A' },
  card: { backgroundColor: '#131317', borderRadius: 16, padding: 16, marginBottom: 14 },
  cardTitle: { color: '#F2F2F5', fontSize: 15, fontWeight: '700' },
  cardSub: { color: '#56565F', fontSize: 11, marginTop: 4, marginBottom: 14, lineHeight: 16 },
  infoBox: { backgroundColor: '#08080A', borderRadius: 8, padding: 10, marginBottom: 12 },
  infoText: { color: '#93939E', fontSize: 11, lineHeight: 16 },
  warnCard: { borderWidth: 1, borderColor: '#C25A1240' },
  warnTitle: { color: '#C25A12', fontSize: 14, fontWeight: '800', marginBottom: 8 },
  warnText: { color: '#cbd5e1', fontSize: 12, lineHeight: 18, marginBottom: 8 },
  chartContainer: { backgroundColor: '#08080A', borderRadius: 10, overflow: 'hidden', position: 'relative' },
  gridLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#131317' },
  gridCol: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: '#131317' },
  firingRow: { flexDirection: 'row', marginTop: 8 },
  firingCell: { alignItems: 'center' },
  firingNum: { fontSize: 12, fontWeight: '800' },
  firingVal: { color: '#93939E', fontSize: 10, fontVariant: ['tabular-nums'], marginTop: 2 },
  legendGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  legendItem: { width: '48%', flexDirection: 'row', alignItems: 'center', backgroundColor: '#08080A', padding: 8, borderRadius: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  legendText: { color: '#93939E', fontSize: 11, flex: 1 },
  legendValue: { fontSize: 12, fontWeight: '800' },
  barRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  barLabel: { color: '#93939E', fontSize: 11, width: 38 },
  barTrack: { flex: 1, height: 14, backgroundColor: '#08080A', borderRadius: 7, overflow: 'hidden' },
  barFill: { height: 14, borderRadius: 7 },
  barValue: { color: '#F2F2F5', fontSize: 12, fontWeight: '800', width: 42, textAlign: 'right' },
  barBank: { color: '#56565F', fontSize: 10, width: 22, textAlign: 'right' },
  verdictBox: { backgroundColor: '#08080A', borderLeftWidth: 3, borderRadius: 8, padding: 12, marginTop: 10 },
  verdictText: { fontSize: 12, lineHeight: 18, fontWeight: '600' },
  fuelRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  bankCard: { flex: 1, backgroundColor: '#08080A', padding: 12, borderRadius: 10 },
  bankTitle: { color: '#9A9AA4', fontSize: 11, fontWeight: '800', marginBottom: 6 },
  fuelValue: { color: '#F2F2F5', fontSize: 13, marginTop: 4 },
  fuelTotal: { color: '#93939E', fontSize: 12, marginTop: 8, fontWeight: '700' },
  bankMisfire: { color: '#56565F', fontSize: 11, marginTop: 6 },
  hint: { color: '#93939E', fontSize: 11, lineHeight: 17, marginTop: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#08080A' },
  rowLabel: { color: '#93939E', fontSize: 12, flex: 1 },
  rowValue: { color: '#F2F2F5', fontSize: 13, fontWeight: '700' },
  vctBlock: { backgroundColor: '#08080A', borderRadius: 10, padding: 12, marginTop: 10 },
  vctBank: { color: '#9A9AA4', fontSize: 11, fontWeight: '800', marginBottom: 4 },
});
