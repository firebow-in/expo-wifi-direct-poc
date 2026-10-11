import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ChatMessage, ConnectionInfo, JoinRequest, RoomState } from 'expo-wifi-direct';
import { colors, borderRadius, spacing } from '../theme';

export function HostScreen(props: {
  hostRoomName: string;
  hostHostName: string;
  p2pEnabled: boolean;
  connectionInfo: ConnectionInfo;
  joinRequests: JoinRequest[];
  roomState: RoomState | null;
  messages: ChatMessage[];
  lastError: string | null;
  clearError: () => void;
  onRetry: () => void;
  onAccept: (requestId: string) => void;
  onDeny: (requestId: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState<string>('');

  const roomName = props.roomState?.roomName ?? props.hostRoomName;
  const hostName = props.roomState?.hostName ?? props.hostHostName;
  const memberCount = (props.roomState?.members ?? []).length;

  function formatTime(ts: number): string {
    const d = new Date(ts);
    const h = d.getHours();
    const m = d.getMinutes();
    const am = h < 12;
    const h12 = h % 12 || 12;
    return `${h12}:${m.toString().padStart(2, '0')} ${am ? 'AM' : 'PM'}`;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={props.onStop} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={colors.primary} />
          <Text style={styles.backButtonText}>Back</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.roomTitle}>{roomName}</Text>
          <Text style={styles.connectedText}>
            <Text style={styles.greenDot}>• </Text>
            Connected{memberCount > 0 ? ` • ${memberCount} member(s)` : ''}
          </Text>
        </View>
        <Pressable style={styles.headerIconBtn}>
          <Ionicons name="information-circle-outline" size={24} color={colors.text} />
        </Pressable>
      </View>

      <View style={styles.p2pBanner}>
        <Text style={styles.p2pBannerText}>DIRECT P2P LINK ESTABLISHED</Text>
      </View>

      {props.lastError && (
        <Pressable onPress={props.clearError} style={styles.errorStrip}>
          <Text style={styles.errorStripText}>{props.lastError}</Text>
          <Text style={styles.errorDismiss}>Tap to dismiss</Text>
          {(props.lastError.includes('createGroup') || props.lastError.includes('P2P busy')) && (
            <Pressable onPress={props.onRetry} style={styles.retryButton}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
          )}
        </Pressable>
      )}

      {props.joinRequests.length > 0 && (
        <View style={styles.pendingCard}>
          <Text style={styles.pendingTitle}>Join requests</Text>
          {props.joinRequests.map((r) => (
            <View key={r.requestId} style={styles.pendingRow}>
              <Text style={styles.pendingName}>{r.name}</Text>
              <View style={styles.pendingActions}>
                <Pressable
                  onPress={() => props.onDeny(r.requestId)}
                  style={styles.denyButton}
                >
                  <Text style={styles.denyButtonText}>Deny</Text>
                </Pressable>
                <Pressable
                  onPress={() => props.onAccept(r.requestId)}
                  style={styles.acceptButton}
                >
                  <Text style={styles.acceptButtonText}>Accept</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}

      <ScrollView
        style={styles.messagesScroll}
        contentContainerStyle={styles.messagesContent}
        showsVerticalScrollIndicator={false}
      >
        {props.messages.map((m) => {
          const isMe = m.fromMemberId === 'HOST';
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    marginLeft: -spacing.sm,
  },
  backButtonText: {
    fontSize: 17,
    color: colors.primary,
    fontWeight: '500',
  },
  headerCenter: {
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
  headerIconBtn: {
    padding: spacing.sm,
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
  errorStrip: {
    backgroundColor: '#FFEBEE',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#FFCDD2',
  },
  errorStripText: {
    fontSize: 14,
    color: colors.text,
  },
  errorDismiss: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  retryButton: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    paddingVertical: 8,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.sm,
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFF',
  },
  pendingCard: {
    backgroundColor: colors.card,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pendingTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  pendingName: {
    fontSize: 16,
    color: colors.text,
  },
  pendingActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  denyButton: {
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.background,
  },
  denyButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  acceptButton: {
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.primary,
  },
  acceptButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFF',
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
