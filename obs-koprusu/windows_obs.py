"""Windows URL handler for the local OBS bridge. No arguments from the URL are used."""
import ctypes
from ctypes import wintypes
import os
import shutil
import tempfile
from pathlib import Path
import sys
import webbrowser

SCHEME = "degerlendirici-obs"
PORT = int(os.environ.get("OBS_PORT", "8000"))


def register():
    import winreg
    pythonw = Path(sys.executable).with_name("pythonw.exe")
    if getattr(sys, "frozen", False):
        # Keep the handler usable after the user removes the downloaded copy.
        folder = Path(os.environ["LOCALAPPDATA"], "Degerlendirici", "obs-2026.11.25.1")
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / "Değerlendirici OBS Köprüsü.exe"
        source = Path(sys.executable)
        if source.resolve() != target.resolve() and not target.exists():
            with tempfile.NamedTemporaryFile(dir=folder, delete=False) as temp:
                staged = Path(temp.name)
            try:
                shutil.copyfile(source, staged)
                try:
                    staged.rename(target)
                except FileExistsError:
                    pass  # a concurrent first launch completed the same installation
            finally:
                staged.unlink(missing_ok=True)
        command = f'"{target}"'
    else:
        command = f'"{pythonw}" "{Path(__file__).resolve()}"'
    root = "Software\\Classes\\" + SCHEME
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, root) as key:
        winreg.SetValueEx(key, "", 0, winreg.REG_SZ, "URL:Değerlendirici OBS Köprüsü")
        winreg.SetValueEx(key, "URL Protocol", 0, winreg.REG_SZ, "")
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, root + "\\shell\\open\\command") as key:
        winreg.SetValueEx(key, "", 0, winreg.REG_SZ, command)


def launch():
    import threading
    from sunucu import API, Kopru, sunucu, zaten_acik
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateEventW.argtypes = [wintypes.LPVOID, wintypes.BOOL, wintypes.BOOL, wintypes.LPCWSTR]
    kernel.CreateEventW.restype = wintypes.HANDLE
    kernel.SetEvent.argtypes = kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    handle = kernel.CreateEventW(None, False, False, f"Local\\DegerlendiriciObsOpen{PORT}")
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        if ctypes.get_last_error() == 183:
            kernel.SetEvent(handle)
            return
        bridge = Kopru()
        try:
            server = sunucu(PORT, bridge)
        except OSError:
            if zaten_acik(PORT):
                webbrowser.open(f"http://127.0.0.1:{PORT}/degerlendirici/#obs")
                return
            raise
        url = f"http://127.0.0.1:{PORT}{API}ac?a={bridge.anahtar}#obs"
        def reopen():
            while kernel.WaitForSingleObject(handle, 0xffffffff) == 0:
                webbrowser.open(url)
        threading.Thread(target=reopen, daemon=True).start()
        webbrowser.open(url)
        try:
            server.serve_forever()
        finally:
            server.server_close()
            bridge.calistir(bridge.obs.kapat(), 15)
    finally:
        kernel.CloseHandle(handle)


if __name__ == "__main__":
    if sys.argv[1:] == ["--register"]:
        register()
    else:
        try:
            if getattr(sys, "frozen", False):
                register()
            launch()
        except Exception as exc:
            ctypes.windll.user32.MessageBoxW(None, str(exc), "OBS bağlantısı açılamadı", 16)

