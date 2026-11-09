"""Audio del micrófono de la webcam USB, transmitido a la interfaz web.

La captura se hace con ``arecord`` (paquete ``alsa-utils``, incluido en
Raspberry Pi OS) en PCM de 16 bits, mono, a 16 kHz (~32 KB/s). El micrófono
solo se abre mientras hay al menos un navegador escuchando; al cerrarse el
último se libera, así no se gasta CPU de la Pi sin necesidad.

Con ``dispositivo: auto`` se elige el primer dispositivo de captura de
``arecord -l`` cuyo nombre parezca una webcam/USB (si no, el primero que haya).

En simulación se genera un tono suave para probar la interfaz sin hardware.
"""

from __future__ import annotations

import logging
import math
import queue
import re
import shutil
import subprocess
import threading
import time

import numpy as np

log = logging.getLogger(__name__)

BYTES_POR_MUESTRA = 2  # PCM S16_LE
PALABRAS_WEBCAM = ("usb", "webcam", "camera", "cam", "c270", "c920", "c922", "logitech")


def listar_capturas(salida_arecord: str) -> list[tuple[str, str]]:
    """Convierte la salida de ``arecord -l`` en ``[(plughw:N,M, descripción)]``."""
    dispositivos = []
    for linea in salida_arecord.splitlines():
        m = re.match(r"^card (\d+): ([^,]*), device (\d+): (.*)$", linea.strip())
        if m:
            dispositivos.append((f"plughw:{m.group(1)},{m.group(3)}",
                                 f"{m.group(2).strip()} / {m.group(4).strip()}"))
    return dispositivos


def elegir_dispositivo(dispositivos: list[tuple[str, str]]) -> tuple[str, str] | None:
    """Prefiere el micrófono de la webcam (USB); si no hay, el primero."""
    for disp in dispositivos:
        if any(p in disp[1].lower() for p in PALABRAS_WEBCAM):
            return disp
    return dispositivos[0] if dispositivos else None


class FuenteAudio:
    """Origen de audio: entrega bloques PCM S16_LE mono de ``bloque_ms``."""

    nombre = "audio"
    disponible = True
    detalle = ""

    def __init__(self, tasa_hz: int = 16000, bloque_ms: int = 100):
        self.tasa_hz = int(tasa_hz)
        self.bytes_bloque = int(self.tasa_hz * bloque_ms / 1000) * BYTES_POR_MUESTRA

    def abrir(self) -> None:
        pass

    def leer_bloque(self) -> bytes | None:
        raise NotImplementedError

    def cerrar(self) -> None:
        pass

    def estado(self) -> dict:
        return {"nombre": self.nombre, "disponible": self.disponible, "detalle": self.detalle}


class AudioArecord(FuenteAudio):
    """Micrófono real leído con ``arecord``."""

    nombre = "Micrófono de la webcam (ALSA)"

    def __init__(self, dispositivo: str = "auto", tasa_hz: int = 16000, bloque_ms: int = 100):
        super().__init__(tasa_hz, bloque_ms)
        self._proc: subprocess.Popen | None = None
        self.dispositivo = None
        if not shutil.which("arecord"):
            self.disponible = False
            self.detalle = "Falta arecord (sudo apt install alsa-utils)"
            return
        if dispositivo and dispositivo != "auto":
            self.dispositivo = dispositivo
            self.detalle = dispositivo
            return
        try:
            salida = subprocess.run(["arecord", "-l"], capture_output=True, text=True,
                                    timeout=5).stdout
        except (OSError, subprocess.SubprocessError) as e:
            self.disponible = False
            self.detalle = f"No se pudo ejecutar arecord: {e}"
            return
        elegido = elegir_dispositivo(listar_capturas(salida))
        if elegido is None:
            self.disponible = False
            self.detalle = "No se encontró ningún micrófono (arecord -l)"
        else:
            self.dispositivo, desc = elegido
            self.detalle = f"{desc} ({self.dispositivo}), {self.tasa_hz} Hz mono"
        log.info("Audio: %s", self.detalle)

    def abrir(self) -> None:
        if not self.disponible or self._proc is not None:
            return
        self._proc = subprocess.Popen(
            ["arecord", "-q", "-D", self.dispositivo, "-f", "S16_LE", "-r", str(self.tasa_hz),
             "-c", "1", "-t", "raw"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0)

    def leer_bloque(self) -> bytes | None:
        proc = self._proc
        if proc is None or proc.stdout is None:
            return None
        datos = proc.stdout.read(self.bytes_bloque)
        if not datos:
            error = proc.stderr.read().decode(errors="replace").strip() if proc.stderr else ""
            log.warning("arecord terminó: %s", error or f"código {proc.poll()}")
            if error:
                self.detalle = f"arecord: {error[:160]}"
            return None
        return datos

    def cerrar(self) -> None:
        proc, self._proc = self._proc, None
        if proc is not None:
            proc.terminate()
            try:
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:  # pragma: no cover
                proc.kill()


class AudioSimulado(FuenteAudio):
    """Tono suave intermitente (440 Hz) para probar la interfaz sin micrófono."""

    nombre = "Audio simulado"
    detalle = "Tono de prueba 440 Hz"

    def __init__(self, tasa_hz: int = 16000, bloque_ms: int = 100):
        super().__init__(tasa_hz, bloque_ms)
        self._n = 0
        self._t = None

    def abrir(self) -> None:
        self._t = time.monotonic()

    def leer_bloque(self) -> bytes | None:
        muestras = self.bytes_bloque // BYTES_POR_MUESTRA
        # Ritmo de tiempo real
        self._t = (self._t or time.monotonic()) + muestras / self.tasa_hz
        espera = self._t - time.monotonic()
        if espera > 0:
            time.sleep(espera)
        idx = np.arange(self._n, self._n + muestras)
        self._n += muestras
        envolvente = (np.sin(2 * math.pi * 0.5 * idx / self.tasa_hz) > 0).astype(np.float32)
        senal = 0.15 * envolvente * np.sin(2 * math.pi * 440 * idx / self.tasa_hz)
        return (senal * 32767).astype("<i2").tobytes()


class TransmisorAudio:
    """Reparte el audio de una fuente a varios oyentes (navegadores).

    La fuente se abre con el primer oyente y se cierra con el último. Cada
    oyente tiene una cola corta: si se atrasa, se descartan los bloques viejos
    para mantener la latencia baja.
    """

    MAX_BLOQUES_COLA = 8  # ~0.8 s

    def __init__(self, fuente: FuenteAudio):
        self.fuente = fuente
        self._oyentes: set[queue.Queue] = set()
        self._bloqueo = threading.Lock()
        self._hilo: threading.Thread | None = None

    @property
    def disponible(self) -> bool:
        return self.fuente.disponible

    @property
    def oyentes(self) -> int:
        with self._bloqueo:
            return len(self._oyentes)

    def suscribir(self) -> queue.Queue:
        cola: queue.Queue = queue.Queue(maxsize=self.MAX_BLOQUES_COLA)
        with self._bloqueo:
            self._oyentes.add(cola)
            if self._hilo is None or not self._hilo.is_alive():
                self._hilo = threading.Thread(target=self._bucle, name="audio", daemon=True)
                self._hilo.start()
        return cola

    def desuscribir(self, cola: queue.Queue) -> None:
        with self._bloqueo:
            self._oyentes.discard(cola)

    def _bucle(self) -> None:
        try:
            self.fuente.abrir()
        except Exception as e:
            log.error("No se pudo abrir el audio: %s", e)
            self._terminar()
            return
        while True:
            with self._bloqueo:
                if not self._oyentes:
                    # Se cierra con el bloqueo tomado para que un oyente nuevo
                    # no abra la fuente mientras esta se está cerrando
                    self.fuente.cerrar()
                    self._hilo = None
                    return
            bloque = self.fuente.leer_bloque()
            if bloque is None:
                self._terminar()
                return
            with self._bloqueo:
                oyentes = list(self._oyentes)
            for cola in oyentes:
                if cola.full():
                    try:
                        cola.get_nowait()
                    except queue.Empty:
                        pass
                try:
                    cola.put_nowait(bloque)
                except queue.Full:
                    pass

    def _terminar(self) -> None:
        """Cierra la fuente y avisa a los oyentes que terminó (bloque ``None``)."""
        with self._bloqueo:
            self.fuente.cerrar()
            oyentes = list(self._oyentes)
            self._oyentes.clear()
            self._hilo = None
        for cola in oyentes:
            try:
                cola.put_nowait(None)
            except queue.Full:
                try:
                    cola.get_nowait()
                    cola.put_nowait(None)
                except (queue.Empty, queue.Full):
                    pass

    def cerrar(self) -> None:
        self._terminar()


def crear_audio(cfg_audio: dict, simulacion: bool) -> FuenteAudio:
    tasa = int(cfg_audio.get("tasa_hz", 16000))
    if not cfg_audio.get("habilitado", True):
        fuente = FuenteAudio(tasa)
        fuente.nombre, fuente.disponible, fuente.detalle = "Audio", False, "Deshabilitado en config.yaml"
        return fuente
    if simulacion:
        return AudioSimulado(tasa)
    return AudioArecord(cfg_audio.get("dispositivo", "auto"), tasa)
