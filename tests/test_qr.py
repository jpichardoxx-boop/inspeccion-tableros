"""Identificación de tableros por código QR."""

import cv2
import numpy as np

from robot.logica.qr import generar_qr_png, interpretar, leer_qr


def _cuadro_con_qr(texto, lado=150, espejo=False):
    qr = cv2.imdecode(np.frombuffer(generar_qr_png(texto), np.uint8), cv2.IMREAD_COLOR)
    cuadro = np.full((480, 640, 3), 170, np.uint8)
    cuadro[100:100 + lado, 300:300 + lado] = cv2.resize(qr, (lado, lado), interpolation=cv2.INTER_AREA)
    return np.ascontiguousarray(cuadro[:, ::-1]) if espejo else cuadro


def test_interpretar_texto():
    assert interpretar("TD-01") == {"texto": "TD-01", "codigo": "TD-01", "ubicacion": ""}
    assert interpretar("TD-02 | Nave 2")["ubicacion"] == "Nave 2"
    assert interpretar("TABLERO:TD-03")["codigo"] == "TD-03"
    assert interpretar("   ") is None and interpretar("|solo ubicación") is None


def test_leer_qr_normal_espejo_y_pequeno():
    for espejo in (False, True):
        r = leer_qr(_cuadro_con_qr("TD-01|Laboratorio", espejo=espejo))
        assert r["codigo"] == "TD-01" and r["ubicacion"] == "Laboratorio"
        assert len(r["puntos"]) == 4 and all(0 <= v <= 1 for p in r["puntos"] for v in p)
    assert leer_qr(_cuadro_con_qr("TD-09|Nave 2, nivel 1", lado=78))["codigo"] == "TD-09"


def test_sin_qr():
    assert leer_qr(np.zeros((480, 640, 3), np.uint8)) is None
    assert leer_qr(None) is None


def test_api_qr_y_etiqueta(robot_sim):
    import time

    from robot.web.app import crear_app

    app, _ = crear_app(robot_sim)
    http = app.test_client()
    r = http.get("/api/qr/etiqueta.png?texto=TD-05")
    assert r.status_code == 200 and r.data[:4] == b"\x89PNG"
    assert http.get("/api/qr/etiqueta.png?texto=").status_code == 400
    assert http.get("/etiquetas-qr").status_code == 200
    # La escena simulada trae la etiqueta QR del tablero TD-01
    limite = time.monotonic() + 6
    qr = None
    while qr is None and time.monotonic() < limite:
        qr = http.get("/api/qr").get_json()["qr"]
        time.sleep(0.6)
    assert qr and qr["codigo"] == "TD-01"
