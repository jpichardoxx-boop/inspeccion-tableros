"""Odometría y API del gemelo digital."""

import math

import pytest

from robot.logica.control import ControladorTraccion, ParametrosTraccion

from .test_watchdog import EncodersQuietos, MotoresEspia


def _controlador():
    p = ParametrosTraccion(separacion_orugas=0.2)
    return ControladorTraccion(MotoresEspia(), EncodersQuietos(), p, cuentas_por_vuelta=1000)


def test_odometria_avance_recto():
    c = _controlador()
    for _ in range(10):
        c._integrar_odometria(0.01, 0.01)
    o = c.odometria()
    assert o["x"] == pytest.approx(0.1)
    assert o["y"] == pytest.approx(0.0)
    assert o["rumbo"] == pytest.approx(0.0)
    assert o["distancia"] == pytest.approx(0.1)


def test_odometria_giro_en_su_lugar_a_la_izquierda():
    c = _controlador()
    # Cuarto de vuelta: cada oruga recorre (π/2)·(b/2)
    arco = math.pi / 2 * 0.1
    for _ in range(100):
        c._integrar_odometria(-arco / 100, arco / 100)
    o = c.odometria()
    assert o["rumbo"] == pytest.approx(math.pi / 2, abs=1e-3)
    assert abs(o["x"]) < 1e-6 and abs(o["y"]) < 1e-6
    assert o["rec_izq"] == pytest.approx(-arco, abs=1e-4)


def test_reiniciar_odometria():
    c = _controlador()
    c._integrar_odometria(0.05, 0.03)
    c.reiniciar_odometria()
    assert c.odometria()["x"] == 0 and c.odometria()["distancia"] == 0


def test_api_gemelo_y_hallazgo_con_posicion(robot_sim):
    import time

    from robot.web.app import crear_app

    app, _ = crear_app(robot_sim)
    http = app.test_client()
    assert http.get("/gemelo").status_code == 200
    limite = time.monotonic() + 5
    while robot_sim.matriz_termica() is None and time.monotonic() < limite:
        time.sleep(0.05)
    robot_sim.control.pose = [0.4, -0.2, 0.3]
    r = http.post("/api/capturar", json={"tablero": "TD-07", "referencia": {"modo": "mediana"}})
    assert r.status_code == 200, r.get_json()
    d = http.get("/api/gemelo").get_json()
    assert d["hallazgos"][0]["tablero"] == "TD-07"
    assert d["hallazgos"][0]["pos_x"] == pytest.approx(0.4, abs=0.02)
    assert http.post("/api/odometria/reiniciar").get_json()["odometria"]["x"] == 0
