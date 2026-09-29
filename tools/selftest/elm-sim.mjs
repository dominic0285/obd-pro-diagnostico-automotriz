/**
 * Simulador de un ELM327 conectado a un vehículo.
 * Reproduce lo que hace el adaptador de verdad: responde con retardo, trocea
 * la respuesta en fragmentos como las notificaciones BLE, y termina siempre
 * con el prompt '>'. Puede portarse mal a propósito.
 */
export class ElmSim {
  constructor(opts = {}) {
    this.mode = opts.mode ?? 'normal';   // normal | slow | silent | garbage | flaky
    this.latency = opts.latency ?? 15;
    this.slowLatency = opts.slowLatency ?? 2500;
    this.chunk = opts.chunk ?? 20;
    this.feed = opts.feed;               // (texto) => void
    this.received = [];
    this.pending = 0;
    this.timers = new Set();
    this.header = '7DF';
  }

  receive(cmd) {
    this.received.push(cmd);
    const mode = typeof this.mode === 'function' ? this.mode(cmd, this.received.length) : this.mode;
    if (mode === 'silent') return;                 // nunca contesta
    const latency = mode === 'slow' ? this.slowLatency : this.latency;
    const body = mode === 'garbage' ? 'STOPPED' : this.answer(cmd);
    this.pending++;
    const t = setTimeout(() => {
      this.timers.delete(t);
      this.pending--;
      this.emit(body + '\r>');
    }, latency);
    this.timers.add(t);
  }

  emit(text) {
    for (let i = 0; i < text.length; i += this.chunk) {
      this.feed(text.slice(i, i + this.chunk));
    }
  }

  answer(cmd) {
    const c = cmd.toUpperCase().replace(/\s+/g, '');
    if (c === 'ATZ') return 'ELM327 v1.5';
    if (c === 'ATRV') return '12.4V';
    if (c === 'ATDPN') return '6';
    if (c === 'ATI') return 'ELM327 v1.5';
    if (c.startsWith('ATSH')) { this.header = c.slice(4); return 'OK'; }
    if (c.startsWith('AT')) return 'OK';
    if (c === '0100') return '4100BE3EA813';
    if (c === '0120') return '412080000000';
    if (c === '0140') return '414000000000';
    if (c === '010C') return '410C0B98';
    if (c === '010D') return '410D00';
    if (c === '0105') return '41057E';
    if (c === '0902') return '014\r0:490201314641\r1:4D50353544383A\r2:41303736373030';
    if (c === '03') return '4301030000';
    if (c === '07') return '4700';
    if (c === '22160E') return '62160E0026';
    if (c === '221E1C') return '621E1C0740';
    if (c === '1902AF') return '5902FFC114452F';
    if (c === '1800FF00') return '58010300 60'.replace(/\s/g, '');
    if (c.startsWith('22')) return '7F2231';        // identificador inexistente
    if (c.startsWith('19')) return '7F1931';
    return 'NO DATA';
  }

  destroy() { this.timers.forEach(t => clearTimeout(t)); this.timers.clear(); }
}
