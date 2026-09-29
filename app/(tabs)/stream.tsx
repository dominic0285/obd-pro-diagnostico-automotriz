/**
 * Flujo de datos en vivo, por grupos que se abren y se cierran.
 *
 * POR QUÉ NO ES UNA LISTA LARGA
 * ─────────────────────────────
 * Lo era, y durante meses funcionó: una lista con todo el perfil, y la app le
 * preguntaba al vehículo solo por las filas que estuvieran dentro de la
 * pantalla. La idea era buena —tener los 129 datos disponibles sin que el bus
 * recibiera nunca más de veinte preguntas por vuelta— pero se apoyaba en que
 * React Native avisara de qué filas están visibles, y eso resultó no ser de
 * fiar: en un teléfono con Android 14 dejaba de avisar después del primer
 * golpe de scroll y las filas de abajo se quedaban en "leyendo…" para siempre,
 * mientras el mismo apk funcionaba en otro teléfono con Android 16.
 *
 * Se intentó arreglar dos veces. La primera fue el objeto de configuración que
 * se creaba en cada dibujado; la segunda, la lista que se rearmaba entera
 * varias veces por segundo. Las dos eran fallos reales y las dos había que
 * arreglarlas, pero en ese teléfono siguió fallando.
 *
 * Así que se cambió el planteamiento. Los grupos empiezan CERRADOS y solo se
 * lee lo del grupo que abres. La ventaja no es solo que funcione en cualquier
 * teléfono: es que ya no hay nada que detectar. Lo que se lee es lo que tú has
 * abierto con el dedo, no lo que un vigilante cree que está en pantalla.
 *
 * Y de paso se diagnostica mejor. Con la lista larga, mirar las cuatro sondas
 * significaba tener en pantalla también los veinte vecinos, así que cada sonda
 * se refrescaba cada varios segundos. Abriendo solo ese grupo, las cuatro se
 * actualizan varias veces por segundo, que es cuando de verdad se ve si una
 * oscila y otra no.
 *
 * La carga sobre la ECU no sube: se sigue pidiendo un número acotado de datos
 * por vuelta, y la cabecera dice cuántos y cuánto tarda la vuelta.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useObdStore } from '../../src/store/useObdStore';
import { textoLectura } from '../../src/profiles';
import { C } from '../../src/ui/theme';
import { EmptyState } from '../../src/ui/components';
import { useVisibles } from '../../src/ui/useVisibles';
import { explicar } from '../../src/obd/glosario';
import { informeGrabacion, costeVuelta } from '../../src/obd/grabacion';
import { SelectorGrabacion } from '../../src/ui/SelectorGrabacion';
import { shareReportFile } from '../../src/obd/export';

/**
 * Tras este tiempo con un grupo abierto y sin recibir NADA, la pantalla deja de
 * decir "leyendo…" y explica qué puede estar pasando.
 *
 * Diez segundos son de sobra: con un grupo abierto una vuelta entera tarda uno
 * o dos. Si en diez no llegó ni un dato, no es lentitud, es que algo no está
 * funcionando, y quedarse en "leyendo…" sería mentir con buena cara.
 */
const SIN_DATOS_MS = 10000;

export default function StreamScreen() {
  const connectionState = useObdStore(st => st.connectionState);
  const selectedProfile = useObdStore(st => st.selectedProfile);
  const readings = useObdStore(st => st.readings);
  const disabledPids = useObdStore(st => st.disabledPids);
  const unsupportedPids = useObdStore(st => st.unsupportedPids);
  const supportedMode01 = useObdStore(st => st.supportedMode01);
  const strictMode = useObdStore(st => st.strictMode);
  const grabando = useObdStore(st => st.grabando);
  const grabMuestras = useObdStore(st => st.grabMuestras);
  const grabInicio = useObdStore(st => st.grabInicio);
  const iniciarGrabacion = useObdStore(st => st.iniciarGrabacion);
  const pararGrabacion = useObdStore(st => st.pararGrabacion);

  const router = useRouter();
  const [abiertos, setAbiertos] = useState<string[]>([]);
  const [abiertoDesde, setAbiertoDesde] = useState<Record<string, number>>({});
  const [ayudaDe, setAyudaDe] = useState<string | null>(null);
  const [eligiendo, setEligiendo] = useState(false);
  /** Late una vez por segundo solo para que el aviso de los diez segundos
   *  aparezca aunque no esté llegando ni un dato que redibuje la pantalla. */
  const [, latido] = useState(0);

  const conectado = connectionState === 'connected';

  useEffect(() => {
    if (!abiertos.length) return;
    const t = setInterval(() => latido(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [abiertos.length]);

  const grupos = useMemo(() => selectedProfile.moduleGroups, [selectedProfile]);

  /** Lo que se le pregunta al vehículo: exactamente lo de los grupos abiertos. */
  const claves = useMemo(() => {
    const out: string[] = [];
    for (const g of grupos) {
      if (!abiertos.includes(g.moduleName)) continue;
      for (const p of g.pids) {
        if (disabledPids.has(p.key) || unsupportedPids.has(p.key)) continue;
        if (p.mode === '01' && supportedMode01 && !supportedMode01.has(p.command)) continue;
        out.push(p.key);
      }
    }
    return out;
  }, [grupos, abiertos, disabledPids, unsupportedPids, supportedMode01]);

  useVisibles('flujo', conectado ? claves : []);

  const coste = useMemo(() => costeVuelta(selectedProfile, claves), [selectedProfile, claves]);

  const alternar = useCallback((nombre: string) => {
    setAbiertos(prev => {
      const esta = prev.includes(nombre);
      if (!esta) setAbiertoDesde(d => ({ ...d, [nombre]: Date.now() }));
      return esta ? prev.filter(x => x !== nombre) : [...prev, nombre];
    });
  }, []);

  const grabar = useCallback(() => {
    if (grabando) {
      pararGrabacion();
      const st = useObdStore.getState();
      const texto = informeGrabacion(st.selectedProfile, st.grabMuestras, st.grabInicio);
      Alert.alert(
        'Grabación detenida',
        `${st.grabMuestras.length} lecturas guardadas. ¿Compartir el informe?`,
        [{ text: 'Ahora no' }, { text: 'Compartir', onPress: () => void shareReportFile(texto, 'grabacion') }],
      );
    } else {
      setEligiendo(true);
    }
  }, [grabando, pararGrabacion]);

  const empezar = useCallback((cs: string[]) => { setEligiendo(false); iniciarGrabacion(cs); }, [iniciarGrabacion]);

  if (!conectado) {
    return <View style={s.container}><EmptyState icon="pulse-outline" title="Sin conexión" subtitle="Conecta el escáner para ver el flujo de datos" /></View>;
  }

  const segundos = grabando ? Math.floor((Date.now() - grabInicio) / 1000) : 0;

  return (
    <View style={s.container}>
      <View style={s.barra}>
        <View style={{ flex: 1 }}>
          <Text style={s.barraTitulo}>
            {abiertos.length ? `${claves.length} datos leyéndose` : 'Todo cerrado · abre un grupo para leerlo'}
          </Text>
          <Text style={s.barraSub}>
            {grabando
              ? `GRABANDO · ${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')} · ${grabMuestras.length} lecturas`
              : abiertos.length
                ? `una vuelta ≈ ${coste.segundos.toFixed(1)} s · ${selectedProfile.make} ${selectedProfile.model}`
                : 'solo sigue vivo el tablero: revoluciones, velocidad, refrigerante, marcha y combustible'}
          </Text>
        </View>
        <TouchableOpacity style={[s.btnGrabar, grabando && s.btnGrabarActivo]} onPress={grabar}>
          <Ionicons name={grabando ? 'stop' : 'radio-button-on'} size={13} color={grabando ? '#08080A' : C.red} />
          <Text style={[s.btnGrabarTexto, grabando && { color: '#08080A' }]}>{grabando ? 'Parar' : 'Grabar'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        {/*
          El modo estricto viene encendido por defecto y deja fuera TODO el
          Modo 22, que es la mayor parte de los perfiles de la Explorer y la
          EcoSport. Hasta la 3.11 eso no se decía en ningún sitio: los grupos
          se abrían, decían "leyendo…" y nunca llegaba nada, porque el motor
          ni siquiera los pedía. En el teléfono de un amigo eso costó tres
          versiones persiguiendo un fallo de Android que no existía. Un ajuste
          que apaga media app tiene que verse desde la primera pantalla.
        */}
        {strictMode && (
          <TouchableOpacity style={s.estricto} activeOpacity={0.7} onPress={() => router.push('/settings')}>
            <Ionicons name="lock-closed" size={16} color={C.ambar} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={s.estrictoTitulo}>MODO ESTRICTO ENCENDIDO</Text>
              <Text style={s.estrictoTexto}>
                Solo se leen los datos estándar (Modo 01). Todos los grupos con dirección propia
                —los de Ford, que son la mayoría— están bloqueados y no se le piden al vehículo.
                Se apaga en Ajustes → Seguridad.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={C.ambar} />
          </TouchableOpacity>
        )}

        {grupos.map(g => {
          const abierto = abiertos.includes(g.moduleName);
          const suyos = g.pids.filter(p => !disabledPids.has(p.key));
          const conDato = suyos.filter(p => readings.has(p.key)).length;
          const desde = abiertoDesde[g.moduleName];
          // Con el modo estricto, un grupo con dirección propia NO se pide.
          // No es que no conteste: es que no se le pregunta. Decir "leyendo…"
          // o esperar diez segundos para dar un error sería mentir.
          const bloqueado = strictMode && !!g.header;
          const mudo = !bloqueado && abierto && conDato === 0 && !!desde && Date.now() - desde > SIN_DATOS_MS;

          return (
            <View key={g.moduleName} style={s.grupo}>
              <TouchableOpacity style={s.grupoCab} activeOpacity={0.6} onPress={() => alternar(g.moduleName)}>
                <View style={[s.dot, { backgroundColor: g.color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.grupoTitulo}>{g.moduleName}</Text>
                  <Text style={[s.grupoSub, bloqueado && { color: C.ambar }]}>
                    {bloqueado
                      ? `${suyos.length} datos · bloqueado por el modo estricto`
                      : `${suyos.length} datos · ${g.header ? `${g.header} → ${g.rxHeader ?? ''}` : '7DF'}${abierto ? ` · ${conDato} con lectura` : ''}`}
                  </Text>
                </View>
                {bloqueado && <Ionicons name="lock-closed" size={14} color={C.ambar} style={{ marginRight: 6 }} />}
                {mudo && <Ionicons name="alert-circle" size={16} color={C.rojoVivo} style={{ marginRight: 6 }} />}
                <Ionicons name={abierto ? 'chevron-up' : 'chevron-down'} size={18} color={C.sub} />
              </TouchableOpacity>

              {abierto && mudo && (
                <View style={s.aviso}>
                  <Text style={s.avisoTitulo}>NO LLEGA NINGÚN DATO DE ESTE GRUPO</Text>
                  <Text style={s.avisoTexto}>
                    Han pasado diez segundos con el grupo abierto y no ha contestado ni uno solo de
                    sus {suyos.length} datos. Con un grupo abierto una vuelta entera tarda uno o dos
                    segundos, así que esto no es lentitud.
                    {'\n\n'}
                    Lo más probable, por orden:
                    {'\n'}· El motor está apagado. Muchos datos solo existen con el motor en marcha.
                    {'\n'}· Este módulo no contesta{g.header ? ` en ${g.header}` : ''}. Otros grupos pueden ir bien.
                    {'\n'}· El escáner perdió el diálogo con el vehículo: prueba a desconectar y conectar.
                    {'\n\n'}
                    Si otro grupo sí muestra datos, el problema es de este módulo y no de la app.
                  </Text>
                </View>
              )}

              {abierto && suyos.map(p => {
                const r = readings.get(p.key);
                const noSoportado = unsupportedPids.has(p.key)
                  || (p.mode === '01' && !!supportedMode01 && !supportedMode01.has(p.command));
                const estado = bloqueado ? 'bloqueado · modo estricto'
                  : noSoportado ? 'el vehículo no lo tiene'
                  : r ? `hace ${((Date.now() - r.timestamp) / 1000).toFixed(0)} s`
                  : mudo ? 'sin respuesta' : 'leyendo…';
                const ayuda = explicar(p);
                const verAyuda = ayudaDe === p.key;
                return (
                  <View key={p.key} style={[s.fila, (noSoportado || bloqueado) && { opacity: 0.4 }]}>
                    <TouchableOpacity
                      style={s.filaTop} activeOpacity={0.6}
                      onPress={() => setAyudaDe(verAyuda ? null : p.key)}
                    >
                      <View style={{ flex: 1 }}>
                        <View style={s.nameLine}>
                          <Text style={s.name}>{p.name}</Text>
                          {!!ayuda && <Ionicons name={verAyuda ? 'chevron-up' : 'help-circle-outline'} size={13} color={C.muted} style={{ marginLeft: 5 }} />}
                        </View>
                        <Text style={s.cmd}>{p.command} · {estado}{r ? ` · ${r.rawHex}` : ''}</Text>
                      </View>
                      <Text style={[s.val, { color: r ? g.color : C.muted }]}>
                        {r ? textoLectura(p, r.value) : '—'}
                      </Text>
                    </TouchableOpacity>
                    {verAyuda && !!ayuda && <Text style={s.ayuda}>{ayuda}</Text>}
                  </View>
                );
              })}
            </View>
          );
        })}
      </ScrollView>

      <SelectorGrabacion
        visible={eligiendo}
        profile={selectedProfile}
        apagados={disabledPids}
        sinSoporte={unsupportedPids}
        soportadosModo01={supportedMode01}
        onCancelar={() => setEligiendo(false)}
        onGrabar={empezar}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  barra: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10,
           borderBottomWidth: 1, borderBottomColor: C.card, gap: 10 },
  barraTitulo: { color: C.text, fontSize: 13, fontWeight: '700' },
  barraSub: { color: C.muted, fontSize: 10, marginTop: 1 },
  btnGrabar: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7,
               borderRadius: 8, backgroundColor: C.card, borderWidth: 1, borderColor: C.red },
  btnGrabarActivo: { backgroundColor: C.red, borderColor: C.red },
  btnGrabarTexto: { color: C.red, fontSize: 12, fontWeight: '800' },

  grupo: { marginBottom: 10, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.card2, overflow: 'hidden' },
  grupoCab: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  grupoTitulo: { color: C.text, fontSize: 13, fontWeight: '800' },
  grupoSub: { color: C.muted, fontSize: 10, marginTop: 2, fontFamily: 'monospace' },

  estricto: { flexDirection: 'row', alignItems: 'center', padding: 12, marginBottom: 12, borderRadius: 12,
              borderWidth: 1, borderColor: C.ambar, backgroundColor: '#1C1405' },
  estrictoTitulo: { color: C.ambar, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  estrictoTexto: { color: C.sub, fontSize: 11, lineHeight: 16, marginTop: 3 },

  aviso: { marginHorizontal: 10, marginBottom: 10, padding: 12, borderRadius: 10,
           borderWidth: 1, borderColor: C.rojoApagado, backgroundColor: '#1A0B0A' },
  avisoTitulo: { color: C.rojoVivo, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  avisoTexto: { color: C.sub, fontSize: 11, lineHeight: 17, marginTop: 6 },

  fila: { backgroundColor: C.card, borderRadius: 10, marginHorizontal: 10, marginBottom: 6, overflow: 'hidden' },
  filaTop: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10 },
  nameLine: { flexDirection: 'row', alignItems: 'center' },
  name: { color: '#F2F2F5', fontSize: 13, fontWeight: '500' },
  cmd: { color: C.muted, fontSize: 10, fontFamily: 'monospace', marginTop: 1 },
  val: { fontSize: 14, fontWeight: '800' },
  ayuda: { color: C.sub, fontSize: 11, lineHeight: 16, paddingHorizontal: 14, paddingBottom: 12, paddingTop: 2 },
});
