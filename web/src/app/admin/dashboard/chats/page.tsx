"use client";

import { useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Group,
  Image,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Switch,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import {
  collection,
  doc,
  onSnapshot,
  query,
  orderBy,
} from "firebase/firestore";
import { db, auth } from "../../../../lib/firebase";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

interface SessionMessage {
  from: "user" | "bot" | "admin";
  text?: string;
  photoUrl?: string;
  timestamp: number;
}

interface ChatSession {
  phone: string;
  state: string;
  messages: SessionMessage[];
  lastMessage?: string;
}

const FROM_COLORS: Record<string, string> = {
  user: "#dcf8c6",
  bot: "#ffffff",
  admin: "#d0e8ff",
};

const FROM_LABELS: Record<string, string> = {
  user: "Usuario",
  bot: "Bot",
  admin: "Admin",
};

export default function ChatsPage() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<ChatSession | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [botEnabled, setBotEnabled] = useState(true);
  const [togglingBot, setTogglingBot] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);

  // Scroll automático al final
  useEffect(() => {
    viewport.current?.scrollTo({
      top: viewport.current.scrollHeight,
      behavior: "smooth",
    });
  }, [selectedSession?.messages]);

  // Listar todas las sesiones activas
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "whatsapp_sessions"),
      (snapshot) => {
        const list: ChatSession[] = snapshot.docs.map((d) => {
          const data = d.data();
          const msgs: SessionMessage[] = data.messages || [];
          const last = msgs[msgs.length - 1]?.text ?? "";
          return {
            phone: d.id,
            state: data.state || "IDLE",
            messages: msgs,
            lastMessage: last.length > 50 ? last.slice(0, 50) + "…" : last,
          };
        });
        list.sort((a, b) => {
          const aT = a.messages[a.messages.length - 1]?.timestamp ?? 0;
          const bT = b.messages[b.messages.length - 1]?.timestamp ?? 0;
          return bT - aT;
        });
        setSessions(list);
      },
      (err) => console.warn("Error leyendo sesiones:", err),
    );
    return () => unsub();
  }, []);

  // Suscripción al chat seleccionado en tiempo real
  useEffect(() => {
    if (!selectedPhone) return;

    const unsub = onSnapshot(
      doc(db, "whatsapp_sessions", selectedPhone),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setSelectedSession({
            phone: snap.id,
            state: data.state || "IDLE",
            messages: (data.messages || []).sort(
              (a: SessionMessage, b: SessionMessage) => a.timestamp - b.timestamp,
            ),
            lastMessage: "",
          });
          // Cargar el estado del bot desde Firestore
          setBotEnabled(data.botEnabled !== false); // Por defecto activo
        }
      },
    );
    return () => unsub();
  }, [selectedPhone]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !selectedPhone || sending) return;

    setInput("");
    setSending(true);
    setError(null);

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("No autenticado.");

      const res = await fetch(`${BACKEND_URL}/api/whatsapp/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ to: selectedPhone, message: text }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Error ${res.status}`);
      }
    } catch (err: any) {
      setError(err.message || "Error enviando el mensaje.");
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleToggleBot = async (enabled: boolean) => {
    if (!selectedPhone) return;
    
    setTogglingBot(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("No autenticado.");

      const res = await fetch(`${BACKEND_URL}/api/whatsapp/bot-toggle`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ phone: selectedPhone, botEnabled: enabled }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Error ${res.status}`);
      }

      setBotEnabled(enabled);
    } catch (err: any) {
      setError(err.message || "Error al cambiar el estado del bot.");
      setBotEnabled(!enabled); // Revertir el cambio
    } finally {
      setTogglingBot(false);
    }
  };

  return (
    <Paper p="md" shadow="sm" radius="md" withBorder style={{ height: "calc(100vh - 120px)" }}>
      <Group mb="md">
        <Title order={2}>Chats WhatsApp</Title>
      </Group>

      <Group align="flex-start" style={{ height: "calc(100% - 56px)" }} gap={0}>
        {/* ── Panel izquierdo: lista de sesiones ── */}
        <Box
          style={{
            width: 260,
            height: "100%",
            borderRight: "1px solid #dee2e6",
            overflowY: "auto",
            flexShrink: 0,
          }}
        >
          {sessions.length === 0 && (
            <Text c="dimmed" size="sm" p="md">
              No hay conversaciones aún.
            </Text>
          )}
          {sessions.map((s) => (
            <Box
              key={s.phone}
              p="sm"
              onClick={() => setSelectedPhone(s.phone)}
              style={{
                cursor: "pointer",
                background: selectedPhone === s.phone ? "#e7f5ff" : "transparent",
                borderBottom: "1px solid #f1f3f5",
              }}
            >
              <Text fw={600} size="sm">
                {s.phone}
              </Text>
              <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {s.lastMessage || "Sin mensajes"}
              </Text>
              <Text size="xs" c="blue">
                Estado: {s.state}
              </Text>
            </Box>
          ))}
        </Box>

        {/* ── Panel derecho: conversación ── */}
        <Box style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column" }}>
          {!selectedPhone ? (
            <Text c="dimmed" size="sm" p="xl" ta="center">
              Selecciona una conversación para ver los mensajes.
            </Text>
          ) : !selectedSession ? (
            <Loader m="xl" />
          ) : (
            <>
              {/* Cabecera */}
              <Box
                p="sm"
                style={{
                  borderBottom: "1px solid #dee2e6",
                  background: "#6e8f6d",
                  flexShrink: 0,
                }}
              >
                <Group justify="space-between" mb="xs">
                  <Box>
                    <Text fw={700} c={"dark"}>{selectedPhone}</Text>
                    <Text size="xs" c="dark">
                      Estado bot: {selectedSession.state}
                    </Text>
                  </Box>
                  <Switch
                    label={botEnabled ? "Bot activo" : "Bot inactivo"}
                    checked={botEnabled}
                    onChange={(e) => handleToggleBot(e.currentTarget.checked)}
                    disabled={togglingBot}
                    color="green"
                  />
                </Group>
              </Box>

              {/* Mensajes */}
              <ScrollArea style={{ flex: 1, background: "#ece5dd" }} viewportRef={viewport} p="sm">
                {selectedSession.messages.length === 0 && (
                  <Text c="dimmed" size="sm" ta="center" mt="xl">
                    Sin mensajes aún.
                  </Text>
                )}
                {selectedSession.messages.map((msg, i) => (
                  <Group
                    key={i}
                    justify={msg.from === "user" ? "flex-start" : "flex-end"}
                    mb={6}
                  >
                    <Box>
                      <Text size="xs" c="dimmed" mb={2} ta={msg.from === "user" ? "left" : "right"}>
                        {FROM_LABELS[msg.from]}
                      </Text>
                      <Paper
                        p={msg.photoUrl ? 4 : "xs"}
                        radius="md"
                        maw={360}
                        style={{
                          background: FROM_COLORS[msg.from] ?? "#fff",
                          boxShadow: "0 1px 2px rgba(0,0,0,.15)",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {msg.photoUrl ? (
                          <Stack gap={4}>
                            <Image
                              src={msg.photoUrl}
                              alt="Foto del chat"
                              radius="sm"
                              fit="cover"
                              mah={220}
                              maw={260}
                            />
                            {msg.text && (
                              <Text size="sm" c="dark">
                                {msg.text}
                              </Text>
                            )}
                          </Stack>
                        ) : (
                          <Text size="sm" c="dark">
                            {msg.text || "[imagen]"}
                          </Text>
                        )}
                        <Text size="xs" c="dimmed" ta="right">
                          {new Date(msg.timestamp).toLocaleTimeString()}
                        </Text>
                      </Paper>
                    </Box>
                  </Group>
                ))}
              </ScrollArea>

              {/* Input del admin */}
              <Box
                p="sm"
                style={{
                  borderTop: "1px solid #dee2e6",
                  background: "#f0f0f0",
                  flexShrink: 0,
                }}
              >
                {error && (
                  <Text c="red" size="xs" mb={4}>
                    {error}
                  </Text>
                )}
                <Group gap="xs" align="flex-end">
                  <Textarea
                    placeholder="Escribe un mensaje como admin…"
                    value={input}
                    onChange={(e) => setInput(e.currentTarget.value)}
                    onKeyDown={handleKeyDown}
                    autosize
                    minRows={1}
                    maxRows={4}
                    style={{ flex: 1 }}
                    disabled={sending}
                  />
                  <Button
                    color="blue"
                    onClick={handleSend}
                    loading={sending}
                    h={36}
                  >
                    Enviar
                  </Button>
                </Group>
              </Box>
            </>
          )}
        </Box>
      </Group>
    </Paper>
  );
}
