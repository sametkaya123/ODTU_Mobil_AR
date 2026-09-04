// Field map screen — WebView + Leaflet + OpenStreetMap.
// Shows one pin per asset (Asset.lat/lon — Intersection has no GPS).
// Same/near coords cluster into one pin showing the count + type badges.
// Tap pin → bottom themed card. Single pin → asset detail. Cluster → list of assets at that coord.

import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { storage } from '@/lib/storage';
import { useThemedAlert } from '@/components/Alert';
import type { Asset, AssetType, Intersection } from '@/types/domain';
import { useTheme } from '@/lib/theme';

const TYPE_EMOJI: Record<AssetType, string> = {
  traffic_signal: '🚥',
  cabinet: '⚡',
  bus_stop: '🚏',
};

const TYPE_LABEL: Record<AssetType, string> = {
  traffic_signal: 'Sinyal',
  cabinet: 'Pano',
  bus_stop: 'Durak',
};

const TYPE_COLOR: Record<AssetType, string> = {
  traffic_signal: '#e74c3c',
  cabinet: '#3498db',
  bus_stop: '#2ecc71',
};

type Marker =
  | { kind: 'single'; id: string; lat: number; lon: number; type: AssetType }
  | { kind: 'cluster'; lat: number; lon: number; ids: string[]; types: AssetType[] };

interface SelectedGroup {
  assets: Asset[];
  intersection?: Intersection;
}

function coordKey(lat: number, lon: number): string {
  // ~1.1m precision — collapses GPS float jitter from medianPosition.
  return `${lat.toFixed(5)}|${lon.toFixed(5)}`;
}

// Greedy close-coord clustering. ~0.0003° ≈ 33m latitude / ~26m longitude at 40°N —
// group bus stop + signal + cabinet that sit at the same corner.
// Sorted by asset_id so the first member anchors the group; deterministic across runs.
function clusterNearby(assets: Asset[]): Asset[][] {
  const THRESHOLD = 0.0003;
  const sorted = [...assets].sort((a, b) => a.asset_id.localeCompare(b.asset_id));
  const groups: Asset[][] = [];
  for (const a of sorted) {
    const hit = groups.find(
      (g) => Math.abs(g[0].lat - a.lat) < THRESHOLD && Math.abs(g[0].lon - a.lon) < THRESHOLD,
    );
    if (hit) hit.push(a);
    else groups.push([a]);
  }
  return groups;
}

function isValidCoord(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    !(lat === 0 && lon === 0) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

function buildHtml(markers: Marker[]): string {
  const data = JSON.stringify(markers);
  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Harita</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <style>
    html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; }
    body { background: #aad3df; }
    .pin {
      width: 36px; height: 36px; border-radius: 18px;
      display: flex; align-items: center; justify-content: center;
      color: #fff; font-size: 18px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
      border: 3px solid #fff;
    }
    .pin.traffic_signal { background: #e74c3c; }
    .pin.cabinet        { background: #3498db; }
    .pin.bus_stop       { background: #2ecc71; }
    .cluster {
      width: 48px; height: 48px; border-radius: 24px;
      background: #2c3e50;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.5);
      border: 3px solid #fff;
      position: relative;
    }
    .cluster-count { color: #fff; font-size: 17px; font-weight: 700; }
    .cluster-dots { position: absolute; bottom: -4px; right: -4px; display: flex; }
    .cluster-dot { width: 12px; height: 12px; border-radius: 6px; border: 2px solid #fff; margin-left: -4px; }
    .leaflet-control-attribution { font-size: 11px; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    (function() {
      var markers = ${data};
      var map = L.map('map', { zoomControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19
      }).addTo(map);

      var bounds = [];
      var emoji = { traffic_signal: '🚥', cabinet: '⚡', bus_stop: '🚏' };
      var color = { traffic_signal: '#e74c3c', cabinet: '#3498db', bus_stop: '#2ecc71' };

      markers.forEach(function(m) {
        var html, size, anchor;
        if (m.kind === 'cluster') {
          var seen = {}; var dots = '';
          m.types.forEach(function(t) { if (!seen[t]) { seen[t] = 1; dots += '<span class="cluster-dot" style="background:' + color[t] + '"></span>'; } });
          html = '<div class="cluster"><span class="cluster-count">' + m.ids.length + '</span><span class="cluster-dots">' + dots + '</span></div>';
          size = [48, 48];
          anchor = [24, 24];
        } else {
          html = '<div class="pin ' + m.type + '">' + emoji[m.type] + '</div>';
          size = [36, 36];
          anchor = [18, 18];
        }
        var icon = L.divIcon({ className: 'marker-wrap', html: html, iconSize: size, iconAnchor: anchor });
        var mk = L.marker([m.lat, m.lon], { icon: icon }).addTo(map);
        if (m.kind === 'cluster') {
          mk.on('click', function() {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'selectGroup', ids: m.ids }));
          });
        } else {
          mk.on('click', function() {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'select', assetId: m.id }));
          });
        }
        bounds.push([m.lat, m.lon]);
      });

      if (markers.length === 1) {
        map.setView([markers[0].lat, markers[0].lon], 16);
      } else if (markers.length > 1) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
      } else {
        map.setView([39.0, 35.0], 6);
      }
    })();
  </script>
</body>
</html>`;
}

export default function HaritaScreen() {
  const router = useRouter();
  const t = useTheme();
  const styles = makeStyles(t);
  const insets = useSafeAreaInsets();
  const { alert } = useThemedAlert();

  const [markers, setMarkers] = useState<Marker[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SelectedGroup | null>(null);

  const load = useCallback(async () => {
    try {
      const [assets] = await Promise.all([storage.getAssets()]);
      // Group valid coords; same AND nearby (~30m) coords collapse to one pin.
      const valid = assets.filter((a) => isValidCoord(a.lat, a.lon));
      const groups = clusterNearby(valid);
      const ms: Marker[] = [];
      for (const group of groups) {
        if (group.length === 1) {
          const a = group[0];
          ms.push({ kind: 'single', id: a.asset_id, lat: a.lat, lon: a.lon, type: a.type });
        } else {
          const types = Array.from(new Set(group.map((a) => a.type)));
          ms.push({
            kind: 'cluster',
            lat: group[0].lat,
            lon: group[0].lon,
            ids: group.map((a) => a.asset_id),
            types,
          });
        }
      }
      setMarkers(ms);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await alert({ title: 'Hata', message: `Konumlar yüklenemedi: ${msg}` });
    } finally {
      setLoading(false);
    }
  }, [alert]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const html = useMemo(() => buildHtml(markers), [markers]);

  const onMessage = useCallback(async (event: { nativeEvent: { data: string } }) => {
    try {
      // Parse as one shape — fields vary by click type. Discriminate via type.
      const msg = JSON.parse(event.nativeEvent.data) as {
        type?: string;
        assetId?: string;
        ids?: string[];
      };
      const [assets, intersections] = await Promise.all([
        storage.getAssets(),
        storage.getIntersections(),
      ]);

      if (msg.type === 'selectGroup' && Array.isArray(msg.ids) && msg.ids.length > 0) {
        const idSet = new Set(msg.ids);
        const groupAssets = assets.filter((a) => idSet.has(a.asset_id));
        if (groupAssets.length === 0) return;
        const ix = intersections.find((x) => x.intersection_id === groupAssets[0].intersection_id);
        setSelected({ assets: groupAssets, intersection: ix });
        Haptics.selectionAsync().catch(() => {});
        return;
      }

      if (msg.type === 'select' && msg.assetId) {
        const asset = assets.find((a) => a.asset_id === msg.assetId);
        if (!asset) return;
        const ix = intersections.find((x) => x.intersection_id === asset.intersection_id);
        setSelected({ assets: [asset], intersection: ix });
        Haptics.selectionAsync().catch(() => {});
      }
    } catch {
      /* malformed payload — ignore */
    }
  }, []);

  const openAsset = useCallback(
    (asset: Asset) => {
      router.push({
        pathname: '/cekim',
        params: {
          intersection_id: asset.intersection_id,
          asset_id: asset.asset_id,
        },
      });
    },
    [router],
  );

  const closeCard = useCallback(() => {
    setSelected(null);
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.center}>
          <ActivityIndicator color={t.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (markers.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>🗺️</Text>
          <Text style={styles.emptyTitle}>Henüz konum yok</Text>
          <Text style={styles.emptyBody}>
            Haritada göstermek için önce asset ekleyip GPS kaydedin.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
            onPress={() => router.replace('/kavsak')}
          >
            <Text style={styles.btnText}>Kavşak Ekranına Dön</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const isCluster = selected && selected.assets.length > 1;
  const headerAsset = selected ? selected.assets[0] : null;

  return (
    <View style={styles.container}>
      <WebView
        style={styles.web}
        originWhitelist={['*']}
        source={{ html }}
        javaScriptEnabled
        domStorageEnabled
        onMessage={onMessage}
        onError={() => {
          alert({
            title: 'Hata',
            message: 'Harita yüklenemedi. İnternet bağlantınızı kontrol edin.',
          });
        }}
      />
      {selected ? (
        <View
          style={[styles.cardWrap, { paddingBottom: insets.bottom + 8 }]}
          pointerEvents="box-none"
        >
          <View style={[styles.card, isCluster ? styles.cardCluster : null]}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardEmoji}>
                {isCluster ? '📍' : headerAsset ? TYPE_EMOJI[headerAsset.type] : ''}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {isCluster ? `${selected.assets.length} öğe` : headerAsset?.asset_id}
                </Text>
                <Text style={styles.cardSubtitle} numberOfLines={1}>
                  {isCluster
                    ? 'Aynı konumdaki assetler'
                    : headerAsset
                    ? TYPE_LABEL[headerAsset.type]
                    : ''}
                </Text>
              </View>
              <Pressable
                onPress={closeCard}
                hitSlop={12}
                style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
              >
                <Text style={styles.closeBtnText}>×</Text>
              </Pressable>
            </View>

            {isCluster ? (
              <ScrollView style={styles.clusterList} keyboardShouldPersistTaps="handled">
                {selected.assets.map((a) => (
                  <Pressable
                    key={a.asset_id}
                    style={({ pressed }) => [styles.clusterRow, pressed && styles.pressed]}
                    onPress={() => openAsset(a)}
                  >
                    <View style={[styles.clusterRowEmoji, { backgroundColor: TYPE_COLOR[a.type] }]}>
                      <Text style={styles.clusterRowEmojiText}>{TYPE_EMOJI[a.type]}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.clusterRowId} numberOfLines={1}>
                        {a.asset_id}
                      </Text>
                      <Text style={styles.clusterRowSub} numberOfLines={1}>
                        {TYPE_LABEL[a.type]}
                        {a.description ? ` · ${a.description}` : ''}
                      </Text>
                    </View>
                    <Text style={styles.clusterRowChevron}>›</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : headerAsset ? (
              <>
                <View style={styles.cardRow}>
                  <Text style={styles.cardLabel}>Kavşak:</Text>
                  <Text style={styles.cardValue} numberOfLines={1}>
                    {selected.intersection?.intersection_id ?? headerAsset.intersection_id}
                  </Text>
                </View>
                {selected.intersection?.intersection_name ? (
                  <View style={styles.cardRow}>
                    <Text style={styles.cardLabel}>Açıklama:</Text>
                    <Text style={styles.cardValue} numberOfLines={2}>
                      {selected.intersection.intersection_name}
                    </Text>
                  </View>
                ) : null}
                {headerAsset.description ? (
                  <View style={styles.cardRow}>
                    <Text style={styles.cardLabel}>Not:</Text>
                    <Text style={styles.cardValue} numberOfLines={2}>
                      {headerAsset.description}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.cardRow}>
                  <Text style={styles.cardLabel}>Konum:</Text>
                  <Text style={styles.cardCoords}>
                    {headerAsset.lat.toFixed(6)}, {headerAsset.lon.toFixed(6)}
                  </Text>
                </View>
                <Pressable
                  style={({ pressed }) => [styles.detailBtn, pressed && styles.pressed]}
                  onPress={() => openAsset(headerAsset)}
                >
                  <Text style={styles.detailBtnText}>Detay →</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function makeStyles(t: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.bg },
    safe: { flex: 1, backgroundColor: t.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    web: { flex: 1 },
    emptyEmoji: { fontSize: 64, marginBottom: 8 },
    emptyTitle: { fontSize: t.type.title, fontWeight: '700', color: t.text, marginBottom: 6 },
    emptyBody: {
      fontSize: t.type.body,
      color: t.textMuted,
      textAlign: 'center',
      lineHeight: 22,
    },
    btn: {
      marginTop: 20,
      backgroundColor: t.primary,
      paddingVertical: 14,
      paddingHorizontal: 20,
      borderRadius: 12,
      alignItems: 'center',
      minHeight: 52,
      justifyContent: 'center',
    },
    pressed: { opacity: 0.7, transform: [{ scale: 0.97 }] },
    btnText: { color: t.textInverse, fontWeight: '700', fontSize: t.type.btn },
    cardWrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: 12,
    },
    card: {
      padding: 14,
      backgroundColor: t.cardElevated,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: t.border,
      shadowColor: t.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.6,
      shadowRadius: 8,
      elevation: 6,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 10,
    },
    cardEmoji: { fontSize: 32 },
    cardTitle: {
      fontSize: t.type.title,
      fontWeight: '700',
      color: t.text,
      fontFamily: 'monospace',
    },
    cardSubtitle: {
      fontSize: t.type.caption,
      color: t.primary,
      marginTop: 2,
      fontWeight: '600',
    },
    cardCluster: {
      maxHeight: 360,
    },
    clusterList: {
      maxHeight: 280,
    },
    clusterRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
      paddingHorizontal: 8,
      marginTop: 8,
      borderRadius: 10,
      backgroundColor: t.chipBg,
    },
    clusterRowEmoji: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    clusterRowEmojiText: { fontSize: 18 },
    clusterRowId: {
      fontSize: t.type.body,
      fontWeight: '600',
      color: t.text,
      fontFamily: 'monospace',
    },
    clusterRowSub: {
      fontSize: t.type.caption,
      color: t.textMuted,
      marginTop: 2,
    },
    clusterRowChevron: {
      fontSize: 28,
      color: t.textMuted,
      fontWeight: '300',
    },
    closeBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.chipBg,
    },
    closeBtnText: { fontSize: 22, color: t.text, fontWeight: '700', lineHeight: 24 },
    cardRow: { flexDirection: 'row', marginTop: 6, alignItems: 'flex-start' },
    cardLabel: {
      fontSize: t.type.body,
      color: t.textMuted,
      fontWeight: '600',
      width: 86,
    },
    cardValue: { fontSize: t.type.body, color: t.text, flex: 1 },
    cardCoords: {
      fontSize: t.type.caption,
      color: t.text,
      fontFamily: 'monospace',
      flex: 1,
    },
    detailBtn: {
      marginTop: 14,
      backgroundColor: t.primary,
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderRadius: 12,
      alignItems: 'center',
      minHeight: 50,
      justifyContent: 'center',
    },
    detailBtnText: { color: t.textInverse, fontWeight: '700', fontSize: t.type.btn },
  });
}
