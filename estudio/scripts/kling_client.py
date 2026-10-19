"""Cliente mínimo para la API oficial de Kling (texto → video).

Autenticación: JWT HS256 firmado con el Secret Key, `iss` = Access Key (vigencia máx. 30 min).
Flujo: crear tarea → consultar hasta `succeed` → descargar el mp4.
"""
from __future__ import annotations

import time
from pathlib import Path

import jwt
import requests

from comun import env


class KlingError(RuntimeError):
    pass


class Kling:
    def __init__(self) -> None:
        self.ak = env("KLING_ACCESS_KEY", requerido=True)
        self.sk = env("KLING_SECRET_KEY", requerido=True)
        self.base = env("KLING_BASE_URL", "https://api-singapore.klingai.com").rstrip("/")
        self.modelo = env("KLING_MODELO", "kling-v2-6")
        self.modo = env("KLING_MODO", "std")  # std | pro
        self._token = None
        self._expira = 0

    # --- auth -----------------------------------------------------------
    def _headers(self) -> dict:
        ahora = int(time.time())
        if not self._token or ahora > self._expira - 120:
            self._expira = ahora + 1800
            self._token = jwt.encode(
                {"iss": self.ak, "exp": self._expira, "nbf": ahora - 5},
                self.sk, algorithm="HS256", headers={"alg": "HS256", "typ": "JWT"},
            )
        return {"Authorization": f"Bearer {self._token}", "Content-Type": "application/json"}

    def _req(self, metodo: str, ruta: str, **kw) -> dict:
        for intento in range(5):
            r = requests.request(metodo, f"{self.base}{ruta}", headers=self._headers(),
                                 timeout=60, **kw)
            if r.status_code == 429 or r.status_code >= 500:
                time.sleep(10 * (intento + 1))
                continue
            datos = r.json() if r.content else {}
            if r.status_code != 200 or datos.get("code", 0) != 0:
                raise KlingError(f"Kling {r.status_code}: {datos or r.text[:300]}")
            return datos["data"]
        raise KlingError("Kling: demasiados reintentos (429/5xx)")

    # --- API pública ----------------------------------------------------
    def crear_texto_a_video(self, prompt: str, duracion: int, aspect_ratio: str,
                            negativo: str = "") -> str:
        cuerpo = {
            "model_name": self.modelo,
            "prompt": prompt[:2500],
            "negative_prompt": (negativo or
                                "text, watermark, logo, subtitles, distorted hands, blurry")[:2500],
            "duration": str(duracion),
            "aspect_ratio": aspect_ratio,
            "mode": self.modo,
            "cfg_scale": 0.5,
        }
        return self._req("POST", "/v1/videos/text2video", json=cuerpo)["task_id"]

    def esperar(self, task_id: str, max_seg: int = 900, intervalo: int = 10) -> str:
        """Devuelve la URL del video cuando la tarea termina."""
        limite = time.time() + max_seg
        while time.time() < limite:
            d = self._req("GET", f"/v1/videos/text2video/{task_id}")
            estado = d.get("task_status")
            if estado == "succeed":
                return d["task_result"]["videos"][0]["url"]
            if estado == "failed":
                raise KlingError(f"Tarea {task_id} falló: {d.get('task_status_msg')}")
            time.sleep(intervalo)
        raise KlingError(f"Tarea {task_id}: tiempo de espera agotado")

    @staticmethod
    def descargar(url: str, destino: Path) -> None:
        with requests.get(url, stream=True, timeout=300) as r:
            r.raise_for_status()
            with open(destino, "wb") as f:
                for trozo in r.iter_content(1 << 20):
                    f.write(trozo)
