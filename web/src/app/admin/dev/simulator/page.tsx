"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  Container,
  Group,
  Paper,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";

type WhatsAppPayload = {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        contacts: Array<{
          profile: {
            name: string;
          };
          wa_id: string;
        }>;
        messages: Array<{
          from: string;
          id: string;
          timestamp: string;
          type: string;
          text: {
            body: string;
          };
        }>;
      };
      field: string;
    }>;
  }>;
};

const PROJECT_ID = "lenovo-experiences";
const REGION = "us-central1";

// Usar el puerto del emulador
const FUNCTIONS_PORT = process.env.NEXT_PUBLIC_FUNCTIONS_PORT || "5010";

// Si usamos emuladores, la URL apunta a localhost. Si no, debe apuntar a la URL de Cloud Run en producción.
const WEBHOOK_URL =
  process.env.NEXT_PUBLIC_USE_EMULATORS === "true"
    ? `http://127.0.0.1:${FUNCTIONS_PORT}/${PROJECT_ID}/${REGION}/whatsappWebhook`
    : `https://whatsappwebhook-rwkor6m4fa-uc.a.run.app`;

const buildWhatsAppPayload = (
  phoneNumber: string,
  messageBody: string,
): WhatsAppPayload => {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WHATSAPP_BUSINESS_ACCOUNT_ID",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "1234567890",
                phone_number_id: "PHONE_NUMBER_ID",
              },
              contacts: [
                {
                  profile: {
                    name: "Mock User",
                  },
                  wa_id: phoneNumber,
                },
              ],
              messages: [
                {
                  from: phoneNumber,
                  id: `wamid.${Math.random().toString(36).substring(7)}`,
                  timestamp: Math.floor(Date.now() / 1000).toString(),
                  type: "text",
                  text: {
                    body: messageBody,
                  },
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
};

export default function SimulatorPage() {
  const [phone, setPhone] = useState("573001234567");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (log: string) => {
    const time = new Date().toLocaleTimeString();

    setLogs((prev) => [`[${time}] ${log}`, ...prev]);
  };

  const handleSend = async () => {
    if (!message.trim() || !phone.trim()) {
      return;
    }

    setLoading(true);

    const payload = buildWhatsAppPayload(phone, message);

    try {
      const response = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        addLog("Éxito: 200 OK");
        setMessage("");
        return;
      }

      const responseText = await response.text();

      addLog(
        `Error: ${response.status}. ` +
          `${responseText || "Sin detalle de respuesta."}`,
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Error desconocido";

      addLog(
        `Fetch Error: ${errorMessage}. ` +
          "Verifica que el emulador de Firebase esté corriendo.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container size="sm" py="xl">
      <Paper shadow="sm" p="lg" radius="md" withBorder>
        <Group justify="space-between" mb="md">
          <Title order={2}>Simulador WhatsApp</Title>

          <Badge color="blue" variant="light">
            Dev Mode
          </Badge>
        </Group>

        <Text c="dimmed" size="sm" mb="xl">
          Esto envía un payload de prueba directamente al emulador local del
          Webhook, simulando un mensaje entrante desde Meta WhatsApp Cloud API.
        </Text>

        <Stack>
          <TextInput
            label="Teléfono del remitente"
            value={phone}
            onChange={(event) => setPhone(event.currentTarget.value)}
            required
          />

          <Textarea
            label="Mensaje de prueba"
            placeholder="Ej: La vitrina principal del punto centro está rota."
            value={message}
            onChange={(event) => setMessage(event.currentTarget.value)}
            minRows={3}
            required
          />

          <Button
            onClick={handleSend}
            loading={loading}
            color="green"
            fullWidth
            mt="md"
          >
            Simular Webhook Meta
          </Button>
        </Stack>

        {logs.length > 0 && (
          <Paper mt="xl" p="sm" bg="gray.1" radius="md" c="black">
            <Title order={5} mb="sm">
              Logs:
            </Title>

            <Stack gap="xs">
              {logs.map((log, index) => (
                <Text key={index} size="xs" ff="monospace">
                  {log}
                </Text>
              ))}
            </Stack>
          </Paper>
        )}
      </Paper>
    </Container>
  );
}
