import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, Linking, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { obdGateway } from '../../src/obd/ObdGateway';
import { useObdStore } from '../../src/store/useObdStore';
import { C } from '../../src/ui/theme';
import { Card, SectionTitle, Button, EmptyState, Badge } from '../../src/ui/components';
import { describeStatus, type ModuleScanResult } from '../../src/obd/moduleScan';
import type { DiagnosticModule } from '../../src/profiles';
import { describirDtc, totalDtcConocidos } from '../../src/obd/dtcTextos';
import { explicarDtc, totalComunes } from '../../src/obd/dtcComunes';

const TYPE_INFO: Record<string, { label: string; color: string }> = {
  P: { label: 'Powertrain (motor / transmisión)', color: C.orange },
  C: { label: 'Chasis (ABS / frenos)', color: C.purple },
  B: { label: 'Carrocería', color: C.cyan },
  U: { label: 'Red / comunicación', color: C.sub },
};

/**
 * Una fila de código, con lo que significa.
 *
 * Hasta la 3.7 esta fila enseñaba el número pelado, la palabra "genérico" y un
 * botón para buscarlo en Google. O sea que la app llevaba encima 8.953
 * descripciones —las usaba para armar el informe del diagnóstico— y en la
 * pantalla donde de verdad lees los códigos había que salir a internet. Eso es
 * lo que se arregla aquí.
 *
 * Se toca y se abre: el título siempre a la vista, y debajo qué significa y
 * por dónde empezar a mirar cuando el código es de los explicados en español.
 */
function DtcRow({ code, pending, estado }: { code: string; pending?: boolean; estado?: string }) {
  const [abierto, setAbierto] = useState(false);
  const info = TYPE_INFO[code[0]] ?? TYPE_INFO.U;
  const base = code.split('-')[0];
  const exp = explicarDtc(base, describirDtc(base));
  const buscar = () => Linking.openURL(`https://www.google.com/search?q=${encodeURIComponent(base + ' OBD2')}`);
  const hayDetalle = !!(exp.que || exp.mirar);

  return (
    <View style={s.dtcItem}>
      <TouchableOpacity
        style={s.dtcCabecera}
        activeOpacity={0.6}
        onPress={() => setAbierto(!abierto)}
      >
        <View style={[s.badge, { backgroundColor: info.color + '33' }]}>
          <Text style={[s.code, { color: info.color }]}>{code}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={s.titulo}>{exp.titulo}</Text>
          <Text style={s.desc}>
            {pending ? 'Pendiente · aún no confirmado' : estado ? estado : exp.generico ? 'De la norma' : 'Propio de Ford'}
            {exp.fuente === 'estructura' ? ' · sin descripción, solo la familia' : ''}
          </Text>
        </View>
        {hayDetalle && (
          <Ionicons name={abierto ? 'chevron-up' : 'chevron-down'} size={18} color={C.muted} />
        )}
      </TouchableOpacity>

      {abierto && (
        <View style={s.detalle}>
          {exp.que ? <><Text style={s.detTitulo}>QUÉ SIGNIFICA</Text><Text style={s.detTexto}>{exp.que}</Text></> : null}
          {exp.mirar ? <><Text style={[s.detTitulo, { marginTop: 10 }]}>POR DÓNDE EMPEZAR</Text><Text style={s.detTexto}>{exp.mirar}</Text></> : null}
          <Text style={s.detFamilia}>{exp.familia}</Text>
          <TouchableOpacity onPress={buscar} style={s.buscar}>
            <Ionicons name="open-outline" size={14} color={C.sub} />
            <Text style={s.buscarTxt}>Buscarlo en internet</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export default function DtcScreen() {
  const { connectionState, dtcCodes, pendingDtcCodes, setDtcCodes, setPendingDtcCodes, vin, setVin,
          selectedProfile, moduleScan, setModuleScan, strictMode } = useObdStore();
  const [scanning, setScanning] = useState(false);
  const [scanningId, setScanningId] = useState('');
  const modules = selectedProfile.modules ?? [];

  const scanModules = async () => {
    setScanning(true); setModuleScan([]);
    const acc: ModuleScanResult[] = [];
    try {
      for (const m of modules) {
        setScanningId(m.id);
        const [r] = await obdGateway.scanModules([m]);
        acc.push(r); setModuleScan([...acc]);
      }
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setScanning(false); setScanningId(''); }
  };

  const clearModule = (m: DiagnosticModule, r: ModuleScanResult) => Alert.alert(
    `Borrar códigos de ${m.name}`,
    'Envía el servicio 14 solo a este módulo. Borra su memoria de fallos; no repara nada. ¿Continuar?',
    [{ text: 'Cancelar', style: 'cancel' },
     { text: 'Borrar', style: 'destructive', onPress: async () => {
        setScanning(true);
        const ok = await obdGateway.clearModuleDtcs(m, r.protocol ?? 'uds', true);
        setScanning(false);
        if (ok) { const [nr] = await obdGateway.scanModules([m]); setModuleScan(moduleScan.map(x => x.moduleId === m.id ? nr : x)); }
        else Alert.alert('No se pudo', 'El módulo no confirmó el borrado.');
      } }]);
  const isConnected = connectionState === 'connected';
  const [loading, setLoading] = useState(false);

  const read = async () => {
    setLoading(true);
    try {
      setDtcCodes(await obdGateway.readDTCs());
      setPendingDtcCodes(await obdGateway.readPendingDTCs());
    } catch { Alert.alert('Error', 'No se pudieron leer los códigos.'); }
    finally { setLoading(false); }
  };

  const readVin = async () => {
    setLoading(true);
    try { setVin((await obdGateway.readVIN()) || ''); } finally { setLoading(false); }
  };

  const clear = () => Alert.alert(
    'Borrar códigos de falla',
    'Esto envía el servicio 04 al PCM: borra DTC almacenados, freeze frame y reinicia los monitores de emisiones (readiness). ' +
    'No repara nada; si la causa sigue, el código volverá. ¿Continuar?',
    [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Borrar', style: 'destructive', onPress: async () => {
          setLoading(true);
          const ok = await obdGateway.clearDTCs(true);
          setLoading(false);
          if (ok) { setDtcCodes([]); setPendingDtcCodes([]); Alert.alert('Listo', 'Códigos borrados.'); }
          else Alert.alert('No se pudo', 'La ECU no confirmó el borrado (prueba con el motor apagado y contacto puesto).');
        } },
    ]);

  if (!isConnected) {
    return <View style={s.container}><EmptyState icon="warning-outline" title="Sin conexión" subtitle="Conecta el escáner en la pestaña Panel" /></View>;
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={{ paddingBottom: 32 }}>
      <Card>
        <SectionTitle>Identificación</SectionTitle>
        <Text style={s.vin}>{vin || 'VIN no leído'}</Text>
        <Button label="Leer VIN" icon="car" variant="ghost" onPress={readVin} loading={loading} style={{ marginTop: 10 }} />
      </Card>

      <Text style={s.help}>
        Toca cualquier código para ver qué significa y por dónde empezar a mirar. La app lleva
        {` ${totalComunes()} `}explicados en español y {totalDtcConocidos().toLocaleString('es')} con
        descripción: no hace falta internet.
      </Text>
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
        <Button label="Leer códigos" icon="search" onPress={read} loading={loading} style={{ flex: 1 }} />
        {(dtcCodes.length > 0 || pendingDtcCodes.length > 0) &&
          <Button label="Borrar" icon="trash" variant="danger" onPress={clear} disabled={loading} style={{ flex: 1 }} />}
      </View>

      {dtcCodes.length > 0 && (
        <Card>
          <SectionTitle>{dtcCodes.length} código{dtcCodes.length > 1 ? 's' : ''} almacenado{dtcCodes.length > 1 ? 's' : ''}</SectionTitle>
          {dtcCodes.map(c => <DtcRow key={c} code={c} />)}
        </Card>
      )}
      {pendingDtcCodes.length > 0 && (
        <Card>
          <SectionTitle>{pendingDtcCodes.length} pendiente{pendingDtcCodes.length > 1 ? 's' : ''} (modo 07)</SectionTitle>
          {pendingDtcCodes.map(c => <DtcRow key={c} code={c} pending />)}
        </Card>
      )}
      {dtcCodes.length === 0 && pendingDtcCodes.length === 0 && !loading && (
        <Card style={{ alignItems: 'center', paddingVertical: 32 }}>
          <Ionicons name="checkmark-circle" size={48} color={C.green} />
          <Text style={{ color: C.green, marginTop: 8, fontSize: 16, fontWeight: '700' }}>Sin códigos de falla</Text>
        </Card>
      )}
      {modules.length > 0 && (
        <>
          <SectionTitle>Escaneo por módulo</SectionTitle>
          <Text style={s.help}>
            Pregunta a cada módulo (ABS, airbags, tablero…) por sus propios códigos con los servicios de lectura
            19 02 / 18 00. Es lo que el botón "Leer códigos" de arriba no alcanza. Hazlo con el contacto puesto.
          </Text>
          <Button label={scanning ? `Escaneando ${modules.find(m => m.id === scanningId)?.name ?? ''}…` : 'Escanear módulos'}
                  icon="scan" onPress={scanModules} loading={scanning} disabled={loading || strictMode} style={{ marginBottom: 12 }} />
          {strictMode && <Text style={[s.help, { color: C.orange }]}>Modo estricto activo (Ajustes → Seguridad): el escaneo por módulo está desactivado.</Text>}
          {modules.map(m => {
            const r = moduleScan.find(x => x.moduleId === m.id);
            const badge = !r ? null
              : r.status === 'ok' ? <Badge text={r.dtcs.length ? `${r.dtcs.length} código${r.dtcs.length > 1 ? 's' : ''}` : 'Sin códigos'} color={r.dtcs.length ? C.orange : C.green} />
              : r.status === 'no_response' ? <Badge text="Sin respuesta" color={C.muted} />
              : r.status === 'unsupported' ? <Badge text="No soportado" color={C.yellow} />
              : <Badge text="Error" color={C.red} />;
            return (
              <Card key={m.id} style={{ paddingVertical: 12, opacity: r && r.status !== 'ok' ? 0.7 : 1 }}>
                <View style={s.modHeader}>
                  <View style={[s.dot, { backgroundColor: m.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.modName}>{m.name}</Text>
                    <Text style={s.modHex}>
                      {m.header} → {m.rxHeader} · {m.codeTypes}
                      {m.bus === 'ms' ? ' · MS-CAN' : ''}
                      {r?.protocol ? ` · ${r.protocol.toUpperCase()}` : ''}
                    </Text>
                    {m.note ? <Text style={s.modNote}>{m.note}</Text> : null}
                  </View>
                  {badge}
                </View>
                {r?.message ? <Text style={s.modMsg}>{r.message}</Text> : null}
                {r?.dtcs.map(d => {
                  const full = d.failureType ? `${d.code}-${d.failureType}` : d.code;
                  return <DtcRow key={full} code={full} estado={describeStatus(d)} />;
                })}
                {r?.status === 'ok' && r.dtcs.length > 0 && (
                  <Button label="Borrar este módulo" icon="trash" variant="danger" onPress={() => clearModule(m, r)} disabled={scanning} style={{ marginTop: 10 }} />
                )}
              </Card>
            );
          })}
        </>
      )}

    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg, padding: 16 },
  help: { color: C.muted, fontSize: 12, lineHeight: 17, marginBottom: 10 },
  modHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  modName: { color: C.text, fontSize: 14, fontWeight: '700' },
  modHex: { color: C.muted, fontSize: 10, fontFamily: 'monospace', marginTop: 2 },
  modMsg: { color: C.muted, fontSize: 11, marginTop: 6 },
  modNote: { color: C.muted, fontSize: 10, marginTop: 3, fontStyle: 'italic' },
  vin: { color: C.cyan, fontFamily: 'monospace', fontSize: 15, letterSpacing: 1 },
  dtcCabecera: { flexDirection: 'row', alignItems: 'center' },
  titulo: { color: C.text, fontSize: 13, fontWeight: '700' },
  detalle: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border },
  detTitulo: { color: C.rojo, fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  detTexto: { color: C.sub, fontSize: 12, lineHeight: 18, marginTop: 3 },
  detFamilia: { color: C.muted, fontSize: 10, marginTop: 10, fontStyle: 'italic' },
  buscar: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10 },
  buscarTxt: { color: C.sub, fontSize: 11, fontWeight: '600' },
  // Ya no es una fila: es un bloque que se abre. La cabecera de dentro sí es fila.
  dtcItem: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.bg },
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  code: { fontSize: 16, fontWeight: '800', fontFamily: 'monospace' },
  type: { color: C.text, fontSize: 14, fontWeight: '600' },
  desc: { color: C.muted, fontSize: 12, marginTop: 2 },
});
