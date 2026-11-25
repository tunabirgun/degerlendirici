"""Windows URL handler for the local OBS bridge. No arguments from the URL are used."""
import ctypes
from ctypes import wintypes
import os
from pathlib import Path
import sys
import webbrowser

SCHEME = "degerlendirici-obs"
PORT = 8000


def register():
    import winreg
    pythonw = Path(sys.executable).with_name("pythonw.exe")
    root = "Software\\Classes\\" + SCHEME
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, root) as key:
        winreg.SetValueEx(key, "", 0, winreg.REG_SZ, "URL:Değerlendirici OBS")
        winreg.SetValueEx(key, "URL Protocol", 0, winreg.REG_SZ, "")
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, root + "\\shell\\open\\command") as key:
        winreg.SetValueEx(key, "", 0, winreg.REG_SZ, f'"{pythonw}" "{Path(__file__).resolve()}"')


def launch():
    import threading
    from sunucu import API, Kopru, sunucu, zaten_acik
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateEventW.argtypes = [wintypes.LPVOID, wintypes.BOOL, wintypes.BOOL, wintypes.LPCWSTR]
    kernel.CreateEventW.restype = wintypes.HANDLE
    kernel.SetEvent.argtypes = kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    handle = kernel.CreateEventW(None, False, False, "Local\\DegerlendiriciObsOpen8000")
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
            launch()
        except Exception as exc:
            ctypes.windll.user32.MessageBoxW(None, str(exc), "OBS bağlantısı açılamadı", 16)

