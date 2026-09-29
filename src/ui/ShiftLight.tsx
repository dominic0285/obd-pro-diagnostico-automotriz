/**
 * Luz de cambio.
 *
 * Ya no dibuja nada: el aviso va en el COLOR DE LA AGUJA del cuentavueltas
 * —verde, ámbar, rojo— porque una fila de puntos arriba obliga a apartar la
 * vista del reloj, que es justo lo que no se puede hacer conduciendo.
 *
 * En un carro automático no hay un punto de cambio fijo que se pueda escribir a
 * mano: la caja sube antes o después según cuánto pises. Poner un umbral
 * inventado sería una luz que miente.
 *
 * Así que esta APRENDE. Mira la marcha comandada; cuando sube, apunta a qué
 * revoluciones ocurrió, y con las últimas seis calcula dónde cambia esta caja
 * con tu forma de conducir. La barra se llena acercándose a ese punto: gris,
 * ámbar, roja. Y cuando el cambio ocurre de verdad, parpadea en verde y deja
 * escrito a qué revoluciones fue.
 *
 * Mientras no haya aprendido nada usa un punto de partida razonable para esta
 * caja, y lo dice: no finge saber lo que todavía no sabe.
 */
import { useEffect, useRef, useState } from 'react';
import { esSubida, calcularAviso, BANDA_CAMBIO } from './cambio';

/** Hasta que aprenda, una 6R80 con el pie suave sube por aquí. */
const PUNTO_INICIAL = 2400;
/** Cuántos cambios se promedian. */
const MEMORIA = 6;
/** Cuánto dura el destello verde tras un cambio. */
const DESTELLO_MS = 1600;

export type Fase = 'normal' | 'pre' | 'cambio' | 'cambiado';

export interface EstadoCambio {
  /** 0 a 1: cuánto falta para el punto de cambio aprendido. */
  aviso: number;
  fase: Fase;
  ultimo: { de: number; a: number; rpm: number } | null;
  punto: number;
  aprendidos: number;
}

const NOMBRE: Record<number, string> = {
  1: '1ª', 2: '2ª', 3: '3ª', 4: '4ª', 5: '5ª', 6: '6ª', 7: 'R',
};


export function useLuzDeCambio(rpm: number | null, marcha: number | null): EstadoCambio {
  const marchaPrev = useRef<number | null>(null);
  const ultimasRpm = useRef<number[]>([]);
  const puntos = useRef<number[]>([]);
  const [ultimo, setUltimo] = useState<EstadoCambio['ultimo']>(null);
  const [destello, setDestello] = useState(false);
  const [punto, setPunto] = useState(PUNTO_INICIAL);
  const [aprendidos, setAprendidos] = useState(0);

  // Las últimas revoluciones, para saber a cuántas iba el motor justo antes
  // del cambio. En el instante en que la marcha sube, las revoluciones YA
  // cayeron, así que el dato bueno es el de un momento antes.
  useEffect(() => {
    if (rpm === null || !Number.isFinite(rpm)) return;
    const a = ultimasRpm.current;
    a.push(rpm);
    if (a.length > 5) a.shift();
  }, [rpm]);

  useEffect(() => {
    if (marcha === null || !Number.isFinite(marcha)) return;
    const prev = marchaPrev.current;
    marchaPrev.current = marcha;
    if (prev === null || marcha === prev) return;

    const subida = esSubida(prev, marcha);
    const rpmCambio = Math.max(0, ...ultimasRpm.current);
    if (subida && rpmCambio > 600) {
      setUltimo({ de: prev, a: marcha, rpm: Math.round(rpmCambio) });
      const p = puntos.current;
      p.push(rpmCambio);
      if (p.length > MEMORIA) p.shift();
      setPunto(Math.round(p.reduce((x, y) => x + y, 0) / p.length));
      setAprendidos(p.length);
    }
    setDestello(true);
    const t = setTimeout(() => setDestello(false), DESTELLO_MS);
    return () => clearTimeout(t);
  }, [marcha]);

  const aviso = calcularAviso(rpm, punto);
  const fase: Fase = destello ? 'cambiado' : aviso >= 0.95 ? 'cambio' : aviso >= 0.6 ? 'pre' : 'normal';

  return { aviso, fase, ultimo, punto, aprendidos };
}
