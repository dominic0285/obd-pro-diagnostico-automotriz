import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { Device } from 'react-native-ble-plx';
import { bleManager } from '../../src/ble/BleManager';
import { obdGateway } from '../../src/obd/ObdGateway';
import { Cluster } from '../../src/ui/Cluster';
import { useObdStore } from '../../src/store/useObdStore';
import { C } from '../../src/ui/theme';
import { Card, SectionTitle, Button, Badge } from '../../src/ui/components';

function DeviceItem({ device, onPress, busy }: { device: Device; onPress: () => void; busy: boolean }) {
  const profile = bleManager.resolveUUIDs(device.name);
  return (
    <TouchableOpacity style={s.deviceItem} onPress={onPress} disabled={busy}>
      <Ionicons name="bluetooth" size={20} color={C.cyan} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={s.deviceName}>{device.name ?? 'Dispositivo sin nombre'}</Text>
        <Text style={s.deviceMac}>{device.id} · {profile.label} · {device.rssi ?? '?'} dBm</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={C.muted} />
    </TouchableOpacity>
  );
}


export default function DashboardScreen() {
  const router = useRouter();
  const { connectionState, readings, setConnectionState, setConnectedDevice, setReadings,
          deviceName, selectedProfile, adapter, initStatus, dtcCodes, vin,
          voltageWarning, lastDevice, setLastDevice } = useObdStore();
  const [found, setFound] = useState<Device[]>([]);
  const [lastError, setLastError] = useState('');
  const isConnected = connectionState === 'connected';
  const busy = connectionState === 'connecting' || connectionState === 'initializing';

  useEffect(() => bleManager.onStateChange(setConnectionState), []);
  // Si el canal se detiene por seguridad, avisamos en vez de dejarlo en silencio.
  useEffect(() => bleManager.onCircuitOpen((reason) => {
    setLastError(reason);
    obdGateway.reset();
  }), []);
  // Aquí había una suscripción a las lecturas. Se fue a propósito: era el
  // ÚNICO camino por el que los datos del vehículo llegaban a la interfaz, y
  // vivía dentro de esta pantalla. Ahora el motor los guarda él mismo en el
  // almacén, así que ninguna pantalla puede llevarse los datos al irse.

  const handleScan = async () => {
    setFound([]); setLastError('');
    try {
      const list = await bleManager.scan(setFound, 12000);
      if (list.length === 0) setLastError('No se encontró ningún escáner. Enciende el contacto y acércate al adaptador.');
    } catch (e: any) {
      setLastError(e.message ?? 'Error de escaneo (¿permisos de Bluetooth/ubicación?)');
    }
  };

  const finishConnect = async () => {
    const dev = bleManager.getDevice();
    if (dev) {
      setConnectedDevice(dev);
      const last = bleManager.getLastDevice();
      if (last) setLastDevice(last);
    }
    setConnectionState('initializing');
    await obdGateway.initialize();
    setConnectionState('connected');
  };

  const handleConnect = async (device: Device) => {
    setLastError('');
    try {
      await bleManager.connectToDevice(device);
      await finishConnect();
    } catch (e: any) {
      setLastError(e.message ?? 'Fallo de conexión');
      obdGateway.reset();
      await bleManager.disconnect();
      setConnectedDevice(null);
    }
  };

  /**
   * Reconexión directa por dirección, sin escanear. Es el camino fiable con
   * estos adaptadores: no depende de que estén anunciándose en ese instante.
   */
  const handleReconnect = async () => {
    if (!lastDevice) return;
    setLastError('');
    try {
      bleManager.setLastDevice(lastDevice);
      await bleManager.connectToAddress(lastDevice.id, lastDevice.name);
      await finishConnect();
    } catch (e: any) {
      setLastError(e.message ?? 'No se pudo reconectar');
      obdGateway.reset();
      await bleManager.disconnect();
      setConnectedDevice(null);
    }
  };

  const handleDisconnect = async () => {
    obdGateway.reset();
    await bleManager.disconnect();
    setConnectedDevice(null);
    setReadings(new Map());
  };


  // ── Conectado ──────────────────────────────────────────────────────────
  // El cluster vive en su propio componente. Aquí solo queda la conexión, que
  // es lo único que esta pantalla hace de verdad.
  if (isConnected) {
    return <Cluster onSalir={handleDisconnect} />;
  }

  // ── Conectando / inicializando ─────────────────────────────────────────
  if (busy) {
    return (
      <View style={[s.container, s.center]}>
        <ActivityIndicator size="large" color={C.cyan} />
        <Text style={s.scanning}>{connectionState === 'connecting' ? 'Conectando por Bluetooth…' : 'Inicializando ELM327…'}</Text>
        {initStatus ? <Text style={s.initStatus}>{initStatus}</Text> : null}
        <Text style={s.hint}>Ten el contacto puesto (o el motor encendido). No desconectes el adaptador durante este paso.</Text>
      </View>
    );
  }

  // ── Inactivo / escaneando ──────────────────────────────────────────────
  const scanning = connectionState === 'scanning';
  return (
    <ScrollView style={s.container} contentContainerStyle={{ paddingBottom: 32, flexGrow: 1 }}>
      <View style={[s.center, { paddingVertical: 24 }]}>
        <Ionicons name="car-sport" size={72} color={C.card} />
        <Text style={s.idleTitle}>OBD Pro</Text>
        <Text style={s.idleSub}>Perfil: {selectedProfile.make} {selectedProfile.model} {selectedProfile.year}</Text>
        <TouchableOpacity onPress={() => router.push('/vehicle-select')}>
          <Text style={{ color: C.cyan, fontSize: 13, marginTop: 4 }}>Cambiar vehículo ▸</Text>
        </TouchableOpacity>

        {lastDevice ? (
          <>
            <Button label={`Conectar a ${lastDevice.name ?? lastDevice.id}`} icon="flash"
                    onPress={handleReconnect} loading={busy}
                    style={{ marginTop: 24, paddingHorizontal: 28 }} />
            <Text style={s.hintSmall}>Conexión directa, sin buscar. Es la vía fiable con estos adaptadores.</Text>
            <Button label={scanning ? 'Buscando…' : 'Buscar otro escáner'} icon="bluetooth" variant="ghost"
                    onPress={handleScan} loading={scanning} style={{ marginTop: 10 }} />
          </>
        ) : (
          <Button label={scanning ? 'Buscando…' : 'Buscar escáner'} icon="bluetooth" onPress={handleScan}
                  loading={scanning} style={{ marginTop: 24, paddingHorizontal: 28 }} />
        )}
        {lastError ? <Text style={s.error}>{lastError}</Text> : null}
      </View>

      {found.length > 0 && (
        <>
          <SectionTitle>Dispositivos encontrados</SectionTitle>
          {found.map(d => <DeviceItem key={d.id} device={d} busy={busy} onPress={() => handleConnect(d)} />)}
        </>
      )}

      <Card style={{ marginTop: 16, backgroundColor: C.card2 }}>
        <Text style={s.safetyTitle}>Por qué no aparece en los ajustes de Bluetooth</Text>
        <Text style={s.safetyText}>
          Tu adaptador es Bluetooth LE, y los aparatos LE no se emparejan desde los ajustes de Android:
          se conectan directamente desde la app. Que no salga en la lista de dispositivos del teléfono es
          normal, no es un fallo.{'\n\n'}
          Si alguna vez no lo encuentra al buscar, usa el botón de conexión directa: no depende de que el
          adaptador esté anunciándose en ese momento. Y si sigue sin responder, desenchúfalo del conector
          y vuelve a ponerlo con el contacto apagado; estos aparatos se quedan colgados a veces y solo se
          recuperan quitándoles la corriente.
        </Text>
      </Card>

      <Card style={{ marginTop: 12, backgroundColor: C.card2 }}>
        <Text style={s.safetyTitle}>Seguridad</Text>
        <Text style={s.safetyText}>
          Solo se permiten servicios de lectura, y la lista de comandos permitidos se comprueba en el
          último punto antes de escribir en el adaptador: nada fuera de ella puede salir hacia el carro.
          El ritmo de preguntas tiene un techo fijo. Borrar códigos siempre pide confirmación.
        </Text>
      </Card>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg, padding: 16 },
  center: { justifyContent: 'center', alignItems: 'center' },
  idleTitle: { fontSize: 28, fontWeight: '700', color: C.text, marginTop: 12 },
  idleSub: { fontSize: 13, color: C.muted, marginTop: 6 },
  error: { color: C.red, marginTop: 16, textAlign: 'center', fontSize: 13 },
  scanning: { color: C.sub, marginTop: 16, fontSize: 16 },
  initStatus: { color: C.cyan, marginTop: 8, fontSize: 13 },
  hint: { color: C.muted, marginTop: 20, fontSize: 12, textAlign: 'center', maxWidth: 300 },
  hintSmall: { color: C.muted, marginTop: 8, fontSize: 11, textAlign: 'center', maxWidth: 280 },
  deviceItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, padding: 14, borderRadius: 10, marginBottom: 8 },
  deviceName: { color: C.text, fontSize: 15, fontWeight: '600' },
  deviceMac: { color: C.muted, fontSize: 11, marginTop: 2 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  title: { color: C.text, fontSize: 18, fontWeight: '700' },
  subtitle: { color: C.cyan, fontSize: 12, marginTop: 2 },
  disconnect: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
  primaryRow: { flexDirection: 'row', gap: 12 },
  big: { flex: 1, backgroundColor: C.card, borderRadius: 16, padding: 20, alignItems: 'center' },
  bigValue: { fontSize: 46, fontWeight: '800', color: C.cyan, lineHeight: 54 },
  bigUnit: { color: C.muted, fontSize: 14, marginTop: 4 },
  note: { color: C.muted, fontSize: 11, marginTop: 4 },
  estadoFila: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  estadoNombre: { color: '#F2F2F5', fontSize: 13 },
  estadoValor: { color: C.yellow, fontSize: 15, fontWeight: '800' },
  warn: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: 'rgba(249,115,22,0.12)',
          borderRadius: 12, padding: 12, marginBottom: 12 },
  warnText: { color: C.orange, fontSize: 12, lineHeight: 17, flex: 1 },
  safetyTitle: { color: C.green, fontSize: 12, fontWeight: '800', marginBottom: 6 },
  safetyText: { color: C.sub, fontSize: 12, lineHeight: 17 },
});
