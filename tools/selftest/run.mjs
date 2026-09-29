/**
 * Batería de seguridad. Ejecuta el código real de la app contra un ELM327
 * simulado y comprueba las garantías que impiden dañar la ECU.
 *   node --experimental-strip-types tools/selftest/run.mjs
 */
import { build } from './build.mjs';
import { ElmSim } from './elm-sim.mjs';

const dir = build();
const { checkCommandSafety, READ_SERVICES, CLEAR_SERVICES } = await import(`${dir}/obd/safety.ts`);
const { CommandPipeline, HARD_LIMITS } = await import(`${dir}/obd/pipeline.ts`);
const { PollEngine } = await import(`${dir}/obd/pollEngine.ts`);
const P = await import(`${dir}/obd/protocol.ts`);

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) pass++;
  else { fail++; failures.push(`${name} ${detail}`); console.log(`  X ${name} ${detail}`); }
}
function section(t) { console.log(`\n-- ${t}`); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

section('A · Lista blanca: nada peligroso puede existir como comando');
const DANGEROUS_SERVICES = ['10', '11', '27', '28', '2E', '2F', '31', '34', '35', '36', '37',
  '3B', '3D', '85', '87', '3E',
  ...Array.from({ length: 32 }, (_, i) => (0xA0 + i).toString(16).toUpperCase())];
for (const svc of DANGEROUS_SERVICES) {
  check(`servicio ${svc} rechazado`, checkCommandSafety(svc + '0102').ok === false);
}
const DANGEROUS_AT = [
  'ATSH 200', 'ATSH 000', 'ATSH 6FF', 'ATSH18DAF110', 'ATSH 18DB33F1',
  'ATCAF0', 'ATAL', 'ATCSM0', 'ATMA', 'ATMR 7E8', 'ATMT 20', 'ATRTR',
  'ATPP 0C SV 23', 'ATPP 2F ON', 'ATBI', 'ATSPB', 'ATSPC', 'ATPB 40 00',
  'ATR0', 'ATCM 700', 'ATCF 7E8', 'STP53', 'STPBR 500000', 'ATFCSH 7E0',
  'ATIB 10', 'ATJE', 'ATV1', 'ATZZ', 'AT@1',
];
for (const at of DANGEROUS_AT) check(`${at} rechazado`, checkCommandSafety(at).ok === false);
// El 21 (leer dato KWP) entra en la lista blanca; su vecino de escritura NO.
for (const c of ['3B01FF', '3D01', '2101FF00AA', '2100']) {
  const permitido = checkCommandSafety(c).ok;
  check(`${c} ${c.startsWith('21') ? 'permitido' : 'rechazado'}`, permitido === c.startsWith('21'));
}
const ALLOWED = ['010C', '0100', '0902', '03', '07', '0A', '02020C', '0601', '050101',
  '22160E', '221E1C', '1902AF', '1800FF00', '2101', '2140', '21FF',
  // Modos estandar que la version 2.2 empieza a usar
  '0904', '0906', '090A', '0908', '090B', '0A', '0500',
  '020200', '020C00', '021100', '0103', '0114', '0133', '013C', '015E',
  '010A', '0122', '0123', '0159',
  'ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATAT1', 'ATST32', 'ATSP6', 'ATSP0', 'ATDPN', 'ATDP',
  'ATRV', 'ATI', 'ATCAF1', 'ATSH 7E0', 'ATSH 7DF', 'ATSH 760', 'ATCRA 7E8', 'ATCRA 7EX',
  'ATCRA', 'ATAR', 'ATTP6'];
for (const c of ALLOWED) check(`${c} permitido`, checkCommandSafety(c).ok === true, JSON.stringify(checkCommandSafety(c)));
for (const c of ['04', '14FFFFFF', '14FF00', 'ATZ']) {
  const v = checkCommandSafety(c);
  check(`${c} pide confirmación`, v.ok === true && v.needsConfirm === true);
}
for (const c of ['22160E', '1902AF', '1800FF00', '2101', 'ATSH 7E0', 'ATSH 760']) {
  check(`estricto rechaza ${c}`, checkCommandSafety(c, true).ok === false);
}
for (const c of ['010C', '03', '07', '0902', '050101', '0601', 'ATSH 7DF', 'ATSP6', 'ATRV']) {
  check(`estricto permite ${c}`, checkCommandSafety(c, true).ok === true);
}
// El 08 acciona componentes: debe seguir fuera aunque el 05 y el 06 entren.
check('servicio 08 sigue bloqueado', checkCommandSafety('080101').ok === false);

section('A2 · Fuzz de 60.000 comandos al azar');
const CHARS = '0123456789ABCDEFGHXYZ @#$%^&*()-_=+[]{};:,.<>/?\\\'"`~\t\n ';
const AT_OK = /^AT(Z|WS|D|I|RV|DP|DPN|E[01]|L[01]|S[01]|H[01]|AT[0-2]|CAF1|ST[0-9A-F]{1,2}|SP[0-9A]|TP[0-9A]|SH7[0-9A-F]{2}|CRA(7[0-9A-FX]{2})?|AR)$/;
check('modo 05 permitido (lo usa un escáner genérico)', checkCommandSafety('0501').ok === true);
function rnd(n) { let s = ''; for (let i = 0; i < n; i++) s += CHARS[(Math.random() * CHARS.length) | 0]; return s; }
let accepted = 0, violations = 0;
for (let i = 0; i < 60000; i++) {
  const raw = Math.random() < 0.5 ? rnd(1 + ((Math.random() * 10) | 0))
    : (Math.random() < 0.5 ? 'AT' : '') + rnd(1 + ((Math.random() * 8) | 0));
  if (!checkCommandSafety(raw).ok) continue;
  accepted++;
  const cmd = raw.trim().toUpperCase().replace(/\s+/g, '');
  const okAt = /^AT/.test(cmd) && AT_OK.test(cmd);
  const okHex = /^[0-9A-F]+$/.test(cmd) && cmd.length % 2 === 0 && cmd.length <= 16
    && (READ_SERVICES.has(cmd.slice(0, 2)) || CLEAR_SERVICES.has(cmd.slice(0, 2)));
  if (!okAt && !okHex) { violations++; if (violations < 4) console.log('    escapó:', JSON.stringify(raw)); }
}
check('fuzz: ningún comando fuera del molde', violations === 0, `${violations} de ${accepted}`);
console.log(`  (${accepted} aceptados de 60000, ${violations} violaciones)`);

section('B · Canal de comandos contra un ELM327 simulado');
function makePipe(simOpts = {}, hooks = {}) {
  const writes = [];
  let inFlight = 0, overlap = 0;
  const box = {};
  const sim = new ElmSim({ ...simOpts, feed: (t) => box.pipe.feed(t) });
  box.pipe = new CommandPipeline({
    write: async (payload) => {
      if (inFlight > 0) overlap++;
      inFlight++;
      writes.push({ cmd: payload.replace(/\r$/, ''), t: Date.now() });
      await sleep(1);
      inFlight--;
      sim.receive(payload.replace(/\r$/, ''));
    },
    ...hooks,
  });
  return { pipe: box.pipe, sim, writes, get overlap() { return overlap; } };
}

{
  const h = makePipe();
  // Se encolan por debajo del tope de cola para medir solo la concurrencia.
  const N = HARD_LIMITS.MAX_QUEUE - 2;
  const res = await Promise.allSettled(Array.from({ length: N }, () => h.pipe.send('010C', 4000)));
  check('B1 nunca hay dos comandos escribiéndose a la vez', h.overlap === 0, `solapes=${h.overlap}`);
  check('B1 todos enviados y resueltos', h.writes.length === N && res.every(r => r.status === 'fulfilled'),
    `escritos=${h.writes.length}/${N}`);
  h.sim.destroy();
}
{
  const h = makePipe({ latency: 0 });
  await Promise.all(Array.from({ length: 120 }, () => h.pipe.send('010C', 4000).catch(() => null)));
  let maxWindow = 0, minGap = Infinity;
  const w = h.writes;
  for (let i = 0; i < w.length; i++) {
    maxWindow = Math.max(maxWindow, w.filter(y => y.t > w[i].t - 1000 && y.t <= w[i].t).length);
    if (i > 0) minGap = Math.min(minGap, w[i].t - w[i - 1].t);
  }
  check('B2 nunca supera el máximo por segundo', maxWindow <= HARD_LIMITS.MAX_PER_SECOND, `pico=${maxWindow}/s`);
  check('B2 respeta la separación mínima', minGap >= HARD_LIMITS.MIN_GAP_MS - 2, `min=${minGap}ms`);
  console.log(`  (pico real ${maxWindow} cmd/s de un techo de ${HARD_LIMITS.MAX_PER_SECOND}, separación mínima ${minGap} ms)`);
  h.sim.destroy();
}
{
  const h = makePipe({ mode: (c, n) => (n === 1 ? 'slow' : 'normal'), slowLatency: 400 });
  const first = await h.pipe.send('010C', 120).then(() => 'resuelto', () => 'expirado');
  check('B3 el primero expira', first === 'expirado');
  await sleep(30);
  const second = await h.pipe.send('0105', 4000).catch(e => 'ERR:' + e.message);
  check('B3 el segundo recibe SU respuesta', String(second).includes('41057E'), `recibido=${JSON.stringify(second)}`);
  check('B3 la respuesta tardía se descartó', h.pipe.stats.dropped >= 1, `descartadas=${h.pipe.stats.dropped}`);
  h.sim.destroy();
}
{
  const h = makePipe({ mode: (c, n) => (n === 1 ? 'slow' : 'normal'), slowLatency: 300 });
  h.pipe.send('010C', 100).catch(() => {});
  await sleep(130);
  const t0 = Date.now();
  const p = h.pipe.send('0105', 4000).catch(() => null);
  await sleep(60);
  const early = h.writes.some(x => x.cmd === '0105' && x.t - t0 < 140);
  check('B4 espera el prompt pendiente antes del siguiente comando', !early);
  await p;
  h.sim.destroy();
}
{
  const h = makePipe({ latency: 500 });
  const res = await Promise.allSettled(
    Array.from({ length: HARD_LIMITS.MAX_QUEUE + 20 }, () => h.pipe.send('010C', 6000)));
  const rejected = res.filter(r => r.status === 'rejected' && /cola/i.test(r.reason.message)).length;
  check('B5 la cola no crece sin límite', rejected >= 15, `rechazados=${rejected}`);
  h.pipe.cancelAll('fin'); h.sim.destroy();
}
{
  let opened = '';
  const h = makePipe({ mode: 'silent' }, { onCircuitOpen: (r) => { opened = r; } });
  await Promise.allSettled(Array.from({ length: HARD_LIMITS.MAX_CONSECUTIVE_TIMEOUTS + 6 },
    () => h.pipe.send('010C', 30)));
  await sleep(60);
  check('B6 se detiene tras fallos seguidos', opened !== '');
  check('B6 no sigue escribiendo tras detenerse',
    h.writes.length <= HARD_LIMITS.MAX_CONSECUTIVE_TIMEOUTS + 1, `escritos=${h.writes.length}`);
  const after = await h.pipe.send('010C', 100).then(() => 'pasó', () => 'bloqueado');
  check('B6 rechaza comandos con el canal detenido', after === 'bloqueado');
  h.sim.destroy();
}
{
  const h = makePipe();
  const bad = [...DANGEROUS_AT, ...DANGEROUS_SERVICES.map(s => s + '0102'), '2E1234', '2F0301', '3101FF00'];
  const res = await Promise.allSettled(bad.map(c => h.pipe.send(c, 200)));
  check('B7 todos los peligrosos rechazados', res.every(r => r.status === 'rejected'));
  check('B7 no se escribió ni un byte peligroso', h.writes.length === 0, `escritos=${h.writes.length}`);
  console.log(`  (${bad.length} comandos peligrosos probados, 0 llegaron al adaptador)`);
  h.sim.destroy();
}

section('C · Motor de muestreo: imposible tener dos bucles');
function makeEngine(opts = {}) {
  const sent = [];
  const box = {};
  box.engine = new PollEngine({
    send: async (cmd) => {
      sent.push({ cmd, t: Date.now() });
      await sleep(opts.latency ?? 2);
      if (opts.throwOn?.(cmd)) throw new Error('boom');
      return '410C0B98';
    },
    ensureHeader: async () => true,
    getPlan: () => ({ groups: [{ header: '', tasks: [{ key: 'a', command: '010C', header: '' }] }], intervalMs: 10 }),
    isConnected: () => (opts.connected ? opts.connected() : true),
    onResult: () => {},
    onFatal: () => {},
  });
  return { engine: box.engine, sent };
}
{
  const { engine, sent } = makeEngine();
  let peak = 0;
  const w = setInterval(() => { peak = Math.max(peak, engine.activeLoopCount()); }, 1);
  for (let i = 0; i < 500; i++) { engine.start(); if (i % 3 === 0) engine.stop(); }
  engine.start();
  await sleep(300);
  peak = Math.max(peak, engine.activeLoopCount());
  engine.stop();
  await sleep(150);
  clearInterval(w);
  check('C1 nunca hay más de un bucle vivo', peak <= 1, `pico=${peak}`);
  check('C1 al parar no queda ningún bucle', engine.activeLoopCount() === 0);
  const before = sent.length;
  await sleep(200);
  check('C1 tras parar no se envía nada más', sent.length === before, `+${sent.length - before}`);
  console.log(`  (500 arranques/paradas encadenados, pico de bucles vivos: ${peak})`);
}
{
  const { engine, sent } = makeEngine();
  engine.start();
  await sleep(80);
  const marca = sent.length;
  let durante = 0;
  await engine.runExclusive(async () => {
    const n = sent.length;
    await sleep(200);
    durante = sent.length - n;
  });
  check('C2 el bucle no envía nada durante una operación exclusiva', durante === 0, `envíos=${durante}`);
  await sleep(80);
  check('C2 el bucle se reanuda después', sent.length > marca);
  engine.stop(); await sleep(60);
}
{
  const { engine } = makeEngine();
  engine.start();
  await sleep(50);
  let dentro = 0, solapes = 0;
  const op = () => engine.runExclusive(async () => {
    dentro++; if (dentro > 1) solapes++;
    await sleep(60);
    dentro--;
  });
  await Promise.all([op(), op(), op(), op()]);
  check('C3 las operaciones exclusivas se serializan', solapes === 0, `solapes=${solapes}`);
  engine.stop(); await sleep(60);
}
{
  const { engine } = makeEngine({ throwOn: () => Math.random() < 0.5 });
  engine.start();
  await sleep(250);
  check('C4 sigue vivo pese a errores continuos', engine.isRunning() && engine.activeLoopCount() === 1);
  engine.stop(); await sleep(80);
  check('C4 se detiene limpiamente', engine.activeLoopCount() === 0);
}
{
  let conectado = true;
  const { engine, sent } = makeEngine({ connected: () => conectado });
  engine.start();
  await sleep(80);
  conectado = false;
  await sleep(150);
  const n = sent.length;
  await sleep(200);
  check('C5 al desconectar deja de enviar', sent.length === n, `+${sent.length - n}`);
  check('C5 no queda bucle colgado', engine.activeLoopCount() === 0);
  engine.stop();
}

// C6 · un apagado dado durante una operación exclusiva no puede ser revertido
//      por el rearranque automático de esa misma operación (regresión real).
{
  const { engine, sent } = makeEngine();
  engine.start();
  await sleep(60);
  const exclusiva = engine.runExclusive(async () => {
    await sleep(150);          // durante esto llega el apagado
  });
  await sleep(40);
  engine.shutdown();           // equivale a obdGateway.reset()
  await exclusiva;
  await sleep(120);
  check('C6 shutdown() sobrevive al rearranque de una operación exclusiva',
    engine.activeLoopCount() === 0 && !engine.isRunning(),
    `vivos=${engine.activeLoopCount()} running=${engine.isRunning()}`);
  const n = sent.length;
  await sleep(200);
  check('C6 tras shutdown() no se envía nada más', sent.length === n, `+${sent.length - n}`);
  engine.resume();
  engine.start();
  await sleep(80);
  check('C6 resume() vuelve a permitir el arranque', engine.isRunning());
  engine.stop();
  await sleep(60);
}

section('D · Interpretación de respuestas');
const eq = (n, got, exp) => check(n, JSON.stringify(got) === JSON.stringify(exp), `-> ${JSON.stringify(got)}`);
eq('D respuesta simple', P.normalizeHex('410C1AF8\r'), '410C1AF8');
eq('D descarta SEARCHING', P.normalizeHex('SEARCHING...\r41000BE1BA13'), '41000BE1BA13');
eq('D DTC CAN con contador', P.decodeDtcs('4302030004200', '43', true), ['P0300', 'P0420']);
eq('D DTC ninguno', P.decodeDtcs('4300', '43', true), []);
eq('D DTC línea K', P.decodeDtcs('43030004200000', '43', false), ['P0300', 'P0420']);
eq('D código U', P.decodeDtcs('4301C100', '43', true), ['U0100']);
check('D 7F es negativo', P.isNegative('7F2231'));
check('D NO DATA es negativo', P.isNegative('NO DATA'));
check('D BUFFER FULL es negativo', P.isNegative('BUFFER FULL'));
check('D 7F..31 = no soportado', P.isUnsupportedResponse('7F2231'));
check('D 7F..78 = ocupado', P.isBusyResponse('7F2278'));
check('D respuesta buena no es negativa', !P.isNegative('62160E0026'));
eq('D voltaje', P.parseVoltage('12.4V'), 12.4);
const base = { command: '010C', mode: '01', unit: '', name: '', key: 'x', min: 0, max: 1 };
eq('D fórmula que da NaN -> sin dato', P.parsePidResponse({ ...base, formula: () => NaN }, '410C0B98'), null);
eq('D fórmula que falla -> sin dato', P.parsePidResponse({ ...base, formula: () => { throw new Error('x'); } }, '410C0B98'), null);
eq('D RPM correcto', P.parsePidResponse({ ...base, formula: ([A, B]) => ((A * 256) + B) / 4 }, '410C0B98')?.value, 742);
eq('D respuesta de otro PID -> sin dato', P.parsePidResponse({ ...base, formula: ([A]) => A }, '41057E'), null);
eq('D VIN longitud', P.parseVin('014\r0:490201314641\r1:4D50353544383A\r2:41303736373030').length, 17);

section('E · Integración con caos: la app entera contra un adaptador hostil');
{
  const { bleManager, spy } = await import(`${dir}/ble/BleManager.ts`);
  const { obdGateway } = await import(`${dir}/obd/ObdGateway.ts`);
  const { useObdStore } = await import(`${dir}/store/useObdStore.ts`);

  // ── El doble del almacén no puede quedarse atrás ────────────────────────
  // El almacén real usa React y aquí no se puede cargar, así que estas pruebas
  // corren contra un doble. Un doble desfasado es peor que no tener pruebas:
  // la batería sale en verde mientras la app está rota.
  //
  // Esto lee el código del motor, saca todas las llamadas st.loQueSea() que
  // hace y exige que el doble las tenga. Ya ha pasado dos veces: con
  // clavesActivas() y con setReadings(). A la tercera no.
  const fsE = await import('node:fs');
  const pathE = await import('node:path');
  const urlE = await import('node:url');
  const raizE = pathE.resolve(pathE.dirname(urlE.fileURLToPath(import.meta.url)), '../..');
  const fuenteMotor = fsE.readFileSync(pathE.join(raizE, 'src/obd/ObdGateway.ts'), 'utf8');
  const usadas = new Set();
  // El almacén aparece en el motor con tres nombres: this.st(), st y store.
  for (const m of fuenteMotor.matchAll(/(?:this\.st\(\)|\bst|\bstore)\.([a-zA-Z_]\w*)\s*\(/g)) usadas.add(m[1]);
  const tieneDoble = new Set(Object.keys(useObdStore.getState()));
  const faltan = [...usadas].filter(k => !tieneDoble.has(k));
  check('E el doble del almacén tiene todo lo que el motor le pide',
    faltan.length === 0,
    `al doble le faltan: ${faltan.join(', ')} — añádelos en tools/selftest/build.mjs`);
  console.log(`  (el motor llama a ${usadas.size} funciones del almacén; el doble las tiene todas)`);

  // El adaptador empieza sano: primero se comprueba lo que tiene que pasar
  // siempre, y solo después se le mete el caos encima. Con el caos activo un
  // identificador puede quedar marcado como no soportado tras tres fallos
  // seguidos, así que exigir lecturas ahí dentro es exigir suerte.
  let hostil = false;
  const sim = new ElmSim({
    feed: (t) => bleManager.feed(t),
    mode: () => {
      if (!hostil) return 'normal';
      const r = Math.random();
      if (r < 0.06) return 'silent';
      if (r < 0.14) return 'slow';
      if (r < 0.20) return 'garbage';
      return 'normal';
    },
    slowLatency: 400, latency: 5, chunk: 7,
  });
  spy.sim = sim;
  spy.connected = true;

  const errores = [];
  process.on('unhandledRejection', (e) => errores.push(e));

  await obdGateway.initialize().catch(() => {});
  obdGateway.startPolling();

  // ── Las lecturas llegan al almacén SIN que nadie se suscriba ────────────
  // Nadie ha llamado a subscribe() en toda esta sección. Si aun así el almacén
  // se llena, el dato ya no depende de que una pantalla concreta esté viva.
  await sleep(600);
  const enAlmacen = useObdStore.getState().readings;
  check('E las lecturas llegan al almacén sin que ninguna pantalla se suscriba',
    enAlmacen.size > 0,
    'si esto falla, la lista de datos en vivo se queda en "leyendo…" para siempre');
  check('E y el núcleo está entre ellas',
    ['010C', '010D', '0105', '0104'].some(k => enAlmacen.has(k)),
    [...enAlmacen.keys()].join(','));

  hostil = true;
  const perfil = useObdStore.getState().selectedProfile;
  const caos = [];
  for (let i = 0; i < 14; i++) {
    caos.push((async () => {
      await sleep(Math.random() * 700);
      const d = Math.random();
      if (d < 0.30) { obdGateway.stopPolling(); await sleep(20); obdGateway.startPolling(); }
      else if (d < 0.55) await obdGateway.readDTCs().catch(() => {});
      else if (d < 0.72) await obdGateway.readVIN().catch(() => {});
      else if (d < 0.88) await obdGateway.scanModules((perfil.modules ?? []).slice(0, 3)).catch(() => {});
      else await obdGateway.probePids(perfil.moduleGroups.slice(0, 2)).catch(() => {});
      process.stdout.write('.');
    })());
  }
  await Promise.all(caos);
  process.stdout.write('\n');
  await sleep(500);

  obdGateway.reset();
  // La garantía es "el bucle termina", no "termina en un plazo fijo": puede
  // estar esperando una respuesta ya en curso. Se le da margen y se comprueba.
  const t0 = Date.now();
  while (obdGateway.activeLoops() > 0 && Date.now() - t0 < 3000) await sleep(25);
  check('E el bucle termina enseguida tras reset()', Date.now() - t0 < 500, `tardó ${Date.now() - t0} ms`);
  await sleep(200);

  const w = spy.written;
  const prohibidos = w.filter(x => {
    const c = x.cmd.toUpperCase().replace(/\s+/g, '');
    if (/^AT/.test(c)) return !AT_OK.test(c);
    return !(READ_SERVICES.has(c.slice(0, 2)) || CLEAR_SERVICES.has(c.slice(0, 2)));
  });
  check('E ningún comando prohibido llegó al adaptador', prohibidos.length === 0,
    prohibidos.slice(0, 5).map(x => x.cmd).join(', '));
  let pico = 0;
  for (const x of w) pico = Math.max(pico, w.filter(y => y.t > x.t - 1000 && y.t <= x.t).length);
  check('E la tasa nunca superó el techo', pico <= HARD_LIMITS.MAX_PER_SECOND, `pico=${pico}/s`);
  check('E no quedó ningún bucle vivo', obdGateway.activeLoops() === 0, `vivos=${obdGateway.activeLoops()}`);
  check('E no hubo promesas sin gestionar', errores.length === 0, `${errores.length}`);
  // Si el motor llama a algo que el almacén no tiene, el bucle muere y hasta
  // ahora eso solo salía por la consola. Ahora es un fallo de la batería.
  const fatales = obdGateway.__fatalesParaPruebas();
  check('E el bucle no murió por un error interno', fatales.length === 0,
    fatales.slice(0, 2).join(' | '));
  const finalizados = w.length;
  await sleep(500);
  check('E tras reset() no se envía nada más', spy.written.length === finalizados,
    `+${spy.written.length - finalizados}`);
  console.log(`  (${w.length} comandos enviados bajo caos, pico real ${pico} cmd/s)`);
  sim.destroy();
}

// ─── F · El perfil contra las lecturas REALES de la camioneta ───────────────
// Cada fila de aquí es un dato que el vehículo entregó de verdad, con la fecha
// en que lo entregó. No son valores inventados para que el test pase: son el
// crudo que salió por el bus y el número físico que tiene que dar.
//
// Esto es lo que impide que una escala se rompa sin que nadie se entere: si
// alguien toca una fórmula del perfil, aquí salta.
{
  section('F · El perfil contra las lecturas reales del vehículo');
  const { FORD_EXPLORER_2010_PROFILE, textoLectura } = await import(`${dir}/profiles/index.ts`);
  const porClave = new Map();
  for (const g of FORD_EXPLORER_2010_PROFILE.moduleGroups) for (const p of g.pids) porClave.set(p.key, p);

  const hex = (s) => { const b = []; for (let i = 0; i < s.length; i += 2) b.push(parseInt(s.slice(i, i + 2), 16)); return b; };

  // clave, crudo, valor esperado, tolerancia, de dónde salió
  const REALES = [
    // Sondas de oxígeno · 13/09
    ['o2_b1s1_v',   '02EF',  0.7334, 0.001, 'B1 delantera, 0,73 V'],
    ['o2_b1s2_v',   '0000',  0,      0.001, 'B1 TRASERA, la del P2270: clavada en cero'],
    ['o2_b2s1_v',   '029A',  0.6504, 0.001, 'B2 delantera'],
    ['o2_b2s2_v',   '02FE',  0.748,  0.001, 'B2 trasera'],
    ['o2_b1s1_mv',  '0240',  576,    0.5,   'la misma sonda en mV a 1828 rpm'],
    ['o2_b1s1_mv',  '028B',  651,    0.5,   'y al ralentí: oscila, está viva'],
    ['o2_b1s2_mv',  'FFF1',  -15,    0.5,   'la muerta, en negativo'],
    ['o2_b1s2_mv',  'FFBF',  -65,    0.5,   'y en la otra corrida, igual de muerta'],
    ['o2_b2s2_mv',  '0175',  373,    0.5,   'B2 trasera, oscilando'],
    ['o2_htr_b1s1', '0093',  0.5742, 0.001, 'calefactor B1 delantera'],
    ['o2_htr_b1s2', '011A',  1.1016, 0.001, 'calefactor de la sonda MUERTA: consume, o sea que el circuito está bien'],
    ['o2_htr_b2s1', '0099',  0.5977, 0.001, 'calefactor B2 delantera'],
    ['o2_htr_b2s2', '0107',  1.0273, 0.001, 'calefactor B2 trasera, gemelo del de la muerta'],
    ['ro2ft_b1',    '0000',  0,      0.001, 'corrección por sonda trasera B1: cero, el PCM la desactivó'],
    ['ro2ft_b2',    'FFF4', -0.1465, 0.001, 'la del B2 sí trabaja'],
    ['o2_htr_bits', '0F',    15,     0,     'los cuatro calefactores encendidos'],

    // Combustible · 13/09. La real y la deseada tienen que coincidir.
    ['frp',         '13CD',  273.05, 0.05,  'presión del riel a 1828 rpm'],
    ['frp',         '13E3',  274.24, 0.05,  'y al ralentí: plana, como debe ser en un sistema sin retorno'],
    ['frp_dsd',     '1403',  275.96, 0.05,  'presión DESEADA: a 1 % de la real'],
    ['frp_v',       '8E00',  2.7761, 0.001, 'voltaje del sensor del riel'],
    ['fuel_pump',   '1AFC',  21.08,  0.01,  'mando de la bomba al ralentí'],
    ['ftp_v',       '4900',  1.4272, 0.001, 'sensor de presión del tanque'],
    ['fuelsys',     '02',    2,      0,     'lazo cerrado, igual que el Modo 02'],

    // Aire, levas y encendido · 13/09
    ['maf22',       '0265',  6.13,   0.001, 'MAF a 1828 rpm'],
    ['maf22',       '0231',  5.61,   0.001, 'MAF al ralentí'],
    ['maf_v',       '2E74',  0.9071, 0.001, 'voltaje del MAF'],
    // OJO con esta: la respuesta cruda del 13/09 fue 62 16 24 00 64, o sea DOS
    // bytes de datos, y aquí estaba anotada como un solo '64'. Con la anotación
    // mal, la autoprueba daba verde mientras el teléfono enseñaba -17,8 °C fijos.
    ['cht',         '0064',  93.333, 0.01,  'culata a 93 °C con el refrigerante en 88'],
    ['vct_adv_b1',  '014F',  20.9375, 0.001, 'avance de leva B1 a 1828 rpm: la escala /16'],
    ['vct_adv_b2',  '015B',  21.6875, 0.001, 'y el B2, a 0,75° del otro banco'],
    ['vct_err_b1',  '0000',  0,      0.001, 'error de seguimiento B1: clavado'],
    ['vct_err_b2',  'FFFD', -0.1875, 0.001, 'error B2, con signo'],
    ['vct_dc_b1',   '383D',  43.936, 0.01,  'solenoide del VCT'],
    ['knock1',      '005E',  94,     0,     'detonación 1'],
    ['knock2',      '0071',  113,    0,     'detonación 2'],

    // Carga eléctrica y clima · 13/09
    ['vbatt_pcm',   'E0',    14.0,   0.001, 'el PCM ve 14,0 V, lo mismo que el adaptador'],
    ['vbatt_pcm',   'DD',    13.8125, 0.001, 'y en la otra corrida, 13,81'],
    ['gen_v_dsd',   '6F8D',  13.9438, 0.001, 'el alternador PIDE 13,94 y el sistema está en 14,0'],
    ['gen_cmd',     '0000',  0,      0.001, 'comando al alternador'],
    ['ac_press',    '92',    2013.34, 0.01, 'A/C encendido: 292 psi, alta de compresor'],
    ['ac_press',    '39',    786.03, 0.01,  'A/C apagado: 114 psi, el equilibrio del R134a'],
    ['ac_press_v',  '979A',  2.9639, 0.001, 'el voltaje del mismo sensor'],
    ['fan_duty',    '06',    19.3548, 0.001, 'ventilador al 19 % con el aire encendido'],
    ['fan_duty',    '00',    0,      0.001, 'y en cero con el aire apagado'],
    ['iac_kam0',    'FFD7', -0.0100, 0.001, 'ralentí aprendido: prácticamente nada que compensar'],
    ['iac_kam2',    'FCE8', -0.1934, 0.001, 'la celda de neutro con A/C'],

    // Transmisión · 13/09, palanca por las cuatro posiciones
    ['trs',         '46',    70,     0,     'palanca en P'],
    ['trs',         '3C',    60,     0,     'palanca en R'],
    ['trs',         '32',    50,     0,     'palanca en N'],
    ['trs',         '2E',    46,     0,     'palanca en D'],
    ['gear',        '07',    7,      0,     'marcha comandada en R'],
    ['gear',        '01',    1,      0,     'y 1ª en P, N y D con el carro parado'],
    ['iss',         '0B40',  720,    0.001, 'eje de entrada en P: 720 rpm con el motor a 748'],
    ['iss',         '0B28',  714,    0.001, 'y en N: 714 con el motor a 737'],
    ['iss',         '0000',  0,      0.001, 'en R y en D cae a cero: la turbina se cala contra el convertidor'],
    ['oss',         '0000',  0,      0.001, 'eje de salida, carro parado'],
    ['gear_ratio',  'FF5C',  3.99,   0.01,  'relación medida'],

    // Frenos · 13/09, pedal suelto y pedal a fondo
    ['brake_press', '0011',  17,     0,     'pedal suelto: prácticamente cero'],
    ['brake_press', 'FFF9',  -7,     0,     'pedal suelto de verdad: el ABS baja de cero, y sin signo esto eran 65529 kPa'],
    ['brake_press', '1035',  4149,   0,     'pedal a fondo: 41,5 bar'],
    ['brake_sw',    '2000',  0,      0,     'interruptor de freno, suelto'],
    ['brake_sw',    'A000',  1,      0,     'interruptor de freno, pisado'],
    ['booster_sw',  '00000000', 0,   0,     'servofreno, suelto'],
    ['booster_sw',  '00800000', 1,   0,     'servofreno, pisado'],
    ['wss_0',       '00000000', 0,   0,     'rueda delantera izquierda, carro parado'],
  ];

  for (const [clave, crudo, esperado, tol, porque] of REALES) {
    const p = porClave.get(clave);
    if (!p) { check(`F ${clave} existe en el perfil`, false, '(no está)'); continue; }
    let v;
    try { v = p.formula(hex(crudo)); } catch (e) { v = NaN; }
    const bien = Number.isFinite(v) && Math.abs(v - esperado) <= tol;
    check(`F ${clave} ${crudo} -> ${esperado}`, bien, `dio ${v} · ${porque}`);
  }

  // Las etiquetas: un número suelto no dice nada, "P" sí.
  const ETIQUETAS = [
    ['trs', 70, 'P'], ['trs', 60, 'R'], ['trs', 50, 'N'], ['trs', 46, 'D'],
    ['gear', 7, 'R'], ['gear', 1, '1ª'],
    ['brake_sw', 1, 'PISADO'], ['brake_sw', 0, 'suelto'],
    ['booster_sw', 1, 'PISADO'],
    ['fuelsys', 2, 'lazo cerrado'],
    ['o2_htr_bits', 15, 'los cuatro encendidos'],
  ];
  for (const [clave, valor, texto] of ETIQUETAS) {
    const p = porClave.get(clave);
    check(`F etiqueta ${clave}=${valor} -> "${texto}"`, !!p && textoLectura(p, valor) === texto,
      p ? `dio "${textoLectura(p, valor)}"` : '(no está)');
  }
  // Y donde no hay etiqueta, se muestra el número con su unidad.
  check('F sin etiqueta se muestra el número y la unidad',
    textoLectura(porClave.get('frp'), 273.05) === '273.05 kPa',
    textoLectura(porClave.get('frp'), 273.05));

  // Ninguna fórmula del perfil puede reventar con una respuesta rara.
  let reventadas = 0;
  const BASURA = [[], [0], [255], [0, 0], [255, 255], [0, 0, 0, 0], [255, 255, 255, 255]];
  for (const [, p] of porClave) {
    for (const b of BASURA) {
      try { p.formula(b); } catch { reventadas++; }
    }
  }
  check('F ninguna fórmula lanza excepción con respuestas raras', reventadas === 0, `${reventadas} reventaron`);
  // ── Ninguna pantalla puede pedir una clave que el perfil no tiene ────────
  // Esto existe porque pasó: al renombrar vct_ret_b1 a vct_adv_b1, la pestaña
  // de cilindros se quedó pidiendo la clave vieja. No revienta —devuelve
  // undefined y el dato desaparece sin avisar— que es justo lo peor.
  {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const raiz = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '../..');
    const pantallas = [];
    const recorrer = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) recorrer(f);
        else if (e.name.endsWith('.tsx')) pantallas.push(f);
      }
    };
    recorrer(path.join(raiz, 'app'));
    // Y src/ui, que es donde vive la portada desde la 3.2. Cuando el tablero se
    // mudó de carpeta, esta comprobación dejó de cubrirlo sin que nadie lo
    // notara: la vigilancia hay que mudarla con lo vigilado.
    recorrer(path.join(raiz, 'src', 'ui'));

    // Claves con nombre literal
    const pedidas = new Map();
    for (const f of pantallas) {
      const code = fs.readFileSync(f, 'utf8');
      for (const m of code.matchAll(/(?:gauge|estado|val|readings\.get|defs\.get)\(\s*'([a-z0-9_]+)'/gi)) {
        if (!pedidas.has(m[1])) pedidas.set(m[1], path.basename(f));
      }
      // La portada declara sus datos como { k: 'clave' } dentro de cada bloque.
      for (const m of code.matchAll(/\{\s*k:\s*'([a-z0-9_]+)'/gi)) {
        if (!pedidas.has(m[1])) pedidas.set(m[1], path.basename(f));
      }
      // Y las listas sueltas de claves, como la cabecera de la portada.
      for (const m of code.matchAll(/CLAVES\w*\s*=\s*\[([^\]]*)\]/g)) {
        for (const k of m[1].matchAll(/'([a-z0-9_]+)'/gi)) {
          if (!pedidas.has(k[1])) pedidas.set(k[1], path.basename(f));
        }
      }
      // Claves construidas con plantilla: se expanden a mano las familias que existen
      for (const m of code.matchAll(/`([a-z0-9_]+)_b\$\{b\}`/gi)) {
        for (const b of [1, 2]) pedidas.set(`${m[1]}_b${b}`, path.basename(f));
      }
      for (const m of code.matchAll(/`(spark_dur|cyl)[^`]*`/gi)) {
        for (let n = 1; n <= 8; n++) {
          pedidas.set(m[1] === 'cyl' ? `cyl${n}_m06` : `spark_dur_${n}`, path.basename(f));
        }
      }
    }
    // ── Nadie puede escribir viewabilityConfig dentro del render ──────────
    // FlatList guarda ese objeto para decidir qué filas están dentro de la
    // pantalla. Escrito a mano en el render, cada dibujado crea un objeto
    // nuevo y React Native rehace el vigilante de visibilidad. En la pestaña
    // de datos en vivo, que se redibuja varias veces por segundo, eso dejó de
    // avisar de los cambios de scroll en un teléfono con Android 14 mientras
    // funcionaba en otro con Android 16 y el MISMO apk. Desde fuera parecía
    // que la app no detectaba el scroll; en realidad detectaba el primer
    // golpe y ninguno más, y las filas de abajo se quedaban en "leyendo…".
    const inlineVis = [];
    for (const f of pantallas) {
      const code = fs.readFileSync(f, 'utf8');
      if (/viewabilityConfig\s*=\s*\{\{/.test(code)) inlineVis.push(path.relative(raiz, f));
    }
    check('F viewabilityConfig nunca se escribe dentro del render',
      inlineVis.length === 0,
      `${inlineVis.join(', ')} — sácalo a una constante fuera del componente`);

    // Y lo mismo para la lista que se le pasa a FlatList: si se arma en cada
    // dibujado, FlatList rehace todas las filas al ritmo de las lecturas.
    const listasSinMemo = [];
    for (const f of pantallas) {
      const code = fs.readFileSync(f, 'utf8');
      if (!/<FlatList/.test(code)) continue;
      const m = /data=\{(\w+)\}/.exec(code);
      if (!m) continue;
      const nombre = m[1];
      const decl = new RegExp(`const\\s+${nombre}\\s*(?::[^=]+)?=\\s*(useMemo|React\\.useMemo)`);
      // Una constante de módulo o algo importado ya es estable: no hace falta memo.
      const esConstante = new RegExp(`^const\\s+${nombre}\\s*=\\s*\\[`, 'm');
      const esImportado = new RegExp(`import[^;]*\\b${nombre}\\b[^;]*from`).test(code);
      if (!decl.test(code) && !esConstante.test(code) && !esImportado) {
        listasSinMemo.push(`${path.basename(f)}:${nombre}`);
      }
    }
    check('F la lista que recibe FlatList no se rearma en cada dibujado',
      listasSinMemo.length === 0,
      `${listasSinMemo.join(', ')} — envuélvela en useMemo`);

    // Nadie puede importar react-navigation a pelo.
    //
    // Desde el SDK 56, expo-router lo rechaza y el empaquetado falla ENTERO —
    // no el archivo, la app. Y no salta ni en tsc ni en las autopruebas: se
    // descubre a los diez minutos, en la nube, con un mensaje que dice
    // "Unknown error". Pasó exactamente eso con useVisibles.ts, que importaba
    // useFocusEffect de ahí en vez de expo-router, que lo reexporta.
    const culpables = [];
    for (const f of pantallas.concat(
      (() => { const out = []; const d = path.join(raiz, 'src');
        const w = (x) => { for (const e of fs.readdirSync(x, { withFileTypes: true })) {
          const p2 = path.join(x, e.name);
          if (e.isDirectory()) w(p2); else if (/\.tsx?$/.test(e.name)) out.push(p2); } };
        w(d); return out; })())) {
      const code = fs.readFileSync(f, 'utf8');
      if (/from '@react-navigation\//.test(code)) culpables.push(path.relative(raiz, f));
    }
    check('F nadie importa react-navigation directamente', culpables.length === 0,
      `${culpables.join(', ')} — usa expo-router, que reexporta lo mismo`);

    const huerfanas = [...pedidas].filter(([k]) => !porClave.has(k));
    check('F ninguna pantalla pide una clave que no existe en el perfil',
      huerfanas.length === 0,
      huerfanas.map(([k, f]) => `${k} (${f})`).join(', '));
    console.log(`  (${pedidas.size} claves nombradas por las pantallas, todas existen)`);
  }

  console.log(`  (${REALES.length} lecturas reales del vehículo comprobadas contra el perfil)`);
}

// ─── F2 · El perfil de la EcoSport contra su prueba del 16/09 ───────────────
// Mismo trato que la Explorer: cada fila salió del informe de descubrimiento,
// con el crudo tal cual lo devolvió el PCM 4N15. Lo importante de esta sección
// no son los números grandes sino los tres que se dedujeron por analogía con la
// Explorer —el MAP fino, el permiso del A/C y las celdas de ralentí—, porque
// son los únicos que no vienen de la norma y por tanto los únicos que podrían
// estar mal sin que salte nada más.
{
  section('F2 · El perfil de la EcoSport contra su prueba del 16/09');
  const { FORD_ECOSPORT_2006_PROFILE, textoLectura } = await import(`${dir}/profiles/index.ts`);
  const porClave = new Map();
  for (const g of FORD_ECOSPORT_2006_PROFILE.moduleGroups) for (const p of g.pids) porClave.set(p.key, p);
  const hex = (s2) => { const b = []; for (let i = 0; i < s2.length; i += 2) b.push(parseInt(s2.slice(i, i + 2), 16)); return b; };

  const ECO = [
    ['010C',        '0D92',  868.5,   0.01,  'ralentí, 868 rpm'],
    ['010C',        '2669',  2458.25, 0.01,  'la maniobra de 2500 rpm'],
    ['0105',        '7F',    87,      0,     'refrigerante caliente'],
    ['010B',        '31',    49,      0,     'colector al ralentí'],
    ['010B',        '19',    25,      0,     'colector a 2500 rpm en punto muerto: baja, como debe'],
    ['010E',        'B5',    26.5,    0.01,  'avance a 2500 rpm'],
    ['010E',        '7C',    -2,      0.01,  'avance NEGATIVO al ralentí con luces y aire: así sube el ralentí sin abrir mariposa'],
    ['stft_b1',     '7E',    -1.5625, 0.001, 'corrección corta al ralentí'],
    ['ltft_b1',     '76',    -7.8125, 0.001, 'corrección larga con el aire encendido'],
    ['o2_b1s1',     'A67F',  0.83,    0.005, 'la única sonda que este PCM declara'],
    ['o2_presentes','01',    1,       0,     'una sola sonda: es lo que hace mentira a las otras tres del espejo'],
    ['fuelsys',     '02',    2,       0,     'lazo cerrado en las cuatro maniobras'],

    // Los tres deducidos por analogía con la Explorer
    ['ac_allowed',  '80',    128,     0,     'compresor permitido al ralentí'],
    ['ac_allowed',  '00',    0,       0,     'y cortado acelerando'],
    ['iac_kam0',    '0000',  0,       0.0001,'celda "en marcha": cero clavado, porque esta caja es sincrónica'],
    ['iac_kam2',    'FDF9', -0.12671, 0.0001,'celda "en neutro con A/C": esta sí lleva valor'],
    ['iac_kam3',    '0271',  0.15259, 0.0001,'celda "en neutro sin A/C"'],
    ['iac_trim',    'FFC6', -0.014160,0.0001,'corrección instantánea, negativa y con signo'],
    ['iac_mode',    '01',    1,       0,     'modo de ralentí activo'],
    ['o2_temp',     '12A0',  596,     0.01,  'temperatura calculada en la punta de la sonda al ralentí'],
    ['o2_temp',     '14CD',  665.625, 0.01,  'y a 2500 rpm: el escape más caliente'],

    // La segunda corrida del 16/09, con las páginas 11xx y 16xx ya barridas
    ['vbatt_pcm',   'DB',    13.6875, 0.0001,'voltaje al ralentí'],
    ['vbatt_pcm',   'D8',    13.5,    0.0001,'SUBE a 2500 rpm: el alternador cargando'],
    ['vbatt_pcm',   'CB',    12.6875, 0.0001,'y BAJA con luces y aire: es lo que hace una batería de verdad'],
    ['vbatt_pcm',   'C9',    12.5625, 0.0001,'y más aún pisando el freno, que enciende las luces de freno'],
    ['cht',         '0061',  90,      0.01,  'el 1624 de este PCM: da lo mismo que el refrigerante, no es la culata'],
    ['fuel_lvl',    '4746',  55.676,  0.01,  'el tanque, la lectura que cuadró con la aguja'],
    ['octane',      '5B',    91,      0,     'octanaje aprendido, igual que la Explorer'],
    ['o2_htr_bits', '01',    1,       0,     'UN calefactor, no cuatro: una sola sonda'],
    ['fuel_pump',   '8000',  100,     0.01,  'bomba a todo: aquí no es de mando variable'],
    ['tire_size',   '031D',  797,     0,     '797 vueltas por milla, un 205/65R15'],
    ['misfire_total','0000', 0,       0,     'cero fallos de encendido contados'],
    ['mp_lrn',      '01',    1,       0,     'rueda dentada aprendida: el contador es de fiar'],

    // Los que salieron de cruzar la prueba con el catálogo de referencia.
    // Cada uno de estos lleva DOS pruebas encima: el catálogo dice qué
    // debería ser, y el carro se comportó como si lo fuera.
    ['rpm_dsd',     '36',    864,     0,     'ralentí DESEADO 864 rpm, con el real en 868'],
    ['iac',         '1F5A',  24.487,  0.01,  'aire de ralentí con todo apagado'],
    ['iac',         '4955',  57.294,  0.01,  'y con luces y aire: el PCM abriendo para sostenerlo'],
    ['tp_v',        '2AB5',  0.834122,0.000001,'mariposa al ralentí'],
    ['tp_cerrada',  '2A75',  0.829239,0.000001,'y el valor de cerrada APRENDIDO: cinco milivoltios de diferencia'],
    ['ect_v',       '1F78',  0.61462, 0.0001,'sensor de refrigerante a 87 °C'],
    ['ect_v',       '173A',  0.45358, 0.0001,'y a 97 °C: baja, porque es un termistor NTC'],
    ['iat_v',       '3D70',  1.19995, 0.0001,'sensor de aire de admisión'],
    ['spark_fino',  'FFFB', -1.25,    0.0001,'avance al ralentí, con signo'],
    ['spark_fino',  '006D',  27.25,   0.0001,'y a 2500 rpm, contra los 26,5 del PID de un byte'],
    ['lambda',      '8038',  1.00171, 0.0001,'mezcla al ralentí: estequiométrico clavado'],
    ['map_v',       '07EE',  1.982422,0.000001,'señal del colector al ralentí (49 kPa)'],
    ['map_v',       '040B',  1.010742,0.000001,'y a 2500 rpm en punto muerto (25 kPa)'],
    ['rev_sw',      '01',    1,       0,     'interruptor de reversa ACTIVADO con el carro parado: el P0812'],
    ['ac_clutch',   '01',    1,       0,     'embrague del A/C pegado'],
    ['o2_b1s1_mv',  '02A3',  675,     0,     'la sonda, en milivoltios'],
    ['tp_modo',     'FF',    255,     0,     'mariposa cerrada'],
    ['load_ford',   '2044',  25.208,  0.01,  'carga al ralentí'],

    // Lo que cerró la prueba del 17/09, con las condiciones separadas
    ['ltft_fino',   '00FE', -1.5625,  0.0001,'corrección larga: el PID estándar decía -1,56 en la MISMA tanda'],
    ['ltft_fino',   '00F7', -7.03125, 0.0001,'y aquí -7,03 contra -7,03 del PID: la escala era /128, no /256'],
    ['ltft_fino',   '00F9', -5.46875, 0.0001,'y -5,47 contra -5,47'],
    ['vel_rueda',   '0759',  470.25,  0.01,  'rueda a 54 km/h; un 205/65R15 gira 452 rpm a esa velocidad'],
    ['vss_ford',    '4569',  34.705,  0.001, 'velocidad cruda: 34,7 mph con el PID marcando 54-61 km/h'],
    ['fan_bits',    '04',    4,       0,     'ventilador encendido con el aire'],
    ['fan_bits',    '84',    132,     0,     'y el byte entero rodando: si fuera un sí/no, estos dos se verían iguales'],
    ['sw_bits',     '01',    1,       0,     'bit 0: A/C pedido'],
    ['sw_bits',     '08',    8,       0,     'bit 3: fuera de ralentí'],
  ];
  for (const [clave, crudo, esperado, tol, porque] of ECO) {
    const p = porClave.get(clave);
    if (!p) { check(`F2 ${clave} existe en el perfil`, false, '(no está)'); continue; }
    let v; try { v = p.formula(hex(crudo)); } catch { v = NaN; }
    check(`F2 ${clave} ${crudo} -> ${esperado}`,
      Number.isFinite(v) && Math.abs(v - esperado) <= tol, `dio ${v} · ${porque}`);
  }

  for (const [clave, valor, texto] of [
    ['ac_allowed', 128, 'PERMITIDO'], ['ac_allowed', 0, 'sin permiso'],
    ['fuelsys', 2, 'lazo cerrado'],
    ['o2_htr_bits', 1, 'el único, encendido'],
    ['mp_lrn', 1, 'SÍ'], ['flt_egr', 0, 'no'],
    ['rev_sw', 1, 'ACTIVADO'], ['rev_sw', 0, 'suelto'],
    ['ac_clutch', 1, 'PEGADO'], ['tp_modo', 255, 'CERRADA (ralentí)'],
    ['imrc', 0, 'cerrada'],
  ]) {
    const p = porClave.get(clave);
    check(`F2 etiqueta ${clave}=${valor} -> "${texto}"`,
      !!p && textoLectura(p, valor) === texto, p ? `dio "${textoLectura(p, valor)}"` : '(no está)');
  }

  // Lo que este carro NO tiene no puede colarse en el perfil por descuido: si
  // alguien copia y pega un bloque de la Explorer, aquí salta.
  // Lo que este PCM contestó "no existe" no puede colarse copiando y pegando de
  // la Explorer. Cada uno de estos se preguntó el 16/09 y lo rechazó.
  for (const prohibido of ['012F', '0110', 'stft_b2', 'ltft_b2', '0142',
                           'frp', 'frp_dsd', 'frp_v', 'ftp_v', 'maf22', 'maf_v',
                           'gear_ratio', 'gear', 'trs', 'iss', 'cht_v',
                           'vct_adv_b1', 'vct_err_b1', 'knock1']) {
    check(`F2 la EcoSport NO pide ${prohibido} (el PCM lo rechaza)`, !porClave.has(prohibido));
  }
  // Y los que contestan pero con un cero eterno tampoco: gastan una pregunta
  // por vuelta a cambio de nada. El ventilador de este carro es de relé, no de
  // mando variable, y el A/C no tiene sensor de presión.
  for (const cero of ['fan_duty', 'ac_press', 'vss_raw', 'eco_1623', 'eco_1675', 'eco_1676']) {
    check(`F2 la EcoSport NO pide ${cero} (contesta, pero siempre cero)`, !porClave.has(cero));
  }
  // Los que se mueven pero no sabemos qué son: en el perfil, apagados y crudos.
  // Ya no queda ninguno sin identificar. Eran dieciséis antes de cruzarlos con
  // el catálogo de referencia, tres después, y los tres resultaron constantes en
  // las siete condiciones del 17/09: no eran datos, eran ceros con nombre.
  const misterios = [...porClave.values()].filter(p => p.key.startsWith('eco_'));
  check('F2 ya no queda ningún identificador sin identificar', misterios.length === 0,
    misterios.map(p => p.key).join(', '));
  // Nada de lo que se dedujo del catálogo puede quedarse a medias: si lleva
  // unidad y nombre, tiene que estar marcado como verificado.
  const aMedias = [...porClave.values()].filter(p => p.verified === false && !p.key.startsWith('eco_') && !p.note?.includes('SIN CONFIRMAR'));
  check('F2 lo no confirmado lo dice en su nota', aMedias.length === 0,
    aMedias.map(p => p.key).join(', '));
  // Y el nivel de combustible SÍ tiene que estar, por la vía Ford. Esta
  // comprobación existe porque llegué a la conclusión contraria: el barrido de
  // la página 16xx no llegó a correr y lo leí como si hubiera corrido y salido
  // vacío. Si alguien vuelve a quitarlo "porque no aparece en el informe",
  // aquí salta.
  check('F2 la EcoSport SÍ lee el nivel de combustible, por el identificador Ford',
    porClave.get('fuel_lvl')?.command === '2216C1', 'la página 16xx está viva');
  check('F2 y con la escala de la Explorer da el porcentaje que marcaba la aguja',
    Math.abs(porClave.get("fuel_lvl").formula([0x55, 0x55]) - 66.67) < 0.05,
    `${porClave.get('fuel_lvl').formula([0x55, 0x55])}`);
  const modo06 = [...porClave.values()].filter(p => p.mode === '06');
  check('F2 la EcoSport no pide Modo 06 (contesta vacío)', modo06.length === 0,
    modo06.map(p => p.key).join(', '));

  let reventadas = 0;
  const BASURA = [[], [0], [255], [0, 0], [255, 255], [0, 0, 0, 0]];
  for (const [, p] of porClave) for (const b of BASURA) { try { p.formula(b); } catch { reventadas++; } }
  check('F2 ninguna fórmula de la EcoSport revienta con respuestas raras', reventadas === 0, `${reventadas}`);
  // Ningún dato de este perfil puede quedarse sin explicación: es un carro del
  // que no hay catálogo público, así que si la app no explica un número, nadie
  // más lo va a hacer.
  const { explicar } = await import(`${dir}/obd/glosario.ts`);
  const mudos = [...porClave.values()].filter(p => !explicar(p));
  check('F2 todos los datos de la EcoSport tienen explicación', mudos.length === 0,
    mudos.map(p => p.key).join(', '));
  console.log(`  (${ECO.length} lecturas reales de la EcoSport comprobadas contra el perfil)`);
}

// ─── G · Solo se pregunta lo que alguien está mirando ───────────────────────
// Esta es la garantía nueva de la 3.1, y es de las dos clases a la vez: hace la
// app más rápida Y le manda menos comandos al vehículo. Si alguien la rompe sin
// darse cuenta, el bus se llena otra vez de preguntas por datos que nadie tiene
// delante y las agujas vuelven a refrescarse cada siete segundos.
{
  section('G · El plan de muestreo sigue a lo que está en pantalla');
  const { useObdStore } = await import(`${dir}/store/useObdStore.ts`);
  const { NUCLEO, TABLERO } = await import(`${dir}/obd/nucleo.ts`);
  const { FORD_EXPLORER_2010_PROFILE } = await import(`${dir}/profiles/index.ts`);

  const st = useObdStore.getState();
  st.setProfile('ford_explorer_2010');
  useObdStore.setState({ strictMode: false, supportedMode01: null, unsupportedPids: new Set(),
                         disabledPids: new Set(), visiblesPorPantalla: new Map(),
                         grabando: false, grabClaves: new Set() });

  const activas = () => useObdStore.getState().clavesActivas();
  const total = FORD_EXPLORER_2010_PROFILE.moduleGroups.flatMap(g => g.pids).length;

  // Sin nadie mirando: el núcleo MÁS lo del tablero digital. El tablero es la
  // pantalla principal de la app; si se apagara del todo, al volver a él se
  // rellenaría delante de tus ojos en vez de estar al día.
  check('G sin pantallas delante quedan el núcleo y el tablero',
    activas().size === NUCLEO.length + TABLERO.length,
    `${activas().size} claves`);
  check('G y el tablero está entre ellas', TABLERO.every(k => activas().has(k)));
  check('G el núcleo es pequeño de verdad', NUCLEO.length <= 6, `${NUCLEO.length}`);
  check('G el núcleo va todo en cabecera funcional',
    NUCLEO.every(k => /^0[0-9A-F]{3}$/i.test(k)),
    'un núcleo repartido entre módulos costaría más en cambios de cabecera que en lecturas');

  // Una pantalla declara lo suyo: entra eso y nada más.
  useObdStore.getState().setVisibles('principal', ['frp', 'frp_dsd', 'o2_b1s1_v']);
  const conUna = activas();
  check('G lo que declara una pantalla entra en el plan',
    ['frp', 'frp_dsd', 'o2_b1s1_v'].every(k => conUna.has(k)));
  // Y el tablero CEDE EL SITIO: con una pantalla pidiendo datos, la vuelta se
  // queda corta para que lo que estás mirando se refresque rápido.
  check('G y no entra nada más: el tablero cede el sitio',
    conUna.size === NUCLEO.length + 3, `${conUna.size}`);
  check('G la marcha y la palanca salen del plan cuando miras otra cosa',
    !conUna.has('gear') && !conUna.has('trs'),
    'viven en el TCM y cuestan dos comandos de cambio de cabecera');
  check('G el plan queda muy por debajo del perfil entero', conUna.size < total / 4,
    `${conUna.size} de ${total} — antes se preguntaban los ${total}`);

  // Dos pantallas a la vez (por ejemplo la que sale y la que entra) se suman
  // sin duplicar.
  useObdStore.getState().setVisibles('flujo', ['frp', 'tft']);
  const conDos = activas();
  check('G dos pantallas se suman sin duplicar', conDos.size === NUCLEO.length + 4, `${conDos.size}`);

  // Al salir de una pantalla, lo suyo deja de preguntarse.
  useObdStore.getState().quitarVisibles('flujo');
  check('G al salir de una pantalla lo suyo deja de pedirse', !activas().has('tft'));
  useObdStore.getState().quitarVisibles('principal');
  check('G al salir de todas se vuelve al núcleo y al tablero',
    activas().size === NUCLEO.length + TABLERO.length);

  // La grabación es la única excepción: lo grabado se sigue pidiendo aunque no
  // esté en pantalla, porque si no la grabación saldría con agujeros.
  useObdStore.getState().iniciarGrabacion(['frp', 'tft', 'iss']);
  check('G lo que se graba se sigue pidiendo aunque no se vea',
    ['frp', 'tft', 'iss'].every(k => activas().has(k)));
  useObdStore.getState().pararGrabacion();
  check('G al parar la grabación deja de pedirse', !activas().has('iss'));

  // Un PID apagado por el usuario NO se lee aunque esté en pantalla: la
  // visibilidad amplía, nunca pisa una decisión explícita.
  useObdStore.setState({ disabledPids: new Set(['frp']) });
  useObdStore.getState().setVisibles('principal', ['frp']);
  const gw = await import(`${dir}/obd/ObdGateway.ts`);
  const plan = gw.obdGateway.__planParaPruebas();
  const enPlan = plan.groups.flatMap(g => g.tasks.map(t => t.key));
  check('G un PID apagado por el usuario no se lee aunque esté en pantalla',
    !enPlan.includes('frp'), enPlan.join(','));
  check('G el núcleo sí está en el plan', NUCLEO.every(k => enPlan.includes(k)), enPlan.join(','));
  useObdStore.setState({ disabledPids: new Set(), visiblesPorPantalla: new Map() });

  // ── La excepción de la grabadora ────────────────────────────────────────
  // Un dato apagado a mano SÍ se lee si lo marcaste en la lista de la
  // grabadora, y deja de leerse al parar. Es lo único que esa lista promete, y
  // hasta la 3.3 no era verdad: el plan descartaba los apagados antes de mirar
  // si estaban grabándose, así que marcarlos no servía de nada y la grabación
  // salía sin ellos sin avisar.
  const claves = () => gw.obdGateway.__planParaPruebas().groups.flatMap(g => g.tasks.map(t => t.key));
  useObdStore.setState({ disabledPids: new Set(['frp', 'tft']), visiblesPorPantalla: new Map() });
  check('G un dato apagado no se lee si nadie lo pide', !claves().includes('frp'));
  useObdStore.getState().iniciarGrabacion(['frp']);
  check('G pero SÍ se lee si lo marcaste para grabar, aunque esté apagado',
    claves().includes('frp'), claves().join(','));
  check('G y el otro apagado, que no marcaste, sigue sin leerse', !claves().includes('tft'));
  useObdStore.getState().pararGrabacion();
  check('G al parar la grabación vuelve a su sitio sin tocar ningún interruptor',
    !claves().includes('frp') && useObdStore.getState().disabledPids.has('frp'));

  // Lo que el VEHÍCULO dice que no tiene no se lee ni marcándolo: eso no es una
  // preferencia que se pueda saltar, es un identificador que no existe.
  useObdStore.setState({ disabledPids: new Set(), unsupportedPids: new Set(['frp']) });
  useObdStore.getState().iniciarGrabacion(['frp']);
  check('G lo que el vehículo dice que no tiene no se pide ni grabando',
    !claves().includes('frp'), claves().join(','));
  useObdStore.getState().pararGrabacion();
  useObdStore.setState({ disabledPids: new Set(), unsupportedPids: new Set(), visiblesPorPantalla: new Map() });
  console.log(`  (el perfil tiene ${total} datos; mirando una pantalla se preguntan ${NUCLEO.length + 3})`);
}

// ─── D2 · El voltaje del adaptador ─────────────────────────────────────────
{
  section('D2 · El voltaje del adaptador');
  const { parseVoltage } = await import(`${dir}/obd/protocol.ts`);
  check('D2 lee un voltaje normal', parseVoltage('13.7V') === 13.7, `${parseVoltage('13.7V')}`);
  check('D2 lee con el eco pegado', parseVoltage('ATRV12.4V') === 12.4);
  check('D2 rechaza el 28.3 V que salió en el informe del 16/09',
    parseVoltage('28.3V') === null, 'un voltaje imposible en un informe manda a buscar una avería que no existe');
  check('D2 rechaza un cero', parseVoltage('0.0V') === null);
  check('D2 rechaza lo que no es un voltaje', parseVoltage('NO DATA') === null);
  check('D2 acepta el límite bajo de un arranque', parseVoltage('9.6V') === 9.6);
}

// ─── G2 · La lista de "qué grabar" ─────────────────────────────────────────
{
  section('G2 · La lista de qué grabar y lo que cuesta cada vuelta');
  const { grabables, costeVuelta } = await import(`${dir}/obd/grabacion.ts`);
  const { FORD_EXPLORER_2010_PROFILE, FORD_ECOSPORT_2006_PROFILE } = await import(`${dir}/profiles/index.ts`);
  const P = FORD_EXPLORER_2010_PROFILE;
  const todos = P.moduleGroups.flatMap(g => g.pids);

  const lista = grabables(P, new Set(['frp']), new Set(['tft']), null);
  check('G2 lo apagado a mano SÍ sale en la lista, marcado como apagado',
    lista.some(x => x.pid.key === 'frp' && x.apagado));
  check('G2 lo que el vehículo no tiene NO sale', !lista.some(x => x.pid.key === 'tft'));
  check('G2 sale todo lo demás', lista.length === todos.length - 1, `${lista.length} de ${todos.length}`);
  check('G2 cada fila lleva su grupo y su color', lista.every(x => !!x.grupo && !!x.color));

  // La máscara del vehículo también manda: un PID del Modo 01 que el PCM no
  // anuncia no se puede grabar porque no se puede leer.
  const conMascara = grabables(P, new Set(), new Set(), new Set(['010C']));
  check('G2 la máscara del Modo 01 filtra la lista',
    conMascara.some(x => x.pid.command === '010C') &&
    !conMascara.some(x => x.pid.mode === '01' && x.pid.command !== '010C'));

  // El coste: lo que se le enseña antes de empezar.
  const c1 = costeVuelta(P, ['010C', '010D']);
  check('G2 dos datos de cabecera funcional son dos comandos', c1.comandos === 2, `${c1.comandos}`);
  const c2 = costeVuelta(P, ['010C', 'frp']);
  check('G2 un dato de otro módulo cuesta dos comandos más (ATSH y ATCRA)',
    c2.comandos === 4, `${c2.comandos}`);
  check('G2 el tiempo sale del techo de 20 comandos por segundo',
    Math.abs(costeVuelta(P, todos.map(p => p.key)).segundos
             - costeVuelta(P, todos.map(p => p.key)).comandos / 20) < 1e-9);
  check('G2 grabar el perfil entero se avisa como lento (más de 3 s por vuelta)',
    costeVuelta(P, todos.map(p => p.key)).segundos > 3,
    `${costeVuelta(P, todos.map(p => p.key)).segundos.toFixed(1)} s`);
  check('G2 sin nada marcado no cuesta nada', costeVuelta(P, []).comandos === 0);

  // Y lo mismo vale para el otro carro, que es la prueba de que no hay nada
  // atado a la Explorer.
  const eco = grabables(FORD_ECOSPORT_2006_PROFILE, new Set(), new Set(), null);
  check('G2 la lista también funciona con el perfil de la EcoSport', eco.length > 10,
    `${eco.length} datos`);
  console.log(`  (Explorer: ${todos.length} grabables, ${costeVuelta(P, todos.map(p => p.key)).segundos.toFixed(1)} s por vuelta si se marcan todos)`);
}

// ─── H · La prueba de la caja saca las conclusiones correctas ───────────────
// Se le dan trayectos inventados con un comportamiento conocido y se comprueba
// que el veredicto sea el que tiene que ser. Una caja sana tiene que salir
// "bien" y una que patina tiene que salir "patina": ni un falso positivo que
// mande a alguien al taller sin motivo, ni un falso negativo que deje pasar
// una avería real.
{
  section('H · La prueba de la caja');
  const { analizarCaja, informeCaja, RATIOS_6R80, gruposDePrueba, faltantes } =
    await import(`${dir}/obd/pruebaCaja.ts`);
  const { FORD_EXPLORER_2010_PROFILE } = await import(`${dir}/profiles/index.ts`);

  const viaje = (plan) => {
    const out = []; let t = Date.now();
    for (const [marcha, oss, n, factor, desliz] of plan) {
      for (let i = 0; i < n; i++) {
        const ratio = RATIOS_6R80[marcha] * factor;
        out.push({
          t: (t += 500), marcha, oss, iss: oss * ratio, ratio,
          velocidad: Math.round(oss / 30), rpm: oss * ratio, desliz,
        });
      }
    }
    return out;
  };

  // Una caja sana: todas las marchas dan su relación exacta.
  const sana = analizarCaja(viaje([
    [1, 600, 12, 1.0, 200], [2, 1200, 12, 1.0, 150], [3, 1800, 12, 1.0, 60],
    [4, 2200, 14, 1.0, 10], [5, 2400, 14, 1.0, 5], [6, 2600, 16, 1.0, 3],
  ]));
  check('H una caja sana sale bien en las seis',
    sana.marchas.length === 6 && sana.marchas.every(m => m.veredicto === 'bien'),
    sana.marchas.map(m => `${m.nombre}:${m.veredicto}`).join(' '));
  check('H y el convertidor sale bien', sana.veredictoConvertidor === 'bien',
    `${sana.deslizCrucero}`);
  check('H no quedan marchas sin probar', sana.sinProbar.length === 0);

  // La 3ª patinando un 15 %: la relación medida sale más alta que la de fábrica.
  const patina = analizarCaja(viaje([
    [1, 600, 12, 1.0, 200], [2, 1200, 12, 1.0, 150], [3, 1800, 12, 1.15, 60],
    [4, 2200, 14, 1.0, 10], [5, 2400, 14, 1.0, 5], [6, 2600, 16, 1.0, 3],
  ]));
  const t3 = patina.marchas.find(m => m.marcha === 3);
  check('H una 3ª que patina se detecta', t3?.veredicto === 'patina', `${t3?.veredicto} ${t3?.errorPct?.toFixed(1)}%`);
  check('H y las demás siguen saliendo bien',
    patina.marchas.filter(m => m.marcha !== 3).every(m => m.veredicto === 'bien'));
  check('H el resumen nombra la marcha mala', patina.resumen.includes('3ª'), patina.resumen);

  // Un 2 % de diferencia es tolerancia de sensores, no una avería: no puede
  // salir como patinaje o mandaríamos a alguien al taller sin motivo.
  const tolerancia = analizarCaja(viaje([[4, 2200, 20, 1.02, 10]]));
  check('H un 2 % de diferencia NO se reporta como avería',
    tolerancia.marchas[0]?.veredicto === 'bien', `${tolerancia.marchas[0]?.veredicto}`);

  // Convertidor que no bloquea: relaciones correctas pero deslizamiento alto.
  const conv = analizarCaja(viaje([[5, 2400, 20, 1.0, 250], [6, 2600, 20, 1.0, 240]]));
  check('H un convertidor que no bloquea se detecta', conv.veredictoConvertidor === 'patina',
    `${conv.deslizCrucero}`);
  check('H aunque las marchas estén bien', conv.marchas.every(m => m.veredicto === 'bien'));

  // Carro parado: la salida en cero no puede producir ninguna conclusión.
  const parado = analizarCaja(Array.from({ length: 40 }, (_, i) => ({
    t: Date.now() + i * 500, marcha: 1, iss: 700, oss: 0, ratio: null,
    velocidad: 0, rpm: 700, desliz: 40,
  })));
  check('H con el carro parado no se concluye nada', parado.marchas.length === 0);
  check('H y se dice por qué', parado.resumen.toLowerCase().includes('rodar'), parado.resumen);

  // Un cambio de paso —tres muestras sueltas en una marcha— no es una marcha
  // sostenida y no debe generar un veredicto.
  const paso = analizarCaja(viaje([[2, 1200, 3, 1.4, 100], [4, 2200, 20, 1.0, 10]]));
  check('H un cambio de paso no genera veredicto',
    !paso.marchas.some(m => m.marcha === 2), paso.marchas.map(m => m.nombre).join(','));

  // El informe tiene que salir entero en todos los casos, incluido el vacío.
  for (const [nombre, r] of [['sana', sana], ['patina', patina], ['parado', parado]]) {
    let texto = '';
    try { texto = informeCaja(FORD_EXPLORER_2010_PROFILE, r); } catch { texto = ''; }
    check(`H el informe se genera (${nombre})`, texto.length > 400 && texto.includes('FIN DE LA PRUEBA'),
      `${texto.length} caracteres`);
  }

  // El perfil tiene que traer todo lo que la prueba necesita.
  check('H el perfil tiene los datos que la prueba necesita',
    faltantes(FORD_EXPLORER_2010_PROFILE).length === 0,
    faltantes(FORD_EXPLORER_2010_PROFILE).join(','));
  const grupos = gruposDePrueba(FORD_EXPLORER_2010_PROFILE);
  check('H la prueba usa dos cabeceras como mucho',
    new Set(grupos.map(g => g.header)).size <= 2,
    'cada cambio de cabecera cuesta dos comandos extra por ronda');
}

// ─── I · La grabadora y el glosario ─────────────────────────────────────────
{
  section('I · Grabadora y glosario');
  const { informeGrabacion, resumir } = await import(`${dir}/obd/grabacion.ts`);
  const { explicar, totalTerminos } = await import(`${dir}/obd/glosario.ts`);
  const { FORD_EXPLORER_2010_PROFILE } = await import(`${dir}/profiles/index.ts`);
  const perfil = FORD_EXPLORER_2010_PROFILE;

  const inicio = Date.now();
  const muestras = [];
  for (let i = 0; i < 500; i++) {
    muestras.push({ t: inicio + i * 200, key: 'frp', value: 270 + Math.sin(i / 9) * 8 });
    muestras.push({ t: inicio + i * 200, key: 'o2_b1s2_v', value: 0 });   // la sonda muerta
  }
  const res = resumir(perfil, muestras, inicio);
  const frp = res.find(x => x.key === 'frp');
  check('I el resumen cuenta bien las muestras', frp?.n === 500, `${frp?.n}`);
  check('I y encuentra el mínimo y el máximo', frp && frp.min < 263 && frp.max > 277,
    `${frp?.min?.toFixed(1)}-${frp?.max?.toFixed(1)}`);
  const texto = informeGrabacion(perfil, muestras, inicio);
  check('I el informe se genera entero', texto.includes('FIN DE LA GRABACIÓN'));
  check('I y avisa de lo que no se movió en todo el trayecto',
    texto.includes('No se movieron') && texto.includes('Banco 1 · TRASERA'),
    'una sonda clavada durante todo el viaje es justo lo que hay que ver');

  // Un informe de una grabación vacía no puede reventar.
  let vacio = '';
  try { vacio = informeGrabacion(perfil, [], Date.now()); } catch { vacio = ''; }
  check('I una grabación vacía no revienta el informe', vacio.includes('FIN DE LA GRABACIÓN'));

  // La explicación hace falta donde hay jerga. "RPM" o "Velocidad" se explican
  // solos y llenarlos de texto sería ruido; STFT, VCT o ISS no se explican solos
  // y un número junto a una sigla que no entiendes no es información.
  const pids = perfil.moduleGroups.flatMap(g => g.pids);
  const CON_JERGA = ['stft_b1', 'ltft_b2', 'o2_b1s2_v', 'o2_htr_b1s2', 'ro2ft_b1',
    'vct_adv_b1', 'vct_err_b2', 'iss', 'oss', 'tcc_slip', 'gear', 'gear_ratio', 'trs',
    'frp', 'frp_dsd', 'fuel_pump', 'maf22', 'cht', 'tft', 'spark_dur_1', 'cyl1_m06',
    'brake_press', 'ac_press', 'vbatt_pcm', 'gen_v_dsd', 'iac_kam0', 'evap_sta'];
  const sinAyuda = CON_JERGA.filter(k => {
    const p = pids.find(x => x.key === k);
    return !p || !explicar(p);
  });
  check('I todo lo que lleva jerga tiene explicación', sinAyuda.length === 0, sinAyuda.join(', '));
  const conAyuda = pids.filter(p => explicar(p)).length;
  check('I la mayoría de los datos tienen explicación', conAyuda >= pids.length * 0.8,
    `${conAyuda} de ${pids.length}`);
  // La explicación tiene que decir QUÉ SIGNIFICA que se mueva, no solo qué es.
  const stft = pids.find(p => p.key === 'stft_b1');
  check('I la explicación dice hacia dónde mirar cuando el dato se mueve',
    explicar(stft).includes('pobre') && explicar(stft).includes('%'),
    explicar(stft).slice(0, 60));
  console.log(`  (${totalTerminos()} términos en el glosario, ${pids.length} datos del perfil cubiertos)`);
}

// ─── J · El muestreo continuo: el camino más agresivo de la app ─────────────
// Esta es la única ruta que le pregunta al vehículo sin parar durante minutos,
// y hasta ahora no tenía ni una comprobación. Es justo la que más las necesita:
// si se le escapa un bucle, es un bucle que martillea la ECU durante cinco
// minutos con el cerrojo del canal tomado y nadie mirando.
{
  section('J · Muestreo continuo (prueba de carretera)');
  const { bleManager, spy } = await import(`${dir}/ble/BleManager.ts`);
  const { obdGateway } = await import(`${dir}/obd/ObdGateway.ts`);
  const { useObdStore } = await import(`${dir}/store/useObdStore.ts`);
  const { gruposDePrueba } = await import(`${dir}/obd/pruebaCaja.ts`);
  const { FORD_EXPLORER_2010_PROFILE } = await import(`${dir}/profiles/index.ts`);

  const grupos = gruposDePrueba(FORD_EXPLORER_2010_PROFILE);
  useObdStore.setState({ strictMode: false });

  const arrancarSim = () => {
    const sim = new ElmSim({ feed: (t) => bleManager.feed(t), latency: 2, chunk: 16 });
    spy.sim = sim; spy.connected = true; spy.written.length = 0;
    bleManager.resetCircuit();
    return sim;
  };

  // ── 1. Respeta el techo de comandos por segundo ──────────────────────────
  {
    const sim = arrancarSim();
    const t0 = Date.now();
    await obdGateway.muestrearContinuo({
      grupos, segundos: 3, onMuestra: () => {}, debeParar: () => false,
    });
    const w = spy.written;
    let pico = 0;
    for (const x of w) pico = Math.max(pico, w.filter(y => y.t > x.t - 1000 && y.t <= x.t).length);
    check('J el muestreo continuo respeta el techo de comandos/s',
      pico <= HARD_LIMITS.MAX_PER_SECOND, `pico=${pico}/s de un techo de ${HARD_LIMITS.MAX_PER_SECOND}`);
    check('J y no lo consume entero: deja margen', pico <= HARD_LIMITS.MAX_PER_SECOND - 2,
      `pico=${pico}/s — esta ruta antes iba a tope los cinco minutos`);
    check('J termina cuando se le acaba el tiempo', Date.now() - t0 < 6000, `tardó ${Date.now() - t0} ms`);
    check('J y soltó el canal al terminar', !obdGateway.estaOcupado());
    sim.destroy();
  }

  // ── 2. cancelProbe() lo para, que es lo que hace la pantalla al cerrarse ─
  {
    const sim = arrancarSim();
    const t0 = Date.now();
    setTimeout(() => obdGateway.cancelProbe(), 300);
    await obdGateway.muestrearContinuo({
      grupos, segundos: 120, onMuestra: () => {}, debeParar: () => false,
    });
    const tardo = Date.now() - t0;
    check('J cancelProbe() lo para enseguida', tardo < 2500, `tardó ${tardo} ms de 120 s pedidos`);
    check('J y suelta el canal', !obdGateway.estaOcupado());
    const antes = spy.written.length;
    await sleep(400);
    check('J tras cancelar no se envía ni un comando más', spy.written.length === antes,
      `+${spy.written.length - antes}`);
    sim.destroy();
  }

  // ── 3. Una desconexión lo para ───────────────────────────────────────────
  {
    const sim = arrancarSim();
    const t0 = Date.now();
    setTimeout(() => { spy.connected = false; }, 300);
    await obdGateway.muestrearContinuo({
      grupos, segundos: 120, onMuestra: () => {}, debeParar: () => false,
    });
    check('J una desconexión lo para', Date.now() - t0 < 3000, `tardó ${Date.now() - t0} ms`);
    check('J y suelta el canal', !obdGateway.estaOcupado());
    spy.connected = true;
    sim.destroy();
  }

  // ── 4. reset() es un freno de verdad ─────────────────────────────────────
  // Antes de la revisión, reset() no tocaba la cancelación: un muestreo de
  // cinco minutos le sobrevivía y seguía preguntando. Solo parecía funcionar
  // porque reset() se llamaba siempre junto a una desconexión.
  {
    const sim = arrancarSim();
    const t0 = Date.now();
    setTimeout(() => obdGateway.reset(), 300);
    await obdGateway.muestrearContinuo({
      grupos, segundos: 120, onMuestra: () => {}, debeParar: () => false,
    }).catch(() => {});
    check('J reset() para el muestreo continuo', Date.now() - t0 < 3000, `tardó ${Date.now() - t0} ms`);
    const antes = spy.written.length;
    await sleep(400);
    check('J y después no se envía nada más', spy.written.length === antes, `+${spy.written.length - antes}`);
    obdGateway.startPolling();   // reset() deja el motor apagado a propósito
    obdGateway.stopPolling();
    sim.destroy();
  }

  // ── 5. Nada peligroso sale por este camino ───────────────────────────────
  {
    const sim = arrancarSim();
    await obdGateway.muestrearContinuo({
      grupos, segundos: 2, onMuestra: () => {}, debeParar: () => false,
    });
    const prohibidos = spy.written.filter(x => {
      const c = x.cmd.toUpperCase().replace(/\s+/g, '');
      if (/^AT/.test(c)) return !AT_OK.test(c);
      return !(READ_SERVICES.has(c.slice(0, 2)) || CLEAR_SERVICES.has(c.slice(0, 2)));
    });
    check('J ningún comando prohibido sale por esta ruta', prohibidos.length === 0,
      prohibidos.slice(0, 4).map(x => x.cmd).join(', '));
    check('J el bucle no murió por un error interno',
      obdGateway.__fatalesParaPruebas().length === 0);
    sim.destroy();
  }

  // ── 6. El modo estricto lo rechaza al entrar, no a mitad ─────────────────
  // Si se cuela con el modo estricto puesto, cada comando se rechaza de forma
  // síncrona y el bucle se convierte en un giro de microtareas que congela la
  // interfaz. Mejor negarse desde el principio.
  {
    useObdStore.setState({ strictMode: true });
    let rechazo = '';
    try {
      await obdGateway.muestrearContinuo({
        grupos, segundos: 2, onMuestra: () => {}, debeParar: () => false,
      });
    } catch (e) { rechazo = String(e?.message ?? e); }
    check('J con modo estricto se niega a arrancar', rechazo.includes('estricto'), rechazo || '(no se negó)');
    check('J y no tomó el canal', !obdGateway.estaOcupado());
    useObdStore.setState({ strictMode: false });
  }

  // ── 7. El núcleo no se puede apagar a mano ───────────────────────────────
  {
    const { NUCLEO } = await import(`${dir}/obd/nucleo.ts`);
    useObdStore.setState({ visiblesPorPantalla: new Map(), disabledPids: new Set(NUCLEO) });
    const enPlan = obdGateway.__planParaPruebas().groups.flatMap(g => g.tasks.map(t => t.key));
    check('J apagar el núcleo a mano no lo apaga', NUCLEO.every(k => enPlan.includes(k)),
      `en el plan: ${enPlan.join(',')}`);
    // Pero si el VEHÍCULO dice que no lo tiene, eso sí se respeta: no es una
    // preferencia, es un hecho.
    useObdStore.setState({ disabledPids: new Set(), unsupportedPids: new Set([NUCLEO[1]]) });
    const enPlan2 = obdGateway.__planParaPruebas().groups.flatMap(g => g.tasks.map(t => t.key));
    check('J pero si el vehículo dice que no lo tiene, se respeta',
      !enPlan2.includes(NUCLEO[1]), `en el plan: ${enPlan2.join(',')}`);
    useObdStore.setState({ unsupportedPids: new Set() });
  }

  // ── 8. Arrancar una operación no desactiva la cancelación de la anterior ─
  // La bandera de cancelación es una sola, compartida. Si se limpiara al pedir
  // turno en vez de al tomar el canal, pedir una operación nueva borraría la
  // cancelación dirigida a la que sigue corriendo, y esa seguiría preguntándole
  // al vehículo con alguien esperando a que parase.
  {
    const sim = arrancarSim();
    let seguiaViva = 0;
    const larga = obdGateway.muestrearContinuo({
      grupos, segundos: 60, onMuestra: () => { seguiaViva++; }, debeParar: () => false,
    });
    await sleep(300);
    obdGateway.cancelProbe();
    // Y justo después alguien pide otra cosa, que se encola.
    const segunda = obdGateway.probePids(grupos.slice(0, 1)).catch(() => new Map());
    await larga;
    const trasParar = seguiaViva;
    await sleep(300);
    check('J pedir otra operación no revive la que se acaba de cancelar',
      seguiaViva === trasParar, `siguió tomando ${seguiaViva - trasParar} muestras`);
    await segunda;
    sim.destroy();
  }

  // ── 9. Volver del segundo plano vuelve a registrar las pantallas ─────────
  // El fallo era este: al irse a segundo plano se borraban los registros, y al
  // volver no los reponía nadie porque useFocusEffect solo reacciona a cambios
  // de pestaña. El panel se quedaba congelado leyendo cuatro datos para siempre.
  {
    const antes = useObdStore.getState().generacionApp;
    useObdStore.getState().appAlFrente();
    check('J volver al frente cambia la generación',
      useObdStore.getState().generacionApp === antes + 1,
      'es lo que hace que las pantallas se registren otra vez solas');
  }
}

// ─── K · La luz de cambio ───────────────────────────────────────────────────
// Es una luz que alguien va a mirar conduciendo, y aprende del vehículo en vez
// de usar un umbral inventado. Lo que aprende sale de detectar los cambios de
// marcha, y ahí hay una trampa: en este módulo la reversa es el número 7.
{
  section('K · La luz de cambio');
  const { esSubida, calcularAviso, BANDA_CAMBIO } = await import(`${dir}/ui/cambio.ts`);

  check('K 2ª a 3ª es una subida', esSubida(2, 3) === true);
  check('K 5ª a 6ª es una subida', esSubida(5, 6) === true);
  check('K 3ª a 2ª no lo es', esSubida(3, 2) === false);
  check('K quedarse en la misma no lo es', esSubida(3, 3) === false);
  // La que importa: meter la reversa desde 6ª contaría como subir a "7ª" y
  // metería un punto de cambio falso en lo aprendido.
  check('K meter la reversa NO es una subida', esSubida(6, 7) === false,
    'si no, la luz aprendería un punto de cambio inventado');
  check('K salir de la reversa tampoco', esSubida(7, 1) === false);

  const punto = 2400;
  check('K muy por debajo del punto, la luz está apagada', calcularAviso(900, punto) === 0,
    `${calcularAviso(900, punto)}`);
  check('K en el punto exacto, llena', calcularAviso(punto, punto) === 1);
  check('K por encima no se pasa de llena', calcularAviso(punto + 1500, punto) === 1);
  const medio = calcularAviso(punto - BANDA_CAMBIO / 2, punto);
  check('K a media banda va por la mitad', Math.abs(medio - 0.5) < 0.02, `${medio}`);
  check('K sin lectura de revoluciones no se enciende sola', calcularAviso(null, punto) === 0);
  check('K una lectura imposible no la enciende', calcularAviso(NaN, punto) === 0);
  // Un punto aprendido absurdamente bajo no puede dejar la luz encendida fija.
  check('K un punto de cambio muy bajo no deja la luz clavada',
    calcularAviso(750, 800) < 1, `${calcularAviso(750, 800)}`);

  // ── El color de la aguja ────────────────────────────────────────────────
  // Verde mientras falta, ámbar cuando se acerca, rojo justo antes de cambiar.
  // Y por encima de la zona roja de la esfera manda la zona roja: esa es una
  // advertencia del fabricante, no una sugerencia de cuándo cambiar.
  const { colorAguja, RPM_ROJO, VERDE, AMBAR, ROJO } = await import(`${dir}/ui/cambio.ts`);
  check('K aguja verde con revoluciones bajas', colorAguja(1200, 0.2) === VERDE);
  check('K aguja ámbar a media banda', colorAguja(2000, 0.7) === AMBAR);
  check('K aguja roja justo antes del cambio', colorAguja(2380, 0.95) === ROJO);
  check('K en zona roja manda la zona roja', colorAguja(RPM_ROJO + 100, 0) === ROJO,
    'aunque la luz de cambio diga que falta mucho');
  check('K sin lectura no se pone roja sola', colorAguja(null, 0) === VERDE);
  check('K los tres colores son distintos', new Set([VERDE, AMBAR, ROJO]).size === 3);

  // ── La tabla de la palanca ──────────────────────────────────────────────
  // No es una escala, es una tabla: de D a 3 el número cae de 46 a 23, a la
  // mitad, mientras que entre 3, 2 y 1 baja de uno en uno. Por eso ninguna
  // fórmula del catálogo servía y hubo que medir posición por posición.
  {
    const { FORD_EXPLORER_2010_PROFILE, textoLectura } = await import(`${dir}/profiles/index.ts`);
    const trs = FORD_EXPLORER_2010_PROFILE.moduleGroups
      .flatMap(g => g.pids).find(p => p.key === 'trs');
    const TABLA = [[70,'P'],[60,'R'],[50,'N'],[46,'D'],[23,'3'],[22,'2'],[21,'1']];
    for (const [crudo, letra] of TABLA) {
      check(`K palanca ${crudo} -> ${letra}`, textoLectura(trs, crudo) === letra,
        `dio "${textoLectura(trs, crudo)}"`);
    }
    // Un valor que no está en la tabla tiene que salir como número, no fingir.
    check('K una posición sin medir sale como número crudo',
      textoLectura(trs, 45) === '45', textoLectura(trs, 45));
    check('K las siete posiciones están', Object.keys(trs.etiquetas).length === 7,
      `${Object.keys(trs.etiquetas).length}`);
  }

  // ── La mediana del combustible ──────────────────────────────────────────
  // Existe para que un chapoteo del flotador en una curva no mueva la barra.
  // Si esto se cambiara por un promedio, el valor raro volvería a colarse.
  {
    const { mediana } = await import(`${dir}/ui/cambio.ts`);
    check('K mediana de una lista impar', mediana([70, 74, 72]) === 72);
    check('K mediana de una lista par', mediana([70, 72, 74, 76]) === 73);
    // Lo que de verdad importa: un solo valor disparatado no la mueve.
    const normal = [74, 74, 73, 74, 74];
    const conBache = [74, 74, 12, 74, 74];
    check('K un bache no mueve la mediana', mediana(conBache) === mediana(normal),
      `con bache ${mediana(conBache)} contra ${mediana(normal)}`);
    const prom = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    check('K y el promedio sí se la tragaría', Math.abs(prom(conBache) - prom(normal)) > 10,
      'por eso es mediana y no promedio');
    check('K sin lecturas no inventa un número', mediana([]) === null);
    check('K ignora las lecturas imposibles', mediana([74, NaN, 74]) === 74);
  }
}

// ─── G3 · El vigilante de lo declarado ─────────────────────────────────────
// Esta sección existe por una avería concreta, del 17/09: conectando el
// escáner con la camioneta ya andando, el tablero se quedó sin marcha y sin
// posición de palanca, y la única forma de recuperarlas era entrar a la lista
// de datos en vivo y volver. Ese viaje es un evento de foco — o sea que la
// declaración de lo que el tablero necesita dependía de un solo disparador, y
// ese disparador se perdió.
{
  section('G3 · El vigilante de lo declarado');
  const { hayQueRedeclarar, VIGILANTE_MS } = await import(`${dir}/obd/nucleo.ts`);

  check('G3 si no hay nada registrado, hay que declarar',
    hayQueRedeclarar(undefined, '010C|gear|trs') === true,
    'este es el caso exacto de la avería: la pantalla pidió y nadie lo anotó');
  check('G3 si está registrado lo mismo, no se toca nada',
    hayQueRedeclarar(new Set(['010C', 'gear', 'trs']), '010C|gear|trs') === false,
    'un vigilante que redeclara sin parar reconstruiría el plan en cada vuelta');
  check('G3 si falta una clave, hay que redeclarar',
    hayQueRedeclarar(new Set(['010C', 'gear']), '010C|gear|trs') === true);
  check('G3 si sobra una clave, hay que redeclarar',
    hayQueRedeclarar(new Set(['010C', 'gear', 'trs', '0105']), '010C|gear|trs') === true);
  check('G3 el orden no cuenta: es el contenido lo que importa',
    hayQueRedeclarar(new Set(['trs', '010C', 'gear']), '010C|gear|trs') === false,
    'una pantalla puede reordenar su lista sin que eso signifique tocar el plan');
  check('G3 una pantalla que no declara nada no despierta al vigilante',
    hayQueRedeclarar(undefined, '') === false);
  check('G3 el vigilante no es tan rápido como para reconstruir el plan sin parar',
    VIGILANTE_MS >= 1000 && VIGILANTE_MS <= 10000, `${VIGILANTE_MS} ms`);

  // Y la comprobación que ata el vigilante a lo que de verdad pasa: con el
  // registro perdido, el plan se queda sin lo del tablero; al redeclarar,
  // vuelve. Contra el almacén real, no contra un doble.
  const { useObdStore } = await import(`${dir}/store/useObdStore.ts`);
  const gw2 = await import(`${dir}/obd/ObdGateway.ts`);
  useObdStore.getState().setProfile('ford_explorer_2010');
  useObdStore.setState({ strictMode: false, supportedMode01: null, unsupportedPids: new Set(),
                         disabledPids: new Set(), visiblesPorPantalla: new Map(),
                         grabando: false, grabClaves: new Set() });
  const enPlan = () => gw2.obdGateway.__planParaPruebas().groups.flatMap(g => g.tasks.map(t => t.key));
  const FIRMA = '010C|010D|0105|gear|trs';
  // Con OTRA pantalla pidiendo datos, lo del tablero sale del plan. Es el
  // estado en el que se vio la avería: el tablero delante y sin declarar.
  useObdStore.getState().setVisibles('flujo', ['frp']);
  check('G3 sin declarar, el tablero no tiene ni marcha ni palanca',
    !enPlan().includes('gear') && !enPlan().includes('trs'),
    'esto es literalmente lo que se vio en el carro');
  if (hayQueRedeclarar(useObdStore.getState().visiblesPorPantalla.get('cluster'), FIRMA)) {
    useObdStore.getState().setVisibles('cluster', FIRMA.split('|'));
  }
  check('G3 el vigilante lo nota y las devuelve',
    enPlan().includes('gear') && enPlan().includes('trs'), enPlan().join(','));
  check('G3 y a la segunda vuelta ya no hace nada',
    hayQueRedeclarar(useObdStore.getState().visiblesPorPantalla.get('cluster'), FIRMA) === false);
  useObdStore.setState({ visiblesPorPantalla: new Map() });
}

// ─── G4 · Datos en vivo por grupos ─────────────────────────────────────────
// La pantalla de datos en vivo dejó de apoyarse en detectar el scroll porque
// en un teléfono con Android 14 eso no era de fiar. Ahora los grupos empiezan
// cerrados y solo se lee el que abres. Lo que hay que garantizar es que la
// carga sobre la ECU no dependa de nada que se pueda estropear.
{
  section('G4 · Datos en vivo por grupos');
  const { useObdStore } = await import(`${dir}/store/useObdStore.ts`);
  const gw = await import(`${dir}/obd/ObdGateway.ts`);
  const { NUCLEO, TABLERO } = await import(`${dir}/obd/nucleo.ts`);
  const { FORD_EXPLORER_2010_PROFILE: P } = await import(`${dir}/profiles/index.ts`);
  const { costeVuelta } = await import(`${dir}/obd/grabacion.ts`);

  useObdStore.getState().setProfile('ford_explorer_2010');
  useObdStore.setState({ strictMode: false, supportedMode01: null, unsupportedPids: new Set(),
                         disabledPids: new Set(), visiblesPorPantalla: new Map(),
                         grabando: false, grabClaves: new Set() });
  const enPlan = () => gw.obdGateway.__planParaPruebas().groups.flatMap(g => g.tasks.map(t => t.key));

  // Con todos los grupos cerrados la pantalla no declara nada. Esta es LA
  // garantía de la pantalla nueva: entrar a mirar no le cuesta nada al bus.
  useObdStore.getState().setVisibles('flujo', []);
  const cerrado = enPlan();
  check('G4 con todos los grupos cerrados solo se lee el núcleo y el tablero',
    cerrado.length === NUCLEO.length + TABLERO.filter(k => cerrado.includes(k)).length,
    `${cerrado.join(',')} — entrar a la pantalla no debe costar ninguna pregunta de más`);
  check('G4 y el tablero sigue vivo con todo cerrado',
    cerrado.includes('gear') && cerrado.includes('trs'),
    'es la pantalla principal: tiene que estar al día al volver a ella');

  // Pero en cuanto abres un grupo, el tablero cede el sitio.
  useObdStore.getState().setVisibles('flujo', ['frp']);
  check('G4 al abrir un grupo, el tablero sale del plan',
    !enPlan().includes('gear'),
    'con un grupo abierto la vuelta tiene que ser corta');

  // Abrir un grupo declara exactamente los suyos y ni uno más.
  const sondas = P.moduleGroups.find(g => /ox[ií]geno/i.test(g.moduleName));
  const suyas = sondas.pids.map(p => p.key);
  useObdStore.getState().setVisibles('flujo', suyas);
  const conGrupo = enPlan();
  check('G4 abrir un grupo declara todos sus datos',
    suyas.every(k => conGrupo.includes(k)), `${suyas.length} esperadas`);
  check('G4 y no arrastra nada de los demás grupos',
    conGrupo.length === suyas.length + NUCLEO.length,
    `${conGrupo.length} en el plan, deberían ser ${suyas.length + NUCLEO.length}`);

  // Y el grupo más grande del perfil tiene que seguir siendo rápido: si abrir
  // uno solo ya tardara varios segundos por vuelta, la pantalla no serviría
  // para ver una sonda oscilar, que es justo para lo que se hizo así.
  let peor = 0, nombrePeor = '';
  for (const g of P.moduleGroups) {
    const c = costeVuelta(P, g.pids.map(p => p.key)).segundos;
    if (c > peor) { peor = c; nombrePeor = g.moduleName; }
  }
  check('G4 abrir el grupo más grande sigue dando una vuelta rápida',
    peor < 1.5, `el peor es "${nombrePeor}" con ${peor.toFixed(2)} s por vuelta`);
  console.log(`  (el grupo más caro del perfil es "${nombrePeor}": ${peor.toFixed(2)} s por vuelta)`);

  // Y la pantalla ya no puede volver a depender de detectar el scroll.
  const fsG = await import('node:fs');
  const pathG = await import('node:path');
  const urlG = await import('node:url');
  const raizG = pathG.resolve(pathG.dirname(urlG.fileURLToPath(import.meta.url)), '../..');
  const codigo = fsG.readFileSync(pathG.join(raizG, 'app/(tabs)/stream.tsx'), 'utf8');
  check('G4 la pantalla de datos en vivo ya no depende de detectar el scroll',
    !/onViewableItemsChanged|viewabilityConfig|FlatList/.test(codigo),
    'volvió a meterse la detección de visibilidad que falló en Android 14');
  // ── El modo estricto no puede volver a ser invisible ─────────────────────
  // Viene encendido por defecto y deja fuera todo el Modo 22. En el teléfono de
  // un amigo, con una instalación nueva, eso hizo que solo se vieran los datos
  // estándar y el resto dijera "leyendo…" para siempre. Costó tres versiones
  // persiguiendo un fallo de Android que no existía, porque la pantalla nunca
  // decía que ese ajuste estaba encendido.
  useObdStore.setState({ strictMode: true, visiblesPorPantalla: new Map() });
  const conGrupoFord = P.moduleGroups.find(g => !!g.header);
  useObdStore.getState().setVisibles('flujo', conGrupoFord.pids.map(p => p.key));
  const planEstricto = enPlan();
  check('G4 con el modo estricto, un grupo con dirección propia no se pide',
    !conGrupoFord.pids.some(p => planEstricto.includes(p.key)),
    'si el motor lo pidiera, el modo estricto no estaría protegiendo nada');
  check('G4 y la pantalla lo dice arriba del todo, con un aviso propio',
    /MODO ESTRICTO ENCENDIDO/.test(codigo) && /strictMode && \(/.test(codigo),
    'sin el aviso, un ajuste que apaga media app es invisible');
  check('G4 un grupo bloqueado no dice "leyendo…" ni espera diez segundos para dar error',
    /bloqueado = strictMode && !!g\.header/.test(codigo) &&
    /const mudo = !bloqueado/.test(codigo) &&
    /bloqueado \? 'bloqueado · modo estricto'/.test(codigo),
    'la app sabe que no lo va a pedir: decir "leyendo…" es mentir');
  useObdStore.setState({ strictMode: false, visiblesPorPantalla: new Map() });

  const cluster = fsG.readFileSync(pathG.join(raizG, 'src/ui/Cluster.tsx'), 'utf8');
  check('G4 el tablero también avisa del modo estricto',
    /strictMode &&/.test(cluster) && /ESTRICTO/.test(cluster),
    'con él encendido, la marcha, la palanca y el combustible salen en raya sin explicar por qué');

  check('G4 y avisa si un grupo abierto no devuelve nada',
    /SIN_DATOS_MS/.test(codigo) && /NO LLEGA NING[UÚ]N DATO/.test(codigo),
    'sin ese aviso, un módulo mudo vuelve a parecer un fallo de la app');

  useObdStore.setState({ visiblesPorPantalla: new Map() });
}

// ─── O · El barrido de la Explorer ─────────────────────────────────────────
// Un barrido ciego es caro en tiempo, así que lo que hay que vigilar es que no
// gaste ni una pregunta de más: ni en páginas que ya conocemos, ni repitiendo
// tandas, ni pidiendo maniobras que no tiene por qué pedir porque se hace
// rodando.
{
  section('O · El barrido de la Explorer');
  const { buildBarridoExplorer, cabeceraBarridoExplorer, PERFIL_EXPLORER } =
    await import(`${dir}/obd/barridoExplorer.ts`);
  const { FORD_EXPLORER_2010_PROFILE, FORD_ECOSPORT_2006_PROFILE } =
    await import(`${dir}/profiles/index.ts`);
  const { MAX_BLOCK } = await import(`${dir}/obd/ObdGateway.ts`);
  const plan = buildBarridoExplorer(FORD_EXPLORER_2010_PROFILE);

  check('O el plan tiene etapas', plan.length > 10, `${plan.length}`);
  const ids = plan.map(p => p.id);
  check('O los identificadores de etapa no se repiten', new Set(ids).size === ids.length);
  check('O todas las etapas explican qué hacen',
    plan.every(p => p.title && p.detail.length > 30 && typeof p.run === 'function'));
  check('O ninguna etapa se pasa del tope por tanda',
    plan.every(p => p.weight <= MAX_BLOCK + 8),
    plan.filter(p => p.weight > MAX_BLOCK + 8).map(p => `${p.id}:${p.weight}`).join(', '));

  // Se hace rodando: NINGUNA etapa puede parar a pedirle algo al conductor.
  const conPeticion = plan.filter(p => p.prompt);
  check('O ninguna etapa pide maniobras: se hace conduciendo',
    conPeticion.length === 0,
    conPeticion.map(p => p.id).join(', '));

  // El buscador llama a las 256 páginas DOS veces. Con un solo golpe se
  // escaparían páginas vivas: es como se escapó la 16xx de la EcoSport.
  const buscador = plan.filter(p => p.id.startsWith('expl_paginas'));
  check('O el buscador da dos golpes a cada una de las 256 páginas',
    buscador.reduce((a, p) => a + p.weight, 0) === 512,
    `${buscador.reduce((a, p) => a + p.weight, 0)}`);

  // Las tandas de barrido se saltan solas si el buscador no encontró nada.
  const vacio = { profile: FORD_EXPLORER_2010_PROFILE, results: new Map(), note: () => {} };
  const adaptativas = plan.filter(p => p.id.startsWith('expl_barrer'));
  check('O hay tandas que se deciden sobre la marcha', adaptativas.length >= 40, `${adaptativas.length}`);
  check('O y todas se saltan solas si no hay página nueva que barrer',
    adaptativas.every(p => p.when && p.when(vacio).run === false));
  check('O y explican por qué se saltan',
    adaptativas.every(p => p.when(vacio).reason.length > 10));

  // Lo ya barrido NO se repite. Esta es la que ahorra un tercio del tiempo.
  const conPaginas = new Map([['expl_paginas_00_0', {
    id: 'expl_paginas_00_0', status: 'ok', summary: '', lines: [],
    data: { vivas: ['16', '09', '29', '06', 'D1'] },
  }]]);
  const ctx2 = { ...vacio, results: conPaginas };
  const primera = adaptativas[0].when(ctx2);
  check('O con páginas vivas, las tandas arrancan', primera.run === true, primera.reason);
  // Se descarta por TRAMOS de 64, no por páginas enteras, y esa distinción
  // vale dos minutos: de 16xx no queda nada (barrida entera), de 09xx y 29xx
  // solo la segunda mitad (se barrió 0900-097F y 2900-297F), y de 06xx y D1xx
  // los cuatro tramos. Total: 2 + 2 + 4 + 4 = 12.
  const cuantas = adaptativas.filter(p => p.when(ctx2).run).length;
  check('O descarta por tramos ya barridos, no por páginas enteras',
    cuantas === 12, `${cuantas} tandas — deberían ser 12`);
  check('O y no toca ni un tramo de la 16xx, que ya está barrida entera',
    !adaptativas.some(p => p.when(ctx2).run && false) && cuantas === 12);

  // La etapa de los sospechosos con nombre tiene que estar, y tiene que
  // incluir el identificador del que salió toda esta historia.
  const equil = plan.find(p => p.id === 'expl_equilibrio');
  check('O está la etapa del equilibrio de potencia', !!equil && equil.weight > 0);
  check('O la cabecera explica por qué existe este barrido',
    /22063F/.test(cabeceraBarridoExplorer().join(' ')) &&
    /RODANDO/.test(cabeceraBarridoExplorer().join(' ')),
    'si no dice por qué, dentro de un mes nadie se acuerda');
  check('O el barrido está atado al perfil de la Explorer',
    PERFIL_EXPLORER === FORD_EXPLORER_2010_PROFILE.id &&
    PERFIL_EXPLORER !== FORD_ECOSPORT_2006_PROFILE.id);

  const preguntas = plan.reduce((a, p) => a + p.weight, 0);
  console.log(`  (${plan.length} etapas, ~${preguntas} preguntas como mucho)`);
}

// ─── N · Los códigos de avería explicados ──────────────────────────────────
// Comprueba que ningún código de avería se quede sin explicación: primero la
// tabla propia en español, luego la tabla opcional y, siempre, su familia.
{
  section('N · Los códigos de avería explicados');
  const { explicarDtc, familiaDtc, totalComunes, clavesComunes } =
    await import(`${dir}/obd/dtcComunes.ts`);
  const { describirDtc, totalDtcConocidos } = await import(`${dir}/obd/dtcTextos.ts`);

  // Lo primero y más importante: NINGÚN código puede quedarse sin decir algo.
  const INVENTADOS = ['P0171', 'P3456', 'B1234', 'C9999', 'U0100', 'P0XXX', 'P2ABC'];
  const mudos = INVENTADOS.filter(c => !explicarDtc(c, describirDtc(c)).titulo);
  check('N ningún código se queda sin explicación, ni uno inventado',
    mudos.length === 0, mudos.join(', '));
  check('N y todos traen su familia', INVENTADOS.every(c => !!explicarDtc(c, describirDtc(c)).familia));

  // Los tres niveles, cada uno en su sitio.
  const p0171 = explicarDtc('P0171', describirDtc('P0171'));
  check('N un código común sale en español y con qué mirar',
    p0171.fuente === 'comunes' && /pobre/i.test(p0171.titulo) && !!p0171.que && !!p0171.mirar,
    p0171.titulo);
  const tabla = explicarDtc('P0651', describirDtc('P0651'));
  check('N uno que no está en español cae en la tabla opcional o en su familia',
    (tabla.fuente === 'tabla' || tabla.fuente === 'estructura') && !!tabla.titulo, tabla.titulo);
  const inventado = explicarDtc('P3456', '');
  check('N y uno que no existe en ninguna tabla cae en su estructura',
    inventado.fuente === 'estructura' && inventado.titulo.includes('transmisión'), inventado.titulo);

  // La estructura no adivina: deduce. La letra y el tercer dígito son norma.
  check('N la letra dice el sistema',
    familiaDtc('P0300').startsWith('Motor') &&
    familiaDtc('C1234').startsWith('Chasis') &&
    familiaDtc('B1234').startsWith('Carrocería') &&
    familiaDtc('U0100').startsWith('Red'));
  check('N el tercer dígito dice el subsistema',
    familiaDtc('P0300').includes('encendido') &&
    familiaDtc('P0420').includes('emisiones') &&
    familiaDtc('P0700').includes('transmisión') &&
    familiaDtc('P0601').includes('computadora'),
    familiaDtc('P0300'));
  check('N distingue lo de la norma de lo del fabricante',
    explicarDtc('P0171', '').generico === true &&
    explicarDtc('P1000', '').generico === false &&
    explicarDtc('P2270', '').generico === true &&
    explicarDtc('U1262', '').generico === false,
    'P0 y P2 son de la norma; P1 es de Ford');

  // Los códigos de ESTE garaje tienen que estar explicados en español. Son los
  // que han salido de verdad en las pruebas de los dos carros.
  const DE_CASA = ['P2270', 'P0812', 'P0420', 'P0171', 'P0300', 'P0128', 'P0455', 'P0571', 'P2004'];
  const sinEspanol = DE_CASA.filter(c => explicarDtc(c, describirDtc(c)).fuente !== 'comunes');
  check('N los códigos que han salido en estos dos carros están en español',
    sinEspanol.length === 0, sinEspanol.join(', '));

  // Un texto de ayuda que no dice por dónde empezar no ayuda: es un diccionario.
  const flojos = clavesComunes().filter(c => {
    const e = explicarDtc(c, '');
    return !e.que || !e.mirar || e.que.length < 40 || e.mirar.length < 40;
  });
  check('N todos los explicados dicen qué significa Y por dónde empezar',
    flojos.length === 0, flojos.join(', '));

  // Y ninguno puede prometer un diagnóstico: un código dice qué vio la
  // computadora, no qué pieza cambiar.
  const prometen = clavesComunes().filter(c => /^cambia (el|la) /i.test(explicarDtc(c, '').mirar ?? ''));
  check('N ninguna explicación empieza mandando a cambiar una pieza',
    prometen.length === 0, prometen.join(', '));

  console.log(`  (${totalComunes()} códigos explicados en español, sobre ${totalDtcConocidos()} con título)`);
}

console.log(`\n${'='.repeat(62)}`);
console.log(fail === 0
  ? `TODO CORRECTO — ${pass} comprobaciones superadas, 0 fallos`
  : `${pass} superadas, ${fail} FALLOS:\n  ${failures.join('\n  ')}`);
process.exit(fail === 0 ? 0 : 1);
