// Theme-aware alert dialog. Replaces native Alert.alert so dialogs follow the
// app's light/dark palette. Single-instance queue via context provider.

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme } from '@/lib/theme';

export interface AlertButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

export interface AlertOptions {
  title: string;
  message?: string;
  buttons?: AlertButton[];
}

interface QueueItem {
  id: number;
  options: AlertOptions;
  resolve: (buttonIndex: number) => void;
}

interface AlertContextValue {
  alert: (options: AlertOptions) => Promise<number>;
  confirm: (options: Omit<AlertOptions, 'buttons'> & { confirmText?: string; cancelText?: string; destructive?: boolean }) => Promise<boolean>;
}

const AlertContext = createContext<AlertContextValue | null>(null);

export function AlertProvider({ children }: { children: ReactNode }) {
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const [queue, setQueue] = useState<QueueItem[]>([]);

  const enqueue = useCallback((options: AlertOptions): Promise<number> => {
    return new Promise((resolve) => {
      setQueue((prev) => [...prev, { id: Date.now() + Math.random(), options, resolve }]);
    });
  }, []);

  const dismiss = useCallback((item: QueueItem, buttonIndex: number) => {
    setQueue((prev) => prev.filter((q) => q.id !== item.id));
    const btn = item.options.buttons?.[buttonIndex];
    if (btn?.onPress) btn.onPress();
    item.resolve(buttonIndex);
  }, []);

  const alert = useCallback<AlertContextValue['alert']>(
    (options) => enqueue({ ...options, buttons: options.buttons ?? [{ text: 'Tamam' }] }),
    [enqueue],
  );

  const confirm = useCallback<AlertContextValue['confirm']>(
    async (options) => {
      const idx = await enqueue({
        title: options.title,
        message: options.message,
        buttons: [
          { text: options.cancelText ?? 'İptal', style: 'cancel' },
          {
            text: options.confirmText ?? 'Onayla',
            style: options.destructive ? 'destructive' : 'default',
          },
        ],
      });
      return idx === 1;
    },
    [enqueue],
  );

  const value = useMemo<AlertContextValue>(() => ({ alert, confirm }), [alert, confirm]);

  const current = queue[0];

  return (
    <AlertContext.Provider value={value}>
      {children}
      <Modal
        transparent
        animationType="fade"
        visible={current !== undefined}
        onRequestClose={() => current && dismiss(current, 0)}
      >
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.title}>{current?.options.title ?? ''}</Text>
            {current?.options.message ? (
              <Text style={styles.message}>{current.options.message}</Text>
            ) : null}
            <View style={styles.btnRow}>
              {(current?.options.buttons ?? []).map((b, i) => (
                <Pressable
                  key={`${b.text}-${i}`}
                  style={({ pressed }: { pressed: boolean }) => [
                    styles.btn,
                    i > 0 && styles.btnGap,
                    b.style === 'destructive' && styles.btnDanger,
                    b.style === 'cancel' && styles.btnCancel,
                    b.style !== 'destructive' && b.style !== 'cancel' && styles.btnPrimary,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => current && dismiss(current, i)}
                >
                  <Text
                    style={[
                      styles.btnText,
                      b.style === 'destructive' && { color: t.textInverse },
                      b.style === 'cancel' && { color: t.primary, fontWeight: '700' },
                      b.style !== 'destructive' &&
                        b.style !== 'cancel' && { color: t.textInverse },
                    ]}
                  >
                    {b.text}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </AlertContext.Provider>
  );
}

export function useThemedAlert(): AlertContextValue {
  const ctx = useContext(AlertContext);
  if (!ctx) throw new Error('useThemedAlert outside AlertProvider');
  return ctx;
}

function makeStyles(t: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: t.overlay,
      justifyContent: 'center',
      paddingHorizontal: 24,
    },
    card: {
      backgroundColor: t.cardElevated,
      borderRadius: 16,
      padding: 20,
      borderWidth: 1,
      borderColor: t.border,
      shadowColor: t.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.6,
      shadowRadius: 8,
      elevation: 6,
    },
    title: { color: t.text, fontSize: t.type.title, fontWeight: '700' },
    message: { color: t.text, fontSize: t.type.body, marginTop: 10, lineHeight: 22 },
    btnRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 18, gap: 8 },
    btn: {
      paddingVertical: 12,
      paddingHorizontal: 18,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 46,
    },
    btnGap: {},
    btnPrimary: { backgroundColor: t.primary },
    btnCancel: { backgroundColor: t.chipBg, borderWidth: 1, borderColor: t.border },
    btnDanger: { backgroundColor: t.danger },
    pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
    btnText: { fontSize: t.type.btn, fontWeight: '700' },
  });
}
