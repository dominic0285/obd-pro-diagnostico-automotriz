/**
 * Paleta.
 *
 * Deportiva, negro y rojo, sin neón. El neón se ve bien en una captura y fatal
 * en un teléfono sujeto al parabrisas con sol de frente: los colores muy
 * saturados sobre negro vibran y cuesta leer un número de un vistazo.
 *
 * La regla aquí es que el rojo signifique algo. Se usa para el acento de la
 * marca y para lo que hay que mirar ahora; todo lo demás va en grises. Si todo
 * es rojo, nada destaca.
 */
export const C = {
  // ── Superficies ────────────────────────────────────────────────────────
  bg: '#08080A',
  card: '#131317',
  card2: '#0D0D10',
  panel: '#17171C',
  border: '#26262E',
  linea: '#32323C',

  // ── Texto ──────────────────────────────────────────────────────────────
  text: '#F2F2F5',
  sub: '#93939E',
  muted: '#56565F',

  // ── Acentos ────────────────────────────────────────────────────────────
  /** El rojo de la marca. Para el acento y para lo que hay que mirar. */
  rojo: '#D81F14',
  /** Más vivo, solo para el aviso que no se puede perder de vista. */
  rojoVivo: '#FF3B2E',
  rojoApagado: '#4A100C',
  ambar: '#E8930C',
  verde: '#2FA84F',
  azul: '#2C74D6',
  violeta: '#7A6BD0',

  // ── Nombres antiguos, para que las demás pantallas sigan funcionando ───
  // Apuntan a los tonos nuevos: así el cambio de estilo llega a toda la app
  // sin tener que tocar cada pantalla.
  cyan: '#2C74D6',
  green: '#2FA84F',
  orange: '#E8930C',
  red: '#D81F14',
  purple: '#7A6BD0',
  yellow: '#E8930C',
};

/** Colores por sistema, para que cada bloque de la portada tenga su tono. */
export const TONO = {
  motor: '#D81F14',
  combustible: '#E8930C',
  sondas: '#2C74D6',
  transmision: '#7A6BD0',
  electrico: '#2FA84F',
  frenos: '#C25A12',
};
