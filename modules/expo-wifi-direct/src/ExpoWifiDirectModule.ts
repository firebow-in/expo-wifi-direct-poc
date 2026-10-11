import { requireNativeModule } from 'expo-modules-core';

export type Peer = { deviceName: string; deviceAddress: string; status: number };

export type ConnectionInfo = {
  groupFormed: boolean;
  isGroupOwner: boolean;
  groupOwnerAddress?: string;
};

export type JoinRequest = { requestId: string; name: string };

export type JoinResponse = { accepted: boolean; memberId?: string; reason?: string };

export type RoomMember = { memberId: string; name: string; isHost: boolean };

export type RoomState = {
  roomName: string;
  hostName: string;
  members: RoomMember[];
  selfMemberId: string;
  role: 'HOST' | 'CLIENT';
};

export type ChatMessage = { id: string; fromMemberId: string; fromName: string; text: string; ts: number };

export type DisconnectedEvent = { reason?: string };

export type WifiDirectEvents = {
  onP2pStateChanged(event: { enabled: boolean }): void;
  onPeersUpdated(event: { peers: Peer[] }): void;
  onConnectionInfo(event: ConnectionInfo): void;
  onJoinRequest(event: JoinRequest): void;
  onJoinResponse(event: JoinResponse): void;
  onRoomState(event: RoomState): void;
  onChatMessage(event: ChatMessage): void;
  onDisconnected(event: DisconnectedEvent): void;
  onError(event: { scope: string; message: string }): void;
};

export interface ExpoWifiDirectNativeModule {
  addListener<K extends keyof WifiDirectEvents>(eventName: K, listener: WifiDirectEvents[K]): { remove: () => void };
  addListener(eventName: string, listener: (event: any) => void): { remove: () => void };
  initialize(): Promise<void>;
  startDiscovery(): Promise<void>;
  stopDiscovery(): Promise<void>;
  startHost(roomName: string, hostName: string): Promise<void>;
  stopHost(): Promise<void>;
  requestJoin(deviceAddress: string, displayName: string): Promise<void>;
  leaveRoom(): Promise<void>;
  respondToJoinRequest(requestId: string, accepted: boolean): Promise<void>;
  sendChatMessage(text: string): Promise<void>;
}

export default requireNativeModule<ExpoWifiDirectNativeModule>('ExpoWifiDirect');
