"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db, auth } from "../../../../../lib/firebase";
import { Ticket, TicketStatus } from "../../../../../../../shared/types";
import { useParams } from "next/navigation";
import {
  Title,
  Paper,
  Group,
  Text,
  Badge,
  Button,
  Stack,
  Loader,
  Alert,
  Image,
  SimpleGrid,
} from "@mantine/core";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

export default function TicketDetailPage() {
  const params = useParams();
  const ticketId = params.id as string;
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loadingStatus, setLoadingStatus] = useState<TicketStatus | null>(null);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!ticketId) return;

    const unsubscribe = onSnapshot(
      doc(db, "tickets", ticketId),
      (snap) => {
        if (snap.exists()) {
          setTicket({ id: snap.id, ...snap.data() } as Ticket);
        }
      },
      (error) => {
        console.warn("⚠️ Snapshot bloqueado:", error.message);
        setErrorStatus("Permiso denegado. Inicia sesión como Admin.");
      },
    );

    return () => unsubscribe();
  }, [ticketId]);

  const changeStatus = async (newStatus: TicketStatus) => {
    setLoadingStatus(newStatus);
    setErrorStatus(null);

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("No autenticado. Inicia sesión.");

      const res = await fetch(
        `${BACKEND_URL}/api/tickets/${ticketId}/transition`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            newStatus,
            comments: "Transición desde el Dashboard Web",
          }),
        },
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Error ${res.status}`);
      }
      // onSnapshot detectará el cambio en Firestore y actualizará la UI.
    } catch (error: any) {
      console.error("Error al actualizar el ticket:", error);
      setErrorStatus(
        error?.message || "Algo salió mal al transicionar el estado.",
      );
    } finally {
      setLoadingStatus(null);
    }
  };

  if (!ticket) return <Loader color="blue" type="bars" mt="xl" />;

  const statusOptions: TicketStatus[] = [
    "REPORTADO",
    "REVISION",
    "EN_REPARACION",
    "REPARADO",
    "ENTREGADO",
  ];

  return (
    <Paper p="lg" shadow="sm" radius="md" withBorder>
      <Group justify="space-between" mb="lg">
        <Title order={2}>Detalle de Ticket: {ticket.ticketNumber}</Title>
        <Badge
          size="xl"
          color={ticket.status === "ENTREGADO" ? "green" : "blue"}
        >
          {ticket.status}
        </Badge>
      </Group>

      {errorStatus && (
        <Alert color="red" title="Error Transaccional" mb="md">
          {errorStatus}
        </Alert>
      )}

      <Stack
        gap="md"
        mb="xl"
        bg="gray.0"
        p="md"
        c="black"
        style={{ borderRadius: "8px" }}
      >
        <Group>
          <Text fw={700}>Punto Afectado:</Text>
          <Text>{ticket.point?.name || "---"}</Text>
        </Group>

        <Group>
          <Text fw={700}>Reportado Por:</Text>
          <Text>
            {ticket.reporter?.name} ({ticket.reporter?.phone})
          </Text>
        </Group>

        <Group>
          <Text fw={700}>Descripción de la Novedad:</Text>
          <Text>{ticket.novelty?.description || "Sin descripción"}</Text>
        </Group>

        <Group>
          <Text fw={700}>Creación:</Text>
          <Text>
            {ticket.timestamps?.createdAt
              ? new Date(ticket.timestamps.createdAt).toLocaleString()
              : "---"}
          </Text>
        </Group>
      </Stack>

      <Title order={4} mb="md" mt="xl">
        📷 Evidencia
      </Title>
      {ticket.photos?.evidence && ticket.photos.evidence.length > 0 ? (
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md" mb="xl">
          {ticket.photos.evidence.map((photoUrl, idx) => (
            <Paper key={idx} p="xs" withBorder radius="md">
              <Image
                src={photoUrl}
                alt={`Evidencia ${idx + 1}`}
                radius="md"
                fit="cover"
                h={200}
              />
            </Paper>
          ))}
        </SimpleGrid>
      ) : (
        <Alert color="gray" title="Sin evidencia" mb="xl">
          No hay fotos adjuntas para este ticket.
        </Alert>
      )}

      <Title order={4} mb="xs">
        Máquina de Estados de Reparación
      </Title>
      <Text size="sm" c="dimmed" mb="md">
        Zero-Trust: Los botones envían transacciones al backend NestJS. No se
        escribe directamente desde el cliente.
      </Text>

      <Group gap="sm">
        {statusOptions.map((status) => (
          <Button
            key={status}
            onClick={() => changeStatus(status)}
            loading={loadingStatus === status}
            disabled={ticket.status === status || loadingStatus !== null}
            color={ticket.status === status ? "gray" : "dark"}
            variant={ticket.status === status ? "filled" : "outline"}
          >
            Mover a {status}
          </Button>
        ))}
      </Group>
    </Paper>
  );
}
