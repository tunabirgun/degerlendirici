"""Optional eight-section package regression. All names, marks and documents are synthetic."""

import csv
import io
import math
import statistics
import tempfile
import zipfile
from functools import lru_cache
from pathlib import Path

from docx import Document
from openpyxl import Workbook, load_workbook
from PIL import Image
from pypdf import PdfReader
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas

COURSES = [
    ("VER218", "Veri Okuryazarlığı", "1", "Veri Bilimi"),
    ("REN204", "Renk ve Algı", "2", "Tasarım"),
    ("IST310", "Uygulamalı İstatistik", "1", "İstatistik"),
]
LIMITS = [[20, 30, 50], [25] * 4, [5] * 10 + [25, 25]]
TOTALS = [(100, 60, 80), (100, 56, 72), (74, 62, 68)]
LETTERS = [("AA", "DC", "BB", "DZ"), ("AA", "DC", "CB", "DZ"), ("BB", "CC", "CB", "DZ")]
OUTCOMES = [
    ["Veri türlerini ayırt eder.", "Tabloları yorumlar."],
    ["Renkleri sınıflandırır.", "Renk ilişkilerini açıklar."],
    ["Örneklem ortalamasını hesaplar.", "Dağılımları karşılaştırır."],
]
NAMES = [
    ["Ada Gül", "Deniz Ece Ak", "Bora Işık", "Öykü Can"],
    ["Duru Ekin", "Arda Gün", "Yağmur Şen", "Efe Öz"],
    ["Işıl Ay", "Ece Su Bay", "Çağrı Tan", "Ozan Gök"],
]
TEACHER = "Dr. Öğr. Üyesi Deniz Ada ÖRNEK"
FONT = (
    Path(__file__).resolve().parents[2]
    / "public/degerlendirici/print-assets/Tinos-Regular.ttf"
)
pdfmetrics.registerFont(TTFont("Tinos", str(FONT)))


def roster(k):
    return [[f"0{k + 1}2600{i + 1:02d}", name] for i, name in enumerate(NAMES[k])]


def marks(k):
    return [[m * pct / 100 for m in LIMITS[k]] for pct in TOTALS[k]] + [
        ["G"] * len(LIMITS[k])
    ]


def document(pages):
    buf = io.BytesIO()
    pdf = Canvas(buf, pagesize=A4, invariant=True)
    for page in pages:
        pdf.setFont("Tinos", 12)
        for y, cells in enumerate(page):
            for x, text in cells:
                pdf.drawString(x, 780 - y * 24, str(text))
        pdf.showPage()
    pdf.save()
    return buf.getvalue()


@lru_cache(maxsize=32)
def report_pdf(kind, k):
    code, name, _, _ = COURSES[k]
    title = [(48, f"{code} · {name}")]
    if kind == "egitim_rehber_bologna":
        texts = [
            "Ders İzlencesi",
            "Dersin adı: " + name,
            "Dersin kodu: " + code,
            "2025-2026 Güz",
            TEACHER,
            "Öğrenme Çıktıları",
            "1. " + OUTCOMES[k][0],
            "a) Yardımcı örnek verir.",
            "2. " + OUTCOMES[k][1],
            "Haftalık Ders Planı",
        ]
        data = document([[[(48, t)] for t in texts]])
        if k == 1:
            import pypdfium2

            doc = pypdfium2.PdfDocument(data)
            try:
                im = doc[0].render(scale=2.75).to_pil().convert("RGB")
            finally:
                doc.close()
            buf = io.BytesIO()
            im.save(buf, "PDF", resolution=198)
            return buf.getvalue()
        return data
    if kind in ("ou_sinif_listesi", "ou_not_listesi_yeni"):
        scores = kind == "ou_not_listesi_yeni"
        labels = [(48, "Öğrenci No"), (160, "Adı Soyadı")]
        labels += [(380, "B.Notu"), (460, "Sonuç")] if scores else [(425, "Devam")]
        rows = [
            title,
            [(48, "Dönem Sonu Not Listesi" if scores else "Genel Yoklama")],
            labels,
        ]
        for i, (sid, student) in enumerate(roster(k)):
            row = [(48, sid), (160, student)]
            rows.append(
                row
                + (
                    [
                        (380, LETTERS[k][i]),
                        (460, "Kaldı" if LETTERS[k][i] in ("DZ", "FF") else "Geçti"),
                    ]
                    if scores
                    else [(425, ["14/14", "12/14", "13/14", "4/14"][i])]
                )
            )
        return document([rows])
    return document(
        [
            [
                title,
                [
                    (
                        48,
                        "Sınıf Başarı İstatistikleri"
                        if kind == "sinif_basari_ist"
                        else "Not Başarı İstatistikleri",
                    )
                ],
                [(48, "Kayıtlı öğrenci: 4"), (260, "Sınava katılan: 3")],
                [(48, f"Sınav ortalaması: {statistics.mean(TOTALS[k]):g} / 100")],
            ]
        ]
    )


def make_inputs(root, k):
    ws = Workbook().active
    ws.title = "Final"
    separate = k == 2
    names = ["Adı", "Soyadı"] if separate else ["Adı Soyadı"]
    rows = [
        [
            "Öğrenci No",
            *names,
            *[f"{j + 1}. Soru" for j in range(len(LIMITS[k]))],
            "Harf Notu",
        ]
    ]
    for (sid, student), scores, letter in zip(
        roster(k), marks(k), [*LETTERS[k][:3], ""]
    ):
        rows.append(
            [
                sid,
                *(
                    student.rsplit(" ", 1)
                    if separate
                    else ["" if k == 1 and letter == "DC" else student]
                ),
                *scores,
                letter,
            ]
        )
    if k == 1:
        file = root / "Final.csv"
        with file.open("w", newline="", encoding="utf-8-sig") as stream:
            csv.writer(stream, delimiter=";").writerows(rows)
    else:
        file = root / "Final.xlsx"
        for row in rows:
            ws.append(row)
        ws.parent.save(file)
    code, name = COURSES[k][:2]
    key = root / "Anahtar.pdf"
    key.write_bytes(
        document(
            [
                [[(48, f"{code} · {name} · Final cevap anahtarı")]]
                + [
                    [
                        (48, f"{j + 1}. soru"),
                        (185, OUTCOMES[k][j % 2]),
                        (450, f"{m} puan"),
                    ]
                    for j, m in enumerate(LIMITS[k])
                ]
            ]
        )
    )
    samples = []
    for idx, level in [(0, "İyi"), (2, "Orta"), (1, "Yetersiz")]:
        p = root / (level + ".pdf")
        cover = [
            [(48, f"{code} · {name} · Final sınavı")],
            [(48, NAMES[k][idx])],
            [(48, f"Öğrenci çalışması · {level}")],
        ]
        values = [
            [(48, f"{j + 1}. soru"), (200, f"{v:g} / {LIMITS[k][j]} puan")]
            for j, v in enumerate(marks(k)[idx])
        ]
        p.write_bytes(document([cover, values]))
        samples.append(p)
    return file, key, samples


def check_result(path, k, key, narrative):
    code, name = COURSES[k][:2]
    with zipfile.ZipFile(path) as package:
        assert package.testzip() is None
        files = {p: package.read(p) for p in package.namelist() if not p.endswith("/")}
    assert {p[0] for p in files} == set("01234567")
    expected = {
        "egitim_rehber_bologna": "1",
        "ou_sinif_listesi": "2",
        "ou_not_listesi_yeni": "3",
        "not_ist": "3",
    }
    if k:
        expected["sinif_basari_ist"] = "3"
    for kind, section in expected.items():
        assert any(
            p.startswith(section + ".") and b == report_pdf(kind, k)
            for p, b in files.items()
        ), kind

    def one(section, ext):
        return next(
            b
            for p, b in files.items()
            if p.startswith(section + ".") and p.endswith(ext) and "/" not in p
        )

    cover = PdfReader(io.BytesIO(one("0", ".pdf"))).pages[0].extract_text()
    assert all(t in cover for t in (code, name, "2025–2026", "ÖRNEK")), cover
    assert key.read_bytes() in files.values()
    for level in ["İyi", "Orta", "Yetersiz"]:
        data = next(b for p, b in files.items() if p.startswith("7.") and level in p)
        pages = PdfReader(io.BytesIO(data)).pages
        assert len(pages) == 2
        for i, page in enumerate(pages):
            assert f"Final - {level} - {i + 1}/2" in page.extract_text()
    for kind in ("Pasta", "Sütun"):
        Image.open(
            io.BytesIO(
                next(b for p, b in files.items() if kind in p and p.endswith(".png"))
            )
        ).verify()
    data = one("4", ".xlsx")
    ws = load_workbook(io.BytesIO(data), data_only=True).active
    formulas = load_workbook(io.BytesIO(data), data_only=False).active
    rows = marks(k)
    first, total = 4, 4 + len(LIMITS[k])
    for i, ((sid, student), scores) in enumerate(zip(roster(k), rows), 4):
        assert [ws.cell(i, j).value for j in (2, 3)] == [sid, student], (
            code,
            i,
            ws.cell(i, 3).value,
        )
        assert [ws.cell(i, j).value for j in range(first, total)] == scores
        assert (
            ws.cell(i, total).value == "G"
            if i == 7
            else math.isclose(ws.cell(i, total).value, sum(scores))
        )
    means = [statistics.mean(values) for values in zip(*rows[:3])]
    assert ws.title == "Final"
    assert [ws.cell(3, j).value for j in range(first, total)] == [
        f"ÖÇ {1 + i % 2}" for i in range(len(means))
    ]
    for j, avg in enumerate(means + [statistics.mean(TOTALS[k])], first):
        assert (
            math.isclose(ws.cell(8, j).value, avg)
            and formulas.cell(8, j).data_type == "f"
        )
    doc = Document(io.BytesIO(one("5", ".docx")))
    body = "\n".join(p.text for p in doc.paragraphs)
    assert all(
        t in body
        for t in [
            code,
            *OUTCOMES[k],
            *narrative,
            f"{statistics.mean(TOTALS[k]):g} puan (n = 3)",
        ]
    ), body
    assert "Yardımcı örnek" not in body
    assert all(other[0] not in body for other in COURSES if other[0] != code)
    table = doc.tables[0]
    for j, avg in enumerate(means):
        block, col = divmod(j, 10)
        assert table.cell(block * 4, col + 1).text == f"{j + 1}. SORU"
        assert table.cell(block * 4 + 2, col + 1).text == str(1 + j % 2)
        assert math.isclose(
            float(table.cell(block * 4 + 3, col + 1).text.replace(",", ".")), avg
        )
    print(
        f"{code}: {len(files)} files, {len(means)} question averages, final {statistics.mean(TOTALS[k]):g}/100, 3 present, 1 absent",
        flush=True,
    )


def run_courses(page, out):
    out.mkdir(parents=True, exist_ok=True)

    def btn(name):
        return page.get_by_role("button", name=name, exact=True)

    def section(i):
        row = page.locator(f"#documentRow{i}")
        if row.get_attribute("aria-expanded") != "true":
            row.click()

    def upload(control, files):
        with page.expect_file_chooser() as event:
            control.click()
        event.value.set_files(files)

    def closed():
        page.locator("#modal[open]").wait_for(state="hidden")

    errors = []
    page.on("pageerror", lambda err: errors.append(str(err)))
    for k, (code, name, _, _) in enumerate(COURSES):
        print("Course", code, flush=True)
        page.locator(
            ("#selectedCoursePanel" if k else "#emptyCourses") + " .obs-connect"
        ).click()
        page.locator("#obsCourse").select_option(str(k), timeout=90000)
        for cb in page.locator("#obsForm [name=doc]").all():
            cb.check()
        page.locator("#obsFetch").click()
        page.locator("#obsOther").wait_for(timeout=150000)
        assert not page.locator("#obsAgain").count()
        diag = page.evaluate(
            "async()=>await(await fetch('/api/obs/tani',{headers:{'X-OBS-Koprusu':'1'}})).json()"
        )
        assert any("okuma: arka plan" in msg for msg in diag["olaylar"])
        page.locator("#obsLetters").click()
        page.locator("#obsReview").wait_for()
        assert page.locator("#obsReview select").evaluate_all(
            "els=>els.map(e=>e.value)"
        ) == list(LETTERS[k])
        btn("Dağılımı kullan").click()
        page.wait_for_function("course.obsLetters?.counts.length===4")
        page.locator("#modal .mhead button").click()
        assert page.evaluate("course.roster") == roster(k)
        section(1)
        btn("İzlenceyi oku").click()
        page.locator("#ocrForm").wait_for(timeout=90000)
        outcomes = page.locator("#ocrForm .oc-text").evaluate_all(
            "els=>els.map(e=>e.value)"
        )
        assert outcomes == OUTCOMES[k], (code, outcomes)
        btn("Bilgileri aktar").click()
        closed()
        with tempfile.TemporaryDirectory() as tmp:
            file, key, samples = make_inputs(Path(tmp), k)
            page.locator("#quick button").filter(has_text="Not tablosu").click()
            upload(btn("Puanları içe aktar"), file)
            btn("Tabloları ekle").click()
            page.locator("#gradeGrid").wait_for()
            actual = page.evaluate(
                "course.sheets[activeSheet].rows.map(row=>row.slice(0,2))"
            )
            assert actual == roster(k), (code, actual)
            assert page.evaluate("activeSheet") == "Final"
            if not page.locator("#examSettings").evaluate("e=>e.open"):
                page.locator("#examSettings summary").click()
            for j, limit in enumerate(LIMITS[k]):
                page.locator(f'[data-map="{j}"]').fill(f"ÖÇ {1 + j % 2}")
                page.locator(f'[data-max="{j}"]').fill(str(limit))
            page.locator("#examWeight").fill("100")
            btn("Ders dosyasına dön").click()
            for group, files in [(6, [key]), (7, samples)]:
                section(group)
                upload(btn("Dosya seç"), files)
                page.locator("#filingForm .filing").first.wait_for()
                for i, box in enumerate(page.locator("#filingForm .filing").all()):
                    box.locator(".file-kind").select_option("Final")
                    if group == 7:
                        box.locator(".file-level").select_option(files[i].stem)
                btn("Dosyaları ekle").click()
                closed()
            section(0)
            btn("Kapak oluştur").click()
            btn("Kapağı pakete ekle").click()
            closed()
            section(5)
            btn("Rapor hazırla").click()
            narrative = [
                f"{name} dersinin final sınavı {len(LIMITS[k])} sorudan oluşur. Sorular iki öğrenme çıktısını ölçmektedir.",
                f"Dört öğrenciden üçü sınava katıldı. Katılanların toplam puanları {min(TOTALS[k])} ile {max(TOTALS[k])} arasında, sınav ortalaması {statistics.mean(TOTALS[k]):g} puandır.",
                f"Gelecek dönem “{OUTCOMES[k][1]}” çıktısı için kısa bir uygulama ve bireysel geri bildirim planlanmıştır.",
            ]
            for selector, value in zip(["#intro", "#comment", "#actions"], narrative):
                page.locator(selector).fill(value)
            btn("Raporu pakete ekle").click()
            closed()
            for i in range(8):
                section(i)
                if not page.evaluate("i=>course.done[i]", i):
                    btn("Kontrol ettim, tamamla").click()
                    page.wait_for_function(
                        "i=>document.querySelector('#documentRow'+i+' .ready')", arg=i
                    )
            print("Reviewed", page.evaluate("course.done"), flush=True)
            assert page.evaluate("course.done.every(Boolean)")
            page.wait_for_function("document.querySelector('#count').textContent==='8'")
            page.reload()
            page.wait_for_function("document.querySelector('#count').textContent==='8'")
            page.locator("#pack").click()
            with page.expect_download(timeout=90000) as result:
                btn("ZIP indir").click()
            path = out / result.value.suggested_filename
            result.value.save_as(path)
            closed()
            check_result(path, k, key, narrative)
    assert not errors, errors
