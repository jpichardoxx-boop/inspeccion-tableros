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
