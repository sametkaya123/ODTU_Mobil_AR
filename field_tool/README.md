# field_tool — Saha Referans Toplama

ODTÜ Mobil AR pilotu için saha ekiplerinin **kavşak bazında trafik
sinyali / pano / durak varlıklarını** fotoğraflayıp etiketliyor olduğu
Expo SDK 57 / React Native (managed) uygulaması.

## Çekirdek akış

1. **Ayarlar** → Proje ID (örn. `ODTU`) gir.
2. **Kavşak** ekranı → yeni kavşak ekle (`ODTU_K01`). Aç.
3. **Asset** ekranı → tipe göre asset ekle:
   - `Sinyal` → `signal_group_id` opsiyonel
   - `Pano` → `cabinet_subtype` (KKC / UPS / OG / Diğer)
   - `Durak` → `durak_kodu` opsiyonel
   - **GPS** butonu → mevcut konumu alıp lat/lon yaz.
4. **Çekim** ekranı → her asset için `distance_m × angle × light × posture`
   kombinasyonlarında referans fotoğraf çek (5×6×4×4 = 480 maks).
5. **Dışa Aktar** → tek kavşak ZIP'i:
   - `manifest.json` (Spec v2)
   - `manifest.csv` (özet tablo)
   - `assets/<asset_id>/NNN.jpg` dosyaları

## Stack

| Katman | Teknoloji |
|---|---|
| Runtime | Expo SDK 57, React 19.2, RN 0.86 (new architecture) |
| Nav | `expo-router` (file-based) |
| Storage | `@react-native-async-storage/async-storage` (JSON blob) |
| Konum | `expo-location` (GPS okuma, ortanca ile jitter temizleme) |
| Kamera | `expo-camera` |
| Harita | `react-native-webview` + Leaflet + OSM tile |
| Tema | RN StyleSheet + `useTheme` hook (light/dark) |
| Slugify | `src/lib/text.ts` (TR transliterasyon: ç→c, ğ→g, ı→i, ö→o, ş→s, ü→u) |

## Geliştirme

```bash
npm install                # bağımlılıklar
npm start                  # Metro + Expo Go (Android/iOS)
npm run android            # Android emülatörüne push
npm test                   # 44 unit test (manifest + slugify)
npx tsc --noEmit           # tip kontrolü
```

Tip denetimi ve test sıfır hata gerektirir.

## Test

Saf Node runner, RN bağımlılığı yok:

```bash
node --test test/*.test.mjs
```

- `test/manifest.test.mjs` — `buildManifest` davranışı (Spec v2:
  posture, type-özgü alanlar, back-compat) + slugs round-trip.
- `test/text.test.mjs` — `slugify` TR transliterasyon + opsiyonlar.

`buildManifest` kaynak dosyasıyla inlined mirror — manifest
schema değişirse ikisini senkron tut.

## Dizin yapısı

```
app/                      # expo-router ekranları
  index.tsx               # yönlendirme girişi
  kavsak.tsx              # kavşak listesi + yeni
  asset.tsx               # asset CRUD + GPS
  cekim.tsx               # referans çekim (kamera + etiketler)
  harita.tsx              # WebView + Leaflet harita + klüster
  disa_aktar.tsx          # ZIP dışa aktarım
  ayarlar.tsx             # proje ayarları + sayaçlar
  _layout.tsx             # tema + safe area
src/
  components/             # Paylaşılan UI (Alert, Checklist, …)
  lib/                    # storage, manifest, text, theme, settings, filesystem
  types/domain.ts         # Asset / Intersection / ReferenceImage şeması
test/                     # node --test saf Node testleri
```

## Veri modeli (Spec v2)

```ts
Intersection { intersection_id, intersection_name?, created_at }
Asset {
  intersection_id, asset_id, type: 'traffic_signal' | 'cabinet' | 'bus_stop',
  lat, lon, signal_group_id?, cabinet_subtype?, durak_kodu?,
  description?, backend_mapping?, created_at
}
ReferenceImage {
  asset_id, file_index,
  distance_m: 5|10|15|20|30,
  angle: 'on'|'sag_capraz'|'sol_capraz'|'karsi_kaldirim'|'yaklasma'|'uzaklasma',
  light: 'gunesli'|'bulutlu'|'golge'|'gece',
  posture: 'ayakta'|'oturarak'|'yukari_egik'|'asagi_egik',
  captured_at
}
```

`posture` alanı eski kayıtlarda yoksa `ayakta` sayılır (back-compat,
checklist + manifest).

## Manifest çıktısı

`disa_aktar` ekranı ZIP üretir:

- `manifest.json` — `buildManifest()` çıktısı, Spec v2.
- `manifest.csv` — düz tablo.
- `assets/<asset_id>/NNN.jpg` — 001'den başlayan padded dosya isimleri.

Asset sırası `asset_id.localeCompare`, referans görsel sırası
`file_index`. Tip-bazlı alanlar yalnızca ilgili tipte görünür
(diğer tiplerde key yok). Bilinmeyen değerler `null` yazılır.

## Harita klüster davranışı

Aynı koordinat **veya** ≤30 m mesafe (0.0003°) içindeki assetler tek
pin olur. Pin: koyu zemin, ortada sayı, sağ-alt köşede tip renkleri
(kırmızı sinyal, mavi pano, yeşil durak). Tıkla → alttaki kart:

- Tek asset → Kavşak / Açıklama / Not / Konum / Detay (eski kart)
- Klüster → `N öğe` başlığı + her satır tıklanabilir → `/cekim`

## APK üretimi (EAS Build)

```bash
npm install -g eas-cli          # bir kez
npx eas-cli login               # bir kez (Expo hesabı)
npx eas-cli build:configure     # eas.json üretir

# eas.json içine preview profili ekle (APK):
# {
#   "build": {
#     "preview": { "distribution": "internal", "android": { "buildType": "apk" } }
#   }
# }

npx eas-cli build --platform android --profile preview
```

Cloud'da 10-15 dk → APK indirme linki konsola düşer. Telefona
yüklemek için: bilinmeyen kaynaklara izin ver + APK tıkla.

AAB istersen (Play Store): `--profile production` veya
`buildType: "app-bundle"`.

## Ortam notları

- **Android**: kamera + konum izin manifest'te tanımlı
  (`CAMERA`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`).
- **iOS**: kamera izni ilk açılışta sorulur; konum izni
  `NSLocationWhenInUseUsageDescription` gerekir (otomatik).
- **GPS jitter**: `medianPosition()` 5 örnek alıp ortancayı yazar,
  ~1.1 m hassasiyette gruplanır.
- **Web preview**: Metro Web ile açılır ama kamera/yerel depolama
  kısıtlı — gerçek cihazda test et.

## Yol harici (PoC dışı)

- AsyncStorage → SQLite (`expo-sqlite`) — performans + sorgu.
- Çok-kullanıcı senkron — Supabase veya PocketBase.
- Captured fotoğraflar için EXIF → otomatik `captured_at` / GPS.
