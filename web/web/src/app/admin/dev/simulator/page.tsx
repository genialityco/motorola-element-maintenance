"use client";

import { useState } from 'react';
import { Container, Title, TextInput, Button, Paper, Group, Text, Textarea, Stack, Badge } from '@mantine/core';

// Meta WhatsApp Cloud API Payload Builder
const buildWhatsAppPayload = (phoneNumber: string, messageBody: string) => {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '1234567890',
                phone_number_id: 'PHONE_NUMBER_ID',
              },
              contacts: [
                {
                  profile: {
                    name: 'Mock User',
                  },
                  wa_id: phoneNumber,
                },
              ],
              messages: [
                {
                  from: phoneNumber,
                  id: `wamid.${Math.random().toString(36).substring(7)}`,
                  timestamp: Math.floor(Date.now() / 1000).toString(),
                  type: 'text',
                  text: {
                    body: messageBody,
                  },
                },
              ],
            },
            field: 'messages',
          },
        ],
      },
    ],
  };
};

export default function SimulatorPage() {
  const [phone, setPhone] = useState('573001234567');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const handleSend = async () => {
    if (!message.trim() || !phone.trim()) return;

    setLoading(true);
    const payload = buildWhatsAppPayload(phone, message);
    
    // URL del emulador local de Firebase Functions
    // Asegúrate de revisar que el projectId coincide con el emulador local.
    const WEBHOOK_URL = 'http://127.0.0.1:5010/demo-test/us-central1/whatsappWebhook';
    
    try {
      const response = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        setLogs((prev) => [`[${new Date().toLocaleTimeString()}] ✅ Éxito: 200 OK`, ...prev]);
        setMessage('');
      } else {
        setLogs((prev) => [`[${new Date().toLocaleTimeString()}] ❌ Error: ${response.status}`, ...prev]);
      }
    } catch (err: any) {
      setLogs((prev) => [`[${new Date().toLocaleTimeString()}] ❌ Fetch Error: ${err?.message} (Asegúrate de que emulators:start esté corriendo)`, ...prev]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container size="sm" py="xl">
      <Paper shadow="sm" p="lg" radius="md" withBorder>
        <Group justify="space-between" mb="md">
          <Title order={2}>Simulador WhatsApp</Title>
          <Badge color="blue" variant="light">Dev Mode</Badge>
        </Group>

        <Text c="dimmed" size="sm" mb="xl">
          Esto envía un payload de prueba directamente al emulador local del Webhook (Cloud Functions), simulando Meta.
        </Text>

        <Stack>
          <TextInput
            label="Teléfono del Remitente"
            value={phone}
            onChange={(e) => setPhone(e.currentTarget.value)}
            required
          />

          <Textarea
            label="Mensaje de Prueba"
            placeholder="Ej: La vitrina principal del punto centro está rota."
            value={message}
            onChange={(e) => setMessage(e.currentTarget.value)}
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
          <Paper mt="xl" p="sm" bg="gray.1" radius="md">
            <Title order={5} mb="sm">📋 Logs:</Title>
            <Stack gap="xs">
              {logs.map((log, i) => (
                <Text key={i} size="xs" ff="monospace">
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
