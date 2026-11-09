/* ==========================================================================
   en_vivo.js — Página de inspección en vivo.
   ========================================================================== */
"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  let paletaActual = "ironbow";

  // ------------------------------------------------------------ Vistas térmicas
  const vista = new VistaTermica($("cv-termico"), {
    alCursor: (p) => { $("t-cursor").textContent = p ? fmtTemp(p.t) : "—"; },
  });
  const vistaSup = new VistaTermica($("cv-superpuesto"), {
    alCursor: (p) => { $("t-cursor").textContent = p ? fmtTemp(p.t) : "—"; },
  });

  function aplicarPaleta(nombre) {
    paletaActual = nombre;
    vista.paleta = nombre;
    vistaSup.paleta = nombre;
    $("sel-paleta").value = nombre;
  }

  Robot.escuchar("paletas", (paletas) => {
    const sel = $("sel-paleta");
    sel.innerHTML = Object.entries(paletas).map(([k, p]) => `<option value="${k}">${p.nombre}</option>`).join("");
    vista.fijarPaletas(paletas);
    vistaSup.fijarPaletas(paletas);
    aplicarPaleta(Robot.estado.config["interfaz.paleta"] || "ironbow");
  });
  Robot.escuchar("config", (cfg) => {
    posicionarSuperpuesto($("cv-superpuesto"), cfg);
    pintarTablaCriterio($("tabla-criterio"), cfg, null);
  });
  $("sel-paleta").addEventListener("change", (e) => aplicarPaleta(e.target.value));

  // ------------------------------------------------------------ Superposición
  const chkSup = $("chk-superponer"), rngOp = $("rng-opacidad");
  function actualizarSuperposicion() {
    $("cv-superpuesto").hidden = !chkSup.checked;
    $("cv-superpuesto").style.opacity = rngOp.value / 100;
    $("ctl-opacidad").style.opacity = chkSup.checked ? 1 : 0.45;
    try { localStorage.setItem("superponer", JSON.stringify({ on: chkSup.checked, op: rngOp.value })); } catch (_) {}
  }
  try {
    const g = JSON.parse(localStorage.getItem("superponer") || "null");
    if (g) { chkSup.checked = g.on; rngOp.value = g.op; }
  } catch (_) {}
  chkSup.addEventListener("change", actualizarSuperposicion);
  rngOp.addEventListener("input", actualizarSuperposicion);
  actualizarSuperposicion();

  // ------------------------------------------------------------ Rango fijo
  const chkRango = $("chk-rango");
  function actualizarRango() {
    $("fila-rango").hidden = !chkRango.checked;
    if (chkRango.checked) {
      const min = Number($("rango-min").value), max = Number($("rango-max").value);
      vista.rangoManual = vistaSup.rangoManual = max > min ? { min, max } : null;
    } else {
      vista.rangoManual = vistaSup.rangoManual = null;
    }
  }
  chkRango.addEventListener("change", actualizarRango);
  $("rango-min").addEventListener("input", actualizarRango);
  $("rango-max").addEventListener("input", actualizarRango);

  // ------------------------------------------------------------ Datos térmicos
  let ultimoTermico = 0;
  Robot.escuchar("termico", (t) => {
    ultimoTermico = Date.now();
    vista.actualizar(t);
    if (chkSup.checked) vistaSup.actualizar(t);
    $("sin-termico").hidden = true;
    $("t-max").textContent = fmtTemp(t.t_max);
    $("t-min").textContent = fmtTemp(t.t_min);
    $("t-med").textContent = fmtTemp(t.t_mediana);
    $("fps-termico").textContent = `${fmtNum(t.fps, 1)} Hz`;
    dibujarEscala($("cv-escala"), Robot.estado.paletas, paletaActual, vista.rango.min, vista.rango.max);

    const dt = t.t_max - t.t_mediana;
    const c = clasificarDeltaT(dt, Robot.estado.config);
    $("tarjeta-dt").style.setProperty("--c", c.color);
    $("dt-valor").textContent = `${dt.toFixed(1)} °C`;
    $("dt-clasif").innerHTML = insigniaClasif(c.nivel);
    pintarTablaCriterio($("tabla-criterio"), Robot.estado.config, c.nivel);
  });
  setInterval(() => {
    if (Date.now() - ultimoTermico > 3000) $("sin-termico").hidden = false;
  }, 1000);

  // ------------------------------------------------------------ Video (reconexión)
  const video = $("video");
  video.addEventListener("error", () => setTimeout(() => { video.src = "/video.mjpg?t=" + Date.now(); }, 1500));
  Robot.escuchar("conexion", (ok) => { if (ok) video.src = "/video.mjpg?t=" + Date.now(); });

  // ------------------------------------------------------------ Audio de la webcam
  // /audio.pcm entrega PCM de 16 bits mono sin cabecera; se reproduce con Web Audio
  // programando cada bloque justo después del anterior (latencia ~0.3 s).
  const audio = { ctx: null, ganancia: null, abortar: null, siguiente: 0 };
  const btnAudio = $("btn-audio");

  function volumen() { return Number($("rng-volumen").value) / 100; }
  $("rng-volumen").addEventListener("input", () => { if (audio.ganancia) audio.ganancia.gain.value = volumen(); });

  function pintarBotonAudio(activo) {
    btnAudio.textContent = activo ? "🔊 Silenciar" : "🔇 Escuchar";
    btnAudio.classList.toggle("btn-primario", activo);
    $("ctl-volumen").hidden = !activo;
  }

  function detenerAudio() {
    if (audio.abortar) audio.abortar.abort();
    if (audio.ctx) audio.ctx.close().catch(() => {});
    audio.ctx = audio.ganancia = audio.abortar = null;
    pintarBotonAudio(false);
  }

  function reproducirBloque(bytes, tasa) {
    const n = bytes.length >> 1;
    if (!n) return;
    const vista = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
    const buf = audio.ctx.createBuffer(1, n, tasa);
    const canal = buf.getChannelData(0);
    for (let i = 0; i < n; i++) canal[i] = vista.getInt16(i * 2, true) / 32768;
    const fuente = audio.ctx.createBufferSource();
    fuente.buffer = buf;
    fuente.connect(audio.ganancia);
    const ahora = audio.ctx.currentTime;
    // Si nos atrasamos (o adelantamos de más) se reinicia la cola para no acumular retraso
    if (audio.siguiente < ahora + 0.05 || audio.siguiente > ahora + 0.8) audio.siguiente = ahora + 0.15;
    fuente.start(audio.siguiente);
    audio.siguiente += buf.duration;
  }

  async function iniciarAudio() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx || !window.ReadableStream) {
      Robot.aviso("Este navegador no puede reproducir el audio en vivo.", "error");
      return;
    }
    audio.ctx = new Ctx();
    audio.ganancia = audio.ctx.createGain();
    audio.ganancia.gain.value = volumen();
    audio.ganancia.connect(audio.ctx.destination);
    audio.siguiente = 0;
    audio.abortar = new AbortController();
    pintarBotonAudio(true);
    const ctxActual = audio.ctx;
    try {
      const r = await fetch("/audio.pcm?t=" + Date.now(), { signal: audio.abortar.signal, cache: "no-store" });
      if (!r.ok) {
        let msg = "Audio no disponible";
        try { msg = (await r.json()).error || msg; } catch (_) { /* sin JSON */ }
        throw new Error(msg);
      }
      const tasa = Number(r.headers.get("X-Audio-Tasa")) || 16000;
      const lector = r.body.getReader();
      let resto = null;  // byte suelto si un bloque llega partido a la mitad de una muestra
      for (;;) {
        const { value, done } = await lector.read();
        if (done) throw new Error("Se cortó el audio del robot");
        let datos = value;
        if (resto) { datos = new Uint8Array(resto.length + value.length); datos.set(resto); datos.set(value, resto.length); resto = null; }
        if (datos.length & 1) { resto = datos.slice(-1); datos = datos.subarray(0, datos.length - 1); }
        reproducirBloque(datos, tasa);
      }
    } catch (err) {
      if (audio.ctx !== ctxActual) return;  // el usuario lo detuvo
      detenerAudio();
      Robot.aviso(err.message || "Error de audio", "error");
    }
  }

  btnAudio.addEventListener("click", () => { if (audio.ctx) detenerAudio(); else iniciarAudio(); });

  // ------------------------------------------------------------ Control y telemetría
  crearPanelJoystick($("panel-joystick"));

  function barra(id, v, vmax) {
    const el = $(id);
    const f = Math.max(-1, Math.min(1, v / (vmax || 0.3)));
    el.style.width = `${Math.abs(f) * 50}%`;
    el.style.left = f >= 0 ? "50%" : `${50 - Math.abs(f) * 50}%`;
    el.classList.toggle("neg", f < 0);
  }
  Robot.escuchar("estado", (e) => {
    pintarSensores($("sensores"), e.ambiente);
    const vmax = e.velocidad_maxima * (e.factor_velocidad ?? 1);
    barra("bar-izq", e.v_izq, vmax); barra("bar-der", e.v_der, vmax);
    barra("bar-ref-izq", e.ref_izq, vmax); barra("bar-ref-der", e.ref_der, vmax);
    $("val-izq").textContent = `${fmtNum(e.v_izq, 2)} m/s`;
    $("val-der").textContent = `${fmtNum(e.v_der, 2)} m/s`;
    $("val-ref-izq").textContent = `${fmtNum(e.ref_izq, 2)} m/s`;
    $("val-ref-der").textContent = `${fmtNum(e.ref_der, 2)} m/s`;
    $("d-vmax").textContent = e.factor_velocidad < 1
      ? `${fmtNum(vmax, 2)} m/s (reducida al ${Math.round(e.factor_velocidad * 100)} %)`
      : `${fmtNum(vmax, 2)} m/s`;
    $("d-lazo").textContent = e.lazo_cerrado ? "Lazo cerrado (PI + encoders)" : "Lazo abierto";
    $("d-duty").textContent = `${Math.round(e.duty_izq * 100)} % / ${Math.round(e.duty_der * 100)} %`;
    $("d-paro").textContent = e.ultimo_paro || "—";
    $("estado-motores").innerHTML = !e.motores_ok
      ? '<span class="estado-comp" style="--c:var(--peligro)">Motores no disponibles</span>'
      : e.paro_emergencia
        ? '<span class="estado-comp" style="--c:var(--peligro)">Bloqueado por paro</span>'
        : e.bloqueo
          ? `<span class="estado-comp" style="--c:var(--peligro)">Alarma de gas: ${e.bloqueo === "total" ? "movimiento bloqueado" : "solo retroceso"}</span>`
          : '<span class="estado-comp" style="--c:var(--ok)">Listo</span>';
  });
})();
