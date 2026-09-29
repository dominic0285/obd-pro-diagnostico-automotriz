/**
 * Genera el informe de texto de una prueba de PIDs, pensado para copiar y
 * pegar tal cual. Sin adornos: lo importante es el hexadecimal crudo, que es
 * lo único que permite deducir la fórmula correcta a posteriori.
 */

import type { VehicleProfile } from '../profiles';
import type { PidProbeResult } from './ObdGateway';
import type { AdapterInfo } from '../store/useObdStore';

export interface ReportInput {
  profile: VehicleProfile;
  results: Map<string, PidProbeResult>;
  adapter: AdapterInfo;
  deviceName: string | null;
  vin: string;
  strictMode: boolean;
  /** true solo si la prueba cubrió el perfil entero sin cortarse. */
  complete: boolean;
  /** PIDs que se esperaban probar. */
  expected: number;
  scope: 'all' | 'partial';
}

const MARK: Record<PidProbeResult['status'], string> = {
  ok: 'SI ',
  unsupported: 'NO ',
  no_response: '-- ',
  error: 'ERR',
};

export function buildProbeReport(i: ReportInput): string {
  const L: string[] = [];
  const now = new Date();

  const faltan = Math.max(0, i.expected - i.results.size);
  const enElPerfil = i.profile.moduleGroups.reduce((n, g) => n + g.pids.length, 0);
  const truncada = faltan > 0;

  if (i.complete) {
    L.push('INFORME DE PRUEBA DE PIDs — COMPLETO');
  } else if (truncada) {
    L.push('INFORME DE PRUEBA DE PIDs — *** SE CORTÓ A MEDIAS ***');
    L.push(`Faltaron ${faltan} de los ${i.expected} PIDs que tocaba probar. Lo que no se probó no aparece aquí: no lo leas como "no existe".`);
  } else {
    L.push('INFORME DE PRUEBA DE PIDs — SUBCONJUNTO');
    L.push(`Se probó lo que estaba activado: ${i.results.size} de ${i.results.size} previstos (el perfil tiene ${enElPerfil} PIDs en total).`);
    L.push('Los que no estaban activados no se preguntaron. Este informe no dice nada sobre ellos.');
  }
  L.push(`Fecha: ${now.toLocaleString()}`);
  L.push(`Vehiculo: ${i.profile.make} ${i.profile.model} ${i.profile.year} - ${i.profile.engine}`);
  L.push(i.vin
    ? `VIN: ${i.vin}`
    : 'VIN: no se pudo leer (el PCM no lo soltó; no afecta a nada de lo de abajo)');
  L.push(`Adaptador: ${i.deviceName ?? '?'}${i.adapter.elmVersion ? ' / ' + i.adapter.elmVersion : ''}`);
  L.push(`Protocolo: ${i.adapter.protocol || '?'} ${i.adapter.protocolName || ''}`);
  if (i.adapter.voltage) L.push(`Voltaje: ${i.adapter.voltage}`);
  L.push(`Modo estricto: ${i.strictMode ? 'SI' : 'NO'}`);
  L.push('');
  L.push('SI = respondio con un valor    NO = el modulo dice que no existe');
  L.push('-- = sin respuesta             ERR = fallo de comunicacion');
  L.push('');

  let ok = 0, no = 0, sin = 0, err = 0, total = 0;

  for (const g of i.profile.moduleGroups) {
    const probed = g.pids.filter(p => i.results.has(p.key));
    if (!probed.length) continue;
    L.push(`== ${g.moduleName}  [${g.header || '7DF'}${g.rxHeader ? ' -> ' + g.rxHeader : ''}]`);
    for (const p of probed) {
      const r = i.results.get(p.key)!;
      total++;
      if (r.status === 'ok') ok++;
      else if (r.status === 'unsupported') no++;
      else if (r.status === 'no_response') sin++;
      else err++;

      const val = r.status === 'ok' ? `${r.value} ${p.unit}`.trim() : (r.message ?? '');
      const raw = r.raw ? `  crudo=${r.raw}` : '';
      L.push(`${MARK[r.status]} ${p.command.padEnd(7)} ${p.name.padEnd(34)} ${val}${raw}`);
    }
    L.push('');
  }

  L.push(`RESUMEN: ${total} probados / ${ok} responden / ${no} no existen / ${sin} sin respuesta / ${err} error`);
  if (i.complete) L.push('FIN DEL INFORME (completo)');
  else if (truncada) L.push(`FIN DEL INFORME (se cortó: faltan ${faltan} de ${i.expected})`);
  else L.push(`FIN DEL INFORME (subconjunto: ${i.results.size} de los ${enElPerfil} PIDs del perfil)`);

  const buenos = [...i.results.entries()].filter(([, r]) => r.status === 'ok').length;
  if (buenos === 0 && sin === total && total > 0) {
    L.push('Nadie contesto a nada: revisa que el contacto este puesto y que el adaptador siga conectado.');
  } else if (buenos === 0 && no > 0) {
    L.push('Los modulos SI contestaron, pero dijeron que ninguno de esos identificadores existe. El adaptador y el bus estan bien; los identificadores no son los de este vehiculo.');
  }
  return L.join('\n');
}
