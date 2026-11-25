#!/usr/bin/env python3
"""Değerlendirici'yi bu bilgisayarda açar ve OBS'den belge almayı sağlar.

    python obs-koprusu/baslat.py          (kurar ve açar)
    python obs-koprusu/sunucu.py --tani   (sorun giderme)

Yalnızca 127.0.0.1 adresini dinler. Belgeler diske kaydedilmez, doğrudan tarayıcıdaki ders kaydına gider.
"""
from __future__ import annotations

import argparse
import asyncio
import concurrent.futures
import json
import os
import secrets
import signal
import socket
import socketserver
import sys
import threading
import urllib.error
import urllib.request
import webbrowser
from functools import partial
from http.cookies import CookieError, SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

try:
    from obs import GIRIS, HATALAR, GirisGerekli, Obs, ObsHatasi, cevir, eski_profilleri_sil, tarayici_bul
except ModuleNotFoundError as e:
    if e.name != "playwright":
        raise
    sys.exit("Gerekli bileşen kurulu değil. Şu komut kurup açar:  python obs-koprusu/baslat.py")

KOK = (Path(sys._MEIPASS) if getattr(sys, "frozen", False) else Path(__file__).resolve().parent.parent) / "public"
API = "/api/obs/"
CEREZ = "obs_koprusu"


class Kopru:
    """Playwright tek bir asyncio döngüsünde yaşar, HTTP istekleri oraya iş bırakır."""

    def __init__(self) -> None:
        self.anahtar = secrets.token_urlsafe(32)
        self.dongu = asyncio.new_event_loop()
        threading.Thread(target=self.dongu.run_forever, daemon=True).start()
        self.obs = self._kur()

    def _kur(self) -> Obs:
        async def kur():
            return Obs()
        return self.calistir(kur(), 10)

    def calistir(self, is_, sure: float = 300):
        f = asyncio.run_coroutine_threadsafe(is_, self.dongu)
        try:
            return f.result(sure)
        except concurrent.futures.TimeoutError:
            f.cancel()  # yoksa kilit tutulu kalır ve sonraki istekler de bekler
            raise ObsHatasi("zaman") from None


class Sunucu(ThreadingHTTPServer):
    # Windows'ta SO_REUSEADDR iki programın aynı bağlantı noktasını açmasına izin verir.
    allow_reuse_address = os.name != "nt"
    allow_reuse_port = False

    def server_bind(self) -> None:
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        socketserver.TCPServer.server_bind(self)  # HTTPServer'ın ad sorgusu bazı ağlarda uzun sürer
        self.server_name, self.server_port = self.server_address[:2]

    def handle_error(self, request, client_address) -> None:
        if not isinstance(sys.exc_info()[1], ConnectionError):  # yenilenen sayfanın yarım kalan istekleri
            super().handle_error(request, client_address)


class Istek(SimpleHTTPRequestHandler):
    # Windows'ta türler kayıt defterinden okunur ve .js için text/plain gelebilir.
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript",
        ".json": "application/json", ".wasm": "application/wasm", ".png": "image/png", ".svg": "image/svg+xml",
        ".pdf": "application/pdf", ".ttf": "font/ttf", ".gz": "application/gzip", ".txt": "text/plain",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }

    def __init__(self, *a, kopru: Kopru, **k) -> None:
        self.kopru = kopru
        super().__init__(*a, directory=str(KOK), **k)

    def log_message(self, *a) -> None:
        pass  # adreslerde oturum anahtarı geçebilir

    # -------------------------------------------------------- yanıtlar
    def _json(self, veri, kod: int = 200) -> None:
        self._gonder(json.dumps(veri, ensure_ascii=False).encode(), "application/json; charset=utf-8", kod)

    def _gonder(self, govde: bytes, tur: str, kod: int = 200, **baslik: str) -> None:
        self.send_response(kod)
        self.send_header("Content-Type", tur)
        self.send_header("Content-Length", str(len(govde)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for ad, deger in baslik.items():
            self.send_header(ad.replace("_", "-"), deger)
        self.end_headers()
        try:
            self.wfile.write(govde)
        except (BrokenPipeError, ConnectionResetError):
            pass  # kullanıcı pencereyi kapattı

    def _yonlendir(self, adres: str, **baslik: str) -> None:
        self._gonder(b"", "text/plain", 303, Location=adres, **baslik)

    # -------------------------------------------------------- güvenlik
    def _yerel(self) -> bool:
        """DNS rebinding'e karşı: istek gerçekten bu sunucunun adresine gelmiş olmalı."""
        return self.headers.get("Host") == f"127.0.0.1:{self.server.server_port}"

    def _izinli(self) -> bool:
        """Başka sitelerin ve bu bilgisayardaki başka programların OBS oturumuna erişmesini engeller."""
        if not self._yerel() or self.headers.get("X-OBS-Koprusu") != "1":
            return False
        if self.headers.get("Sec-Fetch-Site", "same-origin") != "same-origin":
            return False
        kaynak = self.headers.get("Origin")
        if kaynak and kaynak != f"http://127.0.0.1:{self.server.server_port}":
            return False
        try:
            cerez = SimpleCookie(self.headers.get("Cookie", "")).get(CEREZ)
        except CookieError:
            return False
        return bool(cerez) and secrets.compare_digest(cerez.value.encode(), self.kopru.anahtar.encode())

    # -------------------------------------------------------- istekler
    def do_GET(self) -> None:
        u = urlsplit(self.path)
        if u.path == "/":
            return self._yonlendir("/degerlendirici/")
        if not u.path.startswith(API):
            return super().do_GET()
        if u.path == API + "ac":  # açılış adresi: anahtarı çereze çevirir
            anahtar = parse_qs(u.query).get("a", [""])[0]
            if not self._yerel() or not secrets.compare_digest(anahtar.encode(), self.kopru.anahtar.encode()):
                return self._json({"hata": "Geçersiz açılış adresi."}, 403)
            return self._yonlendir("/degerlendirici/", Set_Cookie=(
                f"{CEREZ}={self.kopru.anahtar}; HttpOnly; SameSite=Strict; Path={API}"))
        self._api(u.path[len(API):], {})

    def do_POST(self) -> None:
        yol = urlsplit(self.path).path
        if not yol.startswith(API):
            return self._json({"hata": "Bulunamadı."}, 404)
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if not 0 <= n <= 65536:
                raise ValueError
            veri = json.loads(self.rfile.read(n) or b"{}")
            if not isinstance(veri, dict):
                raise ValueError
        except ValueError:
            return self._json({"hata": "Geçersiz istek."}, 400)
        self._api(yol[len(API):], veri)

    def _api(self, ad: str, veri: dict) -> None:
        if not self._izinli():
            return self._json({"kod": "anahtar", "hata": "Bu adrese yalnızca açılış bağlantısından ulaşılabilir."}, 403)
        o = self.kopru.obs
        try:
            if (self.command, ad) == ("GET", "durum"):
                return self._json(self.kopru.calistir(o.durum()))
            if (self.command, ad) == ("POST", "baglan"):
                return self._json(self.kopru.calistir(o.baglan()))
            if (self.command, ad) == ("POST", "kapat"):
                self.kopru.calistir(o.kapat())
                return self._json({"durum": "kapali"})
            if (self.command, ad) == ("POST", "one-getir"):
                return self._json(self.kopru.calistir(o.one_getir()))
            if (self.command, ad) == ("GET", "tani"):
                return self._json(o.tani())
            if (self.command, ad) == ("POST", "donemler"):
                return self._json(self.kopru.calistir(o.donemler()))
            if (self.command, ad) == ("POST", "dersler"):
                return self._json(self.kopru.calistir(o.dersler(str(veri.get("donem", "")))))
            if (self.command, ad) == ("POST", "belge"):
                ders = veri.get("ders") if isinstance(veri.get("ders"), dict) else {}
                icerik, bos = self.kopru.calistir(o.belge(str(veri.get("donem", "")), ders, str(veri.get("rapor", ""))))
                return self._gonder(icerik, "application/pdf", X_OBS_Bos="1" if bos else "0")
            return self._json({"hata": "Bulunamadı."}, 404)
        except Exception as e:
            hata = cevir(e)
            if hata.kod == "beklenmeyen":  # ayrıntılar rapor adresi içerebilir, yalnızca tür yazılır
                print(f"Beklenmeyen hata: {type(e).__name__}", file=sys.stderr)
                o.olay(f"beklenmeyen: {type(e).__name__}")
            giris = isinstance(hata, GirisGerekli)
            return self._json({"kod": hata.kod, "hata": str(hata), "oneri": hata.oneri, "giris": giris}, 401 if giris else 502)


def sunucu(port: int, kopru: Kopru) -> Sunucu:
    return Sunucu(("127.0.0.1", port), partial(Istek, kopru=kopru))


def zaten_acik(port: int) -> bool:
    """Bağlantı noktasındaki program bu sunucunun başka bir kopyası mı?"""
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{port}{API}durum", timeout=3)
    except urllib.error.HTTPError as e:
        try:
            return e.code == 403 and json.loads(e.read()).get("kod") == "anahtar"
        except ValueError:
            return False
    except OSError:
        pass
    return False


def tani(port: int) -> int:
    """Kurulumu ve OBS'ye erişimi denetler. Giriş yapmaz, kişisel veri okumaz."""
    sorun = 0

    def yaz(tamam: bool, ne: str, oneri: str = "") -> None:
        nonlocal sorun
        sorun += not tamam
        print(("[tamam] " if tamam else "[SORUN] ") + ne + ("" if tamam or not oneri else f"\n        {oneri}"))

    yaz(sys.version_info >= (3, 10), f"Python {sys.version.split()[0]}", "Python 3.10 veya üzeri gerekir.")
    yaz((KOK / "degerlendirici" / "index.html").is_file(), "Uygulama dosyaları", "Projeyi yeniden indirin.")
    t = asyncio.run(tarayici_bul())
    yaz(bool(t), f"Tarayıcı: {t or 'bulunamadı'}", HATALAR["tarayici"][1])
    try:
        with urllib.request.urlopen(GIRIS, timeout=20) as y:
            sayfa = y.read().decode("utf-8", "replace")
        yaz("txtSecCode" in sayfa and "btnLogin" in sayfa, "OBS giriş sayfası", HATALAR["yapi"][1])
    except OSError as e:
        if "CERTIFICATE" in str(e).upper():
            print("[bilgi] OBS erişimi denetlenemedi: Python sertifikaları eksik. OBS penceresini etkilemez.")
        else:
            yaz(False, "OBS giriş sayfası", HATALAR["ag"][1])
    try:
        Sunucu(("127.0.0.1", port), SimpleHTTPRequestHandler).server_close()
        yaz(True, f"Bağlantı noktası {port} boş")
    except OSError:
        acik = zaten_acik(port)
        yaz(acik, f"Bağlantı noktası {port} " + ("üzerinde Değerlendirici açık" if acik else "başka bir programda"),
            "O programı kapatın.")
    print("\nSorun bulunmadı." if not sorun else f"\n{sorun} sorun bulundu.")
    return 1 if sorun else 0


def main() -> None:
    for akis in (sys.stdout, sys.stderr):  # eski Windows kod sayfalarında Türkçe harf yüzünden durmasın
        if hasattr(akis, "reconfigure"):
            akis.reconfigure(errors="replace")
    p = argparse.ArgumentParser(description="Değerlendirici yerel sunucusu ve OBS köprüsü")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--tarayici-acma", action="store_true", help="uygulamayı otomatik açma")
    p.add_argument("--tani", action="store_true", help="kurulumu ve OBS erişimini denetle")
    a = p.parse_args()
    if a.tani:
        sys.exit(tani(a.port))
    eski_profilleri_sil()
    kopru = Kopru()
    try:
        s = sunucu(a.port, kopru)
    except OSError:
        if zaten_acik(a.port):
            sys.exit("Değerlendirici zaten açık. Önceki terminal penceresindeki bağlantıyı kullanın ya da onu Ctrl+C ile kapatın.")
        sys.exit(f"{a.port} numaralı bağlantı noktasını başka bir program kullanıyor. O programı kapatıp yeniden deneyin.\n"
                 f"Zorunluysa --port {a.port + 1} kullanabilirsiniz. Tarayıcı dersleri adrese göre ayrı sakladığından\n"
                 f"{a.port} adresindeki dersleriniz orada görünmez (silinmez).")
    adres = f"http://127.0.0.1:{s.server_port}{API}ac?a={kopru.anahtar}"
    print("Değerlendirici açık. Bu pencereyi kapatmayın. Durdurmak için Ctrl+C.\n"
          f"Sayfa açılmadıysa bu bağlantıyı tarayıcıya yapıştırın (paylaşmayın):\n{adres}", flush=True)
    if not a.tarayici_acma:
        webbrowser.open(adres)
    for ad in ("SIGTERM", "SIGHUP"):  # terminal kapatılsa da geçici profil silinsin
        if hasattr(signal, ad):
            signal.signal(getattr(signal, ad), signal.default_int_handler)
    try:
        s.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        s.server_close()
        try:
            kopru.calistir(kopru.obs.kapat(), 15)
        except Exception:
            pass


if __name__ == "__main__":
    main()
