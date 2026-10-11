import React, { useEffect, useMemo, useState } from 'react';
import { SafeAreaView, Text, View } from 'react-native';
import ExpoWifiDirect, {
  ChatMessage,
  ConnectionInfo,
  JoinRequest,
  JoinResponse,
  Peer,
  RoomState
} from 'expo-wifi-direct';
import { ensureWifiDirectPermissions } from './src/permissions';
import { HomeScreen } from './src/screens/HomeScreen';
import { HostScreen } from './src/screens/HostScreen';
import { JoinScreen } from './src/screens/JoinScreen';

type Screen = 'HOME' | 'HOST' | 'JOIN';

export default function App() {
  const [screen, setScreen] = useState<Screen>('HOME');

  const [permissionsOk, setPermissionsOk] = useState<boolean>(false);

  const [p2pEnabled, setP2pEnabled] = useState<boolean>(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo>({ groupFormed: false, isGroupOwner: false });

  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [joinResponse, setJoinResponse] = useState<JoinResponse | null>(null);

  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [joinDisplayName, setJoinDisplayName] = useState<string>('Client');
  const [hostRoomName, setHostRoomName] = useState<string>('Room');
  const [hostHostName, setHostHostName] = useState<string>('Host');

  useEffect(() => {
    const subs = [
      ExpoWifiDirect.addListener('onP2pStateChanged', (e) => setP2pEnabled(!!e.enabled)),
      ExpoWifiDirect.addListener('onPeersUpdated', (e) => setPeers(e.peers ?? [])),
      ExpoWifiDirect.addListener('onConnectionInfo', (e) => setConnectionInfo(e)),
      ExpoWifiDirect.addListener('onJoinRequest', (e) => setJoinRequests((prev) => [...prev, e])),
      ExpoWifiDirect.addListener('onJoinResponse', (e) => setJoinResponse(e)),
      ExpoWifiDirect.addListener('onRoomState', (e) => setRoomState(e)),
      ExpoWifiDirect.addListener('onChatMessage', (e) => setMessages((prev) => [...prev, e])),
      ExpoWifiDirect.addListener('onDisconnected', () => {
        setJoinRequests([]);
        setJoinResponse(null);
        setRoomState(null);
        setMessages([]);
        setScreen('HOME');
      }),
      ExpoWifiDirect.addListener('onError', (e) => setLastError(`${e.scope}: ${e.message}`))
    ];
    return () => {
      subs.forEach((s) => s.remove());
    };
  }, []);

  useEffect(() => {
    (async () => {
      const ok = await ensureWifiDirectPermissions();
      setPermissionsOk(ok);
      if (ok) {
        await ExpoWifiDirect.initialize();
      }
    })();
  }, []);

  const common = useMemo(
    () => ({
      p2pEnabled,
      peers,
      connectionInfo,
      joinRequests,
      joinResponse,
      roomState,
      messages,
      lastError,
      clearError: () => setLastError(null),
      resetSession: () => {
        setJoinRequests([]);
        setJoinResponse(null);
        setRoomState(null);
        setMessages([]);
      }
    }),
    [p2pEnabled, peers, connectionInfo, joinRequests, joinResponse, roomState, messages, lastError]
  );

  if (!permissionsOk) {
    return (
      <SafeAreaView style={{ flex: 1, padding: 16 }}>
        <Text style={{ fontSize: 18, fontWeight: '600' }}>Permissions required</Text>
        <Text style={{ marginTop: 12 }}>
          Grant Nearby Wi-Fi Devices (Android 13+) and Location permissions, and ensure Location is turned ON in system settings.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F2F2F7' }}>
      {screen === 'HOME' && (
        <HomeScreen
          p2pEnabled={common.p2pEnabled}
          onHost={async (roomName, hostName) => {
            common.resetSession();
            setHostRoomName(roomName);
            setHostHostName(hostName);
            await ExpoWifiDirect.startHost(roomName, hostName);
            setScreen('HOST');
          }}
          onJoin={(displayName) => {
            common.resetSession();
            setJoinDisplayName(displayName);
            setScreen('JOIN');
          }}
        />
      )}

      {screen === 'HOST' && (
        <HostScreen
          hostRoomName={hostRoomName}
          hostHostName={hostHostName}
          p2pEnabled={common.p2pEnabled}
          connectionInfo={common.connectionInfo}
          joinRequests={common.joinRequests}
          roomState={common.roomState}
          messages={common.messages}
          lastError={common.lastError}
          clearError={common.clearError}
          onRetry={async () => {
            common.clearError();
            await ExpoWifiDirect.startHost(hostRoomName, hostHostName);
          }}
          onAccept={async (requestId) => {
            setJoinRequests((prev) => prev.filter((r) => r.requestId !== requestId));
            await ExpoWifiDirect.respondToJoinRequest(requestId, true);
          }}
          onDeny={async (requestId) => {
            setJoinRequests((prev) => prev.filter((r) => r.requestId !== requestId));
            await ExpoWifiDirect.respondToJoinRequest(requestId, false);
          }}
          onSend={async (text) => {
            await ExpoWifiDirect.sendChatMessage(text);
          }}
          onStop={async () => {
            await ExpoWifiDirect.stopHost();
            common.resetSession();
            setScreen('HOME');
          }}
        />
      )}

      {screen === 'JOIN' && (
        <JoinScreen
          initialDisplayName={joinDisplayName}
          p2pEnabled={common.p2pEnabled}
          peers={common.peers}
          connectionInfo={common.connectionInfo}
          joinResponse={common.joinResponse}
          roomState={common.roomState}
          messages={common.messages}
          lastError={common.lastError}
          clearError={common.clearError}
          onStartScan={async () => {
            await ExpoWifiDirect.startDiscovery();
          }}
          onStopScan={async () => {
            await ExpoWifiDirect.stopDiscovery();
          }}
          onRequestJoin={async (deviceAddress, displayName) => {
            common.resetSession();
            await ExpoWifiDirect.requestJoin(deviceAddress, displayName);
          }}
          onSend={async (text) => {
            await ExpoWifiDirect.sendChatMessage(text);
          }}
          onLeave={async () => {
            await ExpoWifiDirect.leaveRoom();
            common.resetSession();
            setScreen('HOME');
          }}
          onBack={async () => {
            await ExpoWifiDirect.stopDiscovery();
            common.resetSession();
            setScreen('HOME');
          }}
        />
      )}
    </SafeAreaView>
  );
}
