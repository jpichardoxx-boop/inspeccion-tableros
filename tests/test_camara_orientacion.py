"""Volteo de la cámara visible (espejo en X / Y)."""

import numpy as np

from robot.drivers.base import DriverCamaraVisible
from robot.drivers.camara_visible import CamaraOrientada, orientar_cuadro


class _CamaraFija(DriverCamaraVisible):
    nombre = "fija"

    def __init__(self, cuadro):
        self.cuadro = cuadro
        self.detalle = "prueba"
        self.cerrada = False

    def leer_cuadro(self):
        return self.cuadro

    def cerrar(self):
        self.cerrada = True


def _cuadro():
    return np.arange(2 * 3 * 3, dtype=np.uint8).reshape(2, 3, 3)


def test_sin_volteo_devuelve_igual():
    c = _cuadro()
    assert orientar_cuadro(c) is c


def test_espejo_horizontal_invierte_columnas():
    c = _cuadro()
    r = orientar_cuadro(c, espejo_horizontal=True)
    assert np.array_equal(r[:, 0], c[:, -1])
    assert r.flags["C_CONTIGUOUS"]


def test_espejo_vertical_invierte_filas():
    c = _cuadro()
    assert np.array_equal(orientar_cuadro(c, espejo_vertical=True)[0], c[-1])


def test_ambos_equivale_a_rotar_180():
    c = _cuadro()
    assert np.array_equal(orientar_cuadro(c, True, True), np.rot90(c, 2))


def test_camara_orientada_envuelve_y_cierra():
    base = _CamaraFija(_cuadro())
    cam = CamaraOrientada(base, espejo_horizontal=True)
    assert np.array_equal(cam.leer_cuadro()[:, 0], base.cuadro[:, -1])
    assert "espejo X" in cam.detalle
    cam.cerrar()
    assert base.cerrada


# --- Orientación configurable desde la interfaz ------------------------------

def test_orientacion_termica_combina_rotar_180():
    from robot.logica.robot import orientacion_termica

    assert orientacion_termica({}) == (False, False)
    assert orientacion_termica({"espejo_vertical": True}) == (False, True)
    assert orientacion_termica({"rotar_180": True}) == (True, True)
    # rotar 180° + espejo X = solo espejo Y
    assert orientacion_termica({"rotar_180": True, "espejo_horizontal": True}) == (False, True)


def test_volteo_editable_desde_api_y_aplicado_en_vivo(robot_sim):
    import time

    from robot.web.app import crear_app

    app, _ = crear_app(robot_sim)
    http = app.test_client()
    valores = http.get("/api/config").get_json()["valores"]
    for clave in ("camara_visible.espejo_horizontal", "camara_visible.espejo_vertical",
                  "camara_termica.espejo_horizontal", "camara_termica.espejo_vertical"):
        assert clave in valores

    r = http.post("/api/config", json={"camara_termica.espejo_vertical": True,
                                       "camara_visible.espejo_horizontal": False})
    assert r.status_code == 200, r.get_json()
    assert robot_sim.cfg.get("camara_termica.espejo_vertical") is True
    assert robot_sim.cfg.get("camara_visible.espejo_horizontal") is False

    # La cámara térmica simulada sigue entregando cuadros con el volteo activo
    robot_sim._matriz = None
    limite = time.monotonic() + 5
    while robot_sim.matriz_termica() is None and time.monotonic() < limite:
        time.sleep(0.05)
    assert robot_sim.matriz_termica().shape == (24, 32)
    http.post("/api/config/restablecer")
