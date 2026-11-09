/* ==========================================================================
   captura.js — Captura de hallazgos con clasificación ΔT.
   ========================================================================== */
"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  let modoRef = "mediana";
  let puntoRef = null;           // {fila, col}
  let congelado = false;
  let ultimo = null;

  const vista = new VistaTermica($("cv-termico"), {
    alCursor: (p) => { $("t-cursor").textContent = p ? fmtTemp(p.t) : "—"; },
    alClic: (fila, col) => {
      puntoRef = { fila, col };
      seleccionarModo("punto");
      vista.referencia = puntoRef;
      vista.dibujar();
      recalcular();
    },
  });
  $("cv-termico").parentElement.classList.add("marco-clic");

  Robot.escuchar("paletas", (p) => {
    vista.fijarPaletas(p);
    vista.paleta = Robot.estado.config["interfaz.paleta"] || "ironbow";
  });
  Robot.escuchar("config", (cfg) => {
    vista.paleta = cfg["interfaz.paleta"] || "ironbow";
    if (!puntoRef && modoRef === "mediana") seleccionarModo(cfg["analisis.referencia_por_defecto"] === "manual" ? "manual" : "mediana");
    recalcular();
  });

  // ------------------------------------------------------------ Referencia
  function seleccionarModo(modo) {
    modoRef = modo;
    document.querySelectorAll('input[name="ref"]').forEach((r) => { r.checked = r.value === modo; });
    $("campo-manual").hidden = modo !== "manual";
    const ayudas = {
      mediana: "La mediana del cuadro representa la temperatura de los componentes sanos.",
      punto: puntoRef ? `Punto seleccionado: fila ${puntoRef.fila + 1}, columna ${puntoRef.col + 1} (promedio 3×3).`
        : "Haz clic o toca el termograma sobre un componente similar sano.",
      manual: "Escribe la temperatura de un componente similar bajo carga similar.",
    };
    $("ayuda-ref").textContent = ayudas[modo];
    $("ayuda-clic").textContent = modo === "punto" ? "Toca un componente de referencia" : `Referencia: ${{ mediana: "mediana del cuadro", manual: "valor manual" }[modo]}`;
    $("dt-metodo").textContent = { mediana: "Mediana", punto: "Punto", manual: "Manual" }[modo];
    vista.referencia = modo === "punto" ? puntoRef : null;
    vista.dibujar();
    recalcular();
  }
  document.querySelectorAll('input[name="ref"]').forEach((r) => r.addEventListener("change", () => seleccionarModo(r.value)));
  $("ref-manual").addEventListener("input", recalcular);

  function temperaturaReferencia() {
    if (!ultimo) return null;
    if (modoRef === "punto") return puntoRef ? vista.promedioVecindad(puntoRef.fila, puntoRef.col) : null;
    if (modoRef === "manual") { const v = parseFloat($("ref-manual").value); return Number.isFinite(v) ? v : null; }
    return ultimo.t_mediana;
  }

  function recalcular() {
    if (!ultimo) return;
    const ref = temperaturaReferencia();
    $("t-ref").textContent = fmtTemp(ref);
    $("dt-max").textContent = fmtTemp(ultimo.t_max);
    $("dt-ref").textContent = fmtTemp(ref);
    if (ref == null) {
      $("dt-valor").textContent = "—";
      $("dt-clasif").innerHTML = "";
      $("tarjeta-dt").style.removeProperty("--c");
      pintarTablaCriterio($("tabla-criterio"), Robot.estado.config, null);
      return;
    }
    const dt = ultimo.t_max - ref;
    const c = clasificarDeltaT(dt, Robot.estado.config);
    $("dt-valor").textContent = `${dt.toFixed(1)} °C`;
    $("dt-clasif").innerHTML = insigniaClasif(c.nivel);
    $("tarjeta-dt").style.setProperty("--c", c.color);
    pintarTablaCriterio($("tabla-criterio"), Robot.estado.config, c.nivel);
  }

  // ------------------------------------------------------------ Térmico en vivo
  Robot.escuchar("termico", (t) => {
    $("fps-termico").textContent = `${fmtNum(t.fps, 1)} Hz`;
    if (congelado) return;
    ultimo = t;
    vista.actualizar(t);
    $("t-max").textContent = fmtTemp(t.t_max);
    $("t-min").textContent = fmtTemp(t.t_min);
    dibujarEscala($("cv-escala"), Robot.estado.paletas, vista.op.paleta, vista.rango.min, vista.rango.max);
    recalcular();
  });

  $("btn-congelar").addEventListener("click", () => {
    congelado = !congelado;
    $("btn-congelar").textContent = congelado ? "Reanudar" : "Congelar";
    $("btn-congelar").classList.toggle("btn-primario", congelado);
  });

  // ------------------------------------------------------------ Tableros conocidos
  async function cargarTableros() {
    try {
      const tableros = await Robot.api("/api/tableros");
      $("lista-tableros").innerHTML = tableros.map((t) => `<option value="${escaparHTML(t.codigo)}">${escaparHTML(t.ubicacion || "")}</option>`).join("");
      $("tablero").addEventListener("change", () => {
        const t = tableros.find((x) => x.codigo === $("tablero").value);
        if (t && t.ubicacion && !$("ubicacion").value) $("ubicacion").value = t.ubicacion;
      });
    } catch (_) { /* sin tableros aún */ }
  }
  cargarTableros();

  // ------------------------------------------------------------ Captura
  $("form-captura").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const tablero = $("tablero").value.trim();
    if (!tablero) { Robot.aviso("Escribe el nombre o ID del tablero.", "aviso"); $("tablero").focus(); return; }
    if (modoRef === "punto" && !puntoRef) { Robot.aviso("Toca el termograma para elegir el punto de referencia.", "aviso"); return; }
    const referencia = { modo: modoRef };
    if (modoRef === "punto") { referencia.fila = puntoRef.fila; referencia.columna = puntoRef.col; }
    if (modoRef === "manual") referencia.valor = parseFloat($("ref-manual").value);

    const btn = $("btn-capturar");
    btn.disabled = true;
    try {
      const datos = { tablero, ubicacion: $("ubicacion").value.trim(), notas: $("notas").value, referencia };
      // Si la imagen está congelada se guarda exactamente ese cuadro
      if (congelado && ultimo) datos.matriz = ultimo.datos;
      const r = await Robot.api("/api/capturar", { json: datos });
      mostrarResultado(r.inspeccion);
      Robot.aviso(`Hallazgo INS-${String(r.inspeccion.id).padStart(5, "0")} guardado.`, "ok");
      $("notas").value = "";
      cargarTableros();
    } catch (e) {
      Robot.aviso(e.message, "error");
    } finally {
      btn.disabled = false;
    }
  });

  function mostrarResultado(i) {
    const folio = `INS-${String(i.id).padStart(5, "0")}`;
    const imgVis = i.img_visible ? `<img src="/capturas/${i.img_visible}" alt="Imagen visible">` : "";
    $("resultado").hidden = false;
    $("resultado").innerHTML = `
      <div class="tarjeta-dt" style="--c:${CLASIFICACIONES[i.nivel].color}">
        <div class="dt-fila"><b>${folio} · ${escaparHTML(i.tablero)}</b>${insigniaClasif(i.nivel, i.clasificacion)}</div>
        <div class="imgs">${imgVis}<img src="/capturas/${i.img_termica}" alt="Termograma"></div>
        <div class="dt-detalle">
          <div>T máx<b>${fmtTemp(i.t_max)}</b></div>
          <div>T ref.<b>${fmtTemp(i.t_referencia)}</b></div>
          <div>ΔT<b>${fmtTemp(i.delta_t)}</b></div>
        </div>
        <div class="acciones" style="margin-top:12px">
          <a class="btn btn-primario btn-chico" href="/api/inspecciones/${i.id}/pdf" target="_blank" rel="noopener">Reporte PDF</a>
          <a class="btn btn-chico" href="/reporte?id=${i.id}">Ver en Reporte</a>
          <a class="btn btn-chico" href="/api/inspecciones/${i.id}/matriz.csv">Matriz CSV</a>
          <a class="btn btn-chico" href="/historial?tablero=${encodeURIComponent(i.tablero)}">Historial</a>
        </div>
      </div>`;
    $("resultado").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  crearPanelJoystick($("panel-joystick"));

  // ------------------------------------------------------------ Lector de códigos QR
  // Cada ~1.2 s se pregunta al robot si la webcam ve la etiqueta QR de un
  // tablero. Al leer uno nuevo se llenan "tablero" y "ubicación".
  const cvQR = $("cv-qr");
  const ctxQR = cvQR.getContext("2d");
  let ultimoQR = null;
  let consultando = false;

  function dibujarQR(qr) {
    const w = cvQR.clientWidth, h = cvQR.clientHeight;
    if (cvQR.width !== w || cvQR.height !== h) { cvQR.width = w; cvQR.height = h; }
    ctxQR.clearRect(0, 0, w, h);
    if (!qr || !qr.puntos || qr.puntos.length < 4) return;
    ctxQR.strokeStyle = "#2ecc71"; ctxQR.lineWidth = 3; ctxQR.lineJoin = "round";
    ctxQR.beginPath();
    qr.puntos.forEach(([x, y], i) => (i ? ctxQR.lineTo(x * w, y * h) : ctxQR.moveTo(x * w, y * h)));
    ctxQR.closePath(); ctxQR.stroke();
    const [x0, y0] = qr.puntos[0];
    ctxQR.font = "600 13px system-ui, sans-serif";
    const etiqueta = `QR ${qr.codigo}`;
    const ancho = ctxQR.measureText(etiqueta).width + 10;
    ctxQR.fillStyle = "#2ecc71"; ctxQR.fillRect(x0 * w, Math.max(0, y0 * h - 22), ancho, 20);
    ctxQR.fillStyle = "#06120a"; ctxQR.fillText(etiqueta, x0 * w + 5, Math.max(14, y0 * h - 7));
  }

  function estadoLector(estado, texto) {
    $("lector-qr").dataset.estado = estado;
    $("texto-qr").textContent = texto;
  }

  function destellar(el) { el.classList.remove("destello"); void el.offsetWidth; el.classList.add("destello"); }

  async function consultarQR() {
    if (consultando || document.hidden || !$("chk-qr").checked) return;
    consultando = true;
    try {
      const { qr } = await Robot.api("/api/qr");
      dibujarQR(qr);
      if (!qr) {
        if (!ultimoQR) estadoLector("buscando", "Lector QR: apunta la webcam a la etiqueta del tablero");
        return;
      }
      if (qr.texto !== ultimoQR) {
        ultimoQR = qr.texto;
        $("tablero").value = qr.codigo;
        destellar($("tablero"));
        if (qr.ubicacion) { $("ubicacion").value = qr.ubicacion; destellar($("ubicacion")); }
        Robot.aviso(`Tablero ${qr.codigo} identificado por código QR.`, "ok");
      }
      estadoLector("leido", `QR leído: ${qr.codigo}${qr.ubicacion ? " · " + qr.ubicacion : ""}`);
    } catch (_) {
      /* sin conexión: se reintenta en el siguiente ciclo */
    } finally {
      consultando = false;
    }
  }
  $("chk-qr").addEventListener("change", (e) => {
    if (e.target.checked) { ultimoQR = null; estadoLector("buscando", "Lector QR: apunta la webcam a la etiqueta del tablero"); consultarQR(); }
    else { dibujarQR(null); estadoLector("apagado", "Lector QR apagado: escribe el tablero a mano"); }
  });
  setInterval(consultarQR, 1200);
  consultarQR();
})();
