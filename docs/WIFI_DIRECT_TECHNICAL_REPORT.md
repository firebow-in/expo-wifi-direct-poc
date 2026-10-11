# Wi-Fi Direct Module — Full Technical Report

**Project:** wifi-direct-poc  
**Module:** expo-wifi-direct (Android native + TypeScript bridge)

This document is a **full detailed technical report** covering: **overview and architecture**, **endpoints (API and events)**, **implementation details** (with timings and code references), **what was added compared to the baseline Android Wi-Fi Direct API**, **TCP protocol**, **current and potential issues** (with causes and mitigations), **troubleshooting**, and **code references**.

---

## 1. Overview

### 1.1 Architecture

The application uses **Android Wi-Fi Direct (P2P)** to form a peer-to-peer group and **TCP sockets (port 8988)** for application-level communication (join requests, room state, and chat).

**Two-Layer Design**

| Layer | Role | How it is formed | Application use |
|-------|------|------------------|------------------|
| **P2P** | Group Owner (GO) + Client(s) | Host: `WifiP2pManager.createGroup`. Client: `connect(config)`. | Establishes group and provides GO IP for TCP. |
| **TCP** | Server on host, client on joiner | Host: `ServerSocket(8988)` on `0.0.0.0`. Client: `Socket(groupOwnerAddress, 8988)`. | Join requests, join responses, room state, chat messages. |

**Native modes**

- Exactly one mode at a time: **IDLE** | **HOST** | **CLIENT**.
- **HOST:** creates P2P group and runs TCP server.
- **CLIENT:** joins existing group and connects TCP client to GO.

**Why issues persist**

- Wi-Fi Direct is **OEM- and timing-sensitive** (group owner negotiation, “P2P busy”, TCP readiness).
- The module adds **delays, retries, and cleanup** so that **app restarts are generally not required**; remaining failures usually stem from device or network conditions (see Sections 5 and 6).

### 1.2 High-Level Flow

**HOST**

1. `initialize` → clear stale group (fire-and-forget `removeGroup`).
2. `startHost` → `removeGroup` (retry once after 2s on failure) → 1s delay → `createGroup` (retry once after 2.5s on BUSY).
3. On `connectionInfo` (groupFormed, isGroupOwner) → `startServerIfNeeded` (bind :8988, retry once after 1.5s) → 400ms delay → emit room state.
4. `accept()` loop → on `join_request` → `respondToJoinRequest` → chat (broadcast + local emit).

**CLIENT**

1. `initialize` → clear stale group.
2. `requestJoin` → `removeGroup` → 800ms delay → `connect(peer)` with `groupOwnerIntent = 0`.
3. On `connectionInfo` (groupFormed, !isGroupOwner) → `connectClientSocketIfNeeded(hostIp)`.
4. 1800ms delay → TCP connect (max 5 attempts, 2s apart, 90s socket timeout) → `join_request` → `join_response` / `room_state` → chat.

---

## 2. Endpoints (API Surface)

All public API and events are defined in the TypeScript bridge and implemented in the native module.

### 2.1 TypeScript API

**Defined in:** `modules/expo-wifi-direct/src/ExpoWifiDirectModule.ts`

| Method | Signature | Description |
|--------|-----------|-------------|
| `initialize()` | `(): Promise<void>` | Initializes P2P manager, registers broadcast receiver, clears stale group (fire-and-forget removeGroup). |
| `startDiscovery()` | `(): Promise<void>` | Starts peer discovery (`discoverPeers`). |
| `stopDiscovery()` | `(): Promise<void>` | Stops peer discovery. |
| `startHost(roomName, hostName)` | `(roomName: string, hostName: string): Promise<void>` | Clears group (with one retry), creates new group; resolves when group is created. |
| `stopHost()` | `(): Promise<void>` | Stops server, clears sockets, removes group. |
| `requestJoin(deviceAddress, displayName)` | `(deviceAddress: string, displayName: string): Promise<void>` | Removes group then connects to peer; TCP is handled asynchronously after P2P connect. |
| `leaveRoom()` | `(): Promise<void>` | Stops server/client, clears sockets, removes group. |
| `respondToJoinRequest(requestId, accepted)` | `(requestId: string, accepted: boolean): Promise<void>` | Sends join response and updates room state (if accepted). |
| `sendChatMessage(text)` | `(text: string): Promise<void>` | Host: broadcast to all members + local emit. Client: send to host over client socket. |

### 2.2 Events (Subscriptions)

Emitted from native; subscribed in app (e.g. `App.tsx`).

| Event | Payload type | When it is triggered |
|-------|--------------|------------------------|
| `onP2pStateChanged` | `{ enabled: boolean }` | P2P enabled/disabled (and on init if API 29+). |
| `onPeersUpdated` | `{ peers: Peer[] }` | Peer list changed (after discovery or connection change). |
| `onConnectionInfo` | `ConnectionInfo` | Group state updated (groupFormed, isGroupOwner, groupOwnerAddress). |
| `onJoinRequest` | `{ requestId: string; name: string }` | Client connected via TCP and sent join_request; host shows Accept/Deny. |
| `onJoinResponse` | `JoinResponse` | Host sent join_response (accepted + memberId/roomName/hostName, or denied + reason). |
| `onRoomState` | `RoomState` | Room members updated (roomName, hostName, members, selfMemberId, role). |
| `onChatMessage` | `ChatMessage` | Chat message received (id, fromMemberId, fromName, text, ts). |
| `onDisconnected` | `{ reason?: string }` | Group or socket lost (e.g. `group_lost`, `connection_lost`). |
| `onError` | `{ scope: string; message: string }` | Native error (startHost, requestJoin, clientSocket, server, etc.). |

### 2.3 Key Types (full)

```ts
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

export type ChatMessage = {
  id: string;
  fromMemberId: string;
  fromName: string;
  text: string;
  ts: number;
};

export type DisconnectedEvent = { reason?: string };
```

---

## 3. Implementation Details (Detailed)

Entry point for all logic below: `ExpoWifiDirectModule.kt`.

### 3.1 Initialize & Clear Stale Group

- **When:** On every `initialize()` call after `ensureInitialized()`.
- **What:** `manager?.removeGroup(channel, ActionListener)` with no-op success/failure so any leftover P2P group from a previous run is cleared. Resolve promise immediately (fire-and-forget).
- **Why:** Allows Create Room / Connect to work without app restart after crash or stale state.

```kotlin
manager?.removeGroup(channel, object : WifiP2pManager.ActionListener {
  override fun onSuccess() { }
  override fun onFailure(reason: Int) { }
})
promise.resolve(null)
```

### 3.2 startHost Flow (detailed)

- **Guards:** Reject if `isHostStarting` is true or if called within `startHostCooldownMs` (4000 ms) of last `startHost`. Set `isHostStarting = true` and `lastStartHostTimeMs = now`.
- **Cleanup:** `cleanupAllSockets()`, then `mode = HOST`, store `roomName`, `hostName`.
- **removeGroup:** Call `removeGroup`. On success → postDelayed 1000 ms → `tryCreateGroup(false)`. On failure → postDelayed 2000 ms → call `removeGroup` again (retry once); on second failure → clearHostStarting, mode = IDLE, reject with “Could not clear previous group…”.
- **createGroup:** On success → clearHostStarting, `requestConnectionInfoInternal()`, resolve. On failure with reason `2` (BUSY) → postDelayed 2500 ms → `tryCreateGroup(true)` once; otherwise reject with “createGroup failed: P2P busy or disabled…”.
- **After connectionInfo:** When `groupFormed && isGroupOwner`, `startServerIfNeeded()` (see 3.5), then postDelayed 400 ms → emit room state.
- **Code:** `tryRemoveGroupThenCreate(0)`, `tryCreateGroup(isRetry)`, `clearHostStarting()` on all exit paths and in `stopHost` / group disconnected.

### 3.3 requestJoin Flow (detailed)

- **Guard:** Reject with “Already connecting” if `mode == CLIENT && clientSocket == null && clientTargetDeviceAddress.isNotEmpty()`.
- **Cleanup:** `cleanupAllSockets()`, set `clientDisplayName`, `clientTargetDeviceAddress`.
- **Config:** `WifiP2pConfig` with `deviceAddress`, `WpsInfo.PBC`, and on API 29+ `groupOwnerIntent = 0` (prefer not to be GO).
- **removeGroup:** Call `removeGroup`; in both onSuccess and onFailure → postDelayed 800 ms → `doConnect()`.
- **doConnect:** Set `mode = CLIENT`, call `manager?.connect(channel, config, …)`. On success → `requestConnectionInfoInternal()`, resolve. On failure → emit error, mode = IDLE, reject.
- **TCP:** When `onConnectionInfo` has `groupFormed && !isGroupOwner`, `connectClientSocketIfNeeded(hostIp)` is invoked (see 3.4).

### 3.4 Client TCP Logic (connectClientSocketIfNeeded)

- **Thread:** Runs in a background thread.
- **Delay:** `Thread.sleep(1800)` before first connect attempt.
- **Abort:** If `mode != CLIENT` after sleep or before any attempt, return.
- **Attempts:** Up to 5 connect attempts; 2000 ms between attempts on failure.
- **Socket:** `Socket()` with `soTimeout = 90000` ms, connect timeout 8000 ms to `InetSocketAddress(hostIp, port)`.
- **On success:** Send `join_request`, then read loop for `join_response`, `room_state`, `chat_message`.
- **On failure (ECONNREFUSED after all attempts, or SocketTimeoutException):** Call `leaveP2pGroupAndEmitDisconnected("connection_lost")` (close client socket, removeGroup on main thread, mode = IDLE, emit onDisconnected). User can tap Connect again without restarting the app.

### 3.5 Host Server Binding (startServerIfNeeded)

- **First try:** `ServerSocket(port)` (8988). On failure → postDelayed 1500 ms and try once more.
- **On second failure:** Emit error “Could not start host server… Try stopping and creating room again.”
- **On success:** Start accept loop; for each accepted socket, spawn reader handling `join_request` / then route to `pendingJoinByRequestId` and emit onJoinRequest; for `chat_message` broadcast and local emit.

### 3.6 Edge Cases Handled

| Case | Handling |
|------|----------|
| Host lost GO role | In `handleModeWithConnectionInfo`: if `mode == HOST && !info.isGroupOwner` → removeGroup, emit “Host lost group owner role. Please stop and create room again.” |
| Client became GO | If `mode == CLIENT && info.isGroupOwner` → removeGroup, emit “This device became the group owner. Retry…” |
| Double tap Create Room | `isHostStarting` and 4 s cooldown; reject with clear message. |
| Double tap Connect | Reject with “Already connecting” when already in CLIENT with target set but no socket yet. |
| Join request socket closed before accept | `respondToJoinRequest`: send in try/catch; on send failure remove member from maps. |
| Chat send failure (client) | `sendChatMessage` in try/catch; on failure reject and emit “Connection lost. Message not sent.” |
| Overlapping connections | Mode and socket guards; cleanup on mode change. |

---

## 4. What We Added (Extras vs Baseline Source)

Compared to a minimal use of the Android Wi-Fi Direct API, the following were **added** in this module to improve reliability and UX (no app restart where possible).

| Category | What was added | Purpose |
|----------|----------------|---------|
| **Cleanup** | `removeGroup` on `initialize()` (fire-and-forget) | Clear stale group so Create Room / Connect work without restart. |
| **Host flow** | `removeGroup` before `createGroup`, with **one retry** (2 s later) on removeGroup failure | Avoid “P2P busy” and leftover group blocking createGroup. |
| **Host flow** | `createGroup` **retry once** (2.5 s later) when failure reason is 2 (BUSY) | Handle transient BUSY from stack/OEM. |
| **Host flow** | **isHostStarting** guard and **4 s cooldown** after last startHost | Prevent double-tap and overlapping startHost. |
| **Host flow** | Server bind **retry once** (1.5 s later) | Port may be briefly in use or timing race. |
| **Host flow** | **400 ms** delay after server start before first room state emit | Reduces race with client TCP connect. |
| **Client flow** | `removeGroup` before `connect`, then **800 ms** delay before `doConnect()` | Clean state before joining; allow stack to settle. |
| **Client flow** | **groupOwnerIntent = 0** (API 29+) | Prefer client not to become GO so host stays GO. |
| **Client flow** | **1800 ms** delay before first TCP connect attempt | Give host time to bind and accept. |
| **Client flow** | **5** TCP connect attempts, **2000 ms** between attempts | Handle host not ready or network delay. |
| **Client flow** | **90 s** socket read timeout (`soTimeout`) | Avoid blocking forever if other side dies without closing. |
| **Client flow** | On TCP failure: **leaveP2pGroupAndEmitDisconnected** (removeGroup + mode IDLE + onDisconnected) | User can retry Connect without restarting the app. |
| **requestJoin** | Reject if “already connecting” (mode CLIENT, no clientSocket, target set) | Prevent duplicate connect flows. |
| **Role handling** | Detect “host lost GO” and “client became GO”; removeGroup + emit clear message | Recover and guide user (e.g. “Start host first”). |
| **Sockets** | try/catch around `respondToJoinRequest` send and `sendChatMessage` (client) | No crash on closed socket; emit error and clean maps. |

---

## 5. TCP Protocol (Port 8988)

- **Format:** One JSON object per line (line-based JSON).
- **Direction:** Client → Host: `join_request`. Host → Client: `join_response`, `room_state`, `chat_message`. Host also broadcasts `room_state` and `chat_message` to all members.

**Message types and main fields**

| Type | Direction | Main fields |
|------|-----------|-------------|
| `join_request` | Client → Host | `type`, `name`, `ts` |
| `join_response` | Host → Client | `type`, `accepted`, optional `memberId`, `roomName`, `hostName`, or `reason` |
| `room_state` | Host → All | `type`, `roomName`, `hostName`, `members` (array of { memberId, name, isHost }) |
| `chat_message` | Both | `type`, `id`, `fromMemberId`, `fromName`, `text`, `ts` |

---

## 6. Current & Potential Issues

### 6.1 Current Issues (we see these)

| # | Issue | Cause | Code mitigation | What to try |
|---|-------|--------|------------------|-------------|
| 1 | ECONNREFUSED | Host not listening yet | 1800 ms delay + 5 TCP attempts (2 s apart); on failure leave group and emit disconnect | Wait 2–3 s after host “Connected” before client taps Connect; client can tap Connect again |
| 2 | P2P busy | Previous group active | removeGroup + retry once (host); removeGroup before connect (client) | Toggle Wi-Fi; retry Create Room after a few seconds |
| 3 | Client became GO | Android election | groupOwnerIntent = 0; on detect removeGroup and emit message | Start host first, wait for group, then client connects |
| 4 | Stale group | Crash or leftover | Cleanup on init; removeGroup before requestJoin and before startHost (with retry) | Wi-Fi OFF → ON; force-stop app and reopen |
| 5 | TCP not established | Network timing | 5 attempts; on failure leave group and emit onDisconnected | Retry Connect (no app restart) |
| 6 | P2P disabled | Wi-Fi/Location off | Emit onP2pStateChanged; UI shows status | Enable Wi-Fi and Location |
| 7 | Create Room no-op | startHost rejected (busy/cooldown) | Cooldown and isHostStarting guard | Show error UI; check onError; wait and retry |
| 8 | Server not ready when client connects | Race | 1800 ms client delay; 400 ms host delay before room state | Host creates room first; wait before client connects |

### 6.2 Potential Issues (might occur)

| # | Issue | Cause | Mitigation / what to do |
|---|-------|--------|-------------------------|
| 9 | removeGroup fails (even after retry) | OEM holds group (e.g. some Realme/Motorola) | Wi-Fi toggle; force-stop app; try different device |
| 10 | Server port bind fails | Port 8988 in use | Retry once in code; stop other app using port; stop and create room again |
| 11 | Socket read blocks | Other side died without close | soTimeout 90 s; timeout triggers disconnect/cleanup; user can retry Connect |
| 12 | Immediate connection loss after join | Network or one side closed | onDisconnected emitted; client leaves group so retry possible |
| 13 | Backgrounded app disables P2P | System/OEM behavior | Listen to WIFI_P2P_STATE_CHANGED_ACTION; user re-enables Wi-Fi/Location or reopens app |
| 14 | Discovery finds no peers | Host not ready, range, permissions | Host creates room first; client runs discovery; check permissions |
| 15 | Host lost GO role | Rare after createGroup | Detected in code; removeGroup and emit message; user stops and creates room again |
| 16 | Join request socket closed before host accepts | Client disconnected/timeout | respondToJoinRequest in try/catch; on failure remove from maps; host accept promptly; client can retry |

### 6.3 Error Scope Reference

When `onError` fires, `scope` indicates where the error originated:

| Scope | Typical meaning |
|-------|------------------|
| `startHost` | createGroup failed, removeGroup failed, cooldown, “Host is already starting”, “Could not clear previous group” |
| `requestJoin` | connect failed, “Already connecting” |
| `clientSocket` | “TCP not established… Tap Connect again to retry”, “Connection timed out…” |
| `hostMode` | “Host lost group owner role…” |
| `clientMode` | “This device became the group owner. Retry…” |
| `server` | “Could not start host server…” (bind failed twice) |
| `respondToJoinRequest` | Send failed (e.g. socket closed) |
| `sendChatMessage` | “Connection lost. Message not sent.” (client) |
| `initialize` | ReactContext or init failure |

---

## 7. Troubleshooting

**Recommended test sequence**

1. Both devices: Wi-Fi ON, Location ON. Optionally Wi-Fi off 5 s then on. Close other P2P apps.
2. Host: Tap Create Room. Wait until UI shows “Connected” (and room state). Wait 2–3 s more.
3. Client: Tap Find Nearby Devices, wait for peer list, tap Connect on host. If “TCP not established” appears, tap Connect again (no app restart).
4. Chat: Send both ways; if send fails, check onError and onDisconnected.

**If problems persist**

- Toggle Wi-Fi OFF → wait 5 s → ON.
- Force-stop app and reopen.
- Ensure no other app is using Wi-Fi Direct.
- Ensure host creates room first and client connects after host is connected.

---

## 8. Code References

| File | Purpose |
|------|---------|
| `modules/expo-wifi-direct/android/src/main/java/expo/modules/wifidirect/ExpoWifiDirectModule.kt` | All native P2P + TCP logic, retries, cleanup, events. |
| `modules/expo-wifi-direct/src/ExpoWifiDirectModule.ts` | TypeScript types and native module bridge. |
| `App.tsx` | Event subscriptions, screen state, startHost / requestJoin / respondToJoinRequest / sendChatMessage. |
| `HostScreen.tsx` | Host UI: join requests, accept/deny, chat. |
| `JoinScreen.tsx` | Client UI: scan, connect, chat. |
| `android/build-release.ps1` | Release build (short Gradle home for Windows path length). |

### 8.1 Constants (Kotlin)

```kotlin
private val port = 8988
private val startHostCooldownMs = 4000L
```

| Constant | Value | Where used |
|----------|--------|------------|
| port | 8988 | ServerSocket and client Socket |
| startHostCooldownMs | 4000 | startHost cooldown |
| Client delay before first TCP connect | 1800 ms | connectClientSocketIfNeeded |
| Max TCP attempts | 5 | connectClientSocketIfNeeded |
| Delay between TCP attempts | 2000 ms | connectClientSocketIfNeeded |
| Socket read timeout | 90000 ms | client and server-accepted sockets |
| removeGroup retry delay (host) | 2000 ms | tryRemoveGroupThenCreate |
| createGroup retry delay (reason 2) | 2500 ms | tryCreateGroup |
| removeGroup → doConnect delay (client) | 800 ms | requestJoin |
| Host delay after server start before room state | 400 ms | startServerIfNeeded path |
| Server bind retry delay | 1500 ms | startServerIfNeeded |
| removeGroup → tryCreateGroup delay | 1000 ms | tryRemoveGroupThenCreate |

### 8.2 P2P failure message (Android)

```kotlin
private fun p2pFailureMessage(reason: Int): String = when (reason) {
  2 -> "P2P busy or disabled (ensure Wi‑Fi & Location are ON, then retry)"
  else -> "error code $reason"
}
```

Reason `2` = `WifiP2pManager.BUSY`.

### 8.3 Search keywords in ExpoWifiDirectModule.kt

For full implementation details, search in **ExpoWifiDirectModule.kt** for:

- `startHost`
- `requestJoin`
- `connectClientSocketIfNeeded`
- `leaveP2pGroupAndEmitDisconnected`
- `handleModeWithConnectionInfo`
- `startServerIfNeeded`
- `respondToJoinRequest`
- `sendChatMessage`

---

## 9. Summary

- **Architecture:** Two layers — P2P (group owner + client) and TCP (port 8988) for join, room state, and chat.
- **Endpoints:** Section 2 documents the full TypeScript API, events, and types.
- **Implementations:** Section 3 describes initialize, startHost, requestJoin, client TCP, host server binding, and edge cases with timings and code references.
- **Extras vs source:** Section 4 lists what was added compared to baseline Android Wi-Fi Direct (cleanup, retries, delays, guards, role handling, socket safety).
- **TCP:** Section 5 defines the line-based JSON protocol and message types.
- **Issues:** Section 6 covers current issues (with mitigations and what to try), potential issues, and error scope reference.
- **Troubleshooting:** Section 7 gives the recommended test sequence and fallbacks.
- **Code:** Section 8 lists files, constants, and search keywords for `ExpoWifiDirectModule.kt`.
