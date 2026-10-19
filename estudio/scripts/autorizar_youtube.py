"""Autoriza el acceso a tu canal de YouTube (se ejecuta una sola vez).

1. En Google Cloud Console: crea un proyecto, activa "YouTube Data API v3",
   configura la pantalla de consentimiento OAuth (agrega tu correo como usuario de prueba)
   y crea credenciales "ID de cliente OAuth" tipo "App de escritorio".
2. Descarga el JSON y guárdalo como credenciales/client_secret.json
3. Ejecuta: python scripts/autorizar_youtube.py  → se abre el navegador para aceptar.
"""
import sys
from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow

sys.path.insert(0, str(Path(__file__).parent))
from comun import RAIZ, env  # noqa: E402

SCOPES = ["https://www.googleapis.com/auth/youtube.upload",
          "https://www.googleapis.com/auth/youtube.readonly"]


def main() -> None:
    secreto = RAIZ / env("YOUTUBE_CLIENT_SECRET", "credenciales/client_secret.json")
    token = RAIZ / env("YOUTUBE_TOKEN", "credenciales/token.json")
    if not secreto.exists():
        sys.exit(f"ERROR: falta {secreto}. Lee las instrucciones al inicio de este archivo.")
    flujo = InstalledAppFlow.from_client_secrets_file(str(secreto), SCOPES)
    cred = flujo.run_local_server(port=0, prompt="consent", access_type="offline")
    token.parent.mkdir(parents=True, exist_ok=True)
    token.write_text(cred.to_json(), encoding="utf-8")
    print(f"Listo. Token guardado en {token}")


if __name__ == "__main__":
    main()
