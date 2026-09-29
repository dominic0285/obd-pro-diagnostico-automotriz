/**
 * El enganche entre lo que ves y lo que se le pregunta al vehículo.
 *
 * Cada pantalla declara qué claves tiene delante. Mientras esa pantalla está
 * delante, esas claves entran en el plan de muestreo; cuando la dejas, salen.
 * Nada se pregunta "por si acaso".
 *
 * Por qué hay TRES mecanismos y no uno
 * ────────────────────────────────────
 * Hasta la 3.6 la declaración se hacía solo con `useFocusEffect`, o sea que
 * dependía de un evento de navegación. Eso falló en el carro: conectando el
 * escáner con la camioneta ya andando, el tablero no enseñaba ni la marcha ni
 * la palanca, y solo aparecían después de entrar a la lista de datos en vivo,
 * bajar hasta esas filas y volver. Ese viaje de ida y vuelta es exactamente un
 * evento de foco: la declaración que debía haberse hecho al aparecer el
 * tablero no se hizo, y lo único que la disparaba era volver a entrar.
 *
 * El problema de fondo no es cuál era el disparador que falló, sino que solo
 * hubiera uno. La pantalla que miras conduciendo no puede quedarse en blanco
 * a la espera de que se te ocurra salir y entrar. Así que ahora son tres, y
 * cada uno cubre lo que el anterior puede perder:
 *
 *  1. MONTAJE. Al aparecer la pantalla se declara, sin esperar a nadie. Este
 *     es el que faltaba: el tablero aparece cuando la conexión pasa a "lista",
 *     que no es un cambio de pantalla y por tanto no emite evento de foco.
 *  2. FOCO. Al salir se retira y al volver se devuelve, que es lo que hace que
 *     una pantalla que no miras no gaste comandos.
 *  3. VIGILANTE. Cada tres segundos comprueba que lo declarado siga en pie y,
 *     si no, lo vuelve a declarar. No cuesta ni un comando al vehículo —mira
 *     el estado de la app, no el bus— y convierte "se quedó en blanco para
 *     siempre" en "se arregló solo en tres segundos".
 */
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
// De expo-router, NO de @react-navigation/native. Desde el SDK 56 expo-router
// rechaza que se importe react-navigation directamente y el empaquetado falla
// entero. expo-router reexporta este mismo hook.
import { useFocusEffect } from 'expo-router';
import { useObdStore } from '../store/useObdStore';
import { hayQueRedeclarar, VIGILANTE_MS } from '../obd/nucleo';

/**
 * Declara las claves visibles de una pantalla.
 *
 * @param dueño   nombre único de la pantalla ('cluster', 'flujo', …)
 * @param claves  las claves que se están mostrando ahora mismo
 */
export function useVisibles(dueño: string, claves: string[]) {
  // La lista se compara por su contenido, no por identidad: si no, cada
  // render crearía un array nuevo y el efecto se dispararía sin parar.
  const firma = claves.join('|');
  const setVisibles = useObdStore(s => s.setVisibles);
  const quitarVisibles = useObdStore(s => s.quitarVisibles);
  // Volver del segundo plano no emite ningún evento de navegación, así que
  // useFocusEffect no se entera. Esta generación sí cambia, y con ella los
  // efectos se vuelven a ejecutar y la pantalla se registra otra vez.
  const generacion = useObdStore(s => s.generacionApp);

  // ── 1 · Al montar ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!firma) { quitarVisibles(dueño); return; }
    setVisibles(dueño, firma.split('|'));
    return () => quitarVisibles(dueño);
  }, [dueño, firma, generacion, setVisibles, quitarVisibles]);

  // ── 2 · Al entrar y salir de la pantalla ───────────────────────────────
  const enfocada = useRef(true);
  useFocusEffect(
    useCallback(() => {
      enfocada.current = true;
      if (firma) setVisibles(dueño, firma.split('|'));
      return () => { enfocada.current = false; quitarVisibles(dueño); };
    }, [dueño, firma, setVisibles, quitarVisibles]),
  );

  // ── 3 · El vigilante ───────────────────────────────────────────────────
  // Solo actúa cuando encuentra algo mal, y entonces lo arregla en silencio.
  //
  // OJO con la condición del foco, que no estaba y costó caro: sin ella, el
  // vigilante deshacía el trabajo del punto 2. Salías del tablero, el foco
  // quitaba sus claves, y tres segundos después el vigilante las devolvía.
  // Resultado: la marcha y la palanca se seguían pidiendo al TCM en cada
  // vuelta —con su cambio de cabecera— aunque estuvieras en otra pestaña, que
  // es exactamente lo que toda esta arquitectura existe para evitar. Y en
  // silencio, porque nada se veía roto.
  useEffect(() => {
    if (!firma) return;
    const t = setInterval(() => {
      if (!enfocada.current) return;
      const actual = useObdStore.getState().visiblesPorPantalla.get(dueño);
      if (hayQueRedeclarar(actual, firma)) setVisibles(dueño, firma.split('|'));
    }, VIGILANTE_MS);
    return () => clearInterval(t);
  }, [dueño, firma, setVisibles]);
}

/**
 * Con la app en segundo plano no hay ninguna pantalla delante, así que se
 * borran todos los registros y el muestreo cae al núcleo. Al volver, las
 * pantallas se registran otra vez solas porque sube la generación.
 *
 * Solo cuenta 'background', no 'inactive'. En iOS el estado pasa a 'inactive'
 * por cosas de un segundo que no son irse de la app: bajar el centro de
 * notificaciones, asomarse al conmutador, una llamada entrante; en Android, un
 * diálogo de permisos. Tratar eso como "se fue" haría que la app pareciera
 * congelarse cada dos por tres.
 */
export function useVisiblesSegundoPlano() {
  const limpiar = useObdStore(s => s.quitarVisibles);
  const alFrente = useObdStore(s => s.appAlFrente);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'background') {
        for (const dueño of [...useObdStore.getState().visiblesPorPantalla.keys()]) limpiar(dueño);
      } else if (estado === 'active') {
        alFrente();
      }
    });
    return () => sub.remove();
  }, [limpiar, alFrente]);
}
