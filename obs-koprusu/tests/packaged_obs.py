"""Exercise a packaged bridge against a synthetic academic portal on loopback."""

import io
import json
import os
import subprocess
import sys
import threading
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import sync_playwright
from reportlab.pdfgen.canvas import Canvas

types = [
    "ou_sinif_listesi",
    "ou_not_listesi_yeni",
    "sinif_basari_ist",
    "not_ist",
    "egitim_rehber_bologna",
]


def pdf(kind):
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    pdfmetrics.registerFont(
        TTFont(
            "Arial",
            str(
                Path(__file__).resolve().parents[2]
                / "public/degerlendirici/print-assets/Tinos-Regular.ttf"
            ),
        )
    )
    b = io.BytesIO()
    c = Canvas(b, invariant=True)
    c.setFont("Arial", 12)
    c.drawString(60, 740, "SNT101 - " + kind)
    c.drawString(60, 690, "Öğrenci No")
    c.drawString(180, 690, "Ad Soyad")
    c.drawString(60, 665, "01234567")
    c.drawString(180, 665, "Deneme Ada")
    c.drawString(60, 640, "01234568")
    c.drawString(180, 640, "Deneme Bora")
    c.save()
    return b.getvalue()


class Fixture(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send(self, body, typ="text/html; charset=utf-8", download=False):
        body = body.encode() if isinstance(body, str) else body
        self.send_response(200)
        if self.path.endswith("index.aspx"):
            self.send_header(
                "Set-Cookie",
                "mock_session=synthetic; HttpOnly; Path=/; SameSite=Strict",
            )
        self.send_header("Content-Type", typ)
        if download:
            self.send_header("Content-Disposition", "attachment; filename=report.pdf")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        fields = parse_qs(self.rfile.read(int(self.headers["Content-Length"])).decode())
        kind = fields["cmbModalPrintType"][0]
        assert self.path.endswith("verilen_dersler.aspx") and kind in types
        self.send("prolizPopup('/viewer?" + kind + "')")

    def do_GET(self):
        u = urlsplit(self.path)
        kind = u.query
        if u.path.endswith("login.aspx"):
            self.send(
                '<input id=txtSecCode><button id=btnLogin>Sentetik giriş</button><script>setTimeout(()=>location.replace("index.aspx"),1800)</script>'
            )
        elif u.path.endswith("index.aspx"):
            self.send(
                '<a target=IFRAME1 href="verilen_dersler.aspx">Verilen Dersler</a><iframe name=IFRAME1 id=IFRAME1></iframe>'
            )
        elif u.path.endswith("verilen_dersler.aspx"):
            if "mock_session=synthetic" not in self.headers.get("Cookie", ""):
                self.send("Giriş gerekli")
                return
            self.send(
                "<form><select id=cmb_donem><option>2025-2026 Güz</option></select><button type=button>Listele</button><table id=grdDersler><tr>"
                + "".join(
                    "<th>" + x + "</th>"
                    for x in ["Dönem", "Şb", "Ders Kodu", "Ders Adı", "Program", ""]
                )
                + "</tr><tr>"
                + "".join(
                    "<td>" + x + "</td>"
                    for x in [
                        "2025-2026 Güz",
                        "1",
                        "SNT101",
                        "Çizim",
                        "Sanat",
                        "<a id=grdDersler_btnPrintFromGrid_0>Yazdır</a>",
                    ]
                )
                + "</tr></table><select name=cmbModalPrintType id=cmbModalPrintType>"
                + "".join("<option>" + x + "</option>" for x in types)
                + "</select><select id=cmbModalSinavlar><option>Tüm Sınavlar</option></select></form>"
            )
        elif u.path == "/viewer":
            cells = "<tr><th>Öğrenci No</th><th>Ad Soyad</th></tr>" + (
                ""
                if kind == "sinif_basari_ist"
                else "<tr><td>01234567</td><td>Test Öğrenci SNT101</td></tr>"
            )
            self.send(
                "<script>window.jsStiWebViewer1={reportParams:{pagesArray:["
                + json.dumps("<table>" + cells + "</table>")
                + ']},postExport(){location.href="/download?'
                + kind
                + '";}}</script>'
            )
        elif u.path == "/download":
            self.send(pdf(kind), "application/pdf", True)
        else:
            self.send("")


s = ThreadingHTTPServer(("127.0.0.1", 0), Fixture)
threading.Thread(target=s.serve_forever, daemon=True).start()
env = {
    **os.environ,
    "PYTHONIOENCODING": "utf-8",
    "OBS_ADRES": f"http://127.0.0.1:{s.server_port}",
}
import socket
import tempfile
import time

with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
t = Path(tempfile.mkdtemp(prefix="obs-exe-test-"))
if os.name == "nt":
    capture = t / "capture.cmd"
    capture.write_text(
        '@echo off\n>"' + str(t / "url") + '" echo %*\n', encoding="ascii"
    )
else:
    capture = t / "capture"
    capture.write_text('#!/bin/sh\nprintf "%s" "$1" > "' + str(t / "url") + '"\n')
    capture.chmod(0o700)
env.update(
    OBS_PORT=str(port), BROWSER=str(capture) + (" %s" if os.name != "nt" else "")
)
for var in ["PYTHONPATH", "PYTHONHOME"]:
    env.pop(var, None)
env["PATH"] = (
    (os.environ["SystemRoot"] + "\\System32;" + os.environ["SystemRoot"])
    if os.name == "nt"
    else "/usr/bin:/bin"
)
exe = Path(sys.argv[1]).resolve()
start = time.perf_counter()
proc = subprocess.Popen([str(exe)], env=env)
try:
    for _ in range(200):
        if (t / "url").exists() and (t / "url").read_text().strip():
            break
        assert proc.poll() in (None, 0), proc.returncode
        time.sleep(0.5)
    url = (t / "url").read_text().strip().strip(chr(34)).split("#")[0]
    print("Ready in %.2f seconds" % (time.perf_counter() - start), flush=True)
    # Reopening the app must reach the same authenticated session.
    (t / "url").unlink()
    subprocess.run([str(exe)], env=env, timeout=20, check=True)
    for _ in range(100):
        if (t / "url").exists() and (t / "url").read_text().strip():
            break
        time.sleep(0.05)
    assert (t / "url").read_text().strip().strip(chr(34)).split("#")[0] == url
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel="chrome")
        p = b.new_page()
        p.set_default_timeout(45000)
        p.goto(url)
        p.locator("#emptyCourses .obs-connect").click()
        p.locator("#obsCourse option").first.wait_for(state="attached", timeout=280000)
        assert p.locator("#obsPanel").is_hidden()
        for width in (1280, 390, 320):
            p.set_viewport_size({"width": width, "height": 820})
            assert p.locator(".obs-documents label").count() == 5
            assert p.evaluate(
                "document.querySelector('#obsForm').scrollWidth <= document.querySelector('#modal').clientWidth"
            )

        p.set_viewport_size({"width": 1280, "height": 900})
        for cb in p.locator("input[name=doc]").all():
            cb.check()
        p.locator("#obsFetch").click()
        try:
            p.locator("#obsOther").wait_for(timeout=150000)
        except Exception:
            print(p.locator("#modal").inner_text(), flush=True)
            print(
                p.evaluate(
                    "async()=>await(await fetch('/api/obs/tani',{headers:{'X-OBS-Koprusu':'1'}})).json()"
                ),
                flush=True,
            )
            raise
        diag = p.evaluate(
            "async()=>await(await fetch('/api/obs/tani',{headers:{'X-OBS-Koprusu':'1'}})).json()"
        )
        assert any("okuma: arka plan" in msg for msg in diag["olaylar"]), diag
        print("Authenticated headless transfer verified", diag["tarayici"], flush=True)
        p.get_by_role("button", name="Kapat", exact=True).last.click()
        p.reload()
        p.locator("#pack").click()
        with p.expect_download() as dl:
            p.get_by_role("button", name="Taslak ZIP indir").click()
        with zipfile.ZipFile(dl.value.path()) as z:
            found = {
                t
                for t in types
                if pdf(t) in [z.read(n) for n in z.namelist() if n.endswith(".pdf")]
            }
            print("PDF payloads:", found, flush=True)
            assert found == set(types) - {"sinif_basari_ist"}
        assert p.evaluate("course.roster") == [
            ["01234567", "Deneme Ada"],
            ["01234568", "Deneme Bora"],
        ]
        p.locator("#quick button").filter(has_text="Not tablosu").click()
        p.get_by_role("button", name="İlk sınavı oluştur").click()
        p.locator("#newSheet button[type=submit]").click()
        p.wait_for_function("course.sheets.Vize?.rows.length===2")
        assert p.evaluate("course.sheets.Vize.rows.map(r=>r.slice(0,2))") == [
            ["01234567", "Deneme Ada"],
            ["01234568", "Deneme Bora"],
        ]
        print("New exam populated after reload with exact IDs and names.")
        p.locator("#homeLink").click()
        p.locator("#selectedCoursePanel .reset-open").click()
        p.locator("#resetForm .primary").click()
        p.wait_for_function("!document.querySelector('#modal').open")
        b.close()
finally:
    if os.name == "nt":
        # The single-file launcher can exit before its persistent worker.
        conns = subprocess.check_output(["netstat", "-ano", "-p", "tcp"], text=True)
        for line in conns.splitlines():
            cols = line.split()
            if (
                len(cols) == 5
                and cols[1] == f"127.0.0.1:{port}"
                and cols[2] == "0.0.0.0:0"
            ):
                subprocess.run(
                    ["taskkill", "/PID", cols[4], "/T", "/F"], capture_output=True
                )
    else:
        proc.terminate()
    proc.wait()
    s.shutdown()
