"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";
type NotifType = "all" | "presensi" | "tugas" | "materi" | "video";
type UpdateMode = "polling" | "realtime";

interface EtholNotification {
  idNotifikasi: string;
  keterangan: string;
  status: string;
  urlWeb: string;
  kodeNotifikasi: string;
  dataTerkait: string;
  createdAt: string;
  waktuNotifikasi: string;
  createdAtIndonesia: string;
}

interface NotifEntry {
  id: string;
  type: string;
  keterangan: string;
  createdAt: string;
  waktuNotifikasi: string;
  source: "websocket" | "poll";
}

interface NotificationPanelProps {
  refreshNonce: number;
  isRefreshing: boolean;
  onRefreshingChange: (refreshing: boolean) => void;
}

export default function NotificationPanel({ refreshNonce, isRefreshing, onRefreshingChange }: NotificationPanelProps) {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [updateMode, setUpdateMode] = useState<UpdateMode>("polling");
  const [pollingOnlyFallback, setPollingOnlyFallback] = useState(false);
  const [notifications, setNotifications] = useState<NotifEntry[]>([]);
  const [filter, setFilter] = useState<NotifType>("all");
  const [unreadCount, setUnreadCount] = useState(0);

  const ws = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const refreshHandled = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnect = useRef(true);
  const maxReconnects = 3;

  const getWsUrl = useCallback((token: string) => {
    const configuredUrl = process.env.NEXT_PUBLIC_NOTIFICATION_WS_URL;

    if (configuredUrl) {
      const url = new URL(configuredUrl);
      url.searchParams.set("token", token);
      return url.toString();
    }

    const protocol = process.env.NEXT_PUBLIC_NOTIFICATION_WS_PROTOCOL || (window.location.protocol === "https:" ? "wss:" : "ws:");
    const host = process.env.NEXT_PUBLIC_NOTIFICATION_WS_HOST || window.location.hostname;
    const port = process.env.NEXT_PUBLIC_NOTIFICATION_WS_PORT || "4000";

    return `${protocol}//${host}:${port}/ws/notifications?token=${encodeURIComponent(token)}`;
  }, []);

  const closeSocket = useCallback((allowReconnect: boolean) => {
    shouldReconnect.current = allowReconnect;

    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }

    if (ws.current) {
      ws.current.close();
      ws.current = null;
    }
  }, []);

  const connectWs = useCallback(async function connectWsCallback() {
    try {
      setStatus("connecting");
      onRefreshingChange(true);
      const tokenRes = await fetch("/api/token");
      const tokenData = await tokenRes.json();

      if (!tokenData.success || !tokenData.token) {
        setStatus("error");
        onRefreshingChange(false);
        return;
      }

      closeSocket(false);
      shouldReconnect.current = true;

      const wsUrl = getWsUrl(tokenData.token);
      ws.current = new WebSocket(wsUrl);

      ws.current.onopen = () => {
        setStatus("connected");
        setUpdateMode("polling");
        setPollingOnlyFallback(false);
        reconnectAttempts.current = 0;
      };

      ws.current.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "notifications" && Array.isArray(msg.data)) {
            const newNotifs: NotifEntry[] = [];

            for (const group of msg.data as Array<{ type?: string; data?: unknown }>) {
              if (group.type === "unread_count") {
                const countData = group.data as { jumlah?: number } | undefined;
                if (countData && typeof countData.jumlah === "number") {
                  setUnreadCount(countData.jumlah);
                }
                continue;
              }

              if (!Array.isArray(group.data)) continue;

              for (const item of group.data as EtholNotification[]) {
                newNotifs.push({
                  id: item.idNotifikasi,
                  type: group.type || "unknown",
                  keterangan: item.keterangan,
                  createdAt: item.createdAt,
                  waktuNotifikasi: item.waktuNotifikasi,
                  source: "poll",
                });
              }
            }

            setNotifications(prev => {
              const newIds = new Set(newNotifs.map(n => n.id));
              const kept = prev.filter(p => !newIds.has(p.id));
              const combined = [...newNotifs, ...kept];
              return combined.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            });
            onRefreshingChange(false);
          } else if (msg.type === "ethol_message") {
            setUpdateMode("realtime");
            setPollingOnlyFallback(false);
            const newNotif: NotifEntry = {
              id: `ws-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
              type: "realtime",
              keterangan: typeof msg.data === "string" ? msg.data : JSON.stringify(msg.data),
              createdAt: msg.timestamp || new Date().toISOString(),
              waktuNotifikasi: "baru saja",
              source: "websocket",
            };

            setNotifications(prev => [newNotif, ...prev]);
          } else if (msg.type === "connected" || msg.type === "ethol_ws_connected") {
            setStatus("connected");
            if (msg.type === "ethol_ws_connected") {
              setUpdateMode("realtime");
              setPollingOnlyFallback(false);
            }
          } else if (msg.type === "upstream_ws_unavailable") {
            setStatus("connected");
            setUpdateMode("polling");
            setPollingOnlyFallback(true);
          } else if (msg.type === "refresh_complete") {
            onRefreshingChange(false);
          } else if (msg.type === "error") {
            setStatus("error");
            onRefreshingChange(false);
          }
        } catch (e) {
          console.error("Failed to parse WS message", e);
        }
      };

      ws.current.onclose = () => {
        ws.current = null;

        if (!shouldReconnect.current) {
          setStatus("disconnected");
          onRefreshingChange(false);
          return;
        }

        if (reconnectAttempts.current < maxReconnects) {
          setStatus("connecting");
          reconnectAttempts.current += 1;
          reconnectTimer.current = setTimeout(() => {
            void connectWsCallback();
          }, 3000);
        } else {
          setStatus("disconnected");
          onRefreshingChange(false);
        }
      };

      ws.current.onerror = () => {
        setStatus("error");
        onRefreshingChange(false);
      };
    } catch {
      setStatus("error");
      onRefreshingChange(false);
    }
  }, [closeSocket, getWsUrl, onRefreshingChange]);

  const requestRefresh = useCallback(() => {
    onRefreshingChange(true);

    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: "refresh" }));
      return;
    }

    void connectWs();
  }, [connectWs, onRefreshingChange]);

  useEffect(() => {
    void connectWs();
    return () => {
      closeSocket(false);
    };
  }, [closeSocket, connectWs]);

  useEffect(() => {
    if (refreshNonce === refreshHandled.current) {
      return;
    }

    refreshHandled.current = refreshNonce;
    requestRefresh();
  }, [refreshNonce, requestRefresh]);

  const filteredNotifs = useMemo(
    () => notifications.filter((notification) => filter === "all" || notification.type === filter),
    [filter, notifications],
  );

  function clearAll() {
    setNotifications([]);
  }

  function getIconForType(type: string) {
    switch (type) {
      case 'presensi':
        return (
          <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
        );
      case 'tugas':
        return (
          <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        );
      case 'materi':
        return (
          <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
        );
      case 'video':
        return (
          <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      default:
        return (
          <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
    }
  }

  function formatTime(isoStr: string) {
    try {
      const d = new Date(isoStr);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' • ' + d.toLocaleDateString();
    } catch {
      return isoStr;
    }
  }

  const getStatusColor = () => {
    switch (status) {
      case "connected": return "bg-green-500";
      case "connecting": return "bg-yellow-500 animate-pulse";
      case "disconnected": return "bg-red-500";
      case "error": return "bg-red-500";
    }
  };

  const getStatusText = () => {
    switch (status) {
      case "connected":
        if (updateMode === "realtime") {
          return "Connected to real-time updates";
        }
        return pollingOnlyFallback
          ? "Polling-only updates (ETHOL realtime unavailable)"
          : "Connected to polling updates (5-8s)";
      case "connecting": return "Connecting...";
      case "disconnected": return "Disconnected. Will retry...";
      case "error": return "Connection error";
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Bar: Status, Filters, Actions */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">

          {/* Status Indicator */}
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${getStatusColor()}`}></div>
            <span className="text-sm font-medium text-gray-700">{getStatusText()}</span>
          </div>

          {/* Filters & Actions */}
          <div className="flex items-center gap-3 overflow-x-auto pb-1 sm:pb-0">
            <div className="flex bg-gray-100 p-1 rounded-lg">
              {(["all", "presensi", "tugas", "materi", "video"] as NotifType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setFilter(t)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors ${filter === t
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-200"
                    }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <button
              onClick={requestRefresh}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
            >
              <svg
                className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Refresh
            </button>

            <button
              onClick={clearAll}
              className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors whitespace-nowrap"
            >
              Clear All
            </button>
          </div>
        </div>
      </div>

      {/* Notifications List */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
          <h3 className="text-sm font-semibold text-gray-900">Recent Notifications</h3>
          <span className="bg-blue-100 text-blue-700 text-xs font-semibold px-2 py-0.5 rounded-full">
            {filteredNotifs.length}
          </span>
          {unreadCount > 0 && (
            <span className="bg-red-100 text-red-700 text-xs font-semibold px-2 py-0.5 rounded-full ml-1">
              {unreadCount} unread
            </span>
          )}
        </div>

        <div className="divide-y divide-gray-200 max-h-[500px] overflow-y-auto">
          {filteredNotifs.length > 0 ? (
            filteredNotifs.map((notif) => (
              <div key={notif.id} className="p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 shrink-0">
                    {getIconForType(notif.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-gray-900 capitalize">
                        {notif.type}
                      </p>
                      <span className="text-xs text-gray-400 whitespace-nowrap">
                        {notif.waktuNotifikasi || formatTime(notif.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 mt-1 break-words">
                      {notif.keterangan}
                    </p>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="p-8 text-center">
              <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
              <p className="text-sm text-gray-500">No notifications found</p>
            </div>
          )}
        </div>
      </div>

      {/* Raw WebSocket API Info */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 font-mono text-xs text-gray-600 whitespace-pre overflow-x-auto">
        {`┌─────────────────────────────────────────────┐
│ 🔌 Raw WebSocket API for Bots               │
│                                              │
│ Endpoint:                                    │
│ ${process.env.NEXT_PUBLIC_NOTIFICATION_WS_URL || "ws://<host>:4000/ws/notifications?token=JWT"} │
│                                              │
│ Get your token:                              │
│ curl http://localhost:4000/api/token          │
│                                              │
│ Message format (JSON):                       │
│ { "type": "ethol_message",                   │
│   "data": { ... },                           │
│   "timestamp": "2026-..." }                  │
│                                              │
│ Event types:                                 │
│ • connected - Connection established         │
│ • ethol_message - Real-time ETHOL event      │
│ • notifications - Polled notification list   │
│ • ethol_ws_connected - ETHOL WS connected    │
│ • error - Error message                      │
└─────────────────────────────────────────────┘`}
      </div>
    </div>
  );
}
