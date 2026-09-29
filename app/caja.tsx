/**
 * Pantalla de la prueba de la caja de cambios.
 *
 * A diferencia del diagnóstico automático, esta prueba se hace RODANDO, así que
 * la pantalla no es una lista de etapas: es un marcador en vivo y grande, para
 * poder echarle un vistazo de reojo. El análisis llega al final.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useObdStore } from '../src/store/useObdStore';
import { obdGateway } from '../src/obd/ObdGateway';
import {
  correrPruebaCaja, analizarCaja, informeCaja, faltantes,
  RATIOS_6R80, NOMBRE_MARCHA,
  type MuestraCaja, type ResultadoCaja, type Veredicto,
} from '../src/obd/pruebaCaja';
import { shareReportFile, copyReport } from '../src/obd/export';
import { C } from '../src/ui/theme';
import { Card, SectionTitle, Button, EmptyState } from '../src/ui/components';

const DURACION = 300;   // 5 minutos de tope; se puede parar antes cuando quieras

const COLOR: Record<Veredicto, string> = {
  bien: C.green, revisar: C.yellow, patina: C.red, sin_datos: C.muted,
};
const ETIQUETA: Record<Veredicto, string> = {
  bien: 'BIEN', revisar: 'REVISAR', patina: 'PATINA', sin_datos: 'sin datos',
};

export default function CajaScreen() {
  const { connectionState, selectedProfile, strictMode } = useObdStore();
  const conectado = connectionState === 'connected';
  const falta = faltantes(selectedProfile);

  const [corriendo, setCorriendo] = useState(false);
  const [ultima, setUltima] = useState<MuestraCaja | null>(null);
  const [n, setN] = useState(0);
  const [vistas, setVistas] = useState<Set<number>>(new Set());
  const [resultado, setResultado] = useState<ResultadoCaja | null>(null);
  const [muestras, setMuestras] = useState<MuestraCaja[]>([]);
  const pararRef = useRef(false);

  /**
   * Esta pantalla es un modal: se puede cerrar deslizando, y hasta la 3.1 eso
   * dejaba la prueba viva. El ref del componente desmontado se quedaba en false
   * para siempre, así que el bucle seguía preguntándole al vehículo los cinco
   * minutos completos, con el canal tomado y sin nadie mirando. Y al volver a
   * entrar se podía lanzar otra encima.
   *
   * La limpieza al desmontar cierra las dos cosas: baja el freno propio y
   * además cancela en el motor, que es lo único que el bucle lee de verdad
   * cuando esta pantalla ya no existe.
   */
  useEffect(() => () => {
    pararRef.current = true;
    obdGateway.cancelProbe();
  }, []);

  const parar = () => {
    pararRef.current = true;
    obdGateway.cancelProbe();
  };

  const arrancar = async () => {
    if (obdGateway.estaOcupado()) {
      Alert.alert(
        'Hay otra operación en curso',
        'El canal está ocupado con otra prueba. Espera a que termine antes de empezar esta.',
      );
      return;
    }
    pararRef.current = false;
    setCorriendo(true);
    setResultado(null);
    setVistas(new Set());
    setN(0);
    try {
      const ms = await correrPruebaCaja({
        profile: selectedProfile,
        segundos: DURACION,
        debeParar: () => pararRef.current,
        onMuestra: (m, total) => {
          setUltima(m);
          setN(total);
          if (m.marcha !== null && m.ratio !== null) {
            setVistas(prev => (prev.has(m.marcha!) ? prev : new Set([...prev, m.marcha!])));
          }
        },
      });
      setMuestras(ms);
      setResultado(analizarCaja(ms));
    } catch (e: any) {
      Alert.alert('No se pudo hacer la prueba', e?.message ?? String(e));
    } finally {
      setCorriendo(false);
    }
  };

  if (!conectado) {
    return <View style={s.c}><EmptyState icon="car-outline" title="Sin conexión" subtitle="Conecta el escáner para hacer la prueba" /></View>;
  }
  if (strictMode) {
    return (
      <ScrollView style={s.c} contentContainerStyle={{ padding: 16 }}>
        <Card>
          <Text style={s.aviso}>
            La prueba necesita leer el módulo de la transmisión por Modo 22, y el modo
            estricto solo permite la cabecera funcional. Desactívalo en Ajustes → Seguridad.
          </Text>
        </Card>
      </ScrollView>
    );
  }
  if (falta.length) {
    return (
      <ScrollView style={s.c} contentContainerStyle={{ padding: 16 }}>
        <Card>
          <Text style={s.aviso}>
            Este perfil no tiene los datos que la prueba necesita: {falta.join(', ')}.
            Selecciona el perfil del Ford Explorer 2010.
          </Text>
        </Card>
      </ScrollView>
    );
  }

  const ratioAhora = ultima?.ratio;
  const marchaAhora = ultima?.marcha ?? null;
  const nominal = marchaAhora !== null ? RATIOS_6R80[marchaAhora] : undefined;
  const desvio = ratioAhora && nominal ? ((ratioAhora - nominal) / nominal) * 100 : null;

  return (
    <ScrollView style={s.c} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      {!corriendo && !resultado && (
        <Card>
          <Text style={s.titulo}>Qué hace esta prueba</Text>
          <Text style={s.txt}>
            La caja dice qué marcha ORDENA. Los dos ejes dicen qué está pasando DE VERDAD.
            Dividiendo el eje de entrada entre el de salida sale la relación real, y si no
            coincide con la de fábrica es que algo resbala entre los dos.{'\n'}{'\n'}
            La app solo lee. No le manda ninguna orden a la caja ni a ningún otro módulo.
          </Text>

          <Text style={[s.titulo, { marginTop: 16 }]}>Cómo hacerla</Text>
          <Text style={s.txt}>
            1. Que conduzca otra persona, o deja el teléfono en el soporte y no lo toques.{'\n'}
            2. Arranca la prueba y conduce normal, sin prisa.{'\n'}
            3. Pasa por todas las marchas: acelera suave para que suba hasta 6ª y deja
            tramos estables. Necesita unos segundos sostenidos en cada marcha.{'\n'}
            4. Para el convertidor hacen falta tramos por encima de 60 km/h con el pie quieto.{'\n'}
            5. Cuando creas que ya, para la prueba. El tope son 5 minutos.
          </Text>
          <Text style={[s.txt, { color: C.yellow, marginTop: 10 }]}>
            Conduce mirando la carretera. El marcador es para echarle un vistazo de reojo o
            para que lo lea el acompañante; el análisis sale al final y no hay que verlo en marcha.
          </Text>

          <Button label="Empezar la prueba" icon="play" onPress={arrancar} style={{ marginTop: 16 }} />
        </Card>
      )}

      {corriendo && (
        <>
          <Card>
            <View style={s.vivoFila}>
              <View style={s.vivoBloque}>
                <Text style={s.vivoEtiqueta}>MARCHA</Text>
                <Text style={s.vivoGrande}>{marchaAhora !== null ? (NOMBRE_MARCHA[marchaAhora] ?? marchaAhora) : '—'}</Text>
              </View>
              <View style={s.vivoBloque}>
                <Text style={s.vivoEtiqueta}>RELACIÓN</Text>
                <Text style={[s.vivoGrande, { color: desvio === null ? C.text : Math.abs(desvio) <= 3 ? C.green : Math.abs(desvio) <= 8 ? C.yellow : C.red }]}>
                  {ratioAhora ? ratioAhora.toFixed(2) : '—'}
                </Text>
                <Text style={s.vivoPie}>{nominal ? `de fábrica ${nominal}` : 'hace falta rodar'}</Text>
              </View>
              <View style={s.vivoBloque}>
                <Text style={s.vivoEtiqueta}>km/h</Text>
                <Text style={s.vivoGrande}>{ultima?.velocidad ?? '—'}</Text>
              </View>
            </View>
          </Card>

          <Card style={{ marginTop: 12 }}>
            <Text style={s.titulo}>Marchas ya medidas</Text>
            <View style={s.chips}>
              {[1, 2, 3, 4, 5, 6].map(g => (
                <View key={g} style={[s.chip, vistas.has(g) && s.chipOn]}>
                  <Text style={[s.chipTxt, vistas.has(g) && s.chipTxtOn]}>{NOMBRE_MARCHA[g]}</Text>
                </View>
              ))}
            </View>
            <Text style={s.txt}>
              {vistas.size < 6
                ? 'Sigue rodando hasta que se enciendan todas las que quieras comprobar.'
                : 'Ya pasaste por las seis. Puedes parar cuando quieras.'}
            </Text>
            <View style={s.progresoFila}>
              <ActivityIndicator size="small" color={C.cyan} />
              <Text style={s.progreso}>{n} muestras tomadas</Text>
            </View>
            <Button label="Parar y ver el resultado" icon="stop" variant="danger"
              onPress={parar} style={{ marginTop: 12 }} />
          </Card>
        </>
      )}

      {resultado && (
        <>
          <Card>
            <Text style={s.titulo}>Resultado</Text>
            <Text style={s.resumen}>{resultado.resumen}</Text>
            <Text style={s.txt}>
              {resultado.segundos} s · {resultado.total} muestras · {resultado.utiles} con el carro rodando ·
              máxima {resultado.velMax} km/h
            </Text>
          </Card>

          <SectionTitle>Marcha por marcha</SectionTitle>
          <Card>
            {resultado.marchas.length === 0 && (
              <Text style={s.txt}>
                Ninguna marcha se sostuvo el tiempo suficiente para medirla. Hacen falta unos
                segundos seguidos en cada una; los cambios de paso no cuentan.
              </Text>
            )}
            {resultado.marchas.map(m => (
              <View key={m.marcha} style={s.fila}>
                <Text style={s.filaMarcha}>{m.nombre}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.filaPrincipal}>
                    {m.medida.toFixed(2)}  <Text style={s.filaTenue}>de fábrica {m.nominal}</Text>
                  </Text>
                  <Text style={s.filaSub}>
                    {m.errorPct >= 0 ? '+' : ''}{m.errorPct.toFixed(1)} % · {m.muestras} muestras · {m.velMin}-{m.velMax} km/h
                  </Text>
                </View>
                <Text style={[s.veredicto, { color: COLOR[m.veredicto] }]}>{ETIQUETA[m.veredicto]}</Text>
              </View>
            ))}
            {resultado.sinProbar.length > 0 && (
              <Text style={[s.txt, { marginTop: 10 }]}>
                No se usaron: {resultado.sinProbar.map(g => NOMBRE_MARCHA[g]).join(', ')}. Para
                medirlas hay que rodar a la velocidad en la que entran.
              </Text>
            )}
          </Card>

          <SectionTitle>Convertidor de par</SectionTitle>
          <Card>
            <View style={s.fila}>
              <Ionicons name="sync-outline" size={20} color={COLOR[resultado.veredictoConvertidor]} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={s.filaPrincipal}>
                  {resultado.deslizCrucero === null ? 'Sin datos' : `${resultado.deslizCrucero.toFixed(0)} rpm de deslizamiento`}
                </Text>
                <Text style={s.filaSub}>
                  {resultado.deslizCrucero === null
                    ? 'Hacen falta tramos por encima de 60 km/h con el pie estable.'
                    : `Medido sobre ${resultado.muestrasCrucero} muestras a más de 60 km/h en 4ª o superior. Bloqueado debe quedarse casi en cero.`}
                </Text>
              </View>
              <Text style={[s.veredicto, { color: COLOR[resultado.veredictoConvertidor] }]}>
                {ETIQUETA[resultado.veredictoConvertidor]}
              </Text>
            </View>
          </Card>

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <Button label="Compartir" icon="share-outline" style={{ flex: 1 }}
              onPress={() => void shareReportFile(informeCaja(selectedProfile, resultado), 'prueba-caja')} />
            <Button label="Copiar" icon="copy-outline" variant="ghost" style={{ flex: 1 }}
              onPress={() => void copyReport(informeCaja(selectedProfile, resultado))} />
          </View>
          <Button label="Repetir la prueba" icon="refresh" variant="ghost"
            onPress={() => { setResultado(null); setMuestras([]); }} style={{ marginTop: 10 }} />
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  c: { flex: 1, backgroundColor: C.bg },
  titulo: { color: C.text, fontSize: 14, fontWeight: '800', marginBottom: 6 },
  txt: { color: C.sub, fontSize: 12, lineHeight: 18 },
  aviso: { color: C.yellow, fontSize: 13, lineHeight: 19 },
  resumen: { color: C.text, fontSize: 15, fontWeight: '700', lineHeight: 21, marginBottom: 8 },
  vivoFila: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-start' },
  vivoBloque: { alignItems: 'center', flex: 1 },
  vivoEtiqueta: { color: C.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  vivoGrande: { color: C.text, fontSize: 40, fontWeight: '900', marginTop: 2 },
  vivoPie: { color: C.muted, fontSize: 10, marginTop: 2 },
  chips: { flexDirection: 'row', gap: 8, marginVertical: 10 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: C.card2, borderWidth: 1, borderColor: C.border },
  chipOn: { backgroundColor: C.green, borderColor: C.green },
  chipTxt: { color: C.muted, fontSize: 13, fontWeight: '800' },
  chipTxtOn: { color: '#08080A' },
  progresoFila: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  progreso: { color: C.sub, fontSize: 12 },
  fila: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.bg },
  filaMarcha: { color: C.text, fontSize: 18, fontWeight: '900', width: 44 },
  filaPrincipal: { color: C.text, fontSize: 14, fontWeight: '700' },
  filaTenue: { color: C.muted, fontSize: 11, fontWeight: '500' },
  filaSub: { color: C.sub, fontSize: 11, marginTop: 2 },
  veredicto: { fontSize: 11, fontWeight: '900', letterSpacing: 0.5 },
});
