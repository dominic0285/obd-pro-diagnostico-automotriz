/**
 * Pantalla de datos. Todo lo que no cabe en el cluster, en anillos.
 *
 * Se abre desde el botón de la esquina del cluster y mientras no esté abierta
 * no se le pregunta al vehículo ni uno de estos datos.
 */
import React from 'react';
import { PantallaDatos } from '../src/ui/Portada';

export default function Datos() {
  return <PantallaDatos />;
}
