#!/usr/bin/env python3
"""Tek komutla kurulum ve açılış:  python obs-koprusu/baslat.py

İlk çalıştırmada bu klasörde .venv oluşturur ve gerekli bileşeni kurar. Bilgisayarda Chrome ya da Edge yoksa
Playwright'ın Chromium tarayıcısını indirir. Verilen seçenekler sunucu.py'ye aktarılır (ör. --tani, --port).
"""
import os
import subprocess
import sys

if sys.version_info < (3, 10):
    sys.exit("Python 3.10 veya üzeri gerekir. Kurulu sürüm: %s\nhttps://www.python.org/downloads/" % sys.version.split()[0])

for akis in (sys.stdout, sys.stderr):  # eski Windows kod sayfalarında Türkçe harf yüzünden durmasın
    if hasattr(akis, "reconfigure"):
        akis.reconfigure(errors="replace")

KLASOR = os.path.dirname(os.path.abspath(__file__))
ORTAM = os.path.join(KLASOR, ".venv")
PY = os.path.join(ORTAM, "Scripts", "python.exe") if os.name == "nt" else os.path.join(ORTAM, "bin", "python")


def dene(*komut):
    return subprocess.call([PY, *komut], cwd=KLASOR, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) == 0


def adim(mesaj, *komut, oneri):
    print(mesaj, flush=True)
    if subprocess.call(list(komut), cwd=KLASOR):
        sys.exit("Bu adım tamamlanamadı. " + oneri)


def main():
    internet = "İnternet bağlantınızı kontrol edip komutu yeniden çalıştırın."
    if not os.path.exists(PY) or not dene("-c", ""):
        adim("Çalışma ortamı hazırlanıyor…", sys.executable, "-m", "venv", "--clear", ORTAM,
             oneri="Linux'ta python3-venv paketi gerekebilir.")
    if not dene("-c", "import playwright.async_api"):
        adim("Gerekli bileşen kuruluyor…", PY, "-m", "pip", "install", "--quiet", "--disable-pip-version-check",
             "-r", os.path.join(KLASOR, "requirements.txt"), oneri=internet)
    if not dene("-c", "import asyncio, sys, obs; sys.exit(not asyncio.run(obs.tarayici_bul()))"):
        adim("Tarayıcı indiriliyor (bir kez)…", PY, "-m", "playwright", "install", "chromium", oneri=internet)
    if os.name == "nt":
        subprocess.run([PY, os.path.join(KLASOR, "windows_obs.py"), "--register"], check=True)
    surec = subprocess.Popen([PY, os.path.join(KLASOR, "sunucu.py"), *sys.argv[1:]])
    while True:
        try:
            sys.exit(surec.wait())
        except KeyboardInterrupt:
            continue  # Ctrl+C sunucuya da ulaşır, OBS penceresini kapatmasını bekle


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit("\nDurduruldu.")
