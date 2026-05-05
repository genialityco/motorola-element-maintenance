"use client";

import { useState } from "react";
import {
  Container,
  Title,
  Paper,
  Group,
  TextInput,
  Button,
  Stack,
  ScrollArea,
  Text,
  Image,
  Badge,
  Box,
  Loader,
  Alert,
} from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

interface ChatMessage {
  from: "user" | "bot" | "admin";
  text?: string;
  photoUrl?: string;
  timestamp: number;
}

export default function ChatsPage() {
  const [phoneSearch, setPhoneSearch] = useState("");
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneSearch.trim()) return;

    setLoading(true);
    setError(null);
    setMessages([]);

    try {
      const res = await fetch(
        `${BACKEND_URL}/api/whatsapp/chat-history/${phoneSearch.trim()}`,
      );

      if (!res.ok) {
        throw new Error(`Error ${res.status}: No se encontró la conversación.`);
      }

      const data = await res.json();
      setMessages(data.messages || []);
      setSelectedPhone(phoneSearch.trim());
    } catch (err: any) {
      setError(err.message || "Error al cargar la conversación.");
      setMessages([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSendReply = async () => {
    if (!replyText.trim() || !selectedPhone) return;

    setSendingReply(true);
    setError(null);

    try {
      const res = await fetch(`${BACKEND_URL}/api/whatsapp/send-message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: selectedPhone,
          text: replyText,
        }),
      });

      if (!res.ok) {
        throw new Error(`Error ${res.status} al enviar mensaje.`);
      }

      setReplyText("");
      // Recargar conversación
      const historyRes = await fetch(
        `${BACKEND_URL}/api/whatsapp/chat-history/${selectedPhone}`,
      );
      if (historyRes.ok) {
        const data = await historyRes.json();
        setMessages(data.messages || []);
      }
    } catch (err: any) {
      setError(err.message || "Error al enviar la respuesta.");
    } finally {
      setSendingReply(false);
    }
  };

  return (
    <Container size="lg" py="xl">
      <Title order={1} mb="xl">
        💬 Chats con Usuarios
      </Title>

      {/* Búsqueda de teléfono */}
      <Paper p="lg" shadow="sm" radius="md" withBorder mb="xl">
        <form onSubmit={handleSearch}>
          <Group>
            <TextInput
              placeholder="Buscar por número de teléfono (ej: 573001234567)"
              leftSection={<IconSearch size={16} />}
              value={phoneSearch}
              onChange={(e) => setPhoneSearch(e.currentTarget.value)}
              flex={1}
            />
            <Button type="submit" loading={loading}>
              Buscar
            </Button>
          </Group>
        </form>
      </Paper>

      {/* Mensajes */}
      {selectedPhone && (
        <Paper shadow="sm" radius="md" withBorder>
          {/* Header */}
          <Box bg="blue.6" p="md">
            <Group justify="space-between">
              <div>
                <Text c="white" fw={600} size="lg">
                  Conversación con {selectedPhone}
                </Text>
              </div>
              <Badge color="cyan">Chat Activo</Badge>
            </Group>
          </Box>

          {error && (
            <Alert color="red" title="Error" p="md">
              {error}
            </Alert>
          )}

          {/* Área de mensajes */}
          <ScrollArea h={500} p="md" style={{ background: "#f8f8f8" }}>
            {loading && (
              <Stack align="center">
                <Loader />
                <Text c="dimmed">Cargando conversación...</Text>
              </Stack>
            )}

            {messages.length === 0 && !loading && (
              <Text c="dimmed" ta="center" mt="xl">
                Sin mensajes o conversación vacía.
              </Text>
            )}

            {messages.map((msg, i) => (
              <Group
                key={i}
                justify={msg.from === "user" ? "flex-end" : "flex-start"}
                mb="sm"
              >
                <Paper
                  p={msg.photoUrl ? 4 : "xs"}
                  radius="md"
                  maw="70%"
                  style={{
                    background:
                      msg.from === "user"
                        ? "#dcf8c6"
                        : msg.from === "admin"
                          ? "#fff3cd"
                          : "#ffffff",
                    boxShadow: "0 1px 2px rgba(0,0,0,.15)",
                  }}
                >
                  <Stack gap={4}>
                    {msg.photoUrl ? (
                      <Image
                        src={msg.photoUrl}
                        alt="Foto del chat"
                        radius="sm"
                        fit="cover"
                        mah={220}
                        maw={260}
                      />
                    ) : (
                      <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                        {msg.text}
                      </Text>
                    )}
                    <Text size="xs" c="dimmed">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </Text>
                  </Stack>
                </Paper>
              </Group>
            ))}
          </ScrollArea>

          {/* Área para responder */}
          <Box p="md" style={{ borderTop: "1px solid #ddd" }}>
            <Group>
              <TextInput
                placeholder="Escribe una respuesta..."
                value={replyText}
                onChange={(e) => setReplyText(e.currentTarget.value)}
                flex={1}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendReply();
                  }
                }}
              />
              <Button
                onClick={handleSendReply}
                loading={sendingReply}
                disabled={!replyText.trim()}
              >
                Enviar
              </Button>
            </Group>
          </Box>
        </Paper>
      )}
    </Container>
  );
}
