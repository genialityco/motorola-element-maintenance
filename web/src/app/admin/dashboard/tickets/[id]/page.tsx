"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
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
  Timeline,
  Collapse,
  ActionIcon,
  Tooltip,
  FileButton,
  Box,
  Textarea,
  Modal,
} from "@mantine/core";

type StatusHistoryEntry = {
  id: string;
  previousStatus?: TicketStatus;
  newStatus: TicketStatus;
  changedBy?: { uid?: string; role?: string };
  comments?: string;
  timestamp: number;
};

const STATUS_COLORS: Record<TicketStatus, string> = {
  REPORTADO: "gray",
  REVISION: "blue",
  EN_REPARACION: "yellow",
  REPARADO: "teal",
  ENTREGADO: "green",
  FINALIZADO: "green",
};

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

export default function TicketDetailPage() {
  const params = useParams();
  const ticketId = params.id as string;
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [history, setHistory] = useState<StatusHistoryEntry[]>([]);
  const [loadingStatus, setLoadingStatus] = useState<TicketStatus | null>(null);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [deletingPhotoIdx, setDeletingPhotoIdx] = useState<number | null>(null);
  const [deletingRepairIdx, setDeletingRepairIdx] = useState<number | null>(
    null,
  );
  const [repairFiles, setRepairFiles] = useState<File[]>([]);
  const [uploadingRepair, setUploadingRepair] = useState(false);
  const repairFileInputRef = useRef<() => void>(null);
  const [evidenceExpanded, setEvidenceExpanded] = useState(false);
  const [repairExpanded, setRepairExpanded] = useState(false);
  const [observations, setObservations] = useState("");
  const [savingObservations, setSavingObservations] = useState(false);
  const [requestModal, setRequestModal] = useState<{ fieldKey: string; fieldLabel: string } | null>(null);
  const [requestMessage, setRequestMessage] = useState("");
  const [requestingField, setRequestingField] = useState(false);

  useEffect(() => {
    if (!ticketId) return;

    const unsubscribe = onSnapshot(
      doc(db, "tickets", ticketId),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data()!;
          setTicket({ id: snap.id, ...data } as Ticket);
          setObservations((data.observations as string) || "");
        }
      },
      (error) => {
        console.warn("⚠️ Snapshot bloqueado:", error.message);
        setErrorStatus("Permiso denegado. Inicia sesión como Admin.");
      },
    );

    return () => unsubscribe();
  }, [ticketId]);

  useEffect(() => {
    if (!ticketId) return;

    const q = query(
      collection(db, "tickets", ticketId, "statusHistory"),
      orderBy("timestamp", "asc"),
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setHistory(
          snap.docs.map(
            (d) => ({ id: d.id, ...d.data() }) as StatusHistoryEntry,
          ),
        );
      },
      (error) => {
        console.warn("⚠️ Historial bloqueado:", error.message);
      },
    );

    return () => unsubscribe();
  }, [ticketId]);

  const timeline = useMemo(() => {
    if (!ticket) return [];

    const createdAt = ticket.timestamps?.createdAt;
    const initial = {
      status: "REPORTADO" as TicketStatus,
      timestamp: createdAt ? Number(createdAt) : 0,
      comments: "Ticket creado",
      changedBy: undefined as StatusHistoryEntry["changedBy"],
    };

    const transitions = history.map((entry) => ({
      status: entry.newStatus,
      timestamp: entry.timestamp,
      comments: entry.comments,
      changedBy: entry.changedBy,
    }));

    return [initial, ...transitions];
  }, [ticket, history]);

  const getToken = async () => {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error("No autenticado. Inicia sesión.");
    return token;
  };

  const requestFieldImprovement = async () => {
    if (!requestModal || !ticket) return;
    setRequestingField(true);
    setErrorStatus(null);
    try {
      const token = await getToken();
      const res = await fetch(`${BACKEND_URL}/api/whatsapp/request-field-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ticketId,
          fieldKey: requestModal.fieldKey,
          fieldLabel: requestModal.fieldLabel,
          customMessage: requestMessage.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Error ${res.status}`);
      }
      setRequestModal(null);
      setRequestMessage("");
    } catch (error: any) {
      setErrorStatus(error?.message || "Error al enviar la solicitud.");
    } finally {
      setRequestingField(false);
    }
  };

  const saveObservations = async () => {
    setSavingObservations(true);
    setErrorStatus(null);
    try {
      const token = await getToken();
      const res = await fetch(
        `${BACKEND_URL}/api/tickets/${ticketId}/observation`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ observations }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Error ${res.status}`);
      }
    } catch (error: any) {
      setErrorStatus(error?.message || "Error al guardar las observaciones.");
    } finally {
      setSavingObservations(false);
    }
  };

  const changeStatus = async (newStatus: TicketStatus) => {
    setLoadingStatus(newStatus);
    setErrorStatus(null);

    try {
      const token = await getToken();

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
    } catch (error: any) {
      console.error("Error al actualizar el ticket:", error);
      setErrorStatus(
        error?.message || "Algo salió mal al transicionar el estado.",
      );
    } finally {
      setLoadingStatus(null);
    }
  };

  const deleteEvidencePhoto = async (idx: number) => {
    setDeletingPhotoIdx(idx);
    setErrorStatus(null);
    try {
      const token = await getToken();
      const res = await fetch(
        `${BACKEND_URL}/api/tickets/${ticketId}/photos/evidence/${idx}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Error ${res.status}`);
      }
    } catch (error: any) {
      setErrorStatus(error?.message || "Error al eliminar la foto.");
    } finally {
      setDeletingPhotoIdx(null);
    }
  };

  const deleteRepairPhoto = async (idx: number) => {
    setDeletingRepairIdx(idx);
    setErrorStatus(null);
    try {
      const token = await getToken();
      const res = await fetch(
        `${BACKEND_URL}/api/tickets/${ticketId}/photos/repair/${idx}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Error ${res.status}`);
      }
    } catch (error: any) {
      setErrorStatus(
        error?.message || "Error al eliminar la foto de reparación.",
      );
    } finally {
      setDeletingRepairIdx(null);
    }
  };

  const uploadRepairPhotos = async () => {
    if (!repairFiles.length) return;
    setUploadingRepair(true);
    setErrorStatus(null);

    try {
      const token = await getToken();

      for (const file of repairFiles) {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch(
          `${BACKEND_URL}/api/tickets/${ticketId}/photos/repair`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
          },
        );

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || `Error ${res.status}`);
        }
      }

      setRepairFiles([]);
    } catch (error: any) {
      setErrorStatus(error?.message || "Error al subir las fotos.");
    } finally {
      setUploadingRepair(false);
    }
  };

  if (!ticket) return <Loader color="blue" type="bars" mt="xl" />;

  const statusOptions: TicketStatus[] = [
    "REPORTADO",
    "REVISION",
    "EN_REPARACION",
    "REPARADO",
    "ENTREGADO",
    "FINALIZADO",
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
        <Alert
          color="red"
          title="Error"
          mb="md"
          withCloseButton
          onClose={() => setErrorStatus(null)}
        >
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
        {ticket.ciudad && (
          <Group justify="space-between">
            <Group>
              <Text fw={700}>Ciudad:</Text>
              <Text>{ticket.ciudad}</Text>
            </Group>
            <Tooltip label="Solicitar mejora al usuario">
              <ActionIcon variant="filled" color="orange" size="sm" onClick={() => setRequestModal({ fieldKey: "ciudad", fieldLabel: "Ciudad" })}>✎</ActionIcon>
            </Tooltip>
          </Group>
        )}

        {ticket.canal && (
          <Group justify="space-between">
            <Group>
              <Text fw={700}>Canal:</Text>
              <Text>{ticket.canal}</Text>
            </Group>
            <Tooltip label="Solicitar mejora al usuario">
              <ActionIcon variant="filled" color="orange" size="sm" onClick={() => setRequestModal({ fieldKey: "canal", fieldLabel: "Canal" })}>✎</ActionIcon>
            </Tooltip>
          </Group>
        )}

        <Group justify="space-between">
          <Group>
            <Text fw={700}>Punto Afectado:</Text>
            <Text>{ticket.point?.name || "---"}</Text>
          </Group>
          <Tooltip label="Solicitar mejora al usuario">
            <ActionIcon variant="filled" color="orange" size="sm" onClick={() => setRequestModal({ fieldKey: "punto", fieldLabel: "Punto de Venta" })}>✎</ActionIcon>
          </Tooltip>
        </Group>

        <Group>
          <Text fw={700}>Reportado Por:</Text>
          <Text>
            {ticket.reporter?.name} ({ticket.reporter?.phone})
          </Text>
        </Group>

        {(ticket.novelty?.type || ticket.extraFields?.['novelty.type']) && (
          <Group justify="space-between">
            <Group>
              <Text fw={700}>Tipo de Novedad:</Text>
              <Text>{ticket.novelty?.type || ticket.extraFields?.['novelty.type']}</Text>
            </Group>
            <Tooltip label="Solicitar mejora al usuario">
              <ActionIcon variant="filled" color="orange" size="sm" onClick={() => setRequestModal({ fieldKey: "novelty.type", fieldLabel: "Tipo de Novedad" })}>✎</ActionIcon>
            </Tooltip>
          </Group>
        )}

        <Group justify="space-between">
          <Group>
            <Text fw={700}>Descripción de la Novedad:</Text>
            <Text>{ticket.novelty?.description || ticket.extraFields?.['novelty.description'] || "Sin descripción"}</Text>
          </Group>
          <Tooltip label="Solicitar mejora al usuario">
            <ActionIcon variant="filled" color="orange" size="sm" onClick={() => setRequestModal({ fieldKey: "novelty.description", fieldLabel: "Descripción de la Novedad" })}>✎</ActionIcon>
          </Tooltip>
        </Group>

        <Stack gap="xs">
          <Button
            variant="light"
            fullWidth
            onClick={() => setHistoryExpanded(!historyExpanded)}
            justify="space-between"
          >
            <Text fw={700}>Historial de Estados ({timeline.length})</Text>
            <Text>{historyExpanded ? "▼" : "▶"}</Text>
          </Button>

          <Collapse expanded={historyExpanded}>
            {timeline.length === 0 ? (
              <Text c="dimmed" size="sm">
                Sin registros aún.
              </Text>
            ) : (
              <Timeline
                active={timeline.length - 1}
                bulletSize={20}
                lineWidth={2}
                mt="xs"
              >
                {timeline.map((entry, idx) => (
                  <Timeline.Item
                    key={idx}
                    title={
                      <Badge color={STATUS_COLORS[entry.status] || "gray"}>
                        {entry.status}
                      </Badge>
                    }
                  >
                    <Text size="sm">
                      {entry.timestamp
                        ? new Date(entry.timestamp).toLocaleString()
                        : "---"}
                    </Text>
                    {entry.comments && (
                      <Text size="xs" c="dimmed">
                        {entry.comments}
                      </Text>
                    )}
                    {entry.changedBy?.role && (
                      <Text size="xs" c="dimmed">
                        Por: {entry.changedBy.role}
                        {entry.changedBy.uid
                          ? ` (${entry.changedBy.uid.slice(0, 8)}…)`
                          : ""}
                      </Text>
                    )}
                  </Timeline.Item>
                ))}
              </Timeline>
            )}
          </Collapse>
        </Stack>
      </Stack>

      {/* ── Fotos de Evidencia ── */}
      <Stack gap="xs" mb="xl" mt="xl">
        <Button
          variant="light"
          fullWidth
          onClick={() => setEvidenceExpanded(!evidenceExpanded)}
          justify="space-between"
        >
          <Text fw={700}>
            📷 Evidencia del Problema ({ticket.photos?.evidence?.length ?? 0}{" "}
            fotos)
          </Text>
          <Text>{evidenceExpanded ? "▼" : "▶"}</Text>
        </Button>
        <Collapse expanded={evidenceExpanded}>
          {ticket.photos?.evidence && ticket.photos.evidence.length > 0 ? (
            <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md" mt="sm">
              {ticket.photos.evidence.map((photoUrl, idx) => (
                <Paper
                  key={idx}
                  p="xs"
                  withBorder
                  radius="md"
                  style={{ position: "relative" }}
                >
                  <Image
                    src={photoUrl}
                    alt={`Evidencia ${idx + 1}`}
                    radius="md"
                    fit="cover"
                    h={200}
                  />
                  <Tooltip label="Eliminar foto" withArrow>
                    <ActionIcon
                      color="red"
                      variant="filled"
                      size="sm"
                      style={{ position: "absolute", top: 12, right: 12 }}
                      onClick={() => deleteEvidencePhoto(idx)}
                      loading={deletingPhotoIdx === idx}
                    >
                      ✕
                    </ActionIcon>
                  </Tooltip>
                  <Text size="xs" c="dimmed" ta="center" mt={4}>
                    Foto {idx + 1}
                  </Text>
                </Paper>
              ))}
            </SimpleGrid>
          ) : (
            <Alert color="gray" title="Sin evidencia" mt="sm">
              No hay fotos adjuntas para este ticket.
            </Alert>
          )}
        </Collapse>
      </Stack>

      {/* ── Fotos de Reparación ── */}
      <Stack gap="xs" mb="md">
        <Button
          variant="light"
          color="teal"
          fullWidth
          onClick={() => setRepairExpanded(!repairExpanded)}
          justify="space-between"
        >
          <Text fw={700}>
            🔧 Evidencias de Reparación ({ticket.photos?.repair?.length ?? 0}{" "}
            fotos)
          </Text>
          <Text>{repairExpanded ? "▼" : "▶"}</Text>
        </Button>
        <Collapse expanded={repairExpanded}>
          {ticket.photos?.repair && ticket.photos.repair.length > 0 ? (
            <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md" mt="sm">
              {ticket.photos.repair.map((photoUrl, idx) => (
                <Paper
                  key={idx}
                  p="xs"
                  withBorder
                  radius="md"
                  style={{ position: "relative" }}
                >
                  <Image
                    src={photoUrl}
                    alt={`Reparación ${idx + 1}`}
                    radius="md"
                    fit="cover"
                    h={200}
                  />
                  <Tooltip label="Eliminar foto" withArrow>
                    <ActionIcon
                      color="red"
                      variant="filled"
                      size="sm"
                      style={{ position: "absolute", top: 12, right: 12 }}
                      onClick={() => deleteRepairPhoto(idx)}
                      loading={deletingRepairIdx === idx}
                    >
                      ✕
                    </ActionIcon>
                  </Tooltip>
                  <Text size="xs" c="dimmed" ta="center" mt={4}>
                    Reparación {idx + 1}
                  </Text>
                </Paper>
              ))}
            </SimpleGrid>
          ) : (
            <Alert color="gray" title="Sin evidencias de reparación" mt="sm">
              No hay fotos de reparación adjuntas.
            </Alert>
          )}
        </Collapse>
      </Stack>

      <Box mb="xl">
        <FileButton
          resetRef={repairFileInputRef}
          onChange={(files) => setRepairFiles(files)}
          accept="image/*"
          multiple
        >
          {(props) => (
            <Button {...props} variant="light" color="teal" mr="sm">
              Seleccionar fotos de reparación
            </Button>
          )}
        </FileButton>
        {repairFiles.length > 0 && (
          <>
            <Text size="sm" c="dimmed" mt="xs" mb="xs">
              {repairFiles.length} archivo(s) seleccionado(s):{" "}
              {repairFiles.map((f) => f.name).join(", ")}
            </Text>
            <Button
              onClick={uploadRepairPhotos}
              loading={uploadingRepair}
              color="teal"
            >
              Subir fotos de reparación
            </Button>
          </>
        )}
      </Box>

      {/* ── Máquina de Estados ── */}
      <Title order={4} mb="xs">
        Estados de Reparación
      </Title>
      {/* <Text size="sm" c="dimmed" mb="md">
        Zero-Trust: Los botones envían transacciones al backend NestJS. No se
        escribe directamente desde el cliente.
      </Text> */}

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

      {/* ── Observaciones del Admin ── */}
      <Box mt="xl">
        <Title order={4} mb="xs">
          Observaciones del Ticket
        </Title>
        <Text size="sm" c="dimmed" mb="sm">
          Notas internas del administrador. No se envían al usuario.
        </Text>
        <Textarea
          placeholder="Agrega observaciones o comentarios sobre este ticket..."
          value={observations}
          onChange={(e) => setObservations(e.currentTarget.value)}
          minRows={3}
          autosize
          mb="sm"
        />
        <Button
          onClick={saveObservations}
          loading={savingObservations}
          variant="light"
          color="blue"
        >
          Guardar observaciones
        </Button>
      </Box>

      <Modal
        opened={!!requestModal}
        onClose={() => { setRequestModal(null); setRequestMessage(""); }}
        title={`Solicitar mejora: ${requestModal?.fieldLabel}`}
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Se enviará un mensaje por WhatsApp al usuario pidiéndole que actualice <strong>{requestModal?.fieldLabel}</strong> del ticket <strong>{ticket.ticketNumber}</strong>.
          </Text>
          <Textarea
            label="Mensaje adicional (opcional)"
            placeholder="Ej: La descripción debe incluir el modelo del equipo afectado."
            value={requestMessage}
            onChange={(e) => setRequestMessage(e.currentTarget.value)}
            minRows={2}
            autosize
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => { setRequestModal(null); setRequestMessage(""); }}>Cancelar</Button>
            <Button color="orange" loading={requestingField} onClick={requestFieldImprovement}>
              Enviar solicitud
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Paper>
  );
}
