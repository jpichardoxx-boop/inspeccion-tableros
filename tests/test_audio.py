"""Audio del micrófono de la webcam."""

import queue

from robot.drivers.audio import (AudioSimulado, FuenteAudio, TransmisorAudio, crear_audio,
                                 elegir_dispositivo, listar_capturas)

ARECORD_L = """**** List of CAPTURE Hardware Devices ****
card 1: Device [USB PnP Sound Device], device 0: USB Audio [USB Audio]
  Subdevices: 1/1
  Subdevice #0: subdevice #0
card 2: C270 [HD Webcam C270], device 0: USB Audio [USB Audio]
  Subdevices: 1/1
"""


def test_listar_y_elegir_microfono_de_webcam():
    dispositivos = listar_capturas(ARECORD_L)
    assert [d[0] for d in dispositivos] == ["plughw:1,0", "plughw:2,0"]
    assert elegir_dispositivo(dispositivos)[0] == "plughw:1,0"  # primero con "USB"
    assert elegir_dispositivo([("plughw:0,0", "Algo / Otro")])[0] == "plughw:0,0"
    assert elegir_dispositivo([]) is None


def test_crear_audio_segun_config():
    assert isinstance(crear_audio({}, simulacion=True), AudioSimulado)
    apagado = crear_audio({"habilitado": False}, simulacion=True)
    assert not apagado.disponible


class _FuenteContada(FuenteAudio):
    def __init__(self):
        super().__init__(16000, 10)
        self.abierta = 0
        self.cerrada = 0

    def abrir(self):
        self.abierta += 1

    def leer_bloque(self):
        import time
        time.sleep(0.01)
        return b"\x01\x00" * (self.bytes_bloque // 2)

    def cerrar(self):
        self.cerrada += 1


def test_transmisor_abre_con_oyentes_y_cierra_sin_ellos():
    import time

    fuente = _FuenteContada()
    tx = TransmisorAudio(fuente)
    cola = tx.suscribir()
    assert cola.get(timeout=2)[:2] == b"\x01\x00"
    assert fuente.abierta == 1 and tx.oyentes == 1
    tx.desuscribir(cola)
    limite = time.monotonic() + 2
    while fuente.cerrada == 0 and time.monotonic() < limite:
        time.sleep(0.02)
    assert fuente.cerrada == 1
    # Se vuelve a abrir con un oyente nuevo
    cola = tx.suscribir()
    assert cola.get(timeout=2)
    assert fuente.abierta == 2
    tx.cerrar()


def test_transmisor_avisa_fin_si_la_fuente_falla():
    class Muda(FuenteAudio):
        def leer_bloque(self):
            return None

    tx = TransmisorAudio(Muda())
    cola = tx.suscribir()
    assert cola.get(timeout=2) is None


def test_endpoint_audio_entrega_pcm(robot_sim):
    from robot.web.app import crear_app

    app, _ = crear_app(robot_sim)
    r = app.test_client().get("/audio.pcm")
    assert r.status_code == 200
    assert r.headers["X-Audio-Tasa"] == "16000"
    trozo = next(iter(r.response))
    assert len(trozo) == 3200  # 100 ms a 16 kHz, 16 bits
    r.close()
    assert "audio" in robot_sim.diagnostico()["componentes"]


def test_endpoint_audio_503_sin_microfono(robot_sim):
    from robot.web.app import crear_app

    fuente = FuenteAudio()
    fuente.disponible, fuente.detalle = False, "No se encontró ningún micrófono"
    original = robot_sim.audio
    robot_sim.audio = TransmisorAudio(fuente)
    try:
        app, _ = crear_app(robot_sim)
        r = app.test_client().get("/audio.pcm")
        assert r.status_code == 503
        assert "micrófono" in r.get_json()["error"]
    finally:
        robot_sim.audio = original
