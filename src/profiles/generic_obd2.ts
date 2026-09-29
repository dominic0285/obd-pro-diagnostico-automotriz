import type { VehicleProfile } from './index';

export const GENERIC_OBD2_PROFILE: VehicleProfile = {
  id: 'generic_obd2',
  make: 'Genérico',
  model: 'Estándar OBD2',
  year: 'Todos',
  engine: 'Gasolina / Diésel',
  description: 'SAE J1979 Modo 01 vía header funcional 7DF. Los PIDs que el vehículo no soporte (según 0100/0120/0140) se omiten automáticamente.',
  hasEnhanced: false,
  modules: [
    { id: 'pcm', name: 'PCM (motor)', header: '7E0', rxHeader: '7E8', codeTypes: 'P / U', color: '#2C74D6' },
  ],
  moduleGroups: [
    {
      header: '',
      moduleName: 'PCM (Estándar)',
      color: '#2C74D6',
      pids: [
        { command: '010C', key: '010C', name: 'RPM del motor',        unit: 'rpm',  min: 0,   max: 8000, mode: '01', verified: true, formula: ([A, B]) => ((A * 256) + B) / 4 },
        { command: '010D', key: '010D', name: 'Velocidad',            unit: 'km/h', min: 0,   max: 255,  mode: '01', verified: true, formula: ([A]) => A },
        { command: '0105', key: '0105', name: 'Temp. refrigerante',   unit: '°C',   min: -40, max: 150,  mode: '01', verified: true, formula: ([A]) => A - 40 },
        { command: '0104', key: '0104', name: 'Carga del motor',      unit: '%',    min: 0,   max: 100,  mode: '01', verified: true, formula: ([A]) => (A * 100) / 255 },
        { command: '0111', key: '0111', name: 'Posición acelerador',  unit: '%',    min: 0,   max: 100,  mode: '01', verified: true, formula: ([A]) => (A * 100) / 255 },
        { command: '010F', key: '010F', name: 'Temp. aire admisión',  unit: '°C',   min: -40, max: 120,  mode: '01', verified: true, formula: ([A]) => A - 40 },
        { command: '010B', key: '010B', name: 'MAP',                  unit: 'kPa',  min: 0,   max: 255,  mode: '01', verified: true, formula: ([A]) => A },
        { command: '0110', key: '0110', name: 'Flujo MAF',            unit: 'g/s',  min: 0,   max: 200,  mode: '01', verified: true, formula: ([A, B]) => ((A * 256) + B) / 100 },
        { command: '010E', key: '010E', name: 'Avance encendido',     unit: '°',    min: -64, max: 64,   mode: '01', verified: true, formula: ([A]) => A / 2 - 64 },
        { command: '0106', key: '0106', name: 'STFT Banco 1',         unit: '%',    min: -25, max: 25,   mode: '01', verified: true, formula: ([A]) => (A - 128) * 100 / 128 },
        { command: '0107', key: '0107', name: 'LTFT Banco 1',         unit: '%',    min: -25, max: 25,   mode: '01', verified: true, formula: ([A]) => (A - 128) * 100 / 128 },
        { command: '0108', key: '0108', name: 'STFT Banco 2',         unit: '%',    min: -25, max: 25,   mode: '01', verified: true, formula: ([A]) => (A - 128) * 100 / 128 },
        { command: '0109', key: '0109', name: 'LTFT Banco 2',         unit: '%',    min: -25, max: 25,   mode: '01', verified: true, formula: ([A]) => (A - 128) * 100 / 128 },
        { command: '012F', key: '012F', name: 'Nivel combustible',    unit: '%',    min: 0,   max: 100,  mode: '01', verified: true, formula: ([A]) => (A * 100) / 255 },
        { command: '0142', key: '0142', name: 'Voltaje módulo',       unit: 'V',    min: 0,   max: 18,   mode: '01', verified: true, formula: ([A, B]) => ((A * 256) + B) / 1000 },
        { command: '015C', key: '015C', name: 'Temp. aceite',         unit: '°C',   min: -40, max: 150,  mode: '01', verified: true, formula: ([A]) => A - 40 },
        { command: '0133', key: '0133', name: 'Presión barométrica',  unit: 'kPa',  min: 60,  max: 110,  mode: '01', verified: true, formula: ([A]) => A },
        { command: '015E', key: '015E', name: 'Consumo',              unit: 'L/h',  min: 0,   max: 60,   mode: '01', verified: true, formula: ([A, B]) => ((A * 256) + B) * 0.05 },
      ],
    },
  ],
};
