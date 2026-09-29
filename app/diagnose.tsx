import React, { useEffect, useMemo, useRef, useState } from 'react';
import { buildBarridoExplorer, cabeceraBarridoExplorer, BARRIDO_EXPLORER_VERSION, PERFIL_EXPLORER } from '../src/obd/barridoExplorer';
import { View, Text, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useObdStore } from '../src/store/useObdStore';
import { persist } from '../src/store/persist';
import {
  buildPlan, runPlan, planEstimate, buildDiagReport,
  type StepResult, type StepStatus, type DiagRunState, type Peticion, PLAN_VERSION,
} from '../src/obd/autoDiag';
import { obdGateway } from '../src/obd/ObdGateway';
import { shareReportFile, copyReport } from '../src/obd/export';
import { C } from '../src/ui/theme';
import { Card, SectionTitle, Button, Badge, EmptyState } from '../src/ui/components';

const ICON: Record<StepStatus, { n: keyof typeof Ionicons.glyphMap; c: string }> = {
  pending: { n: 'ellipse-outline', c: C.muted },
  running: { n: 'sync', c: C.cyan },
  ok:      { n: 'checkmark-circle', c: C.green },
  empty:   { n: 'remove-circle', c: C.yellow },
  failed:  { n: 'close-circle', c: C.red },
  skipped: { n: 'play-skip-forward-circle', c: C.muted },
};

export default function DiagnoseScreen() {
  const { connectionState, selectedProfile, adapter, vin, strictMode, deviceName } = useObdStore();
  const isConnected = connectionState === 'connected';

  // Dos planes: el diagnóstico de siempre y el barrido de la Explorer.
  //
  // Hubo dos más, los dos para el EcoSport y los dos temporales por diseño. El
  // BARRIDO preguntaba a ciegas por miles de identificadores para ver cuáles
  // existían; la prueba de CIERRE releía los que quedaron a medias en siete
  // condiciones que los separaban. Los dos hicieron su trabajo el 16 y el 17
  // de septiembre —de ahí salió el perfil del EcoSport entero, 73 datos
  // confirmados de 75— y los dos se retiraron a _legacy en cuanto terminaron.
  //
  // Se van porque un botón que ya no hace falta no es neutral: alguien lo
  // pulsa por error y se queda veinte minutos esperando un informe que no le
  // va a decir nada nuevo. Están archivados, no borrados: si algún día hay
  // otro vehículo del que no se sepa nada, vuelven en dos minutos.
  const { plan } = useLocalSearchParams<{ plan?: string }>();
  // El barrido solo existe para la Explorer: los rangos que se salta por ya
  // conocidos son suyos, así que con otro perfil daría un mapa equivocado.
  const esBarrido = plan === 'barrido' && selectedProfile.id === PERFIL_EXPLORER;
  const steps = useMemo(
    () => (esBarrido ? buildBarridoExplorer(selectedProfile) : buildPlan(selectedProfile)),
    [esBarrido, selectedProfile],
  );
  const versionPlan = esBarrido ? 3000 + BARRIDO_EXPLORER_VERSION : PLAN_VERSION;
  const est = useMemo(() => planEstimate(steps), [steps]);

  const [results, setResults] = useState<StepResult[]>([]);
  const [current, setCurrent] = useState(-1);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [note, setNote] = useState('');
  const [aviso, setAviso] = useState('');
  // Maniobra pendiente: la etapa está parada esperando a que la persona diga
  // que ya la hizo. La promesa se resuelve al pulsar uno de los dos botones.
  const [pide, setPide] = useState<Peticion | null>(null);
  const respondeRef = useRef<((hecho: boolean) => void) | null>(null);

  const responder = (hecho: boolean) => {
    respondeRef.current?.(hecho);
    respondeRef.current = null;
    setPide(null);
  };
  const [resting, setResting] = useState(0);
  const stopRef = useRef(false);

  /**
   * Igual que la prueba de la caja: esto es un modal y se puede cerrar
   * deslizando. Sin esta limpieza, el plan seguiría corriendo contra el
   * vehículo con la pantalla ya cerrada.
   */
  useEffect(() => () => {
    stopRef.current = true;
    obdGateway.cancelProbe();
  }, []);

  // Recupera una sesión anterior a medias
  useEffect(() => {
    void (async () => {
      const st = await persist.loadDiag<DiagRunState>();
      // Solo se reanuda lo guardado con ESTE mismo plan. Si la app trae etapas
      // nuevas, continuar por el número de etapa saltaría las que se añadieron
      // y el informe saldría incompleto sin decirlo.
      if (st && st.profileId === selectedProfile.id && st.results?.length
          && st.planVersion === versionPlan) {
        setResults(st.results);
        setFinished(st.finished);
      } else if (st && st.results?.length) {
        setAviso('La sesión guardada es de una versión anterior de la app, que tenía otras etapas. Se empieza de nuevo para no saltarse ninguna.');
      }
    })();
  }, []);

  const start = async (from: number, prior: StepResult[]) => {
    stopRef.current = false;
    setRunning(true); setFinished(false); setNote('');
    try {
      const st = await runPlan(steps, selectedProfile, {
        onStepStart: (i) => { setCurrent(i); setNote(''); setResting(0); },
        onStepEnd: (i, r) => setResults(prev => [...prev.filter(x => x.id !== r.id), r]),
        onNote: (t) => setNote(t),
        onSave: (state) => { void persist.saveDiag(state); },
        shouldStop: () => stopRef.current,
        onRest: (sec) => setResting(sec),
        onPrompt: (step) => new Promise<boolean>(resolve => {
          respondeRef.current = resolve;
          setPide(step.prompt!);
        }),
      }, from, prior, versionPlan);
      setResults(st.results);
      setFinished(st.finished);
      if (st.finished) {
        Alert.alert('Listo', esBarrido
          ? 'El barrido terminó. Manda el informe: ahí está todo lo que este PCM sabe decir y nunca se le había preguntado.'
          : 'El diagnóstico terminó. Ya puedes enviar el informe.');
      }
    } catch (e: any) {
      Alert.alert('Se detuvo', e?.message ?? String(e));
    } finally {
      setRunning(false); setCurrent(-1); setResting(0);
      respondeRef.current = null; setPide(null);
    }
  };

  const confirmStart = () => Alert.alert(
    esBarrido ? 'Barrido de la Explorer' : 'Diagnóstico automático',
    `Son ${steps.length} etapas y unas ${est.questions} preguntas al vehículo, cada una una sola vez, ` +
    `en tandas cortas con ${Math.round(2.5)} segundos de descanso entre ellas. Tarda unos ${est.minutes} minuto(s).\n\n` +
    'Déjalo conectado con el motor encendido. Se guarda después de cada etapa: si se corta, puedes continuar.',
    [{ text: 'Cancelar', style: 'cancel' },
     { text: 'Empezar', onPress: () => { setResults([]); void persist.saveDiag(null); start(0, []); } }]);

  const reportText = () => buildDiagReport({
    profile: selectedProfile, results, steps, finished,
    cabecera: esBarrido ? cabeceraBarridoExplorer() : undefined,
    titulo: esBarrido ? 'BARRIDO DE LA EXPLORER' : undefined,
    adapterLine: `Adaptador: ${deviceName ?? '?'} ${adapter.elmVersion} · Protocolo ${adapter.protocol} ${adapter.protocolName} · ${adapter.voltage}`,
    vin,
  });

  const done = results.length;
  const pct = Math.round((done / steps.length) * 100);

  if (!isConnected && !results.length) {
    return <View style={s.container}><EmptyState icon="pulse-outline" title="Sin conexión"
      subtitle="Conecta el escáner en el Panel para lanzar el diagnóstico" /></View>;
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <Card style={{ backgroundColor: C.card2 }}>
        <Text style={s.intro}>
          Un solo botón. Pregunta al motor qué monitores tiene, prueba todos los identificadores conocidos,
          analiza lo que salió y, según el resultado, decide qué bloques explorar. Lo que falla se anota en
          el informe y el plan continúa con la variante siguiente.
        </Text>
        <Text style={[s.intro, { color: C.muted, marginTop: 8 }]}>
          {steps.length} etapas · ~{est.questions} preguntas · ~{est.minutes} min · descanso entre tandas ·
          se guarda tras cada etapa
        </Text>
      </Card>

      {strictMode && (
        <Card style={{ backgroundColor: 'rgba(249,115,22,0.12)' }}>
          <Text style={{ color: C.orange, fontSize: 12, lineHeight: 17 }}>
            El modo estricto bloquea el Modo 22 y el Modo 06 ampliado. Apágalo en Ajustes → Seguridad
            antes de lanzar el diagnóstico, o casi todas las etapas saldrán vacías.
          </Text>
        </Card>
      )}

      {/* ── Maniobra pedida: la prueba está esperándote ── */}
      {!!pide && (
        <Card style={{ borderWidth: 2, borderColor: C.cyan }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="hand-left" size={20} color={C.cyan} />
            <Text style={s.pideTitulo}>{pide.titulo}</Text>
          </View>
          <Text style={s.pideTexto}>{pide.instruccion}</Text>
          {!!pide.seguro && (
            <View style={s.pideSeguro}>
              <Ionicons name="shield-checkmark" size={14} color={C.orange} />
              <Text style={s.pideSeguroTexto}>{pide.seguro}</Text>
            </View>
          )}
          <Text style={s.pideNota}>
            La prueba está detenida esperándote. Tómate el tiempo que haga falta: nada se
            está preguntando al carro mientras tanto.
          </Text>
          <Button label="Ya lo hice, mide ahora" icon="checkmark-circle"
                  style={{ marginTop: 12 }} onPress={() => responder(true)} />
          <Button label="Saltar esta medición" icon="play-skip-forward" variant="ghost"
                  style={{ marginTop: 8 }} onPress={() => responder(false)} />
        </Card>
      )}

      {!!aviso && (
        <Card style={{ borderLeftWidth: 3, borderLeftColor: C.orange }}>
          <Text style={s.note}>{aviso}</Text>
        </Card>
      )}

      {/* ── Control ── */}
      <Card>
        {running ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <ActivityIndicator color={C.cyan} />
              <View style={{ flex: 1 }}>
                <Text style={s.runTitle}>
                  {resting > 0 ? `Descansando ${resting}s…` : (steps[current]?.title ?? 'Trabajando…')}
                </Text>
                {!!note && <Text style={s.note}>{note}</Text>}
              </View>
              <Text style={s.pct}>{pct}%</Text>
            </View>
            <View style={s.bar}><View style={[s.barFill, { width: `${pct}%` as any }]} /></View>
            <Button label="Detener" icon="stop-circle" variant="danger" style={{ marginTop: 12 }}
                    onPress={() => { stopRef.current = true; obdGateway.cancelProbe(); }} />
          </>
        ) : results.length && !finished ? (
          <>
            <Text style={s.note}>
              Hay un diagnóstico a medias: {done} de {steps.length} etapas. Puedes continuar donde quedó.
            </Text>
            <Button label={`Continuar (etapa ${done + 1})`} icon="play" disabled={!isConnected}
                    onPress={() => start(done, results)} />
            <Button label="Empezar de nuevo" icon="refresh" variant="ghost" style={{ marginTop: 8 }}
                    onPress={confirmStart} disabled={!isConnected} />
          </>
        ) : (
          <Button label={finished ? 'Repetir diagnóstico' : 'Iniciar diagnóstico automático'}
                  icon="play-circle" onPress={confirmStart} disabled={!isConnected} />
        )}
      </Card>

      {/* ── Etapas ── */}
      <SectionTitle>Plan</SectionTitle>
      {steps.map((st, i) => {
        const r = results.find(x => x.id === st.id);
        const status: StepStatus = r ? r.status : (running && i === current ? 'running' : 'pending');
        const ic = ICON[status];
        return (
          <Card key={st.id} style={{ paddingVertical: 12, opacity: status === 'pending' ? 0.55 : 1 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Ionicons name={ic.n} size={20} color={ic.c} style={{ marginTop: 1 }} />
              <View style={{ flex: 1 }}>
                <Text style={s.stepTitle}>{i + 1}. {st.title}</Text>
                <Text style={s.stepDetail}>{st.detail}</Text>
                {r && <Text style={[s.stepSummary, { color: ic.c }]}>{r.summary}</Text>}
              </View>
              {r?.seconds ? <Text style={s.secs}>{r.seconds}s</Text> : null}
            </View>
          </Card>
        );
      })}

      {/* ── Salida ── */}
      {results.length > 0 && (
        <Card style={{ backgroundColor: C.card2 }}>
          {!finished && (
            <View style={s.warn}>
              <Ionicons name="alert-circle" size={18} color={C.orange} />
              <Text style={s.warnText}>
                El diagnóstico está a medias ({done} de {steps.length}). El informe saldrá marcado como incompleto.
              </Text>
            </View>
          )}
          <Text style={s.note}>
            El informe lleva el hexadecimal crudo de todo lo que respondió, y de lo que no, el motivo.
            Guardado en el teléfono: sigue aquí aunque cierres la app.
          </Text>
          <Button label="Enviar informe como archivo" icon="document-text-outline"
                  onPress={async () => {
                    // El nombre del archivo dice de qué carro es. Con los dos
                    // informes llamándose "diagnostico-fecha" se confunden en
                    // la carpeta de descargas en cuanto hay más de uno.
                    const base = esBarrido ? 'barrido-explorer' : 'diagnostico';
                    const r = await shareReportFile(reportText(), finished ? base : `${base}-INCOMPLETO`);
                    if (!r.ok) Alert.alert('Exportar', r.message);
                  }} />
          <Button label="Copiar todo" icon="copy-outline" variant="ghost" style={{ marginTop: 8 }}
                  onPress={async () => { const r = await copyReport(reportText()); Alert.alert(r.ok ? 'Copiado' : 'Error', r.message); }} />
        </Card>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  pideTitulo: { color: C.cyan, fontSize: 16, fontWeight: '800', flex: 1 },
  pideTexto: { color: C.text, fontSize: 15, lineHeight: 22, marginTop: 10 },
  pideSeguro: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 10 },
  pideSeguroTexto: { color: C.orange, fontSize: 13, lineHeight: 18, flex: 1 },
  pideNota: { color: C.muted, fontSize: 12, lineHeight: 17, marginTop: 10 },
  container: { flex: 1, backgroundColor: C.bg, padding: 16 },
  intro: { color: C.sub, fontSize: 12, lineHeight: 18 },
  note: { color: C.muted, fontSize: 11, lineHeight: 16, marginBottom: 8 },
  runTitle: { color: C.text, fontSize: 14, fontWeight: '700' },
  pct: { color: C.cyan, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  bar: { height: 5, backgroundColor: C.bg, borderRadius: 3, overflow: 'hidden', marginTop: 12 },
  barFill: { height: '100%', backgroundColor: C.cyan, borderRadius: 3 },
  stepTitle: { color: C.text, fontSize: 13, fontWeight: '700' },
  stepDetail: { color: C.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  stepSummary: { fontSize: 12, fontWeight: '600', marginTop: 4 },
  secs: { color: C.muted, fontSize: 10, fontFamily: 'monospace' },
  warn: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginBottom: 10,
          backgroundColor: 'rgba(249,115,22,0.12)', borderRadius: 10, padding: 10 },
  warnText: { color: C.orange, fontSize: 12, lineHeight: 17, flex: 1 },
});
