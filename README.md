# Değerlendirici

Değerlendirici, öğretim elemanlarının her ders için belgeleri toplamasını, sınav puanlarını incelemesini ve ders değerlendirme dosyasını ZIP olarak indirmesini sağlar. İzlenceyi okutur, soru puanlarını öğrenme çıktılarıyla eşleştirir ve Word raporu ile Excel not tablosunu üretir.

[Değerlendirici’yi aç](https://tunabirgun.github.io/degerlendirici/) · [OBS Köprüsü’nü indir (Windows x64)](https://github.com/tunabirgun/degerlendirici/releases/latest/download/Degerlendirici-OBS-Koprusu.exe) · [Mac · Apple Silicon](https://github.com/tunabirgun/degerlendirici/releases/latest/download/Degerlendirici-OBS-macOS-arm64.zip) · [Mac · Intel](https://github.com/tunabirgun/degerlendirici/releases/latest/download/Degerlendirici-OBS-macOS-x86_64.zip)

## İlk ders dosyanızı hazırlayın

1. **Yeni ders** ile başlayın. Ders bilgilerini kendiniz girebilir veya izlenceden okutabilirsiniz. Kaydetmeden önce tanınan bilgileri ve öğrenme çıktılarını kontrol edin.
2. **Not tablosu** ekranında OBS yoklamasından öğrenci listesini yükleyin. Bir sınav tanımlayıp soru puanlarını girin veya mevcut puan tablosunu içe aktarın.
3. **Belge Listesi** üzerinden cevap anahtarlarını ve öğrenci çalışmalarını ilgili sınava bağlayın. Raporu yazarken soru ve sınav ortalamaları ile öğrenme çıktısı eşleştirmelerinden yararlanın.
4. **Paket durumu** üzerinden eksikleri gözden geçirin. **Paketi İndir** seçili derse ait belgeleri tek bir ZIP içinde toplar. Eksik bölümler varken de paket alabilirsiniz.

## OBS’den belge aktarımı

İstanbul Yeni Yüzyıl Üniversitesi OBS akademik panelini kullanıyorsanız köprü, seçtiğiniz dersin belgelerini doğrudan alabilir. Elinizdeki dosyaları yükleyerek çalışmak için web uygulamasını açmanız yeterlidir.

1. **İlk kullanımda** Windows x64 için tek EXE’yi açın. Sürüm dosyaları bir kez kullanıcı klasörüne çıkarılır. Mac’te **Bu Mac Hakkında** bölümünde Apple çipi veya Intel işlemci yazmasına göre ZIP’i seçin. ZIP’i açıp **Değerlendirici OBS Köprüsü.app** dosyasını Uygulamalar’a taşıyın ve bir kez açın. Mac uygulaması Apple tarafından noterlenmemiştir. Kurumunuzun güvenlik ayarları açılmasını kısıtlayabilir. Her iki platformda da Python pakete dahildir. Köprü sistemdeki Edge veya Chrome’u kullanır. Bunlar açılamazsa ilk bağlantıda Playwright Chromium’u internetten indirip kullanıcı önbelleğinde saklar.
2. **Sonraki kullanımlarda** web sayfasında **OBS’ye bağlan** düğmesine basın. Tarayıcı onay isterse **Aç** seçeneğini kullanın. Kullanıcı adınızı, şifrenizi ve güvenlik kodunuzu OBS’nin kendi penceresinde girin.
3. Açılan yerel ders ekranında yılı, dönemi, kaynak dersi ve belgelerin kaydedileceği dersi seçin. **Belgeleri al** ile aktarımı başlatın. Girişten sonra köprü belgeleri arka planda okumayı dener. OBS oturumu bunu desteklemiyorsa giriş yaptığınız pencereyi kullanır.

| OBS belgesi | Değerlendirici’deki yeri |
| --- | --- |
| Ders Yoklama Listesi | PDF, Öğrenci Devam Çizelgesi’ne eklenir. Okunan öğrenci numaraları ve adlar yeni sınavların not tablosunda kullanılabilir. |
| Sınav Not Listesi | Harf Notları ve İstatistikler’e eklenir. **Harf notlarını oku** ile dağılımı inceleyebilirsiniz. |
| Sınıf Başarı İstatistikleri ve Not Başarı İstatistikleri | İki PDF, Harf Notları ve İstatistikler’de saklanır. |
| Eğitim Rehberi | Ders İzlencesi’ne eklenir. |

Aktarım sonunda eklenen ve OBS’de boş çıkan belgeleri görebilirsiniz. **Öğrenci listesini incele** ile kimlik bilgilerini kontrol edebilir, kısmi aktarımda **Kalanları yeniden dene** ile devam edebilirsiniz.

## Dosyanın sekiz bölümü

### 1. Dosya Kapağı ve Belgeler Listesi

Öğretim elemanının unvanını, adlarını ve soyadlarını ayrı işler. Kapakta soyadlarını büyük harfle yazar. Kapak şablonunda öğrenci faaliyeti türleri seçilebilir ve “Diğer” için açıklama yazılabilir. Kapak PDF veya Word olarak indirilebilir.

### 2. Ders İzlencesi

Yeni ders açarken veya mevcut derste izlence seçilebilir. DOCX dosyalarında metni, tabloları ve numaralı listeleri okur. Metin içeren PDF ve TXT dosyalarından yazıyı doğrudan alır. Taranmış sayfa ve görüntülerde tarayıcıda çalışan Türkçe OCR kullanır. Bulabildiği ders adını, kodunu, akademik yılı, dönemi ve sorumlu öğretim elemanını forma aktarır.

**Öğrenme çıktıları.** Araç numaralı ana ÖÇ’leri ayıklar, “a”, “b” gibi alt maddeleri dışarıda bırakmaya çalışır. Öğretim elemanı sonuçları gözden geçirir. Her çıktının numarasını ve metnini ayrı ayrı düzeltebilir veya yeni çıktı ekleyebilir. Taramanın kalitesi ve belgenin düzeni tanımayı etkiler.

### 3. Öğrenci Devam Çizelgesi

OBS ders veya sınav yoklamasından öğrenci numarası ve ad-soyad okuyabilir. XLS, XLSX, CSV, PDF ve taranmış PNG, JPG veya WebP desteklenir. Taramalarda OCR kullanılır. Okunan liste aktarım öncesinde gösterilir. Aynı numara için farklı adlar varsa kullanıcı doğru kaydı seçebilir. Liste yeni sınavlara temel olur. İstenirse mevcut sınavlara eksik öğrenciler eklenir ve girilmiş puanlar korunur.

### 4. Dönem Sonu Harf Notları ve İstatistikler

Uygun OBS harf notu PDF’sinden dağılımı okur ve onaya sunar. Not tablosundaki harfleri veya sayısal dönem sonu puanları için seçili baremi kullanabilir. Sınav ağırlıkları toplamı %100 olduğunda ve gerekli puanlar tam olduğunda ağırlıklı sonuç hesaplayabilir. Varsayılan eşikler düzenlenebilir. Harf başına öğrenci sayısını ve yüzdesini gösterir. Sütun ve pasta grafiklerini oluşturur. Grafikler rapora ve ZIP’e eklenebilir.

### 5. Faaliyet ve Not Tablosu

Vize, final, mazeret, bütünleme ve diğer faaliyetler ayrı sayfalarda tanımlanabilir. Soru sayısı, azami puan, sınav ağırlığı ve soruların hangi ÖÇ’leri ölçtüğü düzenlenebilir. Mazeret ve bütünleme dahil, hangi sınavların rapor istatistiklerine gireceğini hoca seçer. Öğrenciler katılmadı olarak işaretlenebilir. XLS/XLSX/CSV içe aktarımı, hücrelere toplu yapıştırma, boş Excel şablonu, Excel ve CSV dışa aktarımı sunulur.

### 6. Ders Değerlendirme Raporu

Öğretim elemanı giriş ve değerlendirme ölçütlerini, değerlendirme metnini ve başarıyı artırmak için yapılacak işlemleri yazar. Yazarken ana ÖÇ listesini, soru–ÖÇ eşleştirmelerini, soru başına azami ve ortalama puanları, sınav ortalamasını ve harf dağılımını inceleyebilir. Word çıktısında rapora dahil edilen sınavların tabloları, mevcutsa dağılım grafikleri, öğrenme çıktıları ve imza alanı bulunur. Uzun soru tabloları sayfa genişliğine göre bölünür. Yorum ve önerilerin yazarı öğretim elemanıdır.

### 7. Cevap Anahtarları

Her dosya bir sınava, istenirse bir veya birkaç soruya bağlanabilir. Soru seçimi boş bırakılırsa anahtar tüm sınava ait kabul edilir. Önerilen paket adı yükleme sırasında gösterilir (örneğin “Final Sınavı Cevap Anahtarı.pdf”).

### 8. Öğrenci Faaliyet Örnekleri

Örnekler sınava veya faaliyete ve “Yetersiz”, “Orta”, “İyi” düzeylerinden birine göre sınıflandırılır. Dosyalar sınav ve düzey bilgisiyle adlandırılır. PDF, JPG, PNG ve WebP örneklerinin pakete giren kopyalarına damga eklenir. Örneğin “Vize - İyi - 2/4” ilgili örneğin dört sayfasından ikincisini gösterir. Sayaç her dosyada yeniden başlar. Hangi öğrenci çalışmasının örnek olacağını öğretim elemanı seçer.

## Kayıtlar ve gizlilik

Dersler, puanlar ve belgeler tarayıcı profilinde IndexedDB ile saklanır. OCR ve belge üretimi cihazda çalışır. Köprü yalnızca `127.0.0.1` adresini dinler ve OBS hesabınız üzerinden listeleme ve yazdırma işlemleri yapar.

Web sayfasının ve köprünün açtığı yerel adresin ders kayıtları ayrıdır. Daha önce çalıştığınız derse ulaşmak için aynı adresi ve tarayıcı profilini kullanın. Site verilerini temizlemeden önce saklamak istediğiniz derslerin ZIP paketlerini indirin.

## Sorun giderme

| Karşılaştığınız durum | Yapılacak işlem |
| --- | --- |
| **OBS’ye bağlan** yerel sayfayı açmıyor | Cihazınıza uygun paketi indirip uygulamayı bir kez açın. Sonraki açılışta tarayıcının uygulamayı açma isteğini onaylayın. |
| Yerel sayfada bağlantı izni hatası var | Köprüyü yeniden açıp yönlendirildiğiniz sekmeyi kullanın. |
| Güncellemeden sonra eski arayüz açılıyor | Çalışmanızı kaydedin. Bilgisayarı yeniden başlattıktan sonra indirdiğiniz güncel dosyayı açın. |
| Başka hesaba ait dersler görünüyor | **Farklı hesapla gir** düğmesini kullanın. |
| Bir rapor boş geldi | Seçili dersin dönemini, şubesini ve programını kontrol edin. OBS’de boş raporlar pakete eklenmez. |
| Aktarım tamamlanmadı | Sonuç ekranındaki **Tanı bilgisi** ile hata ayrıntılarını inceleyin. **Kalanları yeniden dene** ile eksik belgeleri tekrar isteyin. |

## Kaynaktan çalıştırma

**Yalnızca web arayüzü.** Depo kökünden şu komutu çalıştırıp [yerel sayfayı](http://127.0.0.1:8000/degerlendirici/) açın.

```sh
python -m http.server 8000 --bind 127.0.0.1 --directory public
```

**Yerel OBS köprüsü.** Kaynaktan başlatmak için Python 3.10 veya üzeriyle aşağıdaki komutu çalıştırın. İlk açılışta başlatıcı bağımlılıkları hazırlar. macOS ve Linux’ta komut adı `python3` olabilir.

```sh
python obs-koprusu/baslat.py
```

**Windows paketini üretmek için** Windows x64 üzerinde temiz bir Python 3.13 ortamında, depo kökünden `.\obs-koprusu\build-windows.ps1` çalıştırın. Tek dosyalık çıktı `dist/Degerlendirici-OBS-Koprusu.exe` altında oluşur.

**Mac paketini üretmek için** macOS’ta temiz bir Python 3.13 ortamında `python -m pip install playwright==1.65.2 pyinstaller==6.22.3` ve `bash obs-koprusu/build-macos.sh` komutlarını çalıştırın. ZIP, derlemenin çalıştığı işlemci mimarisine göre adlandırılır.

Uygulama kodu, Türkçe OCR dosyaları ve belge şablonları `public/degerlendirici/` dizinindedir. GitHub Actions, `main` dalına gönderilen web değişikliklerini GitHub Pages’te yayımlar.

## Katkıda bulunanlar

- [@cihanunlu](https://github.com/cihanunlu) — OBS’den belge aktarımı için yerel köprü ve ders kayıtlarını sıfırlama arayüzü.
