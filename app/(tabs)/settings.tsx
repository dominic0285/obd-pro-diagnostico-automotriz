import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, TextInput, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { bleManager, type LogEntry } from '../../src/ble/BleManager';
import { useRouter } from 'expo-router';
import { obdGateway, type PidProbeResult } from '../../src/obd/ObdGateway';
import { checkCommandSafety } from '../../src/obd/safety';
import { useObdStore } from '../../src/store/useObdStore';
import { buildProbeReport } from '../../src/obd/report';
import { shareReportFile, copyReport } from '../../src/obd/export';
import { C } from '../../src/ui/theme';
import { esDelNucleo, NUCLEO_TEXTO } from '../../src/obd/nucleo';
import { Card, SectionTitle, Row, Badge, Button } from '../../src/ui/components';

export default function SettingsScreen() {
  const { connectionState, deviceName, connectedDevice, adapter, selectedProfile,
          disabledPids, togglePid, unsupportedPids, supportedMode01,
          pollIntervalMs, setPollIntervalMs, strictMode, setStrictMode, vin,
          probeResults, probeAt, setProbeResults,
          probeExpected, probeComplete, probeScope } = useObdStore();
  const isConnected = connectionState === 'connected';
  const router = useRouter();

  const [interval, setInterval_] = useState(String(pollIntervalMs));
  const [cmd, setCmd] = useState('');
  const [sending, setSending] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [showLog, setShowLog] = useState(true);
  const [probing, setProbing] = useState(false);
  const [showReport, setShowReport] = useState(false);


  const [probeDone, setProbeDone] = useState(0);

  const allGroups = selectedProfile.moduleGroups;
  const totalPids = allGroups.reduce((n, g) => n + g.pids.length, 0);
  const pendingGroups = allGroups
    .map(g => ({ ...g, pids: g.pids.filter(p => p.verified === false || disabledPids.has(p.key)) }))
    .filter(g => g.pids.length > 0);
  const pendingCount = pendingGroups.reduce((n, g) => n + g.pids.length, 0);

  const runProbe = async (groups: typeof allGroups, count: number, scope: 'all' | 'partial') => {
    if (!isConnected) return;
    setProbing(true); setProbeDone(0);
    // Se acumula en local y se vuelca al almacén (que además guarda en disco)
    // para no perder nada si la pantalla se desmonta a mitad.
    const acc = new Map<string, PidProbeResult>();
    setProbeResults(acc, { expected: count, scope, complete: false });
    try {
      await obdGateway.probePids(groups, (key, r) => {
        acc.set(key, r);
        setProbeResults(new Map(acc), { expected: count, scope, complete: false });
        setProbeDone(n => n + 1);
      });
    } catch (e: any) { Alert.alert('No se pudo probar', e.message); }
    finally {
      // Completa solo si se recorrieron todos los previstos: ni cancelada,
      // ni cortada por una desconexión a mitad.
      const complete = acc.size >= count;
      setProbeResults(new Map(acc), { save: true, expected: count, scope, complete });
      setProbing(false);
    }
  };

  // El informe solo se da por bueno si cubrió el perfil entero y no se cortó.
  const reportIsComplete = probeComplete && probeScope === 'all' && probeResults.size >= totalPids;
  const missing = Math.max(0, (probeExpected || totalPids) - probeResults.size);

  const reportText = () => buildProbeReport({
    profile: selectedProfile, results: probeResults, adapter, deviceName, vin, strictMode,
    complete: reportIsComplete, expected: probeExpected || totalPids, scope: probeScope,
  });

  const exportPartial = () => Alert.alert(
    missing > 0 ? 'La prueba se cortó a medias' : 'El informe cubre solo un subconjunto',
    (missing > 0
      ? `Faltaron ${missing} de los ${probeExpected || totalPids} PIDs que tocaba probar. Lo que no se probó no sale en el informe, y eso es fácil de leer mal.`
      : `Se probó lo que estaba activado: ${probeResults.size} de los ${totalPids} PIDs del perfil. Los que no estaban activados no se preguntaron, así que el informe no dice nada sobre ellos.`) +
    ' Puedes enviarlo igualmente; irá marcado. Lo recomendable es repetir la prueba completa con el motor encendido.',
    [{ text: 'Cancelar', style: 'cancel' },
     { text: 'Enviar igualmente', style: 'destructive', onPress: doShareFile }]);

  const doShareFile = async () => {
    const r = await shareReportFile(reportText(),
      reportIsComplete ? 'informe-pids' : 'informe-pids-PARCIAL');
    if (!r.ok) Alert.alert('Exportar', r.message);
  };

  const doCopy = async () => {
    const r = await copyReport(reportText());
    Alert.alert(r.ok ? 'Copiado' : 'Error', r.message);
  };

  const probe = probeResults;
  const probeOk = [...probe.values()].filter(r => r.status === 'ok').length;

  useEffect(() => bleManager.onLog(setLog), []);

  const [stats, setStats] = useState(bleManager.getStats());
  useEffect(() => {
    const id = setInterval(() => setStats(bleManager.getStats()), 700);
    return () => clearInterval(id);
  }, []);

  const sendTerminal = async () => {
    const c = cmd.trim();
    if (!c || !isConnected) return;
    const verdict = checkCommandSafety(c, strictMode);
    if (!verdict.ok) { Alert.alert('Comando bloqueado', verdict.reason); return; }
    const run = async () => {
      setSending(true);
      try {
        await obdGateway.sendExclusive(c.toUpperCase(), 5000, true);
      } catch (e: any) {
        Alert.alert('Error', e.message);
      } finally { setSending(false); setCmd(''); }
    };
    if (verdict.needsConfirm) {
      Alert.alert('Confirmar', verdict.reason, [
        { text: 'Cancelar', style: 'cancel' }, { text: 'Enviar', style: 'destructive', onPress: run },
      ]);
    } else run();
  };

  const profileUuid = connectedDevice ? bleManager.getProfile()?.label ?? bleManager.resolveUUIDs(connectedDevice.name).label : '—';

  return (
    <ScrollView style={s.container} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <SectionTitle>Adaptador</SectionTitle>
      <Card style={{ paddingVertical: 4 }}>
        <Row label="Estado" value={<Badge text={isConnected ? '● CONECTADO' : '○ DESCONECTADO'} color={isConnected ? C.green : C.red} />} />
        {deviceName ? <Row label="Dispositivo" value={deviceName} /> : null}
        {connectedDevice ? <Row label="BLE ID" value={connectedDevice.id} mono /> : null}
        <Row label="Perfil UUID" value={profileUuid} />
        {adapter.elmVersion ? <Row label="Firmware" value={adapter.elmVersion} /> : null}
        {adapter.protocolName ? <Row label="Protocolo" value={`${adapter.protocol} · ${adapter.protocolName}`} /> : null}
        {adapter.voltage ? <Row label="Voltaje" value={adapter.voltage} /> : null}
      </Card>

      <SectionTitle>Seguridad</SectionTitle>
      <Card style={{ paddingVertical: 4 }}>
        <Row label="Modo estricto" value={
          <Switch value={strictMode} onValueChange={(v) => { setStrictMode(v); bleManager.setStrict(v); }}
                  trackColor={{ false: C.border, true: '#166534' }} thumbColor={strictMode ? C.green : '#56565F'} />} />
        <Text style={s.note}>
          {strictMode
            ? 'ACTIVO: la app envía solo lo que envía un escáner genérico (modos 01/03/04/07/09 en 7DF). Sin Modo 22, sin ATSH a módulos, sin escaneo por módulo. Las pestañas Cilindros y el escaneo de ABS quedan sin datos.'
            : 'DESACTIVADO: además de lo anterior se usan lectura Modo 22 (misfires, TCM, ABS) y servicios 19/18 para códigos por módulo. Todo sigue siendo solo lectura; los servicios de escritura siguen bloqueados.'}
        </Text>
      </Card>

      <SectionTitle>Rendimiento</SectionTitle>
      <Card style={{ paddingVertical: 4 }}>
        <Row label="Pausa entre ciclos" value={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TextInput style={s.input} value={interval} onChangeText={setInterval_} keyboardType="number-pad" maxLength={4}
                       onEndEditing={() => { const n = parseInt(interval, 10); if (!isNaN(n)) setPollIntervalMs(n); }} />
            <Text style={{ color: C.text }}>ms</Text>
          </View>} />
        <Text style={s.note}>Cada PID tarda ~50-150 ms en CAN. Menos PIDs activos = más rápido. Cambiar de módulo (ATSH) cuesta ~150 ms extra por grupo.</Text>
      </Card>

      <SectionTitle>PIDs del perfil · {selectedProfile.make} {selectedProfile.model}</SectionTitle>
      <Text style={s.note}>
        Los PIDs en gris no responden en este vehículo (bitmask 0100 o respuesta negativa 7F) y se omiten solos.
        Los marcados "sin verificar" no tienen fuente pública confirmada: actívalos y compara con un escáner profesional.
      </Text>
      <SectionTitle>Prueba de PIDs</SectionTitle>
      <Card style={{ backgroundColor: C.card2 }}>
        <Text style={s.note}>
          Pregunta cada identificador UNA sola vez y anota si responde. Solo lectura, sin reintentos, a unas
          6 preguntas por segundo: menos tráfico del que genera el muestreo normal, que pregunta lo mismo en
          bucle sin parar. Los {totalPids} tardan menos de medio minuto.
        </Text>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button label={probing ? `${probeDone}/${totalPids}` : `Probar todos (${totalPids})`}
                  icon="flask" onPress={() => runProbe(allGroups, totalPids, 'all')}
                  loading={probing} disabled={!isConnected || strictMode} style={{ flex: 1 }} />
          {pendingCount > 0 && !probing && (
            <Button label={`Solo apagados (${pendingCount})`} variant="ghost"
                    onPress={() => runProbe(pendingGroups, pendingCount, 'partial')}
                    disabled={!isConnected || strictMode} style={{ flex: 1 }} />
          )}
        </View>

        {probing && (
          <Button label="Detener" icon="stop-circle" variant="danger"
                  onPress={() => obdGateway.cancelProbe()} style={{ marginTop: 8 }} />
        )}

        {probe.size > 0 && !probing && (
          <>
            <Text style={[s.note, { marginTop: 10, color: C.sub }]}>
              {probe.size} probados · {probeOk} responden
              {probeAt ? ` · ${new Date(probeAt).toLocaleString()}` : ''}.
              Guardado en el teléfono: sigue aquí aunque cierres la app.
            </Text>
            {reportIsComplete ? (
              <Button label="Enviar como archivo .txt" icon="document-text-outline" onPress={doShareFile} />
            ) : (
              <>
                <View style={s.incomplete}>
                  <Ionicons name="alert-circle" size={18} color={C.orange} />
                  <Text style={s.incompleteText}>
                    {missing > 0
                      ? `La prueba se cortó: faltaron ${missing} de ${probeExpected || totalPids}. Repítela para el informe bueno.`
                      : `Se probaron los ${probeResults.size} PIDs activados, de los ${totalPids} que tiene el perfil. Para el informe completo usa "Probar todos".`}
                  </Text>
                </View>
                <Button label="Enviar de todas formas (parcial)" icon="document-text-outline"
                        variant="ghost" onPress={exportPartial} />
              </>
            )}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <Button label="Copiar todo" icon="copy-outline" variant="ghost" onPress={doCopy} style={{ flex: 1 }} />
              <Button label={showReport ? 'Ocultar' : 'Ver informe'} icon="eye-outline" variant="ghost"
                      onPress={() => setShowReport(v => !v)} style={{ flex: 1 }} />
            </View>
            <Text style={[s.note, { marginTop: 8 }]}>
              Envíalo como archivo: al mandarlo como mensaje de texto, WhatsApp y otras apps lo cortan
              sin avisar y se pierde la mitad.
            </Text>
            {showReport && (
              <ScrollView horizontal style={s.reportBox}>
                <Text selectable style={s.reportText}>{reportText()}</Text>
              </ScrollView>
            )}
          </>
        )}

        {!isConnected && <Text style={[s.note, { marginTop: 8 }]}>Conecta el escáner primero.</Text>}
        {strictMode && <Text style={[s.note, { color: C.orange, marginTop: 8 }]}>
          El modo estricto bloquea el Modo 22. Apágalo arriba para poder probar.
        </Text>}
      </Card>
      {selectedProfile.moduleGroups.map(g => (
        <Card key={g.header || 'std'} style={{ paddingVertical: 4 }}>
          <View style={s.groupHeader}>
            <View style={[s.dot, { backgroundColor: g.color }]} />
            <Text style={s.groupTitle}>{g.moduleName}</Text>
            <Text style={s.groupHex}>{g.header ? `ATSH ${g.header} / CRA ${g.rxHeader ?? ''}` : 'ATSH 7DF'}</Text>
          </View>
          {g.pids.map(p => {
            const unsupported = unsupportedPids.has(p.key) ||
              (p.mode === '01' && !!supportedMode01 && !supportedMode01.has(p.command));
            const nucleo = esDelNucleo(p.key);
            const on = nucleo || !disabledPids.has(p.key);
            return (
              <View key={p.key} style={[s.pidRow, unsupported && { opacity: 0.45 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.pidName}>{p.name}{nucleo ? '  ·  siempre encendido' : ''}</Text>
                  <Text style={s.pidHex}>
                    {p.command}{p.mode === '22' ? ' · UDS' : ''}{unsupported ? ' · no soportado' : ''}
                    {p.verified === false ? ' · sin verificar' : ''}
                  </Text>
                  {nucleo ? <Text style={s.pidNote}>{NUCLEO_TEXTO}</Text> : null}
                  {p.note && p.verified === false ? <Text style={s.pidNote}>{p.note}</Text> : null}
                  {probe.get(p.key) ? (() => { const r = probe.get(p.key)!;
                    const col = r.status === 'ok' ? C.green : r.status === 'no_response' ? C.muted : C.red;
                    const txt = r.status === 'ok' ? `✓ responde: ${r.value} ${p.unit}` : r.status === 'no_response' ? '— sin respuesta' : `✗ ${r.message ?? 'no soportado'}`;
                    return <Text style={[s.pidNote, { color: col }]}>{txt}{r.raw ? `  (${r.raw.substring(0, 24)})` : ''}</Text>; })() : null}
                </View>
                <Switch value={on} disabled={nucleo} onValueChange={() => togglePid(p.key)}
                        trackColor={{ false: C.border, true: '#7A1510' }} thumbColor={on ? C.cyan : '#56565F'} />
              </View>
            );
          })}
        </Card>
      ))}

      <SectionTitle>Pruebas</SectionTitle>
      <Card>
        <Text style={s.note}>
          Con el carro parado. Lee el voltaje del canal, los monitores del motor, el congelado
          de datos del último código y los códigos de los ocho módulos. Va por etapas cortas con
          descanso entre ellas y se guarda tras cada una, así que si se corta la conexión no se
          pierde lo hecho.
        </Text>
        <Button label="Diagnóstico automático" icon="play-circle"
                onPress={() => router.push('/diagnose')} disabled={!isConnected} />
      </Card>

      {selectedProfile.id === 'ford_explorer_2010' && (
        <Card style={{ marginTop: 10 }}>
          <Text style={s.note}>
            RODANDO, y se hace una sola vez. Busca qué más sabe decir el PCM de la Explorer que
            nunca se le haya preguntado: llama a la puerta de las 256 páginas y barre entera cada
            una que conteste, saltándose las que ya conocemos. Existe porque el escáner profesional
            enseñó un equilibrio de potencia por cilindro que nosotros no sabíamos leer. Arráncalo,
            deja el teléfono y conduce normal un cuarto de hora: no te va a pedir nada. Mientras
            barre, el tablero de la app no se actualiza.
          </Text>
          <Button label="Barrido de la Explorer" icon="map-outline"
                  onPress={() => router.push('/diagnose?plan=barrido')} disabled={!isConnected} />
        </Card>
      )}

      <Card style={{ marginTop: 10 }}>
        <Text style={s.note}>
          En carretera. Compara la marcha que la caja ORDENA con la relación que los dos ejes
          dicen que está pasando DE VERDAD, y mide si el convertidor se bloquea a velocidad de
          crucero. Solo lee: no le manda ninguna orden a la caja.
        </Text>
        <Button label="Prueba de la caja de cambios" icon="car-sport-outline"
                onPress={() => router.push('/caja')} disabled={!isConnected} />
      </Card>

      <SectionTitle>Estado del canal</SectionTitle>
      <Card style={{ paddingVertical: 4 }}>
        <Row label="Comandos por segundo" value={`${stats.perSecond} de ${stats.limits.MAX_PER_SECOND} (techo)`} />
        <Row label="Separación mínima" value={`${stats.limits.MIN_GAP_MS} ms`} />
        <Row label="En cola / en vuelo" value={`${stats.queue} / ${stats.inFlight}`} />
        <Row label="Enviados · respondidos" value={`${stats.written} · ${stats.resolved}`} />
        <Row label="Sin respuesta" value={String(stats.timeouts)} />
        <Row label="Bloqueados por seguridad" value={String(stats.blocked)} />
        <Row label="Respuestas tardías descartadas" value={String(stats.dropped)} />
        <Row label="Canal" value={
          <Badge text={stats.channelOpen ? '● ABIERTO' : '○ DETENIDO'} color={stats.channelOpen ? C.green : C.red} />} />
        <Text style={s.note}>
          El techo de comandos por segundo y la separación mínima entre ellos están fijados en el código y no
          se pueden subir desde aquí. Si el adaptador deja de responder muchas veces seguidas, el canal se
          detiene solo en vez de seguir insistiendo sobre el bus del vehículo.
        </Text>
      </Card>

      <SectionTitle right={
        <TouchableOpacity onPress={() => bleManager.clearLog()}><Text style={{ color: C.muted, fontSize: 11 }}>Limpiar log</Text></TouchableOpacity>
      }>Terminal ELM327</SectionTitle>
      <Card>
        <Text style={s.note}>
          Solo lectura: se bloquean servicios de escritura/actuadores (10, 11, 27, 28, 2E, 2F, 31, 34-37, 3B, 3D, 85)
          y headers fuera de 700-7FF. ATZ y 04 piden confirmación.
        </Text>
        <View style={s.terminalRow}>
          <TextInput style={[s.input, { flex: 1, fontFamily: 'monospace', minWidth: 0 }]} value={cmd} onChangeText={setCmd}
                     placeholder="ATRV · 010C · 22160E · ATSH 7E0" placeholderTextColor={C.muted}
                     autoCapitalize="characters" autoCorrect={false} editable={isConnected} onSubmitEditing={sendTerminal} />
          <TouchableOpacity style={[s.sendBtn, (!isConnected || sending) && { opacity: 0.4 }]} onPress={sendTerminal} disabled={!isConnected || sending}>
            <Ionicons name="send" size={16} color={C.bg} />
          </TouchableOpacity>
        </View>
        <TouchableOpacity onPress={() => setShowLog(v => !v)} style={{ marginTop: 8 }}>
          <Text style={{ color: C.cyan, fontSize: 12 }}>{showLog ? 'Ocultar' : 'Mostrar'} tráfico ({log.length})</Text>
        </TouchableOpacity>
        {showLog && (
          <View style={s.logBox}>
            {log.slice(-40).map((e, i) => (
              <Text key={i} style={[s.logLine, { color: e.dir === 'tx' ? C.yellow : e.dir === 'rx' ? C.cyan : C.muted }]}>
                {e.dir === 'tx' ? '→ ' : e.dir === 'rx' ? '← ' : '· '}{e.text.replace(/\r/g, ' ⏎ ')}
              </Text>
            ))}
            {log.length === 0 && <Text style={s.logLine}>Sin tráfico todavía</Text>}
          </View>
        )}
      </Card>

      <SectionTitle>Buenas prácticas</SectionTitle>
      <Card>
        {[
          'Conecta y desconecta el adaptador con el contacto apagado.',
          'No uses dos apps/adaptadores a la vez sobre el mismo bus.',
          'Con la batería baja (<12 V con motor apagado) algunos módulos responden mal o guardan códigos U-.',
          'No dejes el adaptador puesto días enteros: muchos clones no duermen y descargan la batería.',
          'Borrar códigos elimina freeze frame y reinicia monitores de emisiones (readiness).',
        ].map((t, i) => <Text key={i} style={s.tip}>• {t}</Text>)}
      </Card>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg, padding: 16 },
  note: { color: C.muted, fontSize: 12, marginBottom: 8, lineHeight: 17 },
  input: { backgroundColor: C.bg, borderRadius: 8, padding: 10, color: C.text, fontSize: 14, minWidth: 80 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.bg },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  groupTitle: { color: C.text, fontSize: 13, fontWeight: '700', flex: 1 },
  groupHex: { color: C.muted, fontSize: 10, fontFamily: 'monospace' },
  pidRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.bg },
  pidName: { color: C.text, fontSize: 13, fontWeight: '600' },
  pidHex: { color: C.muted, fontSize: 11, fontFamily: 'monospace', marginTop: 2 },
  pidNote: { color: C.orange, fontSize: 10, marginTop: 2 },
  terminalRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sendBtn: { backgroundColor: C.cyan, borderRadius: 8, padding: 10 },
  logBox: { backgroundColor: C.bg, marginTop: 8, borderRadius: 8, padding: 10 },
  reportBox: { backgroundColor: C.bg, marginTop: 10, borderRadius: 8, padding: 10, maxHeight: 320 },
  reportText: { color: C.sub, fontFamily: 'monospace', fontSize: 10, lineHeight: 14 },
  incomplete: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginBottom: 8,
                backgroundColor: 'rgba(249,115,22,0.12)', borderRadius: 10, padding: 10 },
  incompleteText: { color: C.orange, fontSize: 12, lineHeight: 17, flex: 1 },
  logLine: { color: C.muted, fontFamily: 'monospace', fontSize: 11, lineHeight: 15 },
  tip: { color: C.sub, fontSize: 12, lineHeight: 18 },
});
