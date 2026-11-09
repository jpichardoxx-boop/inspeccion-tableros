"""Identificación de tableros por código QR (OpenCV, sin dependencias extra).

Formato del texto del QR (lo genera la página "Etiquetas QR"):

    TD-01                      solo el nombre/ID del tablero
    TD-01|Nave 2, nivel 1      nombre y ubicación separados por "|"

También se acepta el prefijo ``TABLERO:`` (``TABLERO:TD-01``).
"""

from __future__ import annotations

import cv2
import numpy as np

MAX_TEXTO = 200


def interpretar(texto: str) -> dict | None:
    """Separa el texto del QR en código de tablero y ubicación."""
    texto = (texto or "").strip()[:MAX_TEXTO]
    if not texto:
        return None
    codigo, _, ubicacion = texto.partition("|")
    codigo = codigo.strip()
    if codigo.upper().startswith("TABLERO:"):
        codigo = codigo[len("TABLERO:"):].strip()
    if not codigo:
        return None
    return {"texto": texto, "codigo": codigo[:80], "ubicacion": ubicacion.strip()[:120]}


def leer_qr(cuadro: np.ndarray | None) -> dict | None:
    """Busca un QR en el cuadro de la cámara visible.

    Si el QR se ve pequeño (lejos de la cámara) se reintenta con la imagen
    ampliada 2×. Si la cámara quedó volteada en X (espejo), el QR se ve
    invertido y no se puede leer, así que también se prueba reflejada.
    Devuelve ``{"codigo", "ubicacion", "texto", "puntos"}`` o ``None``.
    ``puntos`` son las 4 esquinas en fracciones (0–1) del cuadro mostrado.
    """
    if cuadro is None or cuadro.size == 0:
        return None
    gris = cv2.cvtColor(cuadro, cv2.COLOR_BGR2GRAY) if cuadro.ndim == 3 else cuadro
    alto, ancho = gris.shape[:2]
    detector = cv2.QRCodeDetector()
    for reflejado, factor in ((False, 1), (False, 2), (True, 1), (True, 2)):
        imagen = np.ascontiguousarray(gris[:, ::-1] if reflejado else gris)
        if factor != 1:
            imagen = cv2.resize(imagen, None, fx=factor, fy=factor, interpolation=cv2.INTER_CUBIC)
        try:
            texto, puntos, _ = detector.detectAndDecode(imagen)
        except cv2.error:
            continue
        datos = interpretar(texto)
        if datos is None:
            continue
        esquinas = []
        if puntos is not None:
            for x, y in np.asarray(puntos, np.float32).reshape(-1, 2) / factor:
                if reflejado:
                    x = ancho - 1 - x
                esquinas.append([round(float(x) / ancho, 4), round(float(y) / alto, 4)])
        datos["puntos"] = esquinas
        return datos
    return None


def generar_qr_png(texto: str, modulo_px: int = 10) -> bytes:
    """PNG del código QR (con zona de silencio) para imprimir etiquetas."""
    texto = (texto or "").strip()[:MAX_TEXTO]
    if not texto:
        raise ValueError("El texto del QR está vacío")
    if not hasattr(cv2, "QRCodeEncoder"):
        raise RuntimeError("Esta versión de OpenCV no puede generar códigos QR (se requiere 4.5.3 o mayor)")
    qr = cv2.QRCodeEncoder.create().encode(texto)
    qr = cv2.resize(qr, None, fx=modulo_px, fy=modulo_px, interpolation=cv2.INTER_NEAREST)
    borde = 4 * modulo_px
    qr = cv2.copyMakeBorder(qr, borde, borde, borde, borde, cv2.BORDER_CONSTANT, value=255)
    ok, png = cv2.imencode(".png", qr)
    if not ok:
        raise RuntimeError("No se pudo generar la imagen del QR")
    return png.tobytes()
