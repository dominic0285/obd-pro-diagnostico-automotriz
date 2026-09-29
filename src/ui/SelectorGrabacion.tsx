/**
 * Qué grabar: la lista con casillas que se abre antes de empezar a grabar.
 *
 * Aquí sale TODO lo que este vehículo puede entregar, incluido lo que está
 * apagado en los ajustes —marcado como apagado—, porque grabar y mirar no son
 * lo mismo. En pantalla no quieres treinta números que no cambian nunca; en una
 * grabación que vas a leer después, sí los quieres, y no tiene sentido obligar
 * a ir a ajustes a encenderlos y luego acordarse de apagarlos. Lo que marques
 * aquí se lee mientras dure la grabación y al parar todo vuelve a su sitio.
 *
 * Lo único que NO sale es lo que el propio vehículo ya contestó que no tiene.
 * Eso no es una preferencia: es un hecho, y pedirlo sería gastar una pregunta
 * por vuelta a cambio de nada.
 *
 * El número de arriba —cuánto tarda una vuelta— es la parte importante de esta
 * pantalla. Marcarlo todo no está prohibido, pero cuesta: con el perfil entero
 * cada dato llega cada varios segundos, y un tirón corto puede caer entre dos
 * lecturas y no aparecer en el informe. Que se vea antes de empezar y no
 * después de leer el informe.
 */
import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, SectionList, TouchableOpacity, useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from './theme';
import type { VehicleProfile } from '../profiles';
import { grabables, costeVuelta, type Grabable } from '../obd/grabacion';

export interface SelectorGrabacionProps {
  visible: boolean;
  profile: VehicleProfile;
  apagados: ReadonlySet<string>;
  sinSoporte: ReadonlySet<string>;
  soportadosModo01?: ReadonlySet<string> | null;
  onCancelar: () => void;
  onGrabar: (claves: string[]) => void;
}

export function SelectorGrabacion({
  visible, profile, apagados, sinSoporte, soportadosModo01, onCancelar, onGrabar,
}: SelectorGrabacionProps) {
  const { height } = useWindowDimensions();
  const lista = useMemo(
    () => grabables(profile, apagados, sinSoporte, soportadosModo01),
    [profile, apagados, sinSoporte, soportadosModo01],
  );

  // De entrada viene marcado lo que está encendido, que es lo que pasaba antes
  // de que existiera esta pantalla: quien no quiera elegir nada, le da a grabar
  // y se comporta igual que siempre.
  const [marcadas, setMarcadas] = useState<Set<string>>(
    () => new Set(lista.filter(x => !x.apagado).map(x => x.pid.key)),
  );

  const secciones = useMemo(() => {
    const por = new Map<string, { title: string; color: string; data: Grabable[] }>();
    for (const x of lista) {
      const sec = por.get(x.grupo) ?? { title: x.grupo, color: x.color, data: [] };
      sec.data.push(x);
      por.set(x.grupo, sec);
    }
    return [...por.values()];
  }, [lista]);

  const coste = useMemo(() => costeVuelta(profile, marcadas), [profile, marcadas]);

  const alternar = (k: string) => setMarcadas(prev => {
    const n = new Set(prev);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  const todas = () => setMarcadas(new Set(lista.map(x => x.pid.key)));
  const ninguna = () => setMarcadas(new Set());
  const soloEncendidas = () => setMarcadas(new Set(lista.filter(x => !x.apagado).map(x => x.pid.key)));

  const lento = coste.segundos > 3;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancelar}>
      <View style={s.fondo}>
        <View style={[s.hoja, { maxHeight: height * 0.92 }]}>
          <View style={s.cabecera}>
            <View style={{ flex: 1 }}>
              <Text style={s.titulo}>¿Qué grabar?</Text>
              <Text style={s.sub}>
                {marcadas.size} de {lista.length} datos · una vuelta ≈ {coste.segundos.toFixed(1)} s
              </Text>
            </View>
            <TouchableOpacity onPress={onCancelar} hitSlop={12} style={s.cerrar}>
              <Ionicons name="close" size={20} color={C.sub} />
            </TouchableOpacity>
          </View>

          <Text style={[s.aviso, lento && { color: C.ambar }]}>
            {lento
              ? `Con ${marcadas.size} datos cada uno se refresca cada ${coste.segundos.toFixed(1)} s. Un tirón corto puede caer entre dos lecturas y no salir en el informe.`
              : `Cada dato se refresca unas ${(1 / Math.max(coste.segundos, 0.05)).toFixed(1)} veces por segundo. El techo de comandos del bus no cambia: solo cambia cuántos entran en cada vuelta.`}
          </Text>

          <View style={s.atajos}>
            <TouchableOpacity style={s.atajo} onPress={soloEncendidas}><Text style={s.atajoTxt}>Los encendidos</Text></TouchableOpacity>
            <TouchableOpacity style={s.atajo} onPress={todas}><Text style={s.atajoTxt}>Todo</Text></TouchableOpacity>
            <TouchableOpacity style={s.atajo} onPress={ninguna}><Text style={s.atajoTxt}>Nada</Text></TouchableOpacity>
          </View>

          <SectionList
            sections={secciones}
            keyExtractor={(x) => x.pid.key}
            stickySectionHeadersEnabled={false}
            renderSectionHeader={({ section }) => (
              <View style={s.grupo}>
                <View style={[s.punto, { backgroundColor: section.color }]} />
                <Text style={s.grupoTxt}>{section.title}</Text>
              </View>
            )}
            renderItem={({ item }) => {
              const on = marcadas.has(item.pid.key);
              return (
                <TouchableOpacity style={s.fila} activeOpacity={0.6} onPress={() => alternar(item.pid.key)}>
                  <Ionicons
                    name={on ? 'checkbox' : 'square-outline'}
                    size={21}
                    color={on ? C.rojo : C.muted}
                  />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={[s.nombre, !on && { color: C.sub }]} numberOfLines={1}>{item.pid.name}</Text>
                    <Text style={s.meta}>
                      {item.pid.command}
                      {item.pid.unit ? ` · ${item.pid.unit}` : ''}
                      {item.pid.verified === false ? ' · sin confirmar' : ''}
                    </Text>
                  </View>
                  {item.apagado && (
                    <View style={s.chip}>
                      <Text style={s.chipTxt}>{on ? 'se enciende' : 'apagado'}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            }}
          />

          <TouchableOpacity
            style={[s.boton, !marcadas.size && s.botonOff]}
            disabled={!marcadas.size}
            onPress={() => onGrabar([...marcadas])}
          >
            <Ionicons name="radio-button-on" size={16} color="#FFF" />
            <Text style={s.botonTxt}>
              {marcadas.size ? `Grabar ${marcadas.size} datos` : 'Marca algo para grabar'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: '#000000CC', justifyContent: 'flex-end' },
  hoja: {
    backgroundColor: C.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    borderWidth: 1, borderColor: C.border, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 12,
  },
  cabecera: { flexDirection: 'row', alignItems: 'flex-start' },
  titulo: { color: C.text, fontSize: 18, fontWeight: '900' },
  sub: { color: C.sub, fontSize: 12, marginTop: 2 },
  cerrar: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.border, backgroundColor: C.card,
  },
  aviso: { color: C.sub, fontSize: 11, lineHeight: 15, marginTop: 10 },
  atajos: { flexDirection: 'row', gap: 8, marginTop: 10, marginBottom: 6 },
  atajo: {
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.card,
  },
  atajoTxt: { color: C.text, fontSize: 12, fontWeight: '700' },
  grupo: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 14, marginBottom: 4 },
  punto: { width: 7, height: 7, borderRadius: 4 },
  grupoTxt: { color: C.sub, fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  fila: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9 },
  nombre: { color: C.text, fontSize: 14, fontWeight: '600' },
  meta: { color: C.muted, fontSize: 10, fontFamily: 'monospace', marginTop: 1 },
  chip: {
    paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.panel,
  },
  chipTxt: { color: C.sub, fontSize: 10, fontWeight: '700' },
  boton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.rojo, borderRadius: 12, paddingVertical: 14, marginTop: 12,
  },
  botonOff: { backgroundColor: C.panel },
  botonTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
});
