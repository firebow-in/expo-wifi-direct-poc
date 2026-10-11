package expo.modules.wifidirect

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.NetworkInfo
import android.net.wifi.WpsInfo
import android.net.wifi.p2p.WifiP2pConfig
import android.net.wifi.p2p.WifiP2pDevice
import android.net.wifi.p2p.WifiP2pDeviceList
import android.net.wifi.p2p.WifiP2pInfo
import android.net.wifi.p2p.WifiP2pManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.os.bundleOf
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

private enum class Mode {
  IDLE,
  HOST,
  CLIENT
}

private class LineSocket(private val socket: Socket) {
  private val writer = BufferedWriter(OutputStreamWriter(socket.getOutputStream()))
  private val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
  val isClosed = AtomicBoolean(false)

  fun send(json: JSONObject) {
    if (isClosed.get()) return
    synchronized(writer) {
      writer.write(json.toString())
      writer.write("\n")
      writer.flush()
    }
  }

  fun readLine(): String? {
    return reader.readLine()
  }

  fun close() {
    if (isClosed.compareAndSet(false, true)) {
      try { socket.close() } catch (_: Throwable) {}
    }
  }
}

class ExpoWifiDirectModule : Module() {
  private val mainHandler = Handler(Looper.getMainLooper())

  private var manager: WifiP2pManager? = null
  private var channel: WifiP2pManager.Channel? = null
  private var receiver: BroadcastReceiver? = null
  private var isInitialized = false

  private val intentFilter = IntentFilter().apply {
    addAction(WifiP2pManager.WIFI_P2P_STATE_CHANGED_ACTION)
    addAction(WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION)
    addAction(WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION)
    addAction(WifiP2pManager.WIFI_P2P_THIS_DEVICE_CHANGED_ACTION)
  }

  private var peers: List<WifiP2pDevice> = emptyList()
  private var lastInfo: WifiP2pInfo? = null

  private var mode: Mode = Mode.IDLE

  private var roomName: String = ""
  private var hostName: String = ""

  private var clientDisplayName: String = ""
  private var clientTargetDeviceAddress: String = ""

  private val pendingJoinByRequestId = ConcurrentHashMap<String, LineSocket>()
  private val pendingJoinNameByRequestId = ConcurrentHashMap<String, String>()

  private val memberSocketByMemberId = ConcurrentHashMap<String, LineSocket>()
  private val memberNameByMemberId = ConcurrentHashMap<String, String>()

  private var clientSocket: LineSocket? = null

  private var serverSocket: ServerSocket? = null
  private var serverThread: Thread? = null

  private val port = 8988

  private var lastStartHostTimeMs: Long = 0L
  private val startHostCooldownMs = 4000L
  private var isHostStarting = false

  override fun definition() = ModuleDefinition {
    Name("ExpoWifiDirect")

    Events(
      "onP2pStateChanged",
      "onPeersUpdated",
      "onConnectionInfo",
      "onJoinRequest",
      "onJoinResponse",
      "onRoomState",
      "onChatMessage",
      "onDisconnected",
      "onError"
    )

    AsyncFunction("initialize") { promise: Promise ->
      mainHandler.post {
        try {
          ensureInitialized()
          // Clear any stale P2P group from previous run so user doesn't need to restart app.
          manager?.removeGroup(channel, object : WifiP2pManager.ActionListener {
            override fun onSuccess() { }
            override fun onFailure(reason: Int) { }
          })
          promise.resolve(null)
        } catch (t: Throwable) {
          emitError("initialize", t.message ?: "unknown error")
          promise.reject("ERR_INIT", t.message ?: "unknown error", t)
        }
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("startDiscovery") { promise: Promise ->
      mainHandler.post {
        try {
          ensureInitialized()
          manager?.discoverPeers(channel, object : WifiP2pManager.ActionListener {
            override fun onSuccess() {
              promise.resolve(null)
            }
            override fun onFailure(reason: Int) {
              val msg = "discoverPeers failed: ${p2pFailureMessage(reason)}"
              emitError("startDiscovery", msg)
              promise.reject("ERR_DISCOVER", msg, null)
            }
          })
        } catch (t: Throwable) {
          emitError("startDiscovery", t.message ?: "unknown error")
          promise.reject("ERR_DISCOVER", t.message ?: "unknown error", t)
        }
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("stopDiscovery") { promise: Promise ->
      mainHandler.post {
        try {
          ensureInitialized()
          manager?.stopPeerDiscovery(channel, object : WifiP2pManager.ActionListener {
            override fun onSuccess() {
              promise.resolve(null)
            }
            override fun onFailure(reason: Int) {
              val msg = "stopPeerDiscovery failed: ${p2pFailureMessage(reason)}"
              emitError("stopDiscovery", msg)
              promise.reject("ERR_STOP_DISCOVER", msg, null)
            }
          })
        } catch (t: Throwable) {
          emitError("stopDiscovery", t.message ?: "unknown error")
          promise.reject("ERR_STOP_DISCOVER", t.message ?: "unknown error", t)
        }
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("startHost") { rn: String, hn: String, promise: Promise ->
      mainHandler.post {
        try {
          ensureInitialized()
          if (isHostStarting) {
            promise.reject("ERR_BUSY", "Host is already starting. Please wait.", null)
            return@post
          }
          val now = System.currentTimeMillis()
          if (now - lastStartHostTimeMs < startHostCooldownMs) {
            val msg = "Please wait a few seconds before creating a room again."
            emitError("startHost", msg)
            promise.reject("ERR_COOLDOWN", msg, null)
            return@post
          }
          isHostStarting = true
          lastStartHostTimeMs = now
          cleanupAllSockets()
          mode = Mode.HOST
          roomName = rn
          hostName = hn
          fun clearHostStarting() {
            isHostStarting = false
          }
          fun tryCreateGroup(isRetry: Boolean) {
            manager?.createGroup(channel, object : WifiP2pManager.ActionListener {
              override fun onSuccess() {
                lastStartHostTimeMs = 0L
                clearHostStarting()
                requestConnectionInfoInternal()
                promise.resolve(null)
              }
              override fun onFailure(reason: Int) {
                if (reason == 2 && !isRetry) {
                  mainHandler.postDelayed({ tryCreateGroup(true) }, 2500L)
                } else {
                  clearHostStarting()
                  val msg = "createGroup failed: ${p2pFailureMessage(reason)}"
                  emitError("startHost", msg)
                  mode = Mode.IDLE
                  promise.reject("ERR_CREATE_GROUP", msg, null)
                }
              }
            })
          }
          // Always remove any existing P2P group first; retry once if busy so user doesn't need to restart app.
          fun tryRemoveGroupThenCreate(removeAttempt: Int) {
            manager?.removeGroup(channel, object : WifiP2pManager.ActionListener {
              override fun onSuccess() {
                mainHandler.postDelayed({ tryCreateGroup(false) }, 1000L)
              }
              override fun onFailure(reason: Int) {
                if (removeAttempt < 1) {
                  mainHandler.postDelayed({ tryRemoveGroupThenCreate(removeAttempt + 1) }, 2000L)
                } else {
                  clearHostStarting()
                  mode = Mode.IDLE
                  val msg = "Could not clear previous group: ${p2pFailureMessage(reason)}. Try again in a few seconds."
                  emitError("startHost", msg)
                  promise.reject("ERR_REMOVE_GROUP", msg, null)
                }
              }
            })
          }
          tryRemoveGroupThenCreate(0)
        } catch (t: Throwable) {
          isHostStarting = false
          emitError("startHost", t.message ?: "unknown error")
          mode = Mode.IDLE
          promise.reject("ERR_CREATE_GROUP", t.message ?: "unknown error", t)
        }
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("stopHost") { promise: Promise ->
      mainHandler.post {
        try {
          ensureInitialized()
          if (mode == Mode.HOST) {
            stopServer()
            cleanupAllSockets()
            manager?.removeGroup(channel, object : WifiP2pManager.ActionListener {
              override fun onSuccess() {
                lastStartHostTimeMs = 0L
                isHostStarting = false
                mode = Mode.IDLE
                promise.resolve(null)
              }
              override fun onFailure(reason: Int) {
                val msg = "removeGroup failed: ${p2pFailureMessage(reason)}"
                emitError("stopHost", msg)
                mode = Mode.IDLE
                promise.reject("ERR_REMOVE_GROUP", msg, null)
              }
            })
          } else {
            promise.resolve(null)
          }
        } catch (t: Throwable) {
          emitError("stopHost", t.message ?: "unknown error")
          mode = Mode.IDLE
          promise.reject("ERR_STOP_HOST", t.message ?: "unknown error", t)
        }
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("requestJoin") { deviceAddress: String, displayName: String, promise: Promise ->
      mainHandler.post {
        try {
          ensureInitialized()
          // Prevent double-tap / overlapping join (already connecting).
          if (mode == Mode.CLIENT && clientSocket == null && clientTargetDeviceAddress.isNotEmpty()) {
            val msg = "Already connecting. Wait or go back and try again."
            emitError("requestJoin", msg)
            promise.reject("ERR_BUSY", msg, null)
            return@post
          }
          cleanupAllSockets()
          clientDisplayName = displayName
          clientTargetDeviceAddress = deviceAddress

          // Prefer not to be group owner so host remains GO (avoids role flip).
          val config = WifiP2pConfig().apply {
            this.deviceAddress = deviceAddress
            wps.setup = WpsInfo.PBC
            if (Build.VERSION.SDK_INT >= 29) {
              groupOwnerIntent = 0
            }
          }

          fun doConnect() {
            mode = Mode.CLIENT
            manager?.connect(channel, config, object : WifiP2pManager.ActionListener {
              override fun onSuccess() {
                requestConnectionInfoInternal()
                promise.resolve(null)
              }
              override fun onFailure(reason: Int) {
                val msg = "connect failed: ${p2pFailureMessage(reason)}"
                emitError("requestJoin", msg)
                mode = Mode.IDLE
                promise.reject("ERR_CONNECT", msg, null)
              }
            })
          }

          // Remove any previous group so we can connect cleanly without restarting app.
          manager?.removeGroup(channel, object : WifiP2pManager.ActionListener {
            override fun onSuccess() {
              mainHandler.postDelayed({ doConnect() }, 800L)
            }
            override fun onFailure(reason: Int) {
              mainHandler.postDelayed({ doConnect() }, 800L)
            }
          })
        } catch (t: Throwable) {
          emitError("requestJoin", t.message ?: "unknown error")
          mode = Mode.IDLE
          promise.reject("ERR_CONNECT", t.message ?: "unknown error", t)
        }
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("leaveRoom") { promise: Promise ->
      mainHandler.post {
        try {
          ensureInitialized()
          cleanupAllSockets()
          stopServer()
          manager?.removeGroup(channel, object : WifiP2pManager.ActionListener {
            override fun onSuccess() {
              mode = Mode.IDLE
              promise.resolve(null)
            }
            override fun onFailure(reason: Int) {
              mode = Mode.IDLE
              promise.resolve(null)
            }
          })
        } catch (t: Throwable) {
          emitError("leaveRoom", t.message ?: "unknown error")
          mode = Mode.IDLE
          promise.reject("ERR_LEAVE", t.message ?: "unknown error", t)
        }
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("respondToJoinRequest") { requestId: String, accepted: Boolean, promise: Promise ->
      mainHandler.post {
        try {
          if (mode != Mode.HOST) {
            promise.resolve(null)
            return@post
          }
          val sock = pendingJoinByRequestId.remove(requestId)
          val name = pendingJoinNameByRequestId.remove(requestId)
          if (sock == null || name == null) {
            promise.resolve(null)
            return@post
          }
          if (!accepted) {
            val resp = JSONObject()
              .put("type", "join_response")
              .put("accepted", false)
              .put("reason", "denied")
            try {
              sock.send(resp)
            } catch (_: Throwable) {}
            try { sock.close() } catch (_: Throwable) {}
            promise.resolve(null)
            return@post
          }

          val memberId = UUID.randomUUID().toString()
          memberSocketByMemberId[memberId] = sock
          memberNameByMemberId[memberId] = name

          val resp = JSONObject()
            .put("type", "join_response")
            .put("accepted", true)
            .put("memberId", memberId)
            .put("roomName", roomName)
            .put("hostName", hostName)

          try {
            sock.send(resp)
            broadcastRoomState()
          } catch (t: Throwable) {
            memberSocketByMemberId.remove(memberId)
            memberNameByMemberId.remove(memberId)
          }
          promise.resolve(null)
        } catch (t: Throwable) {
          emitError("respondToJoinRequest", t.message ?: "unknown error")
          promise.reject("ERR_JOIN_RESPONSE", t.message ?: "unknown error", t)
        }
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("sendChatMessage") { text: String, promise: Promise ->
      mainHandler.post {
        try {
          val trimmed = text.trim()
          if (trimmed.isEmpty()) {
            promise.resolve(null)
            return@post
          }

          val msgId = UUID.randomUUID().toString()
          val ts = System.currentTimeMillis()

          if (mode == Mode.HOST) {
            val chat = JSONObject()
              .put("type", "chat_message")
              .put("id", msgId)
              .put("fromMemberId", "HOST")
              .put("fromName", hostName)
              .put("text", trimmed)
              .put("ts", ts)

            emitChat(chat)
            broadcast(chat)
            promise.resolve(null)
            return@post
          }

          if (mode == Mode.CLIENT) {
            val chat = JSONObject()
              .put("type", "chat_message")
              .put("id", msgId)
              .put("fromMemberId", "CLIENT")
              .put("fromName", clientDisplayName)
              .put("text", trimmed)
              .put("ts", ts)
            try {
              clientSocket?.send(chat)
              promise.resolve(null)
            } catch (t: Throwable) {
              emitError("sendChatMessage", "Connection lost. Message not sent.")
              promise.reject("ERR_CHAT", t.message ?: "connection lost", t)
            }
            return@post
          }

          promise.resolve(null)
        } catch (t: Throwable) {
          emitError("sendChatMessage", t.message ?: "unknown error")
          promise.reject("ERR_CHAT", t.message ?: "unknown error", t)
        }
      }
    }.runOnQueue(Queues.MAIN)

    OnDestroy {
      try {
        unregisterReceiverInternal()
      } catch (_: Throwable) {}
      cleanupAllSockets()
      stopServer()
      manager = null
      channel = null
      isInitialized = false
    }
  }

  private fun ensureInitialized() {
    if (isInitialized) return

    val ctx = appContext.reactContext ?: throw IllegalStateException("reactContext missing")
    val mgr = ctx.getSystemService(Context.WIFI_P2P_SERVICE) as WifiP2pManager
    manager = mgr
    channel = mgr.initialize(ctx, Looper.getMainLooper(), null)

    receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        try {
          when (intent.action) {
            WifiP2pManager.WIFI_P2P_STATE_CHANGED_ACTION -> {
              val state = intent.getIntExtra(WifiP2pManager.EXTRA_WIFI_STATE, -1)
              val enabled = state == WifiP2pManager.WIFI_P2P_STATE_ENABLED
              sendEvent("onP2pStateChanged", bundleOf("enabled" to enabled))
            }

            WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION -> {
              val m = manager ?: return
              val ch = channel ?: return
              m.requestPeers(ch) { list: WifiP2pDeviceList? ->
                if (list != null) {
                  peers = list.deviceList.toList()
                  emitPeers()
                }
              }
            }

            WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION -> {
              requestConnectionInfoInternal()
            }

            WifiP2pManager.WIFI_P2P_THIS_DEVICE_CHANGED_ACTION -> {
              emitPeers()
            }
          }
        } catch (t: Throwable) {
          emitError("receiver", t.message ?: "unknown error")
        }
      }
    }

    registerReceiverInternal()
    isInitialized = true
    requestP2pStateIfAvailable()
  }

  private fun requestP2pStateIfAvailable() {
    if (Build.VERSION.SDK_INT < 29) return
    val m = manager ?: return
    val ch = channel ?: return
    m.requestP2pState(ch, object : WifiP2pManager.P2pStateListener {
      override fun onP2pStateAvailable(state: Int) {
        val enabled = state == WifiP2pManager.WIFI_P2P_STATE_ENABLED
        mainHandler.post { sendEvent("onP2pStateChanged", bundleOf("enabled" to enabled)) }
      }
    })
  }

  private fun registerReceiverInternal() {
    val ctx = appContext.reactContext ?: return
    val r = receiver ?: return
    if (Build.VERSION.SDK_INT >= 33) {
      ctx.registerReceiver(r, intentFilter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      ctx.registerReceiver(r, intentFilter)
    }
  }

  private fun unregisterReceiverInternal() {
    val ctx = appContext.reactContext ?: return
    val r = receiver ?: return
    try { ctx.unregisterReceiver(r) } catch (_: Throwable) {}
  }

  private fun requestConnectionInfoInternal() {
    try {
      val m = manager ?: return
      val ch = channel ?: return
      m.requestConnectionInfo(ch) { info ->
        if (info != null) {
          lastInfo = info
          emitConnectionInfo(info)
          if (!info.groupFormed) {
            handleGroupDisconnected()
          } else {
            handleModeWithConnectionInfo(info)
          }
        }
      }
    } catch (t: Throwable) {
      emitError("requestConnectionInfo", t.message ?: "unknown error")
    }
  }

  private fun handleGroupDisconnected() {
    if (mode == Mode.IDLE) return
    isHostStarting = false
    stopServer()
    cleanupAllSockets()
    mode = Mode.IDLE
    lastInfo = null
    roomName = ""
    hostName = ""
    clientDisplayName = ""
    clientTargetDeviceAddress = ""
    sendEvent("onDisconnected", bundleOf("reason" to "group_lost"))
  }

  private fun emitPeers() {
    val arr = peers.map {
      mapOf(
        "deviceName" to (it.deviceName ?: ""),
        "deviceAddress" to it.deviceAddress,
        "status" to it.status
      )
    }
    sendEvent("onPeersUpdated", bundleOf("peers" to arr))
  }

  private fun emitConnectionInfo(info: WifiP2pInfo) {
    val addr = info.groupOwnerAddress?.hostAddress
    val bundle = bundleOf(
      "groupFormed" to info.groupFormed,
      "isGroupOwner" to info.isGroupOwner,
      "groupOwnerAddress" to addr
    )
    sendEvent("onConnectionInfo", bundle)
  }

  private fun handleModeWithConnectionInfo(info: WifiP2pInfo) {
    if (!info.groupFormed) {
      handleGroupDisconnected()
      return
    }

    if (mode == Mode.HOST && info.isGroupOwner) {
      startServerIfNeeded()
      // Short delay so accept() is running before we report ready (state guard).
      mainHandler.postDelayed({ emitRoomStateHost() }, 400L)
      return
    }

    // Host lost group owner role (edge case: negotiation gave GO to peer).
    if (mode == Mode.HOST && !info.isGroupOwner) {
      manager?.removeGroup(channel, object : WifiP2pManager.ActionListener {
        override fun onSuccess() {
          mode = Mode.IDLE
          mainHandler.post {
            emitError("hostMode", "Host lost group owner role. Please stop and create room again.")
          }
        }
        override fun onFailure(reason: Int) {
          mode = Mode.IDLE
          mainHandler.post {
            emitError("hostMode", "Host lost group owner role. Please stop and create room again.")
          }
        }
      })
      return
    }

    if (mode == Mode.CLIENT && !info.isGroupOwner) {
      val hostIp = info.groupOwnerAddress?.hostAddress ?: return
      connectClientSocketIfNeeded(hostIp)
      return
    }

    if (mode == Mode.CLIENT && info.isGroupOwner) {
      manager?.removeGroup(channel, object : WifiP2pManager.ActionListener {
        override fun onSuccess() {
          mode = Mode.IDLE
          mainHandler.post {
            emitError("clientMode", "This device became the group owner. Retry: have the other device tap Create Room first, then tap Connect here again.")
          }
        }
        override fun onFailure(reason: Int) {
          mode = Mode.IDLE
          mainHandler.post {
            emitError("clientMode", "This device became the group owner. Retry: have the other device tap Create Room first, then tap Connect here again.")
          }
        }
      })
    }
  }

  private fun startServerIfNeeded() {
    if (serverThread != null) return
    fun tryBind(attempt: Int) {
      val ss = try {
        ServerSocket(port)
      } catch (t: Throwable) {
        if (attempt < 1) {
          mainHandler.postDelayed({ tryBind(attempt + 1) }, 1500L)
        } else {
          emitError("server", "Could not start host server: ${t.message ?: "unknown"}. Try stopping and creating room again.")
        }
        return
      }
      serverSocket = ss
    val running = AtomicBoolean(true)
    val thread = Thread {
      try {
        while (running.get()) {
          val s = ss.accept()
          try { s.soTimeout = 90000 } catch (_: Throwable) {}
          val lineSocket = LineSocket(s)
          Thread {
            try {
              val firstLine = lineSocket.readLine()
              if (firstLine == null) {
                lineSocket.close()
                return@Thread
              }
              val obj = JSONObject(firstLine)
              val type = obj.optString("type", "")
              if (type != "join_request") {
                val resp = JSONObject().put("type", "join_response").put("accepted", false).put("reason", "not_a_room")
                lineSocket.send(resp)
                lineSocket.close()
                return@Thread
              }
              val name = obj.optString("name", "unknown")
              val requestId = UUID.randomUUID().toString()
              pendingJoinByRequestId[requestId] = lineSocket
              pendingJoinNameByRequestId[requestId] = name
              sendEvent("onJoinRequest", bundleOf("requestId" to requestId, "name" to name))

              while (!lineSocket.isClosed.get()) {
                val line = lineSocket.readLine() ?: break
                val msg = JSONObject(line)
                val msgType = msg.optString("type", "")
                if (msgType == "chat_message") {
                  val fromName = memberNameByMemberId.entries.find { it.value == name }?.value ?: name
                  val chat = JSONObject()
                    .put("type", "chat_message")
                    .put("id", msg.optString("id", UUID.randomUUID().toString()))
                    .put("fromMemberId", msg.optString("fromMemberId", "UNKNOWN"))
                    .put("fromName", fromName)
                    .put("text", msg.optString("text", ""))
                    .put("ts", msg.optLong("ts", System.currentTimeMillis()))
                  emitChat(chat)
                  broadcast(chat)
                }
              }

              lineSocket.close()
              pendingJoinByRequestId.entries.removeIf { it.value == lineSocket }
              pendingJoinNameByRequestId.entries.removeIf { pendingJoinByRequestId[it.key] == null }
              val memberId = memberSocketByMemberId.entries.find { it.value == lineSocket }?.key
              if (memberId != null) {
                memberSocketByMemberId.remove(memberId)
                memberNameByMemberId.remove(memberId)
                broadcastRoomState()
              }
            } catch (_: Throwable) {
              lineSocket.close()
            }
          }.start()
        }
      } catch (t: Throwable) {
        emitError("server", t.message ?: "unknown error")
      }
    }
    serverThread = thread
    thread.start()
    }
    tryBind(0)
  }

  private fun stopServer() {
    try { serverSocket?.close() } catch (_: Throwable) {}
    serverSocket = null
    serverThread = null
  }

  /** Leaves P2P group and emits onDisconnected so user can retry without restarting app. */
  private fun leaveP2pGroupAndEmitDisconnected(reason: String) {
    mainHandler.post {
      try { clientSocket?.close() } catch (_: Throwable) {}
      clientSocket = null
      if (mode != Mode.CLIENT) {
        sendEvent("onDisconnected", bundleOf("reason" to reason))
        return@post
      }
      manager?.removeGroup(channel, object : WifiP2pManager.ActionListener {
        override fun onSuccess() {
          mode = Mode.IDLE
          clientTargetDeviceAddress = ""
          sendEvent("onDisconnected", bundleOf("reason" to reason))
        }
        override fun onFailure(r: Int) {
          mode = Mode.IDLE
          clientTargetDeviceAddress = ""
          sendEvent("onDisconnected", bundleOf("reason" to reason))
        }
      })
    }
  }

  private fun connectClientSocketIfNeeded(hostIp: String) {
    if (clientSocket != null) return
    Thread {
      // Delay so host server is listening before first connect attempt (avoids ECONNREFUSED).
      try { Thread.sleep(1800L) } catch (_: InterruptedException) { return@Thread }
      if (mode != Mode.CLIENT) return@Thread
      val maxAttempts = 5
      val delayMs = 2000L
      var lastThrowable: Throwable? = null
      for (attempt in 1..maxAttempts) {
        if (mode != Mode.CLIENT) return@Thread
        try {
          val s = Socket()
          s.soTimeout = 90000
          s.connect(InetSocketAddress(hostIp, port), 8000)
          val ls = LineSocket(s)
          clientSocket = ls

        val req = JSONObject()
          .put("type", "join_request")
          .put("name", clientDisplayName)
          .put("ts", System.currentTimeMillis())
        ls.send(req)

        while (!ls.isClosed.get()) {
          val line = ls.readLine() ?: break
          val obj = JSONObject(line)
          val type = obj.optString("type", "")
          if (type == "join_response") {
            val accepted = obj.optBoolean("accepted", false)
            val memberId = obj.optString("memberId", "")
            val rn = obj.optString("roomName", "")
            val hn = obj.optString("hostName", "")
            if (accepted) {
              sendEvent("onJoinResponse", bundleOf("accepted" to true, "memberId" to memberId))
              roomName = rn
              hostName = hn
              emitRoomStateClient(memberId)
            } else {
              val reason = obj.optString("reason", "denied")
              sendEvent("onJoinResponse", bundleOf("accepted" to false, "reason" to reason))
            }
          } else if (type == "room_state") {
            val payload = bundleOf(
              "roomName" to obj.optString("roomName", roomName),
              "hostName" to obj.optString("hostName", hostName),
              "members" to jsonArrayToMemberList(obj.optJSONArray("members") ?: JSONArray()),
              "selfMemberId" to obj.optString("selfMemberId", ""),
              "role" to "CLIENT"
            )
            sendEvent("onRoomState", payload)
          } else if (type == "chat_message") {
            emitChat(obj)
          }
        }

          ls.close()
          clientSocket = null
          leaveP2pGroupAndEmitDisconnected("connection_lost")
          return@Thread
        } catch (t: Throwable) {
          lastThrowable = t
          val msg = t.message ?: ""
          val isRefused = msg.contains("ECONNREFUSED", ignoreCase = true) ||
              msg.contains("Connection refused", ignoreCase = true)
          val isTimeout = t is java.net.SocketTimeoutException || msg.contains("timed out", ignoreCase = true)
          if (isTimeout) {
            emitError("clientSocket", "Connection timed out. Tap Connect again to retry.")
            try { clientSocket?.close() } catch (_: Throwable) {}
            clientSocket = null
            leaveP2pGroupAndEmitDisconnected("connection_lost")
            return@Thread
          }
          if (isRefused && attempt < maxAttempts) {
            try { Thread.sleep(delayMs) } catch (_: InterruptedException) { break }
          } else {
            emitError("clientSocket", "TCP not established. $msg Tap Connect again to retry.")
            try { clientSocket?.close() } catch (_: Throwable) {}
            clientSocket = null
            leaveP2pGroupAndEmitDisconnected("connection_lost")
            return@Thread
          }
        }
      }
      if (lastThrowable != null) {
        emitError("clientSocket", "TCP not established. ${lastThrowable.message ?: "unknown error"} Tap Connect again to retry.")
        try { clientSocket?.close() } catch (_: Throwable) {}
        clientSocket = null
        leaveP2pGroupAndEmitDisconnected("connection_lost")
      }
    }.start()
  }

  private fun broadcastRoomState() {
    val membersJson = JSONArray()
    membersJson.put(JSONObject().put("memberId", "HOST").put("name", hostName).put("isHost", true))
    memberNameByMemberId.forEach { (id, nm) ->
      membersJson.put(JSONObject().put("memberId", id).put("name", nm).put("isHost", false))
    }
    val state = JSONObject()
      .put("type", "room_state")
      .put("roomName", roomName)
      .put("hostName", hostName)
      .put("members", membersJson)
    broadcast(state)
    emitRoomStateHost()
  }

  private fun emitRoomStateHost() {
    val members = mutableListOf<Map<String, Any?>>()
    members.add(mapOf("memberId" to "HOST", "name" to hostName, "isHost" to true))
    memberNameByMemberId.forEach { (id, nm) ->
      members.add(mapOf("memberId" to id, "name" to nm, "isHost" to false))
    }
    sendEvent(
      "onRoomState",
      bundleOf(
        "roomName" to roomName,
        "hostName" to hostName,
        "members" to members,
        "selfMemberId" to "HOST",
        "role" to "HOST"
      )
    )
  }

  private fun emitRoomStateClient(memberId: String) {
    sendEvent(
      "onRoomState",
      bundleOf(
        "roomName" to roomName,
        "hostName" to hostName,
        "members" to listOf<Map<String, Any?>>(),
        "selfMemberId" to memberId,
        "role" to "CLIENT"
      )
    )
  }

  private fun jsonArrayToMemberList(arr: JSONArray): List<Map<String, Any?>> {
    val out = mutableListOf<Map<String, Any?>>()
    for (i in 0 until arr.length()) {
      val o = arr.optJSONObject(i) ?: continue
      out.add(
        mapOf(
          "memberId" to o.optString("memberId", ""),
          "name" to o.optString("name", ""),
          "isHost" to o.optBoolean("isHost", false)
        )
      )
    }
    return out
  }

  private fun broadcast(json: JSONObject) {
    memberSocketByMemberId.values.forEach { sock ->
      try { sock.send(json) } catch (_: Throwable) {}
    }
  }

  private fun emitChat(chat: JSONObject) {
    sendEvent(
      "onChatMessage",
      bundleOf(
        "id" to chat.optString("id", UUID.randomUUID().toString()),
        "fromMemberId" to chat.optString("fromMemberId", ""),
        "fromName" to chat.optString("fromName", ""),
        "text" to chat.optString("text", ""),
        "ts" to chat.optLong("ts", System.currentTimeMillis())
      )
    )
  }

  private fun cleanupAllSockets() {
    pendingJoinByRequestId.values.forEach { it.close() }
    pendingJoinByRequestId.clear()
    pendingJoinNameByRequestId.clear()

    memberSocketByMemberId.values.forEach { it.close() }
    memberSocketByMemberId.clear()
    memberNameByMemberId.clear()

    try { clientSocket?.close() } catch (_: Throwable) {}
    clientSocket = null
  }

  /** Maps Wi-Fi P2P failure reason codes to a user-friendly message. Reason 2 = BUSY (P2P not ready). */
  private fun p2pFailureMessage(reason: Int): String = when (reason) {
    2 -> "P2P busy or disabled (ensure Wi‑Fi & Location are ON, then retry)"
    else -> "error code $reason"
  }

  private fun emitError(scope: String, message: String) {
    sendEvent("onError", bundleOf("scope" to scope, "message" to message))
  }
}
