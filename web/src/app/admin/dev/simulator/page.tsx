"use client";

import { useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Container,
  FileButton,
  Group,
  Image,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { IconPaperclip, IconX } from "@tabler/icons-react";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

interface ChatMessage {
  from: "user" | "bot";
  text?: string;
  photoUrl?: string;
}

export default function SimulatorPage() {
  const [phone, setPhone] = useState("573001234567");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const resetFileRef = useRef<() => void>(null);

  // Cargar historial cuando cambia el número
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const res = await fetch(
          `${BACKEND_URL}/api/whatsapp/chat-history/${phone}`,
        );
        if (res.ok) {
          const data = await res.json();
          setMessages(data.messages || []);
        }
      } catch (err) {
        console.error("Error cargando historial:", err);
      }
    };
    loadHistory();
  }, [phone]);

  // Polling: cada 2 segundos, recargar el historial para detectar cambios de estado
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `${BACKEND_URL}/api/whatsapp/chat-history/${phone}`,
        );
        if (res.ok) {
          const data = await res.json();
          const newMessages = data.messages || [];
          // Solo actualizar si hay nuevos mensajes
          setMessages((prevMessages) => {
            if (newMessages.length > prevMessages.length) {
              return newMessages;
            }
            return prevMessages;
          });
        }
      } catch (err) {
        // Error silencioso en polling
      }
    }, 2000); // Cada 2 segundos

    return () => clearInterval(interval);
  }, [phone]);

  // Scroll al último mensaje
  useEffect(() => {
    viewport.current?.scrollTo({
      top: viewport.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const handleAddFiles = (files: File[] | null) => {
    if (!files || files.length === 0) return;
    setPendingFiles((prev) => [...prev, ...files]);
    resetFileRef.current?.();
  };

  const removePendingFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && pendingFiles.length === 0) || !phone.trim() || loading) return;

    const filesSnapshot = pendingFiles;
    const localPhotoBubbles: ChatMessage[] = filesSnapshot.map((f) => ({
      from: "user",
      photoUrl: URL.createObjectURL(f),
    }));
    const textBubble: ChatMessage[] = text ? [{ from: "user", text }] : [];

    setInput("");
    setPendingFiles([]);
    setError(null);
    setMessages((prev) => [...prev, ...localPhotoBubbles, ...textBubble]);
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append("phone", phone);
      if (text) formData.append("message", text);
      filesSnapshot.forEach((f) => formData.append("files", f));

      const res = await fetch(`${BACKEND_URL}/api/whatsapp/simulate`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Error ${res.status}: ${body}`);
      }

      await res.json();
      // Refrescar el historial completo desde el servidor — fuente única de
      // verdad. Evita duplicados cuando el polling y la respuesta del endpoint
      // intentan añadir los mismos mensajes del bot a la vez.
      const historyRes = await fetch(
        `${BACKEND_URL}/api/whatsapp/chat-history/${phone}`,
      );
      if (historyRes.ok) {
        const data = await historyRes.json();
        setMessages(data.messages || []);
      }
    } catch (err: any) {
      setError(err.message || "No se pudo conectar al backend NestJS.");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleReset = () => {
    setMessages([]);
    setPendingFiles([]);
    setError(null);
  };

  return (
    <Container size="sm" py="xl">
      <Paper shadow="sm" p="lg" radius="md" withBorder>
        <TextInput
          label="Número de teléfono (remitente)"
          value={phone}
          onChange={(e) => setPhone(e.currentTarget.value)}
          mb="md"
          size="xs"
        />

        {/* Área de chat */}
        <Paper
          withBorder
          radius="md"
          style={{ overflow: "hidden" }}
          mb="sm"
        >
          {/* Barra del "teléfono" */}
          <Box bg="green.7" p="xs">
            <Text c="white" size="sm" fw={600}>
              WhatsApp · {phone}
            </Text>
          </Box>

          <ScrollArea
            h={420}
            viewportRef={viewport}
            p="sm"
            style={{ background: "#ece5dd" }}
          >
            {messages.length === 0 && (
              <Text c="dimmed" size="sm" ta="center" mt="xl">
                Escribe un mensaje o adjunta fotos para iniciar la conversación...
              </Text>
            )}

            {messages.map((msg, i) => (
              <Group
                key={i}
                justify={msg.from === "user" ? "flex-end" : "flex-start"}
                mb={6}
              >
                <Paper
                  p={msg.photoUrl ? 4 : "xs"}
                  radius="md"
                  maw="75%"
                  style={{
                    background: msg.from === "user" ? "#dcf8c6" : "#bffcb2",
                    boxShadow: "0 1px 2px rgba(0,0,0,.15)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {msg.photoUrl ? (
                    <Image
                      src={msg.photoUrl}
                      alt="Foto"
                      radius="sm"
                      fit="cover"
                      mah={220}
                      maw={260}
                    />
                  ) : (
                    <Text size="sm" c="dark">
                      {msg.text}
                    </Text>
                  )}
                </Paper>
              </Group>
            ))}

            {loading && (
              <Group justify="flex-start" mb={6}>
                <Paper
                  p="xs"
                  radius="md"
                  style={{ background: "#ffffff", minWidth: 56 }}
                >
                  <Text size="sm" c="dimmed">
                    escribiendo…
                  </Text>
                </Paper>
              </Group>
            )}
          </ScrollArea>

          {/* Vista previa de fotos pendientes */}
          {pendingFiles.length > 0 && (
            <Box p="xs" style={{ background: "#f5f5f5", borderTop: "1px solid #ddd" }}>
              <Text size="xs" c="dimmed" mb={4}>
                {pendingFiles.length} foto(s) listas para enviar:
              </Text>
              <Group gap="xs" wrap="wrap">
                {pendingFiles.map((f, i) => (
                  <Box key={i} style={{ position: "relative" }}>
                    <Image
                      src={URL.createObjectURL(f)}
                      alt={f.name}
                      w={64}
                      h={64}
                      radius="sm"
                      fit="cover"
                    />
                    <ActionIcon
                      size="xs"
                      color="red"
                      variant="filled"
                      onClick={() => removePendingFile(i)}
                      style={{
                        position: "absolute",
                        top: -6,
                        right: -6,
                      }}
                    >
                      <IconX size={12} />
                    </ActionIcon>
                  </Box>
                ))}
              </Group>
            </Box>
          )}

          {/* Input */}
          <Box p="sm" style={{ background: "#f0f0f0", borderTop: "1px solid #ddd" }}>
            {error && (
              <Text c="red" size="xs" mb={6}>
                {error}
              </Text>
            )}
            <Group gap="xs" align="flex-end">
              <FileButton
                resetRef={resetFileRef}
                onChange={handleAddFiles}
                accept="image/*"
                multiple
              >
                {(props) => (
                  <ActionIcon
                    {...props}
                    size="lg"
                    variant="filled"
                    color="green"
                    disabled={loading}
                    title="Adjuntar fotos"
                  >
                    <IconPaperclip size={20} />
                  </ActionIcon>
                )}
              </FileButton>

              <Textarea
                placeholder="Escribe un mensaje…"
                value={input}
                onChange={(e) => setInput(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                autosize
                minRows={1}
                maxRows={4}
                style={{ flex: 1 }}
                disabled={loading}
              />
              <Button
                color="green"
                onClick={handleSend}
                loading={loading}
                h={36}
              >
                Enviar
              </Button>
            </Group>
          </Box>
        </Paper>

        <Group justify="space-between">
          <Button size="xs" variant="light" color="gray" onClick={handleReset}>
            Limpiar chat
          </Button>
        </Group>
      </Paper>
    </Container>
  );
}
