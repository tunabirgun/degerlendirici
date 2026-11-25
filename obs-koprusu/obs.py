"""OBS akademik panelinden ders listesi ve "Yazdır" raporlarını okur (Playwright ile).

Yalnızca okur: not girişi, yoklama girişi, onay gibi işlemlere dokunmaz.
Girişi kullanıcı açılan pencerede kendisi yapar. Kullanıcı adı, şifre ve güvenlik kodu bu koda ulaşmaz.
"""
from __future__ import annotations

import asyncio
import json
import os
import platform
import re
import shutil
import tempfile
import time
import unicodedata
from collections import deque
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Optional

from playwright.async_api import Frame, Page, TimeoutError as PWTimeout, async_playwright

ADRES = os.environ.get("OBS_ADRES", "https://obs.yeniyuzyil.edu.tr").rstrip("/")
GIRIS = f"{ADRES}/oibs/acd/login.aspx"
ANA_SAYFA = re.compile(r"/oibs/acd/index\.aspx", re.I)
GIRIS_SURESI = 300  # sn
GORUNMEZ = False  # güvenlik kodu için pencere görünmelidir, yalnızca testler değiştirir

# anahtar -> OBS "Yazdır" penceresindeki değer
RAPORLAR = {
    "ders_yoklama": "ou_sinif_listesi",
    "sinav_not": "ou_not_listesi_yeni",
    "sinif_basari": "sinif_basari_ist",
    "not_basari": "not_ist",
    "egitim_rehberi": "egitim_rehber_bologna",
}


# kod -> (ne oldu, ne yapılabilir)
HATALAR = {
    "ag": ("OBS sitesine ulaşılamadı.", "İnternet bağlantınızı kontrol edin. OBS bakımda olabilir, birkaç dakika sonra yeniden deneyin."),
    "zaman": ("OBS zamanında yanıt vermedi.", "OBS yoğun olabilir. Birkaç dakika sonra yeniden deneyin."),
    "tarayici": ("OBS penceresi için uygun tarayıcı bulunamadı.", "Google Chrome veya Microsoft Edge kurun ya da python obs-koprusu/baslat.py komutunu yeniden çalıştırın."),
    "pencere": ("OBS penceresi kapatıldı.", "Yeniden bağlanın. Belgeler alınırken pencereyi küçültebilirsiniz, kapatmayın."),
    "giris_suresi": ("Giriş süresi doldu.", "Yeniden bağlanıp güvenlik kodunu girin."),
    "baglanti_yok": ("OBS’ye bağlı değilsiniz.", "OBS penceresinden yeniden giriş yapın."),
    "oturum": ("OBS oturumu sona erdi.", "OBS’yi aynı anda başka sekmede veya cihazda kullanmak oturumu kapatabilir. Yeniden giriş yapın."),
    "menu": ("OBS menüsünde “Verilen Dersler” bulunamadı.", "OBS penceresinde dilin Türkçe olduğunu ve bu hesabın akademik panele girdiğini kontrol edin."),
    "yapi": ("OBS sayfası beklenenden farklı.", "OBS güncellenmiş olabilir. Belgeyi OBS’den elle indirip ekleyebilir, tanı bilgisini geliştiriciye iletebilirsiniz."),
    "donem_yok": ("Dönem OBS’de bulunamadı.", "OBS’ye yeniden bağlanıp dönemi tekrar seçin."),
    "ders_yok": ("Ders OBS listesinde tek olarak bulunamadı.", "Yanlış dersin belgesini almamak için işlem durduruldu. Ders listesini yenileyin."),
    "belge_yok": ("Bu ders için bu belge sunulmuyor.", ""),
    "ret": ("OBS raporu vermedi.", "Aynı belgeyi OBS’de Yazdır penceresinden deneyerek nedenini görebilirsiniz."),
    "goruntuleyici": ("Rapor görüntüleyici açılmadı.", "Birkaç dakika sonra yeniden deneyin."),
    "dosya_yok": ("OBS dosya göndermedi.", "Yeniden deneyin. Sürerse belgeyi OBS’den elle indirin."),
    "pdf_degil": ("OBS geçerli bir PDF göndermedi.", "Yeniden deneyin. Sürerse belgeyi OBS’den elle indirin."),
    "beklenmeyen": ("OBS işlemi tamamlanamadı.", "Yeniden deneyin. Sürerse tanı bilgisini geliştiriciye iletin."),
}
KESIN = {"menu", "belge_yok", "ret", "donem_yok"}  # yeniden denemek sonucu değiştirmez


class ObsHatasi(Exception):
    """Kullanıcıya gösterilebilecek hata. Metinler HATALAR tablosundan gelir."""

    def __init__(self, kod: str, ek: str = "") -> None:
        self.kod, self.oneri = kod, HATALAR[kod][1]
        super().__init__(f"{HATALAR[kod][0]} {ek}".strip())


class GirisGerekli(ObsHatasi):
    pass


def cevir(e: Exception) -> ObsHatasi:
    """Playwright hatasını kullanıcı diline çevirir. Özgün metin adres içerebildiği için taşınmaz."""
    if isinstance(e, ObsHatasi):
        return e
    m = str(e)
    if "net::ERR" in m or "NS_ERROR" in m:
        return ObsHatasi("ag")
    if isinstance(e, (PWTimeout, asyncio.TimeoutError, TimeoutError)):
        return ObsHatasi("zaman")
    if "has been closed" in m or "Target closed" in m or "Connection closed" in m:
        return GirisGerekli("pencere")
    return ObsHatasi("beklenmeyen")


PROFIL_ONEKI = "obs-koprusu-"


def profil_sil(yol: str) -> bool:
    """Windows'ta tarayıcı kapanırken dosyaları kısa süre açık tutabilir, bu yüzden birkaç kez denenir."""
    for _ in range(12):
        shutil.rmtree(yol, ignore_errors=True)
        if not os.path.exists(yol):
            return True
        time.sleep(0.25)
    return False


def eski_profilleri_sil() -> None:
    """Zorla kapatılmış (ör. Windows'ta pencereden kapatılan) eski çalışmalardan kalan profiller."""
    for yol in Path(tempfile.gettempdir()).glob(PROFIL_ONEKI + "*"):
        try:
            if yol.is_dir() and not yol.is_symlink() and time.time() - yol.stat().st_mtime > 12 * 3600:
                shutil.rmtree(yol, ignore_errors=True)
        except OSError:
            pass


def tarayici_adaylari() -> list[Optional[str]]:
    """Playwright'ın Chromium'u yoksa bilgisayardaki Chrome ya da Edge kullanılır."""
    secim = os.environ.get("OBS_TARAYICI")
    return [secim] if secim else [None, "chrome", "msedge"]


async def tarayici_bul() -> Optional[str]:
    """Açılabilen ilk tarayıcının adı, yoksa None."""
    async with async_playwright() as pw:
        for aday in tarayici_adaylari():
            try:
                b = await pw.chromium.launch(channel=aday)
                await b.close()
                return aday or "chromium"
            except Exception:
                continue
    return None


def sade(s: str) -> str:
    s = (s or "").translate(str.maketrans("ıİ", "iI"))
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s).strip().lower()


# ---------------------------------------------------------------- sayfada çalışan parçalar
JS_BOSTA = """() => { try { return !Sys.WebForms.PageRequestManager.getInstance().get_isInAsyncPostBack(); }
  catch (e) { return document.readyState === 'complete'; } }"""

# Bir postback'in bittiğini anlamak için sayaç
JS_SAYAC = """() => { try {
  const m = Sys.WebForms.PageRequestManager.getInstance();
  if (!window.__obsSayac) {
    const s = window.__obsSayac = {n: 0, hata: false};
    m.add_endRequest((_, a) => { s.hata = !!(a.get_error && a.get_error()); s.n++; });
  }
  return window.__obsSayac.n; } catch (e) { return -1; } }"""

JS_BITTI = """(n) => {
  if (!window.__obsSayac) return document.readyState === 'complete' ? {} : false;
  return window.__obsSayac.n > n ? {hata: window.__obsSayac.hata} : false; }"""

JS_SECENEKLER = """(id) => { const s = document.getElementById(id);
  return s ? [...s.options].map(o => ({v: o.value, t: o.text.trim(), s: o.selected})) : []; }"""

JS_DERSLER = """() => {
  const g = document.getElementById('grdDersler');
  if (!g) return {dersler: [], sayfalar: [], tanindi: true};
  const bas = [...g.querySelectorAll('tr')].find(tr => tr.querySelector('th'));
  const adlar = bas ? [...bas.children].map(c => c.innerText.trim()) : [];
  const dersler = [];
  g.querySelectorAll('a[id^="grdDersler_btnPrintFromGrid_"]').forEach(a => {
    let tr = a.closest('tr');
    while (tr && tr.parentElement.closest('table') !== g) tr = tr.parentElement.closest('tr');
    if (!tr) return;
    const al = n => { const i = adlar.indexOf(n); return i >= 0 ? tr.children[i].innerText.trim() : ''; };
    dersler.push({dugme: a.id, donem: al('Dönem'), sube: al('Şb'), kod: al('Ders Kodu'), ad: al('Ders Adı'),
                  program: al('Program')});
  });
  const s = document.getElementById('grdDersler_cmb_PageSelector');
  const tanindi = ['Dönem', 'Şb', 'Ders Kodu', 'Ders Adı', 'Program'].every(n => adlar.includes(n)) ||
    !bas;
  return {tanindi, dersler, sayfalar: s ? [...s.options].map(o => ({v: o.value, s: o.selected})) : []};
}"""

JS_LISTELE = """(v) => { document.getElementById('cmb_donem').value = v;
  const b = [...document.querySelectorAll('a,input,button')].find(e => (e.innerText || e.value || '').trim() === 'Listele');
  if (!b) throw new Error('Listele düğmesi yok'); b.click(); }"""

JS_SAYFA = """(v) => { const s = document.getElementById('grdDersler_cmb_PageSelector'); s.value = v;
  s.dispatchEvent(new Event('change', {bubbles: true})); }"""

# "Yazdır" düğmesinin gönderdiği istek. Yanıtta raporun tek kullanımlık adresi bulunur.
JS_YAZDIR = """async (tur) => {
  const form = document.forms[0];
  const sec = (id, v) => { const s = document.getElementById(id);
    if (![...s.options].some(o => o.value === v)) return false; s.value = v; return true; };
  if (!sec('cmbModalPrintType', tur)) return {yok: true};
  const tum = [...document.getElementById('cmbModalSinavlar').options].find(o => /^T.m S.navlar/i.test(o.text.trim()));
  if (tum) document.getElementById('cmbModalSinavlar').value = tum.value;
  const fd = new FormData(form);
  fd.set('ScriptManager1', 'UpdatePanel1|btnModalPrint');
  fd.set('__EVENTTARGET', 'btnModalPrint'); fd.set('__EVENTARGUMENT', ''); fd.set('__ASYNCPOST', 'true');
  const r = await fetch(new URL(form.getAttribute('action') || location.href, location.href), {
    method: 'POST', body: new URLSearchParams(fd), credentials: 'include',
    headers: {'X-MicrosoftAjax': 'Delta=true', 'X-Requested-With': 'XMLHttpRequest'}});
  const t = await r.text();
  const m = t.match(/prolizPopup\\('([^']+)'/);
  if (m) return {url: new URL(m[1], location.href).href};
  const e = t.match(/(?:alert|toastr\\.\\w+|[sS]wal(?:\\.fire)?|ProlizMessage)\\(([^)]{0,300})\\)/);
  return e ? {ret: e[1].replace(/["'`{}]/g, '').trim().slice(0, 200)} : {bozuk: true};
}"""

JS_HAZIR = """() => { const v = window.jsStiWebViewer1;
  return !!(v && v.reportParams && v.reportParams.pagesArray && v.reportParams.pagesArray.length); }"""

# Sayfadan yalnızca evet/hayır çıkar. Öğrencisi olmayan şubede OBS başlıkları dolu, satırları boş rapor verir.
JS_BOS_MU = """([rapor, kod]) => {
  const html = window.jsStiWebViewer1.reportParams.pagesArray
    .map(p => typeof p === 'string' ? p : (p && p.content) || '').join(' ');
  if (!html.trim() || rapor === 'egitim_rehberi') return false;
  const d = new DOMParser().parseFromString(html, 'text/html');
  if (rapor === 'not_basari') return !d.body.textContent.includes(kod);
  // Only discard a report when a recognizable student table has no data rows.
  // Student numbers may be short or have leading zeroes; unfamiliar layouts must survive.
  const rows = [...d.querySelectorAll('tr')];
  const header = rows.find(row => [...row.cells].some(cell =>
    !cell.querySelector('table') && /^öğrenci\\s*(no\\.?|numarası)$/iu.test(cell.textContent.trim())));
  if (!header) return false;
  const following = [...header.closest('table').rows].slice(header.rowIndex + 1);
  return !following.some(row => [...row.cells].some(cell => cell.textContent.trim())); }"""

JS_PDF = """() => { const v = window.jsStiWebViewer1;
  const s = (v.getDefaultExportSettings && v.getDefaultExportSettings('Pdf')) || {};
  s.OpenAfterExport = false; v.postExport('Pdf', s); }"""


class Obs:
    def __init__(self) -> None:
        self.pw = None
        self.headless_reader = None
        self.transfer_tried = False
        self.ctx = None
        self.page: Optional[Page] = None
        self.profil: Optional[str] = None
        self.kilit = asyncio.Lock()  # OBS sayfası aynı anda tek iş yapabilir
        self.bekleme: Optional[asyncio.Task] = None
        self.mesaj = ""  # OBS'nin giriş sayfasında yazdığı
        self.giris_hatasi: Optional[str] = None  # HATALAR kodu
        self.giris_sonu = 0.0
        self.tarayici = ""
        self.olaylar: deque[str] = deque(maxlen=40)  # tanı için, kişisel veri yazılmaz

    def olay(self, ad: str) -> None:
        self.olaylar.append(f"{time.strftime('%H:%M:%S')} {ad}")

    def tani(self) -> dict:
        try:
            pw = version("playwright")
        except PackageNotFoundError:
            pw = "?"
        return {"python": platform.python_version(), "sistem": f"{platform.system()} {platform.release()}",
                "playwright": pw, "tarayici": self.tarayici or "açılmadı", "olaylar": list(self.olaylar)}

    # ------------------------------------------------------------ bağlantı
    async def _baslat(self) -> None:
        if not self.headless_reader and self.ctx and self.page and not self.page.is_closed():
            return
        await self.kapat()
        # Her bağlantıda boş bir tarayıcı profili açılır ve kapanışta silinir. Çerez ve şifre saklanmaz.
        self.profil = tempfile.mkdtemp(prefix=PROFIL_ONEKI)
        tercih = Path(self.profil, "Default", "Preferences")
        tercih.parent.mkdir(parents=True)
        tercih.write_text(json.dumps({
            "plugins": {"always_open_pdf_externally": True},  # gösterilen PDF geri okunamaz, indirilmelidir
            "credentials_enable_service": False,
            "profile": {"password_manager_enabled": False},
            "autofill": {"profile_enabled": False},
        }), "utf-8")
        self.pw = await async_playwright().start()
        for aday in tarayici_adaylari():
            try:
                self.ctx = await self.pw.chromium.launch_persistent_context(
                    self.profil, headless=GORUNMEZ, channel=aday, accept_downloads=True,
                    viewport={"width": 1366, "height": 900}, locale="tr-TR")
                self.tarayici = aday or "chromium"
                break
            except Exception:
                self.olay(f"tarayıcı açılmadı: {aday or 'chromium'}")
        else:
            await self.kapat()
            raise ObsHatasi("tarayici")
        self.olay(f"tarayıcı: {self.tarayici}")
        self.page = self.ctx.pages[0] if self.ctx.pages else await self.ctx.new_page()

    async def kapat(self) -> None:
        if self.bekleme and not self.bekleme.done() and self.bekleme is not asyncio.current_task():
            self.bekleme.cancel()
        for is_ in ((self.ctx.close if self.ctx else None), (self.headless_reader.close if self.headless_reader else None), (self.pw.stop if self.pw else None)):
            try:
                if is_:
                    await is_()
            except Exception:
                pass
        self.headless_reader = None
        self.transfer_tried = False
        profil = self.profil
        self.ctx = self.page = self.pw = self.profil = None
        if profil and not await asyncio.to_thread(profil_sil, profil):
            self.olay("profil silinemedi")

    async def bagli(self) -> bool:
        # index.aspx adresine doğrudan gidilmez: OBS oturumu düşürüyor.
        try:
            if self.headless_reader:
                return bool(self.page and not self.page.is_closed() and "verilen_dersler.aspx" in self.page.url.lower() and await self.page.locator("#cmb_donem").count())
            return bool(self.page and not self.page.is_closed() and ANA_SAYFA.search(self.page.url)
                        and await self.page.locator("#IFRAME1").count())
        except Exception:
            return False

    async def durum(self) -> dict:
        if await self.bagli():
            return {"durum": "bagli"}
        if self.bekleme and not self.bekleme.done():
            adres = self.page.url.lower() if self.page and not self.page.is_closed() else ""
            ek = bool(adres) and not any(x in adres for x in ("login.aspx", "redirect.aspx", "about:blank", "index.aspx"))
            return {"durum": "bekliyor", "mesaj": self.mesaj, "ek_islem": ek,
                    "kalan": max(0, int(self.giris_sonu - time.monotonic()))}
        kod = self.giris_hatasi
        return {"durum": "kapali", "kod": kod, "hata": HATALAR[kod][0] if kod else "", "oneri": HATALAR[kod][1] if kod else ""}

    async def baglan(self) -> dict:
        async with self.kilit:
            if not await self.bagli() and not (self.bekleme and not self.bekleme.done()):
                self.mesaj, self.giris_hatasi = "", None
                try:
                    await self._baslat()
                    await self.page.goto(GIRIS, wait_until="domcontentloaded")
                    if not await self.page.locator("#txtSecCode").count() and not await self.bagli():
                        raise ObsHatasi("yapi")
                except Exception as e:
                    hata = cevir(e)
                    self.olay(f"bağlanma: {hata.kod}")
                    raise hata from None
                self.giris_sonu = time.monotonic() + GIRIS_SURESI
                self.bekleme = asyncio.create_task(self._giris_bekle())
        await self.one_getir()
        return await self.durum()

    async def one_getir(self) -> dict:
        try:
            await self.page.bring_to_front()
        except Exception:
            pass
        return {}

    async def _giris_bekle(self) -> None:
        while time.monotonic() < self.giris_sonu:
            if not self.page or self.page.is_closed():
                self.giris_hatasi = "pencere"
                self.olay("giriş: pencere")
                return
            if await self.bagli():
                self.mesaj = ""
                self.olay("giriş yapıldı")
                return
            try:
                adres = self.page.url.lower()
                if "login.aspx" in adres:
                    d = await self.page.evaluate("""() => { const l = document.getElementById('lblSonuclar'),
                        t = document.getElementById('tblLogin');
                        return {mesaj: l ? l.innerText.trim() : '', bitti: !!t && getComputedStyle(t).display === 'none'}; }""")
                    self.mesaj = d["mesaj"] or self.mesaj
                    if d["bitti"]:  # OBS formu 5 dakika sonra gizler
                        await self.page.goto(GIRIS, wait_until="domcontentloaded")
                elif "/redirect.aspx" in adres:
                    await self.page.goto(GIRIS, wait_until="domcontentloaded")
            except Exception:
                pass  # sayfa değişiyor
            await asyncio.sleep(0.7)
        self.giris_hatasi = "giris_suresi"
        self.olay("giriş: süre doldu")

    # ------------------------------------------------------------ sayfa işlemleri
    async def _bosta(self, fr: Frame) -> None:
        for _ in range(4):
            try:
                await fr.wait_for_load_state("domcontentloaded")
                await fr.wait_for_function(JS_BOSTA, timeout=60000)
                return
            except PWTimeout:
                raise
            except Exception:
                await asyncio.sleep(0.5)

    async def _postback(self, fr: Frame, js: str, arg=None) -> None:
        await self._bosta(fr)
        n = await fr.evaluate(JS_SAYAC)
        await fr.evaluate(js, arg)
        if n < 0:
            await asyncio.sleep(1)
            return await self._bosta(fr)
        son = time.monotonic() + 60
        while time.monotonic() < son:
            try:
                d = await fr.evaluate(JS_BITTI, n)
            except Exception:
                if fr.is_detached():
                    raise GirisGerekli("oturum") from None
                d = False
            if d is not False:
                if d.get("hata"):
                    raise ObsHatasi("beklenmeyen")
                return await self._bosta(fr)
            await asyncio.sleep(0.2)
        raise ObsHatasi("zaman")

    async def _ders_sayfasi(self, yenile: bool = False) -> Frame:
        if not await self.bagli():
            raise GirisGerekli("pencere" if self.page and self.page.is_closed() else "baglanti_yok")
        if self.headless_reader:
            if yenile:
                await self.page.reload(wait_until="domcontentloaded")
            if not await self.bagli():
                raise GirisGerekli("oturum")
            return self.page.main_frame
        fr = self.page.frame(name="IFRAME1")
        if yenile or not fr or "verilen_dersler.aspx" not in fr.url.lower():
            if fr:
                try:
                    await fr.evaluate("() => { window.__obsEski = true; }")
                except Exception:
                    pass
            if not await self.page.evaluate("""() => {
                    const a = [...document.querySelectorAll('a')].find(x => x.textContent.trim() === 'Verilen Dersler');
                    if (a) a.click(); return !!a; }"""):
                raise ObsHatasi("menu")
            for _ in range(60):
                await asyncio.sleep(0.5)
                fr = self.page.frame(name="IFRAME1")
                if not fr or not ANA_SAYFA.search(self.page.url) or "login.aspx" in fr.url.lower():
                    raise GirisGerekli("oturum")
                try:
                    if "verilen_dersler.aspx" in fr.url.lower() and not await fr.evaluate("() => !!window.__obsEski"):
                        break
                except Exception:
                    continue
            else:
                raise GirisGerekli("oturum")
        try:
            await fr.wait_for_selector("#cmb_donem", state="attached", timeout=30000)
        except PWTimeout:
            raise ObsHatasi("yapi") from None
        await self._bosta(fr)
        if self.transfer_tried:
            return fr
        self.transfer_tried = True
        # Test the authenticated course view before releasing the visible login window.
        # Some OBS installations bind a session to the original window; keep it in that case.
        original = self.ctx
        reader = None
        try:
            reader = await self.pw.chromium.launch(channel="chromium" if self.tarayici == "chromium" else self.tarayici, headless=True)
            context = await reader.new_context(storage_state=await original.storage_state(), accept_downloads=True, locale="tr-TR")
            page = await context.new_page()
            await page.goto(fr.url, wait_until="domcontentloaded", timeout=15000)
            await page.locator("#cmb_donem").wait_for(state="attached", timeout=5000)
            if await page.locator("#txtSecCode").count() or self.ctx is not original:
                raise RuntimeError("session unavailable")
        except Exception:
            if reader:
                await reader.close()
            self.olay("okuma: mevcut OBS penceresi")
            return fr
        self.ctx, self.page, self.headless_reader = context, page, reader
        await original.close()
        self.olay("okuma: arka plan")
        return page.main_frame

    async def _donem_sayfasi(self, donem: str, tazele: bool = False) -> Frame:
        fr = await self._ders_sayfasi()
        sec = next((o for o in await fr.evaluate(JS_SECENEKLER, "cmb_donem") if o["t"] == donem), None)
        if not sec:
            raise ObsHatasi("donem_yok")
        # Seçili görünen dönem ekrandaki tabloyla uyuşmayabilir, satırların dönemi de karşılaştırılır.
        beklenen = sade(re.sub(r"\(.*?\)", "", donem))
        uyumlu = all(sade(d["donem"]) == beklenen for d in (await fr.evaluate(JS_DERSLER))["dersler"])
        if tazele or not sec["s"] or not uyumlu:
            await self._postback(fr, JS_LISTELE, sec["v"])
        return fr

    async def _grid_sayfasi(self, fr: Frame, deger: Optional[str]) -> None:
        if deger is None:
            return
        if not any(o["s"] and o["v"] == deger for o in await fr.evaluate(JS_SECENEKLER, "grdDersler_cmb_PageSelector")):
            await self._postback(fr, JS_SAYFA, deger)

    async def _dersler(self, fr: Frame) -> list[dict]:
        ilk = await fr.evaluate(JS_DERSLER)
        if not ilk["tanindi"]:
            raise ObsHatasi("yapi")
        if len(ilk["sayfalar"]) < 2:
            return [dict(d, sayfa=None) for d in ilk["dersler"]]
        hepsi = []
        for s in ilk["sayfalar"]:
            await self._grid_sayfasi(fr, s["v"])
            hepsi += [dict(d, sayfa=s["v"]) for d in (await fr.evaluate(JS_DERSLER))["dersler"]]
        return hepsi

    async def _dene(self, ad: str, fn):
        """İşi yapar, sayfa beklenmedik davranırsa listeyi yeniden açıp bir kez daha dener."""
        async with self.kilit:
            bas = time.monotonic()
            try:
                try:
                    sonuc = await fn()
                except Exception as e:
                    ilk = cevir(e)
                    if isinstance(ilk, GirisGerekli) or ilk.kod in KESIN:
                        raise ilk from None
                    self.olay(f"{ad}: {ilk.kod}, yeniden deneniyor")
                    await self._ders_sayfasi(yenile=True)
                    sonuc = await fn()
                self.olay(f"{ad}: tamam {time.monotonic() - bas:.1f} sn")
                return sonuc
            except Exception as e:
                hata = cevir(e)
                self.olay(f"{ad}: {hata.kod}")
                if isinstance(hata, GirisGerekli):
                    # Adres hâlâ index.aspx olabilir. Giriş sayfasına dönülmezse oturum açık sanılır.
                    try:
                        if self.page and not self.page.is_closed():
                            await self.page.goto(GIRIS, wait_until="domcontentloaded")
                    except Exception:
                        pass
                raise hata from None

    # ------------------------------------------------------------ dışarıya açık işler
    async def donemler(self) -> list[dict]:
        async def is_():
            fr = await self._ders_sayfasi()
            return [{"ad": o["t"], "aktif": "aktif donem" in sade(o["t"])}
                    for o in await fr.evaluate(JS_SECENEKLER, "cmb_donem") if sade(o["t"]) != "tumu"]
        return await self._dene("dönemler", is_)

    async def dersler(self, donem: str) -> list[dict]:
        async def is_():
            fr = await self._donem_sayfasi(donem, tazele=True)
            return [{k: d[k] for k in ("kod", "ad", "sube", "program")} for d in await self._dersler(fr)]
        return await self._dene("dersler", is_)

    async def belge(self, donem: str, ders: dict, rapor: str) -> tuple[bytes, bool]:
        """PDF içeriği ve raporun boş görünüp görünmediği."""
        if rapor not in RAPORLAR:
            raise ObsHatasi("belge_yok")
        anahtar = [ders.get(k, "") for k in ("kod", "sube", "program")]

        async def is_():
            fr = await self._donem_sayfasi(donem)
            uyan = [d for d in await self._dersler(fr) if [d[k] for k in ("kod", "sube", "program")] == anahtar]
            if len(uyan) != 1:  # başka bir dersin belgesini yanlışlıkla alma
                raise ObsHatasi("ders_yok")
            await self._grid_sayfasi(fr, uyan[0]["sayfa"])
            simdi = next((d for d in (await fr.evaluate(JS_DERSLER))["dersler"] if d["dugme"] == uyan[0]["dugme"]), None)
            if not simdi or [simdi[k] for k in ("kod", "sube", "program")] != anahtar:
                raise ObsHatasi("ders_yok")
            await self._postback(fr, "(id) => document.getElementById(id).click()", uyan[0]["dugme"])
            try:
                await fr.wait_for_selector("#cmbModalPrintType", state="attached", timeout=30000)
            except PWTimeout:
                raise ObsHatasi("yapi") from None
            y = await fr.evaluate(JS_YAZDIR, RAPORLAR[rapor])
            if "yok" in y:
                raise ObsHatasi("belge_yok")
            if "ret" in y:
                raise ObsHatasi("ret", f"OBS: {y['ret']}")
            if "url" not in y:
                raise ObsHatasi("beklenmeyen")
            return await self._indir(y["url"], rapor, anahtar[0])
        return await self._dene(rapor, is_)

    async def _indir(self, url: str, rapor: str, kod: str) -> tuple[bytes, bool]:
        rp = await self.ctx.new_page()
        ekler: list[Page] = []
        inen: asyncio.Future = asyncio.get_running_loop().create_future()

        def indi(d):
            if not inen.done():
                inen.set_result(d)

        def sayfa_acildi(p: Page):
            ekler.append(p)
            p.on("download", indi)

        rp.on("download", indi)
        self.ctx.on("page", sayfa_acildi)
        try:
            await rp.goto(url, wait_until="domcontentloaded")
            try:
                await rp.wait_for_function(JS_HAZIR, timeout=90000)
            except PWTimeout:
                raise ObsHatasi("goruntuleyici") from None
            bos = await rp.evaluate(JS_BOS_MU, [rapor, kod])
            await rp.evaluate(JS_PDF)
            try:
                d = await asyncio.wait_for(inen, 120)
            except asyncio.TimeoutError:
                raise ObsHatasi("dosya_yok") from None
            try:
                icerik = Path(await d.path()).read_bytes()
            finally:
                await d.delete()
            if not icerik.startswith(b"%PDF"):
                raise ObsHatasi("pdf_degil")
            return icerik, bos
        finally:
            self.ctx.remove_listener("page", sayfa_acildi)
            for p in [rp, *ekler]:
                try:
                    await p.close()
                except Exception:
                    pass
