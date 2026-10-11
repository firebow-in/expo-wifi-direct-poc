import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, borderRadius, spacing } from '../theme';

export function HomeScreen(props: {
  p2pEnabled: boolean;
  onHost: (roomName: string, hostName: string) => void;
  onJoin: (displayName: string) => void;
}) {
  const [hostName, setHostName] = useState<string>('Host');
  const [roomName, setRoomName] = useState<string>('Room');
  const [displayName, setDisplayName] = useState<string>('Client');

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>Wi-Fi Direct Chat</Text>

      {/* System P2P Status card */}
      <View style={styles.card}>
        <View style={styles.p2pRow}>
          <View style={styles.p2pIconWrap}>
            <Ionicons name="wifi" size={28} color={colors.primary} />
          </View>
          <View style={styles.p2pTextWrap}>
            <Text style={styles.cardTitle}>System P2P Status</Text>
            <Text style={styles.p2pSubtext}>
              {props.p2pEnabled
                ? 'Wi-Fi Direct is ready.'
                : 'Wi-Fi Direct is not available.'}
            </Text>
          </View>
          <Switch
            value={props.p2pEnabled}
            onValueChange={() => {}}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor="#FFF"
            disabled
          />
        </View>
      </View>

      {/* Host a Chat card */}
      <View style={styles.card}>
        <View style={styles.sectionHeader}>
          <Ionicons name="people" size={20} color={colors.text} />
          <Text style={styles.cardTitle}>Host a Chat</Text>
        </View>
        <Text style={styles.label}>YOUR HOST NAME</Text>
        <TextInput
          value={hostName}
          onChangeText={setHostName}
          placeholder="e.g. Host"
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
        />
        <Text style={styles.label}>ROOM NAME</Text>
        <TextInput
          value={roomName}
          onChangeText={setRoomName}
          placeholder="e.g. Chat Room"
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
        />
        <Pressable
          onPress={() =>
            props.onHost(roomName.trim() || 'Room', hostName.trim() || 'Host')
          }
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.primaryButtonPressed,
          ]}
        >
          <Ionicons name="add" size={22} color="#FFF" />
          <Text style={styles.primaryButtonText}>Create Room</Text>
        </Pressable>
      </View>

      {/* Join a Chat card */}
      <View style={styles.card}>
        <View style={styles.sectionHeader}>
          <Ionicons name="people-outline" size={20} color={colors.text} />
          <Text style={styles.cardTitle}>Join a Chat</Text>
        </View>
        <Text style={styles.label}>DISPLAY NAME</Text>
        <TextInput
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="e.g. Client"
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
        />
        <Pressable
          onPress={() => props.onJoin(displayName.trim() || 'Client')}
          style={({ pressed }) => [
            styles.joinButton,
            pressed && styles.joinButtonPressed,
          ]}
        >
          <Ionicons name="search" size={22} color="#FFF" />
          <Text style={styles.joinButtonText}>Find Nearby Devices</Text>
        </Pressable>
      </View>

      {/* Info box */}
      <View style={styles.infoBox}>
        <Ionicons name="information-circle" size={22} color={colors.textSecondary} />
        <Text style={styles.infoText}>
          Ensure Wi-Fi and Location are ON on both devices. Discovery often fails
          with Location OFF. This app does not require internet connection.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl * 2,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
  p2pRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  p2pIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  p2pTextWrap: {
    flex: 1,
  },
  p2pSubtext: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.md,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: borderRadius.md,
    marginTop: spacing.xs,
  },
  primaryButtonPressed: {
    opacity: 0.85,
  },
  primaryButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFF',
  },
  joinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primaryDark,
    paddingVertical: 14,
    borderRadius: borderRadius.md,
    marginTop: spacing.xs,
  },
  joinButtonPressed: {
    opacity: 0.85,
  },
  joinButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFF',
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.warningBg,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.warningBorder,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },
});
