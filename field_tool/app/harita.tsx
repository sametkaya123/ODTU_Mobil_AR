// Field map screen — WebView + Leaflet + OpenStreetMap.
// Stitch M3 teal "Harita" design. AppHeader sits on top, the WebView fills the
// body, and overlay controls (search/chips/RTK/recenter) float above it.
// The bottom peek card summarises the selected intersection; a cluster tap
// still reveals a scrollable list of the assets that share the coord.

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';

import { storage } from '@/lib/storage';
import { useThemedAlert } from '@/components/Alert';
import { IconSymbol } from '@/components/StatTile';
import { useTheme } from '@/lib/theme';
import type { Asset, AssetType, Intersection, ReferenceImage } from '@/types/domain';

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

type Filter = 'all' | AssetType;

const FILTER_LABEL: Record<Filter, string> = {
  all: 'Tümü',
  traffic_signal: 'Sinyal',
  cabinet: 'Pano',
  bus_stop: 'Durak',
};

const FILTER_OPTIONS: Filter[] = ['all', 'traffic_signal', 'cabinet', 'bus_stop'];

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

function typeColor(type: AssetType, t: ReturnType<typeof useTheme>): string {
  switch (type) {
    case 'traffic_signal':
      return t.signal;
    case 'cabinet':
      return t.cabinet;
    case 'bus_stop':
      return t.busStop;
  }
}

function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function buildHtml(
  markers: Marker[],
  colors: { signal: string; cabinet: string; busStop: string },
): string {
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
    .pin.traffic_signal { background: ${colors.signal}; }
    .pin.cabinet        { background: ${colors.cabinet}; }
    .pin.bus_stop       { background: ${colors.busStop}; }
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
    .user-dot {
      width: 22px; height: 22px; border-radius: 11px;
      background: #1e88e5;
      border: 3px solid #fff;
      box-shadow: 0 0 0 4px rgba(30,136,229,0.25);
      position: relative;
    }
    .user-dot-pulse {
      position: absolute; inset: -6px;
      border-radius: 50%;
      background: rgba(30,136,229,0.18);
      animation: pulse 1.8s ease-out infinite;
    }
    @keyframes pulse {
      0%   { transform: scale(0.6); opacity: 0.8; }
      100% { transform: scale(2.0); opacity: 0;   }
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    (function() {
      var markers = ${data};
      var userMarker = null;
      var userCircle = null;
      var map = L.map('map', { zoomControl: false });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19
      }).addTo(map);

      var bounds = [];
      var emoji = { traffic_signal: '🚥', cabinet: '⚡', bus_stop: '🚏' };
      var color = { traffic_signal: '${colors.signal}', cabinet: '${colors.cabinet}', bus_stop: '${colors.busStop}' };

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

      window.updateUserLocation = function(lat, lon, acc) {
        var ll = [lat, lon];
        if (!userMarker) {
          var dot = L.divIcon({
            className: 'user-dot-wrap',
            html: '<div class="user-dot"><div class="user-dot-pulse"></div></div>',
            iconSize: [22, 22],
            iconAnchor: [11, 11]
          });
          userMarker = L.marker(ll, { icon: dot, zIndexOffset: 1000 }).addTo(map);
        } else {
          userMarker.setLatLng(ll);
        }
        if (acc && acc > 0) {
          if (!userCircle) {
            userCircle = L.circle(ll, { radius: acc, color: '#1e88e5', fillColor: '#1e88e5', fillOpacity: 0.12, weight: 1 });
            userCircle.addTo(map);
          } else {
            userCircle.setLatLng(ll);
            userCircle.setRadius(acc);
          }
        }
      };
      window.recenterToUser = function() {
        if (userMarker) {
          map.setView(userMarker.getLatLng(), 16, { animate: true });
        }
      };
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
  const webRef = useRef<WebView>(null);

  const [assets, setAssets] = useState<Asset[]>([]);
  const [shots, setShots] = useState<ReferenceImage[]>([]);
  const [intersections, setIntersections] = useState<Intersection[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SelectedGroup | null>(null);
  const [userLoc, setUserLoc] = useState<{ lat: number; lon: number; acc: number } | null>(null);
  const [locPermission, setLocPermission] = useState<'granted' | 'denied' | 'unknown'>('unknown');

  const load = useCallback(async () => {
    try {
      const [allAssets, allShots, allIx] = await Promise.all([
        storage.getAssets(),
        storage.getShots(),
        storage.getIntersections(),
      ]);
      setAssets(allAssets);
      setShots(allShots);
      setIntersections(allIx);
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

  // Live user location — subscribe while screen is focused; push updates to WebView.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      let sub: Location.LocationSubscription | null = null;

      (async () => {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (cancelled) return;
          if (status !== 'granted') {
            setLocPermission('denied');
            return;
          }
          setLocPermission('granted');
          sub = await Location.watchPositionAsync(
            {
              accuracy: Location.Accuracy.High,
              distanceInterval: 5,
              timeInterval: 3000,
            },
            (pos) => {
              const next = {
                lat: pos.coords.latitude,
                lon: pos.coords.longitude,
                acc: pos.coords.accuracy ?? 0,
              };
              setUserLoc(next);
              const payload = JSON.stringify({
                type: 'userLocation',
                ...next,
              });
              webRef.current?.injectJavaScript(
                `window.updateUserLocation && window.updateUserLocation(${next.lat},${next.lon},${next.acc});true;`,
              );
              void payload;
            },
          );
        } catch {
          setLocPermission('denied');
        }
      })();

      return () => {
        cancelled = true;
        sub?.remove();
      };
    }, []),
  );

  // Counts for chips — always over the unfiltered, valid-coord set.
  const counts = useMemo(() => {
    const valid = assets.filter((a) => isValidCoord(a.lat, a.lon));
    return {
      all: valid.length,
      traffic_signal: valid.filter((a) => a.type === 'traffic_signal').length,
      cabinet: valid.filter((a) => a.type === 'cabinet').length,
      bus_stop: valid.filter((a) => a.type === 'bus_stop').length,
    };
  }, [assets]);

  // Build markers after applying the active filter + query.
  const markers = useMemo<Marker[]>(() => {
    const byType = filter === 'all' ? assets : assets.filter((a) => a.type === filter);
    const q = query.trim().toLocaleLowerCase('tr');
    const filtered = q
      ? byType.filter((a) => {
          if (a.asset_id.toLocaleLowerCase('tr').includes(q)) return true;
          if (a.description?.toLocaleLowerCase('tr').includes(q)) return true;
          if (a.intersection_id.toLocaleLowerCase('tr').includes(q)) return true;
          const ix = intersections.find((x) => x.intersection_id === a.intersection_id);
          if (ix?.intersection_name?.toLocaleLowerCase('tr').includes(q)) return true;
          return false;
        })
      : byType;
    const valid = filtered.filter((a) => isValidCoord(a.lat, a.lon));
    const groups = clusterNearby(valid);
    const out: Marker[] = [];
    for (const group of groups) {
      if (group.length === 1) {
        const a = group[0];
        out.push({ kind: 'single', id: a.asset_id, lat: a.lat, lon: a.lon, type: a.type });
      } else {
        const types = Array.from(new Set(group.map((a) => a.type)));
        out.push({
          kind: 'cluster',
          lat: group[0].lat,
          lon: group[0].lon,
          ids: group.map((a) => a.asset_id),
          types,
        });
      }
    }
    return out;
  }, [assets, filter, query, intersections]);

  const html = useMemo(
    () => buildHtml(markers, { signal: t.signal, cabinet: t.cabinet, busStop: t.busStop }),
    [markers, t.signal, t.cabinet, t.busStop],
  );

  const onMessage = useCallback(async (event: { nativeEvent: { data: string } }) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data) as {
        type?: string;
        assetId?: string;
        ids?: string[];
      };
      const [allAssets, intersections] = await Promise.all([
        storage.getAssets(),
        storage.getIntersections(),
      ]);

      if (msg.type === 'selectGroup' && Array.isArray(msg.ids) && msg.ids.length > 0) {
        const idSet = new Set(msg.ids);
        const groupAssets = allAssets.filter((a) => idSet.has(a.asset_id));
        if (groupAssets.length === 0) return;
        const ix = intersections.find((x) => x.intersection_id === groupAssets[0].intersection_id);
        setSelected({ assets: groupAssets, intersection: ix });
        Haptics.selectionAsync().catch(() => {});
        return;
      }

      if (msg.type === 'select' && msg.assetId) {
        const asset = allAssets.find((a) => a.asset_id === msg.assetId);
        if (!asset) return;
        const ix = intersections.find((x) => x.intersection_id === asset.intersection_id);
        setSelected({ assets: [asset], intersection: ix });
        Haptics.selectionAsync().catch(() => {});
      }
    } catch {
      /* malformed payload — ignore */
    }
  }, []);

  const closeCard = useCallback(() => setSelected(null), []);

  const closeFilterModal = useCallback(() => setFilterModalOpen(false), []);
  const chooseFilter = useCallback((next: Filter) => {
    setFilter(next);
    setFilterModalOpen(false);
    Haptics.selectionAsync().catch(() => {});
  }, []);

  // Recenter: pan to live user location if we have it; otherwise fall back
  // to a WebView reload (re-fits bounds on all markers).
  const recenter = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    if (userLoc) {
      webRef.current?.injectJavaScript(
        `window.recenterToUser && window.recenterToUser();true;`,
      );
    } else {
      webRef.current?.reload();
    }
  }, [userLoc]);

  // Peek card derived data — all assets in the selected intersection.
  const ixAssets = useMemo<Asset[]>(() => {
    if (!selected) return [];
    const ixId = selected.intersection?.intersection_id ?? selected.assets[0]?.intersection_id;
    if (!ixId) return [];
    return assets
      .filter((a) => a.intersection_id === ixId)
      .sort((a, b) => a.asset_id.localeCompare(b.asset_id));
  }, [selected, assets]);

  const ixShotCount = useMemo(() => {
    const ids = new Set(ixAssets.map((a) => a.asset_id));
    return shots.filter((s) => ids.has(s.asset_id)).length;
  }, [ixAssets, shots]);

  const breakdown = useMemo(() => {
    return {
      signal: ixAssets.filter((a) => a.type === 'traffic_signal'),
      cabinet: ixAssets.filter((a) => a.type === 'cabinet'),
      busStop: ixAssets.filter((a) => a.type === 'bus_stop'),
    };
  }, [ixAssets]);

  const openCekim = useCallback(() => {
    const target = selected?.assets[0];
    if (!target) return;
    router.push({
      pathname: '/cekim',
      params: { intersection_id: target.intersection_id, asset_id: target.asset_id },
    });
  }, [router, selected]);

  const openAsset = useCallback(
    (a: Asset) => {
      router.push({
        pathname: '/cekim',
        params: { intersection_id: a.intersection_id, asset_id: a.asset_id },
      });
    },
    [router],
  );

  const openDetail = useCallback(() => {
    const ixId = selected?.intersection?.intersection_id ?? selected?.assets[0]?.intersection_id;
    if (!ixId) return;
    router.push({ pathname: '/asset', params: { intersection_id: ixId } });
  }, [router, selected]);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={t.primary} />
      </View>
    );
  }

  const hasMarkers = markers.length > 0;
  const isCluster = (selected?.assets.length ?? 0) > 1;
  const headerAsset = selected?.assets[0];
  const headerIxId =
    selected?.intersection?.intersection_id ?? headerAsset?.intersection_id ?? '';
  const headerIxName = selected?.intersection?.intersection_name ?? headerIxId;

  return (
    <View style={styles.root}>
      <View style={styles.mapArea}>
        {hasMarkers ? (
          <WebView
            ref={webRef}
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
        ) : (
          <View style={styles.emptyMap}>
            <Text style={styles.emptyEmoji}>🗺️</Text>
            <Text style={styles.emptyTitle}>Henüz konum yok</Text>
            <Text style={styles.emptyBody}>
              Haritada göstermek için önce asset ekleyip GPS kaydedin.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.emptyBtn, pressed && styles.pressed]}
              onPress={() => router.replace('/kavsak')}
            >
              <Text style={styles.emptyBtnText}>Kavşak Ekranına Dön</Text>
            </Pressable>
          </View>
        )}

        {/* Top overlay: search + filter button */}
        {hasMarkers && (
          <View pointerEvents="box-none" style={styles.topOverlay}>
            <View style={styles.searchBar}>
              <IconSymbol name="search" size={22} color={t.primaryContainer} />
              <TextInput
                style={styles.searchInput}
                placeholder="Kavşak veya varlık ara…"
                placeholderTextColor={t.textMuted}
                value={query}
                onChangeText={setQuery}
                autoCorrect={false}
                returnKeyType="search"
                clearButtonMode="while-editing"
              />
              <Pressable
                style={({ pressed }) => [styles.filterBtn, pressed && styles.pressed]}
                onPress={() => {
                  setFilterModalOpen(true);
                  Haptics.selectionAsync().catch(() => {});
                }}
                hitSlop={6}
                accessibilityLabel="Filtre"
              >
                <IconSymbol name="filter_list" size={18} color={t.textInverse} />
                <Text style={styles.filterBtnText}>{FILTER_LABEL[filter]}</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Recenter button — anchored bottom-right, above nav */}
        {hasMarkers && (
          <Pressable
            style={({ pressed }) => [
              styles.recenterBtn,
              { bottom: insets.bottom + 96, right: 24 },
              pressed && styles.pressed,
            ]}
            onPress={recenter}
            hitSlop={6}
            accessibilityLabel={userLoc ? 'Konumuma Odaklan' : 'Haritayı Ortala'}
          >
            <IconSymbol
              name="my_location"
              size={24}
              color={userLoc ? t.primary : t.primaryContainer}
            />
          </Pressable>
        )}

        {/* Bottom peek card */}
        {selected ? (
          <View
            pointerEvents="box-none"
            style={[styles.cardWrap, { bottom: insets.bottom + 72, paddingBottom: 16 }]}
          >
            <View style={styles.peekCard}>
              <View style={styles.dragBar} />
              <Pressable
                style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
                onPress={closeCard}
                hitSlop={8}
              >
                <Text style={styles.closeBtnText}>×</Text>
              </Pressable>

              <View style={styles.headerRow}>
                <View style={{ flex: 1 }}>
                  <View style={styles.headerIdRow}>
                    <Text style={styles.ixId} numberOfLines={1}>
                      {headerIxId}
                    </Text>
                    <View style={styles.aktifPill}>
                      <Text style={styles.aktifPillText}>Aktif Bölge</Text>
                    </View>
                  </View>
                  <Text style={styles.ixName} numberOfLines={1}>
                    {headerIxName}
                  </Text>
                  <View style={styles.metaRow}>
                    <View style={styles.metaItem}>
                      <IconSymbol name="hub" size={14} color={t.primary} />
                      <Text style={styles.metaText}>{ixAssets.length} Varlık</Text>
                    </View>
                    <Text style={styles.metaSep}>•</Text>
                    <View style={styles.metaItem}>
                      <IconSymbol name="photo_library" size={14} color={t.primary} />
                      <Text style={styles.metaText}>{ixShotCount} Fotoğraf Kayıtlı</Text>
                    </View>
                  </View>
                </View>
                <Pressable
                  style={({ pressed }) => [styles.routesBtn, pressed && styles.pressed]}
                  onPress={() => Haptics.selectionAsync().catch(() => {})}
                  hitSlop={6}
                  accessibilityLabel="Kavşak Rota"
                >
                  <IconSymbol name="directions" size={20} color={t.textMuted} />
                </Pressable>
              </View>

              <View style={styles.actionsRow}>
                <Pressable
                  style={({ pressed }) => [styles.btnPrimary, pressed && styles.pressed]}
                  onPress={openCekim}
                >
                  <IconSymbol name="photo_camera" size={22} color={t.textInverse} />
                  <Text style={styles.btnPrimaryText}>Çekim Yap</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.btnSecondary, pressed && styles.pressed]}
                  onPress={openDetail}
                >
                  <IconSymbol name="visibility" size={20} color={t.primaryContainer} />
                  <Text style={styles.btnSecondaryText}>Detayları Gör</Text>
                </Pressable>
              </View>

              <View style={styles.breakdownHeader}>
                <Text style={styles.breakdownTitle}>Kavşak İçi Varlık Dağılımı</Text>
                <Pressable onPress={openDetail} hitSlop={6}>
                  <Text style={styles.breakdownLink}>Tümünü İncele</Text>
                </Pressable>
              </View>
              <View style={styles.breakdownRow}>
                <BreakdownMini
                  t={t}
                  label="Sinyal"
                  count={breakdown.signal.length}
                  dotColor={t.signal}
                  range={formatRange(breakdown.signal)}
                  rangeColor={t.tertiary}
                />
                <BreakdownMini
                  t={t}
                  label="Pano"
                  count={breakdown.cabinet.length}
                  dotColor={t.cabinet}
                  range={formatRange(breakdown.cabinet)}
                />
                <BreakdownMini
                  t={t}
                  label="Durak"
                  count={breakdown.busStop.length}
                  dotColor={t.busStop}
                  range={formatRange(breakdown.busStop)}
                />
              </View>

              {/* Cluster: scrollable list of the assets at this coord. */}
              {isCluster ? (
                <ScrollView
                  style={styles.clusterList}
                  contentContainerStyle={styles.clusterListContent}
                  keyboardShouldPersistTaps="handled"
                >
                  {selected.assets.map((a) => (
                    <Pressable
                      key={a.asset_id}
                      style={({ pressed }) => [styles.clusterRow, pressed && styles.pressed]}
                      onPress={() => openAsset(a)}
                    >
                      <View
                        style={[styles.clusterRowEmoji, { backgroundColor: typeColor(a.type, t) }]}
                      >
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
              ) : null}
            </View>
          </View>
        ) : null}

        {/* Filter modal — Tümü / Sinyal / Pano / Durak radios */}
        <Modal
          visible={filterModalOpen}
          animationType="fade"
          transparent
          onRequestClose={closeFilterModal}
        >
          <Pressable style={styles.modalBackdrop} onPress={closeFilterModal}>
            <Pressable
              style={[styles.modalSheet, { marginBottom: insets.bottom + 72, paddingBottom: 20 }]}
              onPress={() => {}}
            >
              <View style={styles.dragBar} />
              <Text style={styles.modalTitle}>Filtre</Text>
              <Text style={styles.modalSubtitle}>Haritada görmek istediğin varlık tipini seç</Text>

              {FILTER_OPTIONS.map((opt) => {
                const active = opt === filter;
                const dotKey: AssetType | null = opt === 'all' ? null : opt;
                const dotColor = dotKey ? typeColor(dotKey, t) : t.primaryContainer;
                const countKey = opt === 'all' ? 'all' : opt;
                return (
                  <Pressable
                    key={opt}
                    onPress={() => chooseFilter(opt)}
                    style={({ pressed }) => [
                      styles.filterOption,
                      active && styles.filterOptionActive,
                      pressed && { opacity: 0.85 },
                    ]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                  >
                    <View style={[styles.filterOptionRadio, active && styles.filterOptionRadioActive]}>
                      {active ? <View style={styles.filterOptionRadioDot} /> : null}
                    </View>
                    {dotKey ? (
                      <View style={[styles.filterOptionDot, { backgroundColor: dotColor }]} />
                    ) : (
                      <View
                        style={[
                          styles.filterOptionDot,
                          { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: t.textMuted },
                        ]}
                      />
                    )}
                    <Text
                      style={[
                        styles.filterOptionLabel,
                        active && { fontWeight: '800', color: '#fff' },
                      ]}
                      numberOfLines={1}
                    >
                      {FILTER_LABEL[opt]}
                    </Text>
                    <View
                      style={[
                        styles.filterOptionCount,
                        active && { backgroundColor: 'rgba(255,255,255,0.25)' },
                      ]}
                    >
                      <Text
                        style={[
                          styles.filterOptionCountText,
                          active && { color: '#fff' },
                        ]}
                      >
                        {counts[countKey]}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    </View>
  );
}

function formatRange(items: Asset[]): string {
  if (items.length === 0) return '—';
  if (items.length === 1) return items[0].asset_id;
  if (items.length === 2) return `${items[0].asset_id}, ${items[1].asset_id}`;
  return `${items[0].asset_id}…${items[items.length - 1].asset_id}`;
}

function BreakdownMini({
  t,
  label,
  count,
  dotColor,
  range,
  rangeColor,
}: {
  t: ReturnType<typeof useTheme>;
  label: string;
  count: number;
  dotColor: string;
  range: string;
  rangeColor?: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        padding: 8,
        borderRadius: 8,
        backgroundColor: t.chipBg,
        gap: 2,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: dotColor }} />
        <Text
          style={{
            fontSize: t.type.labelSm,
            fontWeight: '700',
            color: t.textMuted,
            letterSpacing: 0.3,
          }}
        >
          {label}
        </Text>
      </View>
      <Text
        style={{
          fontSize: t.type.headlineSm,
          fontWeight: '700',
          color: t.text,
          marginTop: 2,
        }}
      >
        {count} Adet
      </Text>
      <Text
        style={{
          fontSize: t.type.labelSm,
          fontWeight: '600',
          color: rangeColor ?? t.textMuted,
          letterSpacing: 0.2,
        }}
        numberOfLines={1}
      >
        {range}
      </Text>
    </View>
  );
}

function makeStyles(t: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
    mapArea: { flex: 1, position: 'relative' },
    web: { flex: 1 },
    emptyMap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    emptyEmoji: { fontSize: 64, marginBottom: 8 },
    emptyTitle: {
      fontSize: t.type.headlineMd,
      fontWeight: '700',
      color: t.text,
      marginBottom: 6,
    },
    emptyBody: {
      fontSize: t.type.bodyMd,
      color: t.textMuted,
      textAlign: 'center',
      lineHeight: 22,
    },
    emptyBtn: {
      marginTop: 20,
      backgroundColor: t.primary,
      paddingVertical: 14,
      paddingHorizontal: 20,
      borderRadius: 12,
      alignItems: 'center',
      minHeight: 52,
      justifyContent: 'center',
    },
    emptyBtnText: { color: t.textInverse, fontWeight: '700', fontSize: t.type.btn },
    pressed: { opacity: 0.7, transform: [{ scale: 0.97 }] },

    /* Top overlay (search + chips) */
    topOverlay: {
      position: 'absolute',
      top: 12,
      left: 0,
      right: 0,
      zIndex: 10,
      paddingHorizontal: 16,
    },
    searchBar: {
      height: 48,
      backgroundColor: t.cardLowest,
      borderRadius: 8,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      gap: 8,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 6,
      elevation: 3,
    },
    searchInput: {
      flex: 1,
      fontSize: t.type.bodyMd,
      color: t.text,
      padding: 0,
      margin: 0,
    },
    layersBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: t.chipBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    filterBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      height: 36,
      paddingHorizontal: 12,
      borderRadius: 8,
      backgroundColor: t.primaryContainer,
    },
    filterBtnText: {
      fontSize: t.type.labelMd,
      fontWeight: '700',
      color: t.textInverse,
      letterSpacing: 0.3,
    },
    chipRow: {
      flexDirection: 'row',
      gap: 6,
      paddingTop: 12,
      paddingRight: 16,
    },

    /* Recenter (live user location) */
    recenterBtn: {
      width: 48,
      height: 48,
      borderRadius: 8,
      backgroundColor: t.cardLowest,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.12,
      shadowRadius: 4,
      elevation: 3,
    },

    /* Bottom peek card */
    cardWrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 20,
    },
    peekCard: {
      backgroundColor: t.cardLowest,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 16,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.12,
      shadowRadius: 10,
      elevation: 8,
    },
    dragBar: {
      alignSelf: 'center',
      width: 48,
      height: 4,
      borderRadius: 2,
      backgroundColor: t.outlineVariant,
      marginBottom: 6,
    },
    closeBtn: {
      position: 'absolute',
      top: 8,
      right: 8,
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.chipBg,
      zIndex: 5,
    },
    closeBtnText: {
      fontSize: 22,
      color: t.text,
      fontWeight: '700',
      lineHeight: 24,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
      paddingTop: 4,
    },
    headerIdRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flexWrap: 'wrap',
    },
    ixId: {
      fontSize: t.type.dataMonoLg,
      fontWeight: '700',
      color: t.primary,
      letterSpacing: -0.3,
    },
    aktifPill: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      backgroundColor: withAlpha(t.tertiary, 0.15),
    },
    aktifPillText: {
      fontSize: t.type.labelSm,
      fontWeight: '700',
      color: t.tertiary,
      letterSpacing: 0.3,
    },
    ixName: {
      fontSize: t.type.titleMd,
      color: t.textMuted,
      marginTop: 2,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 6,
    },
    metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    metaText: {
      fontSize: t.type.labelMd,
      fontWeight: '600',
      color: t.textMuted,
    },
    metaSep: { color: t.outlineVariant, fontSize: t.type.labelMd },
    routesBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: t.chipBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionsRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 14,
    },
    btnPrimary: {
      flex: 1,
      height: 48,
      backgroundColor: t.primaryContainer,
      borderRadius: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 2,
      elevation: 1,
    },
    btnPrimaryText: {
      fontSize: t.type.labelLg,
      fontWeight: '600',
      color: t.textInverse,
    },
    btnSecondary: {
      flex: 1,
      height: 48,
      backgroundColor: t.chipBg,
      borderRadius: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    btnSecondaryText: {
      fontSize: t.type.labelLg,
      fontWeight: '600',
      color: t.primaryContainer,
    },
    breakdownHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 16,
    },
    breakdownTitle: {
      fontSize: t.type.labelSm,
      fontWeight: '700',
      color: t.textMuted,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    breakdownLink: {
      fontSize: t.type.labelSm,
      fontWeight: '700',
      color: t.primary,
    },
    breakdownRow: {
      flexDirection: 'row',
      gap: 6,
      marginTop: 6,
    },

    /* Cluster list (preserved) */
    clusterList: {
      marginTop: 12,
      maxHeight: 220,
    },
    clusterListContent: {
      gap: 6,
    },
    clusterRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
      paddingHorizontal: 10,
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
      fontSize: t.type.bodyMd,
      fontWeight: '700',
      color: t.text,
    },
    clusterRowSub: {
      fontSize: t.type.labelMd,
      color: t.textMuted,
      marginTop: 2,
    },
    clusterRowChevron: {
      fontSize: 28,
      color: t.textMuted,
      fontWeight: '300',
    },

    /* Filter modal */
    modalBackdrop: {
      flex: 1,
      backgroundColor: t.overlay,
      justifyContent: 'flex-end',
    },
    modalSheet: {
      backgroundColor: t.cardLowest,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 16,
      paddingTop: 8,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.18,
      shadowRadius: 10,
      elevation: 8,
    },
    modalTitle: {
      fontSize: t.type.headlineMd,
      fontWeight: '700',
      color: t.text,
      marginTop: 6,
    },
    modalSubtitle: {
      fontSize: t.type.bodySm,
      color: t.textMuted,
      marginTop: 4,
      marginBottom: 12,
    },
    filterOption: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 14,
      paddingHorizontal: 14,
      borderRadius: 14,
      backgroundColor: t.cardHigh,
      marginBottom: 8,
      borderWidth: 1.5,
      borderColor: t.border,
    },
    filterOptionActive: {
      backgroundColor: t.primaryContainer,
      borderColor: t.primaryContainer,
    },
    filterOptionRadio: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 2,
      borderColor: t.outlineVariant,
      alignItems: 'center',
      justifyContent: 'center',
    },
    filterOptionRadioActive: {
      borderColor: '#fff',
    },
    filterOptionRadioDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: '#fff',
    },
    filterOptionDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
    },
    filterOptionLabel: {
      flex: 1,
      fontSize: t.type.bodyMd,
      fontWeight: '600',
      color: t.text,
    },
    filterOptionCount: {
      minWidth: 28,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 9999,
      backgroundColor: t.cardLowest,
      alignItems: 'center',
      justifyContent: 'center',
    },
    filterOptionCountText: {
      fontSize: t.type.labelSm,
      fontWeight: '700',
      color: t.textMuted,
    },
  });
}
