"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../../../../lib/firebase";
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
} from "@mantine/core";

export default function TicketDetailPage() {
  const params = useParams();
  const ticketId = params.id as string;
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loadingStatus, setLoadingStatus] = useState<TicketStatus | null>(null);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!ticketId) return;

    // Suscripción Realtime. NUNCA `updateDoc` en esta vista, estrictamente Zero-Trust.
    const unsubscribe = onSnapshot(doc(db, "tickets", ticketId), (doc) => {
      if (doc.exists()) {
        setTicket({ id: doc.id, ...doc.data() } as Ticket);
      }
    }, (error) => {
      console.warn("⚠️ Snapshot bloqueado:", error.message);
      setErrorStatus("Permiso denegado. Inicia sesión como Admin.");
    });

    return () => unsubscribe();
  }, [ticketId]);

  const changeStatus = async (newStatus: TicketStatus) => {
    setLoadingStatus(newStatus);
    setErrorStatus(null);

    // REGLA Zero-Trust: Usamos el conector Callable
    const transitionTicketStatus = httpsCallable(
      functions,
      "transitionTicketStatus",
    );

    try {
      await transitionTicketStatus({
        ticketId,
        newStatus,
        comments: "Transición automática desde el Dashboard Web",
      });
      // El onSnapshot arriba detectará el cambio de Firestore y actualizará la UI instantáneamente.
    } catch (error: any) {
      console.error("Error al actualizar el ticket:", error);
      setErrorStatus(
        error?.message ||
          "Algo salió mal al transicionar el flujo (Posible regla Auth Falló)",
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
          {errorStatus} (Asegúrate de estar autenticado con rol Custom Claim
          permitido).
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

      <Title order={4} mb="xs">
        Máquina de Estados de Reparación
      </Title>
      <Text size="sm" c="dimmed" mb="md">
        Zero-Trust Architecture: Estos botones despachan transacciones en
        Backend ('httpsCallable'). No se escribe desde cliente.
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
