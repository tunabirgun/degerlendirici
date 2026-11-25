"""Exercise a packaged bridge against a synthetic academic portal on loopback.

Use packaged_obs.py BRIDGE --full-output DIRECTORY for the three-course ZIP check.
It also needs python-docx, openpyxl, Pillow, pypdf and pypdfium2 in the test interpreter.
"""

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


courses = [
    ("SNT101", "Çizim", "1", "Sanat"),
    ("SNT202", "Tasarım", "1", "Sanat"),
    ("SNT101", "Çizim", "2", "Sanat"),
    ("SNT101", "Çizim", "1", "Mimarlık"),
]


def grid_rows():
    rows = []
    for i, (code, name, section, program) in enumerate(courses):
        button = f'<a id="grdDersler_btnPrintFromGrid_{i}" onclick="document.forms[0].elements.picked.value={i}">Yazdır</a>'
        values = ["2025-2026 Güz", section, code, name, program, button]
        rows.append("<tr>" + "".join("<td>" + v + "</td>" for v in values) + "</tr>")
    return "".join(rows)


def pdf(kind, picked):
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
    c.drawString(60, 740, courses[picked][0] + " - " + kind)
    c.drawString(60, 690, "Öğrenci No")
    c.drawString(180, 690, "Ad Soyad")
    c.drawString(60, 665, "01234567" if picked == 0 else "02345678")
    c.drawString(180, 665, "Deneme Ada")
    c.drawString(60, 640, "01234568" if picked == 0 else "02345679")
    c.drawString(180, 640, "Deneme Bora")
    c.save()
    return b.getvalue()


class Fixture(BaseHTTPRequestHandler):
    def handle(self):
        try:
            super().handle()
        except ConnectionResetError:
            # Chromium can close an unused, preconnected loopback socket at exit.
            pass

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
        picked = int(fields["picked"][0])
        assert 0 <= picked < len(courses)
        self.send(f"prolizPopup('/viewer?{kind}={picked}')")

    def do_GET(self):
        u = urlsplit(self.path)
        kind, _, value = u.query.partition("=")
        picked = int(value) if value else 0
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
                + "</tr>"
                + grid_rows()
                + '</table><input type="hidden" name="picked"><select name="cmbModalPrintType" id="cmbModalPrintType">'
                + "".join("<option>" + x + "</option>" for x in types)
                + "</select><select id=cmbModalSinavlar><option>Tüm Sınavlar</option></select></form>"
            )
        elif u.path == "/viewer":
            cells = "<tr><th>Öğrenci No</th><th>Ad Soyad</th></tr>" + (
                ""
                if kind == "sinif_basari_ist" and picked == 0
                else f"<tr><td>01234567</td><td>Test Öğrenci {courses[picked][0]}</td></tr>"
            )
            self.send(
                "<script>window.jsStiWebViewer1={reportParams:{pagesArray:["
                + json.dumps("<table>" + cells + "</table>")
                + ']},postExport(){location.href="/download?'
                + u.query
                + '";}}</script>'
            )
        elif u.path == "/download":
            self.send(pdf(kind, picked), "application/pdf", True)
        else:
            self.send("")


def check_package(page, picked):
    expected = {
        k: (1 if k == "egitim_rehber_bologna" else 2 if k == "ou_sinif_listesi" else 3)
        for k in types
    }
    if picked == 0:
        del expected["sinif_basari_ist"]
    page.locator("#pack").click()
    with page.expect_download() as dl:
        page.get_by_role("button", name="Taslak ZIP indir").click()
    with zipfile.ZipFile(dl.value.path()) as package:
        entries = {
            name: package.read(name)
            for name in package.namelist()
            if name.endswith(".pdf") and not name.startswith("0.")
        }
        assert len(entries) == len(expected), list(entries)
        for kind, section in expected.items():
            matches = [
                name for name, data in entries.items() if data == pdf(kind, picked)
            ]
            assert len(matches) == 1 and matches[0].startswith(f"{section}. "), (
                kind,
                matches,
            )
    print(
        courses[picked][0],
        "verified package section and PDF bytes",
        expected,
        flush=True,
    )


full_run = len(sys.argv) == 4 and sys.argv[2] == "--full-output"
if full_run:
    from full_course import COURSES, report_pdf, run_courses

    courses[:] = COURSES
    pdf = report_pdf

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
        if full_run:
            run_courses(p, Path(sys.argv[3]))
            b.close()
            sys.exit(0)
        p.locator("#emptyCourses .obs-connect").click()
        p.locator("#obsCourse option").first.wait_for(state="attached", timeout=280000)
        assert p.locator("#obsPanel").is_hidden()
        assert p.locator("#obsFetch").is_disabled()
        assert p.locator("#obsCourse option").count() == len(courses) + 1
        p.locator("#obsCourse").select_option("0")
        assert p.locator("#obsTarget").input_value() == ""
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
        check_package(p, 0)
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
        first_id = p.evaluate("course.id")
        p.locator("#add").click()
        for name, value in (
            ("code", "SNT202"),
            ("name", "Tasarım"),
            ("given", "Ada"),
            ("family", "Deneme"),
        ):
            p.locator(f'#form [name="{name}"]').fill(value)
        p.locator('#form [name="year"]').select_option("2025–2026")
        p.locator('#form [name="season"]').select_option("Güz")
        p.locator('#form button[type="submit"]').click()
        p.wait_for_function("course.code==='SNT202'")
        second_id = p.evaluate("course.id")
        p.locator("#selectedCoursePanel .obs-connect").click()
        course_box = p.locator("#obsCourse")
        target = p.locator("#obsTarget")
        for other in ("2", "3"):
            course_box.select_option(other)
            assert target.locator("option").count() == 1 and target.input_value() == ""
        course_box.select_option("0")
        assert target.input_value() == first_id
        course_box.select_option("1")
        assert target.input_value() == second_id
        for cb in p.locator("input[name=doc]").all():
            cb.check()
        p.locator("#obsFetch").click()
        p.locator("#obsOther").wait_for(timeout=150000)
        p.get_by_role("button", name="Kapat", exact=True).last.click()
        p.reload()
        p.wait_for_function("course?.id===localStorage.selectedCourse")
        assert (
            p.evaluate("course.id") == second_id and p.evaluate("course.given") == "Ada"
        )
        assert p.evaluate("course.roster.map(r=>r[0])") == ["02345678", "02345679"]
        check_package(p, 1)
        p.locator("#courses").select_option(first_id)
        assert p.evaluate("course.roster.map(r=>r[0])") == ["01234567", "01234568"]
        check_package(p, 0)
        print(
            "Verified selection across two codes, sections, programs and an existing course.",
            flush=True,
        )
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
                    ["taskkill", "/PID", cols[4], "/T", "/F"],
                    check=False,
                    capture_output=True,
                )
    else:
        proc.terminate()
    proc.wait()
    s.shutdown()
