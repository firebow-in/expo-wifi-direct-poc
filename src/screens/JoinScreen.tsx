import React, { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ChatMessage, ConnectionInfo, JoinResponse, Peer, RoomState } from 'expo-wifi-direct';
import { colors, borderRadius, spacing } from '../theme';

export function JoinScreen(props: {
  initialDisplayName: string;
  p2pEnabled: boolean;
  peers: Peer[];
  connectionInfo: ConnectionInfo;
  joinResponse: JoinResponse | null;
  roomState: RoomState | null;
  messages: ChatMessage[];
  lastError: string | null;
  clearError: () => void;
  onStartScan: () => void;
  onStopScan: () => void;
  onRequestJoin: (deviceAddress: string, displayName: string) => void;
  onSend: (text: string) => void;
  onLeave: () => void;
  onBack: () => void;
}) {
  const [displayName, setDisplayName] = useState<string>(props.initialDisplayName || 'Client');
  const [text, setText] = useState<string>('');

  useEffect(() => {
    setDisplayName((prev) => props.initialDisplayName || prev);
  }, [props.initialDisplayName]);

  useEffect(() => {
    props.onStartScan();
    return () => {
      props.onStopScan();
    };
  }, []);

  const joined = useMemo(
    () => props.roomState?.role === 'CLIENT' && !!props.joinResponse?.accepted,
    [props.roomState, props.joinResponse]
  );

  // --- Joined: Chat view (match reference image 3) ---
  if (joined) {
    const roomName = props.roomState?.roomName ?? 'Room';
    const hostName = props.roomState?.hostName ?? 'Host';
    return (
      <View style={styles.chatContainer}>
        <View style={styles.chatHeader}>
          <Pressable onPress={props.onLeave} style={styles.backButton}>
            <Ionicons name="chevron-back" size={24} color={colors.primary} />
            <Text style={styles.backButtonText}>Back</Text>
          </Pressable>
          <View style={styles.chatHeaderCenter}>
            <Text style={styles.roomTitle}>{roomName}</Text>
            <Text style={styles.connectedText}>
              <Text style={styles.greenDot}>• </Text>
              Connected: {hostName}
            </Text>
          </View>
          <View style={styles.headerIconPlaceholder} />
        </View>
        <View style={styles.p2pBanner}>
          <Text style={styles.p2pBannerText}>DIRECT P2P LINK ESTABLISHED</Text>
        </View>
        <ScrollView
          style={styles.messagesScroll}
          contentContainerStyle={styles.messagesContent}
          showsVerticalScrollIndicator={false}
        >
          {props.messages.map((m) => {
            const isMe = m.fromMemberId === 'CLIENT';
            return (
              <View
                key={m.id}
                style={[styles.messageRow, isMe ? styles.messageRowMe : styles.messageRowThem]}
              >
                {!isMe && (
                  <View style={styles.avatar}>
                    <Ionicons name="person" size={20} color={colors.textSecondary} />
                  </View>
                )}
                <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
                  <Text style={isMe ? styles.bubbleTextMe : styles.bubbleText}>{m.text}</Text>
                  <Text style={[styles.bubbleTime, isMe && styles.bubbleTimeMe]}>
                    {formatTime(m.ts)} {isMe && '• Delivered'}
                  </Text>
                </View>
              </View>
            );
          })}
        </ScrollView>
        <View style={styles.inputRow}>
          <Pressable style={styles.inputIconButton}>
            <Ionicons name="add" size={26} color={colors.primary} />
          </Pressable>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Message"
            placeholderTextColor={colors.textSecondary}
            style={styles.messageInput}
          />
          <Pressable
            onPress={() => {
              const t = text.trim();
              if (t.length > 0) {
                setText('');
                props.onSend(t);
              }
            }}
            style={styles.sendButton}
          >
            <Ionicons name="arrow-up" size={22} color="#FFF" />
          </Pressable>
        </View>
      </View>
    );
  }

  // --- Discovery: Nearby Devices (match reference image 2) ---
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={props.onBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Nearby Devices</Text>
        <Pressable onPress={props.onStartScan} style={styles.refreshButton}>
          <Ionicons name="refresh" size={22} color={colors.primary} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <View style={styles.scanIconWrap}>
            <Ionicons name="wifi" size={36} color={colors.primary} />
          </View>
          <Text style={styles.scanTitle}>Scanning for peers...</Text>
          <Text style={styles.scanHint}>
            Make sure Wi-Fi and Location are enabled on nearby devices.
          </Text>
          <Pressable
            onPress={props.onStopScan}
            style={({ pressed }) => [
              styles.stopScanButton,
              pressed && styles.stopScanButtonPressed,
            ]}
          >
            <Text style={styles.stopScanButtonText}>Stop Scanning</Text>
          </Pressable>
        </View>

        <View style={styles.foundHeader}>
          <Text style={styles.foundTitle}>FOUND DEVICES ({props.peers.length})</Text>
          <View style={styles.liveBadge}>
            <Text style={styles.liveBadgeText}>Live</Text>
          </View>
        </View>

        {props.peers.map((p) => (
          <View key={p.deviceAddress} style={styles.deviceCard}>
            <View style={styles.deviceIconWrap}>
              <Ionicons name="phone-portrait-outline" size={24} color={colors.text} />
            </View>
            <View style={styles.deviceInfo}>
              <Text style={styles.deviceName}>{p.deviceName || 'Unknown device'}</Text>
              <Text style={styles.deviceMeta}>Available</Text>
            </View>
            <Pressable
              onPress={() => props.onRequestJoin(p.deviceAddress, displayName.trim() || 'Client')}
              style={({ pressed }) => [
                styles.connectButton,
                pressed && styles.connectButtonPressed,
              ]}
            >
              <Text style={styles.connectButtonText}>Connect</Text>
            </Pressable>
          </View>
        ))}

        {props.peers.length === 0 && (
          <Text style={styles.noDevices}>No devices yet. Keep Location ON and retry scan.</Text>
        )}

        {props.lastError && (
          <Pressable onPress={props.clearError} style={styles.errorCard}>
            <Text style={styles.errorTitle}>Error</Text>
            <Text style={styles.errorMessage}>{props.lastError}</Text>
            <Text style={styles.errorDismiss}>Tap to dismiss</Text>
            {props.lastError.includes('group owner') && (
              <Text style={styles.errorHint}>
                Create room on the other phone first, then tap Connect again.
              </Text>
            )}
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours();
  const m = d.getMinutes();
  const am = h < 12;
  const h12 = h % 12 || 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${am ? 'AM' : 'PM'}`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    padding: spacing.sm,
    marginLeft: -spacing.sm,
  },
  backButtonText: {
    fontSize: 17,
    color: colors.primary,
    fontWeight: '500',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  refreshButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl * 2,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  scanIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  scanTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  scanHint: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  stopScanButton: {
    backgroundColor: colors.error,
    paddingVertical: 12,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.md,
  },
  stopScanButtonPressed: {
    opacity: 0.9,
  },
  stopScanButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
  },
  foundHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  foundTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  liveBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: borderRadius.pill,
  },
  liveBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFF',
  },
  deviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  deviceIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  deviceMeta: {
    fontSize: 13,
    color: colors.primary,
    marginTop: 2,
  },
  connectButton: {
    backgroundColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
  },
  connectButtonPressed: {
    opacity: 0.9,
  },
  connectButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFF',
  },
  noDevices: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  errorCard: {
    backgroundColor: '#FFEBEE',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: '#FFCDD2',
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  errorMessage: {
    fontSize: 14,
    color: colors.text,
    marginTop: 4,
  },
  errorDismiss: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 6,
  },
  errorHint: {
    fontSize: 13,
    color: colors.text,
    marginTop: spacing.sm,
    fontStyle: 'italic',
  },
  // Chat view styles
  chatContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  chatHeaderCenter: {
    flex: 1,
    alignItems: 'center',
  },
  roomTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  connectedText: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  greenDot: {
    color: colors.success,
  },
  headerIconPlaceholder: {
    width: 40,
    alignItems: 'flex-end',
  },
  p2pBanner: {
    backgroundColor: colors.border,
    paddingVertical: 8,
    alignItems: 'center',
  },
  p2pBannerText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  messagesScroll: {
    flex: 1,
  },
  messagesContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  messageRow: {
    flexDirection: 'row',
    marginBottom: spacing.md,
    alignItems: 'flex-end',
  },
  messageRowMe: {
    justifyContent: 'flex-end',
  },
  messageRowThem: {
    justifyContent: 'flex-start',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: borderRadius.lg,
  },
  bubbleThem: {
    backgroundColor: colors.card,
    borderBottomLeftRadius: 4,
  },
  bubbleMe: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  bubbleText: {
    fontSize: 16,
    color: colors.text,
  },
  bubbleTextMe: {
    fontSize: 16,
    color: '#FFF',
  },
  bubbleTime: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 4,
  },
  bubbleTimeMe: {
    color: 'rgba(255,255,255,0.9)',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  inputIconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageInput: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 20,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
