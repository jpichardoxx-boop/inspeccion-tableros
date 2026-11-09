/* ==========================================================================
   gemelo.js — Gemelo digital: modelo 3D del robot (Three.js) animado con la
   odometría real, y mapa 2D del recorrido con los hallazgos capturados.

   Medidas del plano general (mm): largo X = 185, ancho Y = 200, alto ≈ 80
   sin la cámara (queda dentro del casco). Todo el modelo se arma con
   primitivas, así que no hace falta ningún archivo 3D externo.
   ========================================================================== */
import * as THREE from "three";
import { OrbitControls } from "../vendor/three/OrbitControls.js";
import { ConvexGeometry } from "../vendor/three/ConvexGeometry.js";

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ medidas (mm)
const L = 185, W = 200;                 // largo y ancho total
const ANCHO_ORUGA = 36;
const R_RUEDA = 25;                      // radio de las ruedas dentadas
const R_TRAYECTORIA = 27;                // radio de la línea media de los eslabones
const X_RUEDA = L / 2 - R_TRAYECTORIA - 2;
const Y_EJE = R_TRAYECTORIA + 2;
const Z_ORUGA = W / 2 - ANCHO_ORUGA / 2;
const ANCHO_CUERPO = W - 2 * ANCHO_ORUGA - 6;

const COLORES = {
  casco: 0xfca311,      // ámbar del tema de la interfaz
  chasis: 0x2b323d,     // grafito
  oruga: 0x17191d,      // hule
  taco: 0x2a2e35,
  rueda: 0xb9c0ca,      // aluminio
  cubo: 0xfca311,
  vidrio: 0x0a1622,
  led: { ok: 0x2ecc71, mov: 0x3fa7ff, paro: 0xe74c3c },
};
const COLOR_NIVEL = ["#2ecc71", "#f1c40f", "#e67e22", "#e74c3c"];

// ------------------------------------------------------------------ escena
const marco = $("marco-3d");
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
} catch (e) {
  $("aviso-3d").hidden = false;
  $("aviso-3d").textContent = "Este navegador no soporta WebGL: solo se muestra el mapa 2D.";
}
const escena = new THREE.Scene();
const camara = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
camara.position.set(0.55, 0.42, 0.6);
let controles = null;

if (renderer) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  marco.appendChild(renderer.domElement);
  controles = new OrbitControls(camara, renderer.domElement);
  controles.enableDamping = true;
  controles.maxPolarAngle = Math.PI * 0.49;
  controles.minDistance = 0.25;
  controles.maxDistance = 6;
  controles.target.set(0, 0.04, 0);
}

escena.add(new THREE.HemisphereLight(0xdfe9ff, 0x1a1f26, 0.9));
const sol = new THREE.DirectionalLight(0xffffff, 2.2);
sol.position.set(1.2, 2.2, 0.8);
sol.castShadow = true;
sol.shadow.mapSize.set(1024, 1024);
Object.assign(sol.shadow.camera, { left: -0.6, right: 0.6, top: 0.6, bottom: -0.6, near: 0.5, far: 5 });
escena.add(sol, sol.target);
const contraluz = new THREE.DirectionalLight(0x9fc4ff, 0.7);
contraluz.position.set(-1.5, 0.8, -1.2);
escena.add(contraluz);

// Piso con cuadrícula de 10 cm (líneas fuertes cada 50 cm)
const piso = new THREE.Mesh(new THREE.PlaneGeometry(40, 40),
  new THREE.MeshStandardMaterial({ color: 0x141b24, roughness: 0.92 }));
piso.rotation.x = -Math.PI / 2;
piso.receiveShadow = true;
escena.add(piso);
const rejillaFina = new THREE.GridHelper(20, 200, 0x1b2430, 0x1b2430);
rejillaFina.position.y = 0.0005;
const rejillaGruesa = new THREE.GridHelper(20, 40, 0x2c3a4d, 0x2c3a4d);
rejillaGruesa.position.y = 0.001;
escena.add(rejillaFina, rejillaGruesa);
// Origen (0,0) del mapa
const origen = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.04, 32),
  new THREE.MeshBasicMaterial({ color: 0xfca311, transparent: true, opacity: 0.7 }));
origen.rotation.x = -Math.PI / 2;
origen.position.y = 0.002;
escena.add(origen);

// ------------------------------------------------------------------ modelo del robot
const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1, ...extra });
const MATS = {
  casco: mat(COLORES.casco, { roughness: 0.38, metalness: 0.25 }),
  chasis: mat(COLORES.chasis, { roughness: 0.6, metalness: 0.35 }),
  oruga: mat(COLORES.oruga, { roughness: 0.9 }),
  taco: mat(COLORES.taco, { roughness: 0.85 }),
  rueda: mat(COLORES.rueda, { roughness: 0.3, metalness: 0.85 }),
  cubo: mat(COLORES.cubo, { roughness: 0.4, metalness: 0.3 }),
  vidrio: mat(COLORES.vidrio, { roughness: 0.08, metalness: 0.6, emissive: 0x0c2a44, emissiveIntensity: 0.6 }),
  led: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: COLORES.led.ok, emissiveIntensity: 2.2 }),
};

const robot = new THREE.Group();          // se mueve en el mundo (metros)
const modelo = new THREE.Group();          // dentro: todo en milímetros
modelo.scale.setScalar(0.001);
robot.add(modelo);
escena.add(robot);

function sombra(m) { m.castShadow = true; m.receiveShadow = true; return m; }
function caja(w, h, d, material, x, y, z) {
  const m = sombra(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material));
  m.position.set(x, y, z);
  modelo.add(m);
  return m;
}

// Chasis inferior (entre las orugas)
const LARGO_CHASIS = L - 22;
caja(LARGO_CHASIS, 40, ANCHO_CUERPO, MATS.chasis, 0, 14 + 20, 0);
// Puerta de batería en la parte trasera (detalle del plano)
caja(1.5, 20, ANCHO_CUERPO * 0.45, MATS.casco, -LARGO_CHASIS / 2 - 0.5, 26, -ANCHO_CUERPO * 0.18);
// Ejes que asoman hacia las orugas
for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
  const eje = sombra(new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 12, 12), MATS.rueda));
  eje.rotation.x = Math.PI / 2;
  eje.position.set(sx * X_RUEDA, Y_EJE, sz * (ANCHO_CUERPO / 2 + 4));
  modelo.add(eje);
}

// Casco superior facetado (sin la cámara: queda oculta dentro).
// Paredes verticales hasta yMuro y luego caras inclinadas hasta la tapa.
const yBase = 54, yMuro = 64, yTope = 84;
const base = { x0: -L / 2 + 6, x1: L / 2 - 6, z: ANCHO_CUERPO / 2 + 1 };
const tope = { x0: -L / 2 + 34, x1: L / 2 - 52, z: ANCHO_CUERPO / 2 - 24 };
const puntosCasco = [];
for (const z of [-base.z, base.z]) {
  for (const y of [yBase, yMuro]) puntosCasco.push(new THREE.Vector3(base.x0, y, z), new THREE.Vector3(base.x1, y, z));
}
for (const z of [-tope.z, tope.z]) {
  puntosCasco.push(new THREE.Vector3(tope.x0, yTope, z), new THREE.Vector3(tope.x1, yTope, z));
}
const casco = sombra(new THREE.Mesh(new ConvexGeometry(puntosCasco), MATS.casco));
modelo.add(casco);
// Tapa superior en grafito (dos tonos)
caja(tope.x1 - tope.x0 - 10, 1.2, 2 * tope.z - 10, MATS.chasis, (tope.x0 + tope.x1) / 2, yTope + 0.4, 0);
// Faja de unión casco / chasis
caja(L - 10, 3, ANCHO_CUERPO + 4, MATS.chasis, 0, yBase - 1.5, 0);

// Ventana frontal del sensor sobre la cara inclinada delantera
// (la cámara térmica y la webcam van detrás)
const pendiente = Math.atan2(yTope - yMuro, base.x1 - tope.x1);
const largoCara = Math.hypot(yTope - yMuro, base.x1 - tope.x1);
const ventana = sombra(new THREE.Mesh(new THREE.BoxGeometry(largoCara * 0.45, 1.6, 2 * tope.z + 8), MATS.vidrio));
ventana.position.set((base.x1 + tope.x1) / 2 + Math.sin(pendiente) * 0.8, (yMuro + yTope) / 2 + Math.cos(pendiente) * 0.8, 0);
ventana.rotation.z = -pendiente;
modelo.add(ventana);

// Tira LED de estado alrededor del casco
const led = new THREE.Mesh(new THREE.BoxGeometry(L - 11, 1.6, ANCHO_CUERPO + 3), MATS.led);
led.position.y = yMuro - 3;
modelo.add(led);

// ------------------------------------------------------------------ orugas
const perimetro = 4 * X_RUEDA + 2 * Math.PI * R_TRAYECTORIA;
const N_ESLABONES = Math.round(perimetro / 9);
const paso = perimetro / N_ESLABONES;

/** Punto de la trayectoria de la oruga a la distancia s (mm), recorrida en el
 *  sentido: abajo hacia adelante → rueda delantera → arriba hacia atrás → trasera. */
function puntoOruga(s) {
  s = ((s % perimetro) + perimetro) % perimetro;
  const recta = 2 * X_RUEDA, arco = Math.PI * R_TRAYECTORIA;
  if (s < recta) return { x: -X_RUEDA + s, y: Y_EJE - R_TRAYECTORIA, ang: 0 };
  s -= recta;
  if (s < arco) {
    const a = -Math.PI / 2 + s / R_TRAYECTORIA;
    return { x: X_RUEDA + R_TRAYECTORIA * Math.cos(a), y: Y_EJE + R_TRAYECTORIA * Math.sin(a), ang: a + Math.PI / 2 };
  }
  s -= arco;
  if (s < recta) return { x: X_RUEDA - s, y: Y_EJE + R_TRAYECTORIA, ang: Math.PI };
  s -= recta;
  const a = Math.PI / 2 + s / R_TRAYECTORIA;
  return { x: -X_RUEDA + R_TRAYECTORIA * Math.cos(a), y: Y_EJE + R_TRAYECTORIA * Math.sin(a), ang: a + Math.PI / 2 };
}

function crearOruga(lado) {
  const z = lado * Z_ORUGA;
  const eslabones = new THREE.InstancedMesh(new THREE.BoxGeometry(paso * 0.82, 4, ANCHO_ORUGA), MATS.oruga, N_ESLABONES);
  const tacos = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 3.2, ANCHO_ORUGA * 0.86), MATS.taco, N_ESLABONES);
  for (const m of [eslabones, tacos]) { m.castShadow = true; m.receiveShadow = true; modelo.add(m); }

  // Ruedas dentadas delantera y trasera (aluminio con rayos y cubo ámbar)
  const ruedas = [];
  for (const x of [-X_RUEDA, X_RUEDA]) {
    const g = new THREE.Group();
    g.position.set(x, Y_EJE, z);
    const disco = sombra(new THREE.Mesh(new THREE.CylinderGeometry(R_RUEDA - 3, R_RUEDA - 3, ANCHO_ORUGA - 8, 28), MATS.oruga));
    disco.rotation.x = Math.PI / 2;
    g.add(disco);
    for (const cara of [-1, 1]) {
      const zc = cara * (ANCHO_ORUGA / 2 - 3);
      const aro = sombra(new THREE.Mesh(new THREE.TorusGeometry(R_RUEDA - 4, 2.2, 8, 32), MATS.rueda));
      aro.position.z = zc;
      g.add(aro);
      for (let k = 0; k < 8; k++) {
        const rayo = sombra(new THREE.Mesh(new THREE.BoxGeometry(R_RUEDA * 1.7, 3.2, 2), MATS.rueda));
        rayo.rotation.z = (k * Math.PI) / 8;
        rayo.position.z = zc;
        g.add(rayo);
      }
      const cubo = sombra(new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 4, 16), MATS.cubo));
      cubo.rotation.x = Math.PI / 2;
      cubo.position.z = zc + cara * 2;
      g.add(cubo);
    }
    modelo.add(g);
    ruedas.push(g);
  }
  // Rodillos de apoyo intermedios
  for (const x of [-X_RUEDA / 3, X_RUEDA / 3]) {
    const r = sombra(new THREE.Mesh(new THREE.CylinderGeometry(9, 9, ANCHO_ORUGA - 12, 16), MATS.oruga));
    r.rotation.x = Math.PI / 2;
    r.position.set(x, Y_EJE - R_TRAYECTORIA + 13, z);
    modelo.add(r);
  }

  const aux = new THREE.Object3D();
  function actualizar(recorridoMm) {
    for (let i = 0; i < N_ESLABONES; i++) {
      // Al avanzar, los eslabones de abajo se mueven hacia atrás respecto al cuerpo
      const p = puntoOruga(i * paso - recorridoMm);
      aux.position.set(p.x, p.y, z);
      aux.rotation.set(0, 0, p.ang);
      aux.updateMatrix();
      eslabones.setMatrixAt(i, aux.matrix);
      // Taco hacia afuera de la trayectoria
      aux.translateY(-3.4);
      aux.updateMatrix();
      tacos.setMatrixAt(i, aux.matrix);
    }
    eslabones.instanceMatrix.needsUpdate = true;
    tacos.instanceMatrix.needsUpdate = true;
    for (const g of ruedas) g.rotation.z = -recorridoMm / R_TRAYECTORIA;
  }
  actualizar(0);
  return actualizar;
}
// En el modelo, +X es el frente y +Z la izquierda… de la cámara; la oruga
// izquierda del robot queda en Z negativo (mirando hacia +X, la izquierda es -Z en Three).
const orugaIzq = crearOruga(-1);
const orugaDer = crearOruga(1);

// ------------------------------------------------------------------ ruta y hallazgos en 3D
const MAX_PUNTOS = 4000;
const geoRuta = new THREE.BufferGeometry();
geoRuta.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_PUNTOS * 3), 3));
geoRuta.setDrawRange(0, 0);
const ruta3d = new THREE.Line(geoRuta, new THREE.LineBasicMaterial({ color: 0xfca311, transparent: true, opacity: 0.85 }));
ruta3d.position.y = 0.003;
escena.add(ruta3d);
const grupoHallazgos = new THREE.Group();
escena.add(grupoHallazgos);

// Mundo del robot (x adelante, y izquierda) → Three (x, 0, -y)
const aMundo = (x, y) => new THREE.Vector3(x, 0, -y);

function pinHallazgo(h) {
  const color = new THREE.Color(COLOR_NIVEL[h.nivel] || COLOR_NIVEL[0]);
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, roughness: 0.4 });
  const poste = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.16, 8), m);
  poste.position.y = 0.08;
  const bola = sombra(new THREE.Mesh(new THREE.SphereGeometry(0.018, 20, 14), m));
  bola.position.y = 0.17;
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.025, 0.035, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.002;
  g.add(poste, bola, halo);
  g.position.copy(aMundo(h.pos_x, h.pos_y));
  return g;
}

// ------------------------------------------------------------------ estado
const real = { x: 0, y: 0, rumbo: 0, rec_izq: 0, rec_der: 0, v_izq: 0, v_der: 0, distancia: 0, paro: false };
const vista = { x: 0, y: 0, rumbo: 0, rec_izq: 0, rec_der: 0 };
let ruta = [];
let hallazgos = [];
let primeraPose = true;

function agregarPuntoRuta(x, y) {
  const u = ruta[ruta.length - 1];
  if (u && Math.hypot(x - u[0], y - u[1]) < 0.01) return;
  ruta.push([x, y]);
  if (ruta.length > MAX_PUNTOS) ruta = ruta.slice(-MAX_PUNTOS);
  pintarRuta3d();
}

function pintarRuta3d() {
  const pos = geoRuta.attributes.position;
  ruta.forEach(([px, py], i) => pos.setXYZ(i, px, 0, -py));
  pos.needsUpdate = true;
  geoRuta.setDrawRange(0, ruta.length);
  dibujarMapa();
}

function recibirOdometria(o) {
  Object.assign(real, o);
  if (primeraPose) {
    Object.assign(vista, { x: o.x, y: o.y, rumbo: o.rumbo, rec_izq: o.rec_izq, rec_der: o.rec_der });
    primeraPose = false;
    centrarVista();
  }
  agregarPuntoRuta(o.x, o.y);
  $("o-x").textContent = `${o.x.toFixed(2)} m`;
  $("o-y").textContent = `${o.y.toFixed(2)} m`;
  let grados = (o.rumbo * 180) / Math.PI;
  $("o-rumbo").textContent = `${grados.toFixed(0)}°`;
  $("o-dist").textContent = `${o.distancia.toFixed(2)} m`;
}
Robot.socket.on("odometria", recibirOdometria);

async function cargarGemelo() {
  const d = await Robot.api("/api/gemelo");
  // Ruta guardada en el robot (persiste aunque se recargue la página)
  ruta = (d.ruta || []).map((p) => [p[0], p[1]]);
  pintarRuta3d();
  recibirOdometria(d.odometria);
  hallazgos = d.hallazgos;
  grupoHallazgos.clear();
  hallazgos.forEach((h) => grupoHallazgos.add(pinHallazgo(h)));
  $("cuenta-hallazgos").textContent = `${hallazgos.length} en este recorrido`;
  $("tabla-hallazgos").innerHTML = hallazgos.length ? hallazgos.map((h) => `
    <tr><td style="font-family:var(--mono)">INS-${String(h.id).padStart(5, "0")}</td>
    <td>${escaparHTML(h.tablero)}</td><td>${fmtNum(h.delta_t)} °C</td>
    <td>${insigniaClasif(h.nivel, h.clasificacion)}</td>
    <td style="font-family:var(--mono)">${h.pos_x.toFixed(2)}, ${h.pos_y.toFixed(2)} m</td></tr>`).join("")
    : `<tr><td colspan="5" style="color:var(--tenue)">Aún no hay hallazgos desde el origen actual. Captura uno en <a href="/captura">Captura</a> y aparecerá aquí.</td></tr>`;
  dibujarMapa();
}
Robot.escuchar("nueva_inspeccion", cargarGemelo);
Robot.escuchar("conexion", (ok) => { if (ok) cargarGemelo(); });

$("btn-origen").addEventListener("click", async () => {
  if (!confirm("¿Tomar la posición actual del robot como el nuevo origen (0, 0)? Se borra la ruta dibujada.")) return;
  try {
    await Robot.api("/api/odometria/reiniciar", { method: "POST" });
    ruta = [];
    geoRuta.setDrawRange(0, 0);
    primeraPose = true;
    await cargarGemelo();
    Robot.aviso("Origen del mapa reiniciado.", "ok");
  } catch (e) { Robot.aviso(e.message, "error"); }
});

// ------------------------------------------------------------------ mapa 2D
const cvMapa = $("cv-mapa");
const ctx = cvMapa.getContext("2d");

function dibujarMapa() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cvMapa.clientWidth, h = cvMapa.clientHeight;
  if (!w || !h) return;
  if (cvMapa.width !== Math.round(w * dpr)) { cvMapa.width = Math.round(w * dpr); cvMapa.height = Math.round(h * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // Extensión: origen, ruta, hallazgos y robot (mínimo 1.2 m)
  const pts = [[0, 0], [real.x, real.y], ...ruta, ...hallazgos.map((k) => [k.pos_x, k.pos_y])];
  let x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0]));
  let y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const extension = Math.max(1.2, (x1 - x0) * 1.25 + 0.3, (y1 - y0) * 1.25 + 0.3);
  const escala = Math.min(w, h) / extension;            // px por metro
  // Mapa con el "adelante" inicial hacia arriba: x → arriba, y → izquierda
  const aPx = (x, y) => [w / 2 - (y - cy) * escala, h / 2 - (x - cx) * escala];

  // Cuadrícula
  const pasoM = extension > 6 ? 1 : extension > 3 ? 0.5 : 0.25;
  $("escala-mapa").textContent = `cuadrícula ${pasoM * 100} cm`;
  ctx.lineWidth = 1;
  const xmin = cx - extension, xmax = cx + extension, ymin = cy - extension, ymax = cy + extension;
  for (let v = Math.floor(xmin / pasoM) * pasoM; v <= xmax; v += pasoM) {
    const [, py] = aPx(v, 0);
    ctx.strokeStyle = Math.abs(v) < 1e-6 ? "#3a4b62" : "#18212c";
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
  }
  for (let v = Math.floor(ymin / pasoM) * pasoM; v <= ymax; v += pasoM) {
    const [px] = aPx(0, v);
    ctx.strokeStyle = Math.abs(v) < 1e-6 ? "#3a4b62" : "#18212c";
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
  }

  // Origen
  const [ox, oy] = aPx(0, 0);
  ctx.strokeStyle = "#fca311"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(ox, oy, 6, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "#8b98a9"; ctx.font = "11px ui-monospace, monospace";
  ctx.fillText("origen", ox + 9, oy + 4);

  // Ruta
  if (ruta.length > 1) {
    ctx.strokeStyle = "rgba(252,163,17,.85)"; ctx.lineWidth = 2; ctx.lineJoin = "round";
    ctx.beginPath();
    ruta.forEach(([x, y], i) => { const [px, py] = aPx(x, y); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.stroke();
  }

  // Hallazgos
  hallazgos.forEach((k) => {
    const [px, py] = aPx(k.pos_x, k.pos_y);
    ctx.fillStyle = COLOR_NIVEL[k.nivel] || COLOR_NIVEL[0];
    ctx.strokeStyle = "#0b0f14"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#e6edf3"; ctx.font = "600 11px system-ui, sans-serif";
    ctx.fillText(k.tablero, px + 10, py - 8);
  });

  // Robot (a escala, mínimo visible)
  const [rx, ry] = aPx(vista.x, vista.y);
  const largo = Math.max(16, 0.185 * escala), ancho = Math.max(17, 0.2 * escala);
  ctx.save();
  ctx.translate(rx, ry);
  ctx.rotate(-vista.rumbo);           // rumbo 0 = hacia arriba en el mapa
  ctx.fillStyle = "#17191d"; ctx.fillRect(-ancho / 2, -largo / 2, ancho * 0.18, largo); ctx.fillRect(ancho / 2 - ancho * 0.18, -largo / 2, ancho * 0.18, largo);
  ctx.fillStyle = "#fca311"; ctx.fillRect(-ancho * 0.3, -largo * 0.45, ancho * 0.6, largo * 0.9);
  ctx.fillStyle = "#0b0f14";
  ctx.beginPath(); ctx.moveTo(0, -largo * 0.42); ctx.lineTo(ancho * 0.16, -largo * 0.1); ctx.lineTo(-ancho * 0.16, -largo * 0.1); ctx.closePath(); ctx.fill();
  ctx.restore();
}
window.addEventListener("resize", dibujarMapa);

// ------------------------------------------------------------------ animación
let seguir = true;
$("chk-seguir").addEventListener("change", (e) => { seguir = e.target.checked; });
function centrarVista() {
  if (!controles) return;
  controles.target.set(vista.x, 0.04, -vista.y);
  camara.position.set(vista.x + 0.55, 0.42, -vista.y + 0.6);
}
$("btn-vista").addEventListener("click", centrarVista);

function ajustarTamano() {
  if (!renderer) return;
  const w = marco.clientWidth, h = marco.clientHeight;
  if (renderer.domElement.width !== Math.round(w * renderer.getPixelRatio()) ||
      renderer.domElement.height !== Math.round(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    camara.aspect = w / h;
    camara.updateProjectionMatrix();
  }
}

const reloj = new THREE.Clock();
let ultimoMapa = 0;
function animar() {
  requestAnimationFrame(animar);
  const dt = Math.min(0.1, reloj.getDelta());
  // Suavizado: la pose llega a 10 Hz, el dibujo va a 60 fps
  const k = 1 - Math.exp(-dt * 12);
  const prevX = vista.x, prevY = vista.y;
  vista.x += (real.x - vista.x) * k;
  vista.y += (real.y - vista.y) * k;
  let dA = real.rumbo - vista.rumbo;
  dA = Math.atan2(Math.sin(dA), Math.cos(dA));
  vista.rumbo += dA * k;
  vista.rec_izq += (real.rec_izq - vista.rec_izq) * k;
  vista.rec_der += (real.rec_der - vista.rec_der) * k;

  robot.position.copy(aMundo(vista.x, vista.y));
  robot.rotation.y = vista.rumbo;
  orugaIzq(vista.rec_izq * 1000);
  orugaDer(vista.rec_der * 1000);

  // LED: rojo en paro, azul en movimiento, verde en reposo
  const moviendo = Math.abs(real.v_izq) + Math.abs(real.v_der) > 0.01;
  MATS.led.emissive.setHex(real.paro ? COLORES.led.paro : moviendo ? COLORES.led.mov : COLORES.led.ok);
  MATS.led.emissiveIntensity = real.paro ? 1.5 + Math.sin(performance.now() / 120) : 2.2;

  // Sombra y cámara siguen al robot
  sol.position.set(robot.position.x + 1.2, 2.2, robot.position.z + 0.8);
  sol.target.position.copy(robot.position);
  if (controles) {
    if (seguir) {
      const d = aMundo(vista.x - prevX, vista.y - prevY);
      camara.position.add(d);
      controles.target.add(d);
      controles.target.lerp(new THREE.Vector3(robot.position.x, 0.04, robot.position.z), 0.05);
    }
    controles.update();
    ajustarTamano();
    renderer.render(escena, camara);
  }
  const ahora = performance.now();
  if (ahora - ultimoMapa > 100) { ultimoMapa = ahora; dibujarMapa(); }
}

// Acceso para depurar desde la consola del navegador
window.gemelo = { escena, camara, controles, real, vista };

crearPanelJoystick($("panel-joystick"));
cargarGemelo().catch((e) => Robot.aviso(e.message, "error"));
animar();
