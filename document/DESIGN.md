# ODTU Mobil AR Design System

Field operations AR app for traffic signal/bus stop/cabinet assets at ODTU
intersections. iOS-style dark theme with lime primary accent.

## Brand

- **Name**: ODTU Mobil AR
- **Audience**: Field technicians inspecting traffic infrastructure at
  METU campus pilot area.
- **Aesthetic**: Field-ready dark UI, high contrast, large countdown
  numerals, lime (`#A4E83C`) signals interactive state.

## Colors

### Surface
- `bg` `#0F111A` — screen background
- `bgTransparent` `rgba(15,17,26,0.85)` — overlay panels on camera
- `card` `#1A1D2A` — AR cards / detail cards
- `cardElevated` `#22263A` — bottom sheet
- `chipBg` `#22263A`
- `border` `#2A2E3D`
- `borderStrong` `#3A3F55`
- `missingBg` `#2A2E3D`

### Text
- `text` `#FFFFFF`
- `textMuted` `#8A8FA3`
- `textDim` `#5A5F73`
- `textInverse` `#0F111A` (on lime)

### Accent
- `primary` `#A4E83C` — lime (AR tab circle, active state, primary buttons)
- `primaryAlt` `#86C520` — pressed lime

### Status
- `onlineDot` `#22C55E`
- `warn` `#FFD333`
- `ok` `#22C55E`
- `danger` `#FF4D4D`

### Signal phase (FIXED — all themes)
- `green` `#22C55E`
- `yellow` `#FACC15`
- `red` `#EF4444`
- `greenDim` `#166534`
- `yellowDim` `#854D0E`
- `redDim` `#991B1B`

### Tab bar
- `tabActive` `#A4E83C`
- `tabInactive` `#8A8FA3`
- `tabInactiveBg` `#0F111A`

### Progress
- `progressBg` `#2A2E3D`
- `progressFill` `#A4E83C`

### AR overlay
- `previewBg` `#000000` (AR camera)
- `bboxActive` lime 2px stroke, rounded 8px
- `leaderLine` lime 1.5px solid

## Typography

Sans-serif system. Sizes in pt.

- `countdown` 48 — signal countdown number (e.g., "18")
- `titleLg` 20 — section heading within card
- `title` 22 — screen title / asset id
- `section` 11 — uppercase section label (e.g., "GELEN OTOBÜSLER")
- `body` 15 — row text
- `bodySmall` 12 — descriptions, bus destination
- `number` 20 — bus line number / countdown unit
- `unit` 14 — "sn", "dk"
- `tab` 11 — bottom tab label
- `caption` 12 — metadata, hint text
- `btn` 14 — primary button label

Weights: 900 (headlines/numbers), 700 (row text), 500 (body), 800 (section).

Letter spacing: 0.4 (titles), 1.0-1.5 (section uppercase), 0.3 (tab labels).

## Spacing

- `xs` 4
- `s` 8
- `m` 12
- `l` 16
- `xl` 20
- `xxl` 24
- `sectionGap` 24

Cards: 14-18px border-radius, padding 16, 1px border in `border`.

## Status bar

iOS-style fake bar at top of every screen, 44pt height + safe-area top.

- Left: "9:41" white bold 15pt
- Right: "5G" text 11pt bold + 4 vertical signal bars (gradient heights) +
  battery icon (22x11 rounded rect + cap)
- Background: transparent over screen bg

## Top bar

48pt below status bar. Two icon-only buttons at left and right edges.

- Left: hamburger (☰) — opens Settings
- Right: question mark (?) — opens help (stub)
- Style: 40x40 dark semi-transparent rounded square with thin border
- Background: transparent (floats over content)

## Bottom tab bar

5 tabs evenly spaced, 60pt height.

- Tabs: **Harita | Kaynaklar | AR | Yakınlarım | Ayarlar**
- AR tab elevated: 60x60 lime circle, "AR" label in dark text, raised 8pt
- Other tabs: gray icon (emoji or symbol) + 11pt label
- Active tab: lime icon + label
- Background: `tabInactiveBg`, top hairline border

## Map

Stylized dark canvas. Future: real map tiles.

- Park area: rounded green rectangle (`#1E3A2B`), 30% of area
- Roads: 4-6 thick gray strips (`#262B3A`), horizontal + vertical + diagonal
- Buildings: thin outlined rounded rectangles, `border` color
- Pins: pill label (10pt) + downward triangle + 8px position dot
  - signal → green dot + lime label
  - stop → yellow dot + yellow label
  - panel → purple dot + purple label
  - me → white dot + lime pulse halo (animated scale 1→1.8)
- Compass: 28px circle, "N" glyph, lime text

## AR camera view

- Full-bleed dark preview (`#1A2030`) under overlay
- Bounding box: 2px lime stroke, 8px rounded corners, drawn at normalized
  asset position
- Leader line: 1.5px lime solid line from card corner to bbox edge
- Asset-typed overlay cards (left, 16px from edge):
  - **Signal** card: assetId + direction + phase dot + countdown + progress bar +
    next phase
  - **BusStop** card: stop name + "GELEN OTOBÜSLER" + 3 lines (line + destination
    + ETA) + "SON GEÇEN" + 2 lines + TÜMÜNÜ GÖR button
  - **Panel** card: assetId + ONLINE badge + controller + voltage + temperature
    + lastSeen + DETAY button
- BusStop top badge: lime pill + "ODTÜ DURAK 1023" + ▼ triangle (above card)
- Bottom-left: 88px radar with distance label (e.g., "8 m"), 3 ring
  concentric + 3 green dots + white arrow
- Bottom-right: 56px capture button — black outer + white inner circle
- Bottom: debug sim bar (Faz 1) — 4 buttons (SG-03/BS-07/KAB-01/Reset)

## AssetDetail

- Stack nav header: ← geri + "Varlık Detay"
- Thumbnail (large rounded gradient rectangle)
- assetId + green dot + "ONLINE"
- Direction label (uppercase)
- Divider
- 6 rows: Durum / Kalan Süre / Sonraki Faz / Çevrim Süresi / Plan / Bağlantı
- Primary button: "GEÇMİŞ KAYITLAR" (lime outline)

## History

- Stack nav header: ← geri + "Geçmiş Kayıtlar"
- Segmented control: BUGÜN | GÜN | HAFTA (active = lime text + underline)
- Date label: gray "20 Mayıs 2024"
- Timeline rows: time + phase dot + phase label + duration_sec
- Phase colors: green/yellow/red

## Settings

- Tab root, no nav header. Title "Ayarlar" at content top.
- Sections: AR Ayarları / Veri Ayarları / Hakkında
- Section header: 11pt uppercase gray, 1.2 letter-spacing
- Row container: card with 14pt border-radius
- Toggle row: lime Switch when on, label + description below
- Link row: label + value + chevron (›), pressable
- Cache row: lime value text, no chevron

## Stub screens

- **Resources** (Kaynaklar): 🗺 + "Kaynaklar" + "Sinyal grupları ve planlar
  burada listelenecek." + YAKINDA badge
- **Nearby** (Yakınlarım): 📍 + "Yakınlarım" + "Çevredeki varlıklar mesafeye
  göre sıralanacak." + YAKINDA badge

## Component tokens

- `BottomTabBar`: 60pt height, 5 slots, AR slot raised with lime circle
- `TopBar`: 48pt height, transparent
- `FakeStatusBar`: 44pt + safe-area
- `Radar`: 88px circle, 3 concentric rings, distance label top
- `CaptureButton`: 56px outer + 40px inner, white inner
- `SectionLabel`: 11pt uppercase, 1.2 letter-spacing
- `SignalDot`: 8-14px, signal phase color
- `AssetBbox`: SVG rect, lime, 2px stroke, 8px radius
- `AssetLeaderLine`: SVG line, lime, 1.5px
- `BusStopBadge`: pill + ▼ triangle, lime
- `MapPin`: label + ▼ + dot + optional pulse halo

## Screen inventory

| Route        | Purpose                          | Header  |
|--------------|----------------------------------|---------|
| Map          | Tab root — intersection overview | hidden  |
| AR           | Tab root — camera + overlay      | hidden  |
| Scan         | Camera scan in progress          | hidden  |
| Resources    | Tab root — signal sources        | hidden  |
| Nearby       | Tab root — nearby assets         | hidden  |
| AssetDetail  | Single asset detail              | native  |
| History      | Single asset history             | native  |
| Settings     | Tab root — settings              | hidden  |
