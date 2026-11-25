"""Run the local service and reopen its authenticated page on later app launches."""

import os
import socket
import subprocess
import threading
import time
import webbrowser
from pathlib import Path

from sunucu import API, Kopru, sunucu


def launch():
    port = int(os.environ.get("OBS_PORT", "8000"))
    directory = Path.home() / "Library/Application Support/Degerlendirici"
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    # AF_UNIX limits path length. Binding relative to the private directory also
    # works for long home paths; the HTTP server serves a fixed absolute root.
    os.chdir(directory)
    endpoint = f"reopen-{port}.sock"
    bridge = Kopru()
    with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as events:
        try:
            server = sunucu(port, bridge)
        except OSError:
            for _ in range(10):
                try:
                    events.sendto(b"open", endpoint)
                    return
                except OSError:
                    time.sleep(0.05)
            raise
        with server:
            Path(endpoint).unlink(missing_ok=True)
            events.bind(endpoint)
            url = f"http://127.0.0.1:{port}{API}ac?a={bridge.anahtar}#obs"

            def reopen():
                while events.recv(32) == b"open":
                    webbrowser.open(url)

            threading.Thread(target=reopen, daemon=True).start()
            webbrowser.open(url)
            server.serve_forever()


if __name__ == "__main__":
    try:
        launch()
    except Exception:
        subprocess.run(
            [
                "/usr/bin/osascript",
                "-e",
                'display alert "OBS Köprüsü açılamadı" message "Yerel bağlantı noktasını kullanan uygulamayı kapatıp yeniden deneyin."',
            ]
        )
