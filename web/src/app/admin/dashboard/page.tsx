"use client";

import { useEffect, useState, useMemo } from 'react';
import { collection, doc, onSnapshot, query } from 'firebase/firestore';
import { db, auth } from '../../../lib/firebase';
import { Ticket } from '../../../../../shared/types';
import {
  Table, Badge, Group, Title, Paper, Button,
  Popover, Checkbox, Text, Stack, Select,
  Modal, TextInput, ActionIcon, Tooltip, Pagination, Tabs,
  Textarea, Switch,
} from '@mantine/core';
import {
  IconArrowUp, IconArrowDown, IconArrowsSort, IconFilter, IconEdit,
} from '@tabler/icons-react';
import Link from 'next/link';
import * as XLSX from 'xlsx';

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

// ── Bot Config types ───────────────────────────────────────────────────────────
type BotMessages = {
  menu: string; photosPrompt: string; ticketCreated: string;
  statusChanged: string; reparadoMessage: string; noTickets: string;
  invalidField: string; cancelled: string; goodbye: string; viewTicketOptions: string;
};
type FieldType = 'string' | 'numeric' | 'date' | 'photo' | 'video';
type FieldSource = 'bot' | 'admin' | 'auto';
type BotField = { key: string; label: string; order: number; normalize: boolean; type: FieldType; source: FieldSource; required: boolean; }
type StandardField = { key: string; label: string; type: FieldType; source: FieldSource; required: boolean; };;

const DEFAULT_BOT_MESSAGES: BotMessages = {
  menu: 'Hola, a continuación te mostraré las diferentes funcionalidades que poseo:\n1. Para crear un ticket presiona 1\n2. Para ver el estado de tus tickets presiona 2\n3. Para editar un ticket presiona 3\n4. Para eliminar un ticket presiona 4\n5. Para finalizar un ticket presiona 5',
  photosPrompt: 'Sube unas fotos y añade una descripción para el ticket.',
  ticketCreated: '✅ Ticket *{ticketNumber}* creado exitosamente.\n\nTe notificaremos cuando haya actualizaciones de estados.',
  statusChanged: 'El estado de su solicitud *{ticketNumber}* ha cambiado de "{prevStatus}" a "{newStatus}".',
  reparadoMessage: 'Estas son las evidencias de que su ticket *{ticketNumber}* con descripción "{description}" ha sido reparado:',
  noTickets: 'No tienes tickets registrados aún. ¿Puedo ayudarte en algo más?',
  invalidField: 'Por favor ingresa una respuesta válida.',
  cancelled: 'Operación cancelada.',
  goodbye: 'Hasta luego 👋. Escribe cualquier mensaje para volver al menú.',
  viewTicketOptions: '¿Qué deseas ver?\n1. Info del ticket\n2. Ver fotos',
};
const DEFAULT_BOT_FIELDS: BotField[] = [
  { key: 'ciudad', label: '¿En qué ciudad se encuentra el punto de venta?', order: 0, normalize: true, type: 'string', source: 'bot', required: true },
  { key: 'canal', label: '¿Cuál es el canal de venta? (ejemplo: Retail, Operador, Online):', order: 1, normalize: true, type: 'string', source: 'bot', required: true },
  { key: 'punto', label: '¿Cuál es el nombre del punto de venta?', order: 2, normalize: true, type: 'string', source: 'bot', required: true },
];

const STANDARD_FIELDS: StandardField[] = [
  { key: 'ticketNumber',          label: 'Número de Ticket',        type: 'string',  source: 'auto',  required: true  },
  { key: 'status',                label: 'Estado',                  type: 'string',  source: 'admin', required: true  },
  { key: 'reporter.name',         label: 'Nombre Reportante',       type: 'string',  source: 'auto',  required: true  },
  { key: 'reporter.phone',        label: 'Teléfono Reportante',     type: 'string',  source: 'auto',  required: true  },
  { key: 'novelty.type',          label: 'Tipo de Novedad',         type: 'string',  source: 'bot',   required: false },
  { key: 'novelty.description',   label: 'Descripción / Novedad',   type: 'string',  source: 'bot',   required: true  },
  { key: 'photos.evidence',       label: 'Fotos de Evidencia',      type: 'photo',   source: 'bot',   required: false },
  { key: 'photos.repair',         label: 'Fotos de Reparación',     type: 'photo',   source: 'admin', required: false },
  { key: 'photos.delivery',       label: 'Fotos de Entrega',        type: 'photo',   source: 'admin', required: false },
  { key: 'budget.estimatedValue', label: 'Presupuesto Estimado',    type: 'numeric', source: 'admin', required: false },
  { key: 'budget.approved',       label: 'Presupuesto Aprobado',    type: 'string',  source: 'admin', required: false },
  { key: 'observations',          label: 'Observaciones',           type: 'string',  source: 'admin', required: false },
  { key: 'timestamps.createdAt',  label: 'Fecha de Creación',       type: 'date',    source: 'auto',  required: true  },
  { key: 'timestamps.updatedAt',  label: 'Última Actualización',    type: 'date',    source: 'auto',  required: true  },
];

const TYPE_LABELS: Record<FieldType, string> = { string: 'Texto', numeric: 'Numérico', date: 'Fecha', photo: 'Foto(s)', video: 'Video(s)' };
const TYPE_COLORS: Record<FieldType, string> = { string: 'blue', numeric: 'orange', date: 'violet', photo: 'pink', video: 'grape' };
const SOURCE_LABELS: Record<FieldSource, string> = { bot: 'Chat (Bot)', admin: 'Panel Admin', auto: 'Automático' };
const SOURCE_COLORS: Record<FieldSource, string> = { bot: 'teal', admin: 'indigo', auto: 'gray' };
const MESSAGE_META: Array<{ key: keyof BotMessages; label: string; hint?: string }> = [
  { key: 'menu', label: 'Menú principal del bot' },
  { key: 'photosPrompt', label: 'Prompt para subir fotos y descripción' },
  { key: 'ticketCreated', label: 'Ticket creado exitosamente', hint: '{ticketNumber}' },
  { key: 'statusChanged', label: 'Cambio de estado', hint: '{ticketNumber}, {prevStatus}, {newStatus}' },
  { key: 'reparadoMessage', label: 'Ticket reparado (con fotos de reparación)', hint: '{ticketNumber}, {description}' },
  { key: 'noTickets', label: 'Sin tickets registrados' },
  { key: 'invalidField', label: 'Campo inválido (respuesta vacía)' },
  { key: 'cancelled', label: 'Operación cancelada' },
  { key: 'goodbye', label: 'Despedida' },
  { key: 'viewTicketOptions', label: 'Opciones de ver ticket' },
];

type SortCol = string;
type SortDir = 'asc' | 'desc';

type Host = {
  id: string;
  nombre: string;
  telefono: string;
  creadoEn?: number;
};

const STATUS_COLORS: Record<string, string> = {
  REPORTADO: 'red',
  REVISION: 'blue',
  EN_REPARACION: 'yellow',
  REPARADO: 'teal',
  ENTREGADO: 'green',
  FINALIZADO: 'green',
};

const ALL_STATUSES = ['REPORTADO', 'REVISION', 'EN_REPARACION', 'REPARADO', 'ENTREGADO', 'FINALIZADO'];

export default function DashboardPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>('tickets');

  // Tickets state
  const [sortCol, setSortCol] = useState<SortCol>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filterFields, setFilterFields] = useState<Record<string, string[]>>({});
  const [filterEstados, setFilterEstados] = useState<string[]>([]);
  const [filterFechaFrom, setFilterFechaFrom] = useState('');
  const [filterFechaTo, setFilterFechaTo] = useState('');
  const [dateModalOpen, setDateModalOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState('10');

  // Bot config state
  const [configMessages, setConfigMessages] = useState<BotMessages>(DEFAULT_BOT_MESSAGES);
  const [configFields, setConfigFields] = useState<BotField[]>(DEFAULT_BOT_FIELDS);
  const [savingMessages, setSavingMessages] = useState(false);
  const [savingFields, setSavingFields] = useState(false);
  const [infoTab, setInfoTab] = useState<string | null>('messages');
  const [addFieldOpen, setAddFieldOpen] = useState(false);
  const [newFieldKey, setNewFieldKey] = useState('');
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] = useState<FieldType>('string');
  const [newFieldSource, setNewFieldSource] = useState<FieldSource>('bot');
  const [newFieldRequired, setNewFieldRequired] = useState(false);

  // Hosts state
  const [selectedHost, setSelectedHost] = useState<Host | null>(null);
  const [hostTicketsModalOpen, setHostTicketsModalOpen] = useState(false);
  const [editHostModalOpen, setEditHostModalOpen] = useState(false);
  const [editingHost, setEditingHost] = useState<Host | null>(null);
  const [editNombre, setEditNombre] = useState('');
  const [savingHost, setSavingHost] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'tickets'));
    const unsub = onSnapshot(q, (snapshot) => {
      const rawTickets = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
      })) as Ticket[];
      const uniqueMap = new Map(rawTickets.map(t => [t.id, t]));
      setTickets(Array.from(uniqueMap.values()));
    }, (error) => {
      console.warn("⚠️ Snapshot bloqueado por Reglas/Auth:", error.message);
      setTickets([]);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'hosts'));
    const unsub = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Host[];
      setHosts(data);
    }, (err) => {
      console.warn('⚠️ No se pudo leer hosts:', err.message);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'bot_config', 'messages'), (snap) => {
      if (snap.exists()) setConfigMessages({ ...DEFAULT_BOT_MESSAGES, ...(snap.data() as Partial<BotMessages>) });
    }, () => {});
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'bot_config', 'ticket_fields'), (snap) => {
      const fields = snap.exists() ? (snap.data()?.fields as BotField[] | undefined) : undefined;
      if (fields && fields.length > 0) setConfigFields([...fields].sort((a, b) => a.order - b.order));
    }, () => {});
    return () => unsub();
  }, []);

  // Mapa phone → nombre para mostrar en columna "Reportado Por"
  const hostsMap = useMemo(() => {
    const m = new Map<string, string>();
    hosts.forEach(h => m.set(h.telefono, h.nombre));
    return m;
  }, [hosts]);

  // ── Tickets filters / sort ─────────────────────────────────────────────────

  const getFieldValue = (ticket: Ticket, key: string): string => {
    if (key === 'ciudad') return ticket.ciudad || '';
    if (key === 'canal') return ticket.canal || '';
    if (key === 'punto') return ticket.point?.name || '';
    return ticket.extraFields?.[key] || '';
  };

  const uniqueFieldValues = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const field of configFields) {
      map[field.key] = [...new Set(tickets.map(t => getFieldValue(t, field.key)).filter(Boolean))].sort();
    }
    return map;
  }, [tickets, configFields]);

  const withPageReset = (fn: (v: string[]) => void) => (v: string[]) => {
    fn(v);
    setPage(1);
  };

  const setFieldFilter = (key: string, vals: string[]) => {
    setFilterFields(prev => ({ ...prev, [key]: vals }));
    setPage(1);
  };

  const filtered = useMemo(() => {
    return tickets.filter(t => {
      for (const [key, vals] of Object.entries(filterFields)) {
        if (vals.length && !vals.includes(getFieldValue(t, key))) return false;
      }
      if (filterEstados.length && !filterEstados.includes(t.status)) return false;
      if (filterFechaFrom) {
        const from = new Date(filterFechaFrom).getTime();
        if ((t.timestamps?.createdAt || 0) < from) return false;
      }
      if (filterFechaTo) {
        const to = new Date(filterFechaTo + 'T23:59:59').getTime();
        if ((t.timestamps?.createdAt || 0) > to) return false;
      }
      return true;
    });
  }, [tickets, filterFields, filterEstados, filterFechaFrom, filterFechaTo]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let aVal: any, bVal: any;
      switch (sortCol) {
        case 'ticketNumber': aVal = a.ticketNumber ?? 0; bVal = b.ticketNumber ?? 0; break;
        case 'createdAt': aVal = a.timestamps?.createdAt ?? 0; bVal = b.timestamps?.createdAt ?? 0; break;
        case 'estado': aVal = a.status ?? ''; bVal = b.status ?? ''; break;
        default: aVal = getFieldValue(a, sortCol); bVal = getFieldValue(b, sortCol); break;
      }
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filtered, sortCol, sortDir]);

  const pageSizeNum = parseInt(pageSize, 10);
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSizeNum));
  const paginated = sorted.slice((page - 1) * pageSizeNum, page * pageSizeNum);

  const handleSort = (col: SortCol) => {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
    setPage(1);
  };

  function SortIcon({ col }: { col: SortCol }) {
    if (sortCol !== col) return <IconArrowsSort size={13} opacity={0.35} />;
    return sortDir === 'asc' ? <IconArrowUp size={13} /> : <IconArrowDown size={13} />;
  }

  const exportToExcel = () => {
    const data = tickets.map((t) => {
      const row: Record<string, unknown> = { 'Ticket #': t.ticketNumber, 'Estado': t.status };
      configFields.forEach(f => { row[f.key] = getFieldValue(t, f.key) || ''; });
      Object.assign(row, {
        'Reportado Por': hostsMap.get(t.reporter?.phone) || t.reporter?.name || '',
        'Teléfono Reportante': t.reporter?.phone || '',
        'Descripción': t.novelty?.description || '',
        'Tipo Novedad': t.novelty?.type || '',
        'Taller ID': t.actors?.workshopId || '',
        'Transportador ID': t.actors?.transporterId || '',
        'Presupuesto Estimado': t.budget?.estimatedValue ?? '',
        'Presupuesto Aprobado': t.budget?.approved != null ? (t.budget.approved ? 'Sí' : 'No') : '',
        'Fotos Evidencia': (t.photos?.evidence || []).join(' | '),
        'Fotos Reparación': (t.photos?.repair || []).join(' | '),
        'Fotos Entrega': (t.photos?.delivery || []).join(' | '),
        'Fecha Creación': t.timestamps?.createdAt ? new Date(t.timestamps.createdAt).toLocaleString('es-CO') : '',
        'Última Actualización': t.timestamps?.updatedAt ? new Date(t.timestamps.updatedAt).toLocaleString('es-CO') : '',
      });
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tickets');
    const dateStr = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `tickets_${dateStr}.xlsx`);
  };

  const dateFilterActive = !!filterFechaFrom || !!filterFechaTo;
  const startIdx = sorted.length === 0 ? 0 : (page - 1) * pageSizeNum + 1;
  const endIdx = Math.min(page * pageSizeNum, sorted.length);

  // ── Hosts helpers ──────────────────────────────────────────────────────────

  const getHostTickets = (telefono: string) =>
    tickets.filter(t => t.reporter?.phone === telefono);

  const openHostTickets = (host: Host) => {
    setSelectedHost(host);
    setHostTicketsModalOpen(true);
  };

  const openEditHost = (host: Host) => {
    setEditingHost(host);
    setEditNombre(host.nombre);
    setEditHostModalOpen(true);
  };

  // ── Bot config handlers ────────────────────────────────────────────────────
  const saveMessages = async () => {
    setSavingMessages(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      await fetch(`${BACKEND_URL}/api/config/messages`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(configMessages),
      });
    } catch (e) { console.error('Error guardando mensajes:', e); }
    finally { setSavingMessages(false); }
  };

  const saveFields = async () => {
    setSavingFields(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      await fetch(`${BACKEND_URL}/api/config/fields`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ fields: configFields.map((f, i) => ({ ...f, order: i })) }),
      });
    } catch (e) { console.error('Error guardando campos:', e); }
    finally { setSavingFields(false); }
  };

  const moveField = (idx: number, dir: 'up' | 'down') => {
    const next = [...configFields];
    const target = dir === 'up' ? idx - 1 : idx + 1;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setConfigFields(next);
  };

  const deleteField = (idx: number) => {
    setConfigFields(prev => prev.filter((_, i) => i !== idx));
  };

  const addField = () => {
    const key = newFieldKey.trim().toLowerCase().replace(/\s+/g, '_');
    if (!key || !newFieldLabel.trim()) return;
    if (configFields.some(f => f.key === key)) return;
    setConfigFields(prev => [...prev, {
      key, label: newFieldLabel.trim(), order: prev.length,
      normalize: newFieldType === 'string', type: newFieldType,
      source: newFieldSource, required: newFieldRequired,
    }]);
    setNewFieldKey('');
    setNewFieldLabel('');
    setNewFieldType('string');
    setNewFieldSource('bot');
    setNewFieldRequired(false);
    setAddFieldOpen(false);
  };

  const saveHostNombre = async () => {
    if (!editingHost || !editNombre.trim()) return;
    setSavingHost(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('No autenticado');
      await fetch(`${BACKEND_URL}/api/hosts/${encodeURIComponent(editingHost.telefono)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ nombre: editNombre.trim() }),
      });
      setEditHostModalOpen(false);
    } catch (e) {
      console.error('Error actualizando host:', e);
    } finally {
      setSavingHost(false);
    }
  };

  return (
    <Paper p="md" shadow="sm" radius="md" withBorder>
      <Tabs value={activeTab} onChange={setActiveTab}>
        <Tabs.List mb="xl">
          <Tabs.Tab value="tickets">Tickets</Tabs.Tab>
          <Tabs.Tab value="hosts">Hosts</Tabs.Tab>
          <Tabs.Tab value="config">Info Tickets</Tabs.Tab>
        </Tabs.List>

        {/* ── TAB TICKETS ─────────────────────────────────────────────────── */}
        <Tabs.Panel value="tickets">
          <Group justify="space-between" mb="xl">
            <Title order={2}>Gestor de Tickets</Title>
            <Button onClick={exportToExcel} variant="light" color="green">
              Exportar a Excel
            </Button>
          </Group>

          <Table striped highlightOnHover style={{ tableLayout: 'auto' }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>
                  <Group gap={4} wrap="nowrap" style={{ cursor: 'pointer' }} onClick={() => handleSort('ticketNumber')}>
                    <Text size="sm" fw={600}>Ticket #</Text>
                    <SortIcon col="ticketNumber" />
                  </Group>
                </Table.Th>

                <Table.Th>
                  <Group gap={4} wrap="nowrap">
                    <Group gap={4} wrap="nowrap" style={{ cursor: 'pointer' }} onClick={() => handleSort('createdAt')}>
                      <Text size="sm" fw={600}>Creación</Text>
                      <SortIcon col="createdAt" />
                    </Group>
                    <Tooltip label={dateFilterActive ? 'Filtro activo' : 'Filtrar por fecha'} withArrow>
                      <ActionIcon size="xs" variant="subtle" color={dateFilterActive ? 'blue' : 'gray'} onClick={() => setDateModalOpen(true)}>
                        <IconFilter size={13} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Table.Th>

                {configFields.map(field => (
                  <Table.Th key={field.key}>
                    <Group gap={4} wrap="nowrap">
                      <Group gap={4} wrap="nowrap" style={{ cursor: 'pointer' }} onClick={() => handleSort(field.key)}>
                        <Text size="sm" fw={600}>{field.key.charAt(0).toUpperCase() + field.key.slice(1)}</Text>
                        <SortIcon col={field.key} />
                      </Group>
                      <Popover withArrow shadow="md" position="bottom-start" withinPortal>
                        <Popover.Target>
                          <ActionIcon size="xs" variant="subtle" color={(filterFields[field.key]?.length || 0) > 0 ? 'blue' : 'gray'}>
                            <IconFilter size={13} />
                          </ActionIcon>
                        </Popover.Target>
                        <Popover.Dropdown>
                          <Text size="xs" fw={700} mb="xs">{field.key.charAt(0).toUpperCase() + field.key.slice(1)}</Text>
                          {(uniqueFieldValues[field.key] || []).length === 0
                            ? <Text size="xs" c="dimmed">Sin datos</Text>
                            : <Checkbox.Group value={filterFields[field.key] || []} onChange={(vals) => setFieldFilter(field.key, vals)}>
                                <Stack gap={6}>
                                  {(uniqueFieldValues[field.key] || []).map(v => <Checkbox key={v} value={v} label={v} size="xs" />)}
                                </Stack>
                              </Checkbox.Group>
                          }
                          {(filterFields[field.key]?.length || 0) > 0 && (
                            <Button size="xs" variant="subtle" color="red" mt="xs" onClick={() => setFieldFilter(field.key, [])}>
                              Limpiar
                            </Button>
                          )}
                        </Popover.Dropdown>
                      </Popover>
                    </Group>
                  </Table.Th>
                ))}

                <Table.Th>
                  <Text size="sm" fw={600}>Reportado Por</Text>
                </Table.Th>

                <Table.Th>
                  <Text size="sm" fw={600}>Novedad</Text>
                </Table.Th>

                <Table.Th>
                  <Group gap={4} wrap="nowrap">
                    <Group gap={4} wrap="nowrap" style={{ cursor: 'pointer' }} onClick={() => handleSort('estado')}>
                      <Text size="sm" fw={600}>Estado</Text>
                      <SortIcon col="estado" />
                    </Group>
                    <Popover withArrow shadow="md" position="bottom-start" withinPortal>
                      <Popover.Target>
                        <ActionIcon size="xs" variant="subtle" color={filterEstados.length ? 'blue' : 'gray'}>
                          <IconFilter size={13} />
                        </ActionIcon>
                      </Popover.Target>
                      <Popover.Dropdown>
                        <Text size="xs" fw={700} mb="xs">Estado</Text>
                        <Checkbox.Group value={filterEstados} onChange={withPageReset(setFilterEstados)}>
                          <Stack gap={6}>
                            {ALL_STATUSES.map(s => (
                              <Checkbox
                                key={s}
                                value={s}
                                size="xs"
                                label={<Badge size="xs" color={STATUS_COLORS[s] || 'gray'}>{s}</Badge>}
                              />
                            ))}
                          </Stack>
                        </Checkbox.Group>
                        {filterEstados.length > 0 && (
                          <Button size="xs" variant="subtle" color="red" mt="xs" onClick={() => withPageReset(setFilterEstados)([])}>
                            Limpiar
                          </Button>
                        )}
                      </Popover.Dropdown>
                    </Popover>
                  </Group>
                </Table.Th>

                <Table.Th>
                  <Text size="sm" fw={600}>Acciones</Text>
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {paginated.map((ticket) => (
                <Table.Tr key={ticket.id}>
                  <Table.Td fw={500}>{ticket.ticketNumber}</Table.Td>
                  <Table.Td>
                    {ticket.timestamps?.createdAt
                      ? new Date(ticket.timestamps.createdAt).toLocaleDateString('es-CO')
                      : 'Fecha N/A'}
                  </Table.Td>
                  {configFields.map(field => (
                    <Table.Td key={field.key}>{getFieldValue(ticket, field.key) || '—'}</Table.Td>
                  ))}
                  <Table.Td>
                    {hostsMap.get(ticket.reporter?.phone) || ticket.reporter?.name || ticket.reporter?.phone}
                  </Table.Td>
                  <Table.Td>{ticket.novelty?.description || ticket.novelty?.type}</Table.Td>
                  <Table.Td>
                    <Badge color={STATUS_COLORS[ticket.status] || 'blue'}>{ticket.status}</Badge>
                  </Table.Td>
                  <Table.Td>
                    <Button component={Link} href={`/admin/dashboard/tickets/${ticket.id}`} size="xs" variant="light">
                      Ver Detalle
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
              {paginated.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={6 + configFields.length} ta="center" c="dimmed">
                    No hay tickets para estos filtros.
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>

          <Group justify="space-between" mt="lg" align="center" wrap="wrap" gap="sm">
            <Group gap="xs" align="center">
              <Text size="sm" c="dimmed">
                {sorted.length === 0
                  ? 'Sin tickets'
                  : `Mostrando ${startIdx}–${endIdx} de ${sorted.length} ticket${sorted.length !== 1 ? 's' : ''}`}
              </Text>
              <Select
                value={pageSize}
                onChange={(val) => { if (val) { setPageSize(val); setPage(1); } }}
                data={['5', '10', '20', '50']}
                size="xs"
                w={72}
                allowDeselect={false}
              />
              <Text size="sm" c="dimmed">por página</Text>
            </Group>
            <Pagination total={totalPages} value={page} onChange={setPage} size="sm" />
          </Group>

          <Modal
            opened={dateModalOpen}
            onClose={() => setDateModalOpen(false)}
            title="Filtrar por Fecha de Creación"
            size="sm"
            centered
          >
            <Stack>
              <TextInput
                label="Desde"
                type="date"
                value={filterFechaFrom}
                onChange={(e) => setFilterFechaFrom(e.target.value)}
              />
              <TextInput
                label="Hasta"
                type="date"
                value={filterFechaTo}
                onChange={(e) => setFilterFechaTo(e.target.value)}
              />
              <Group justify="space-between" mt="xs">
                <Button
                  variant="subtle"
                  color="red"
                  size="sm"
                  disabled={!filterFechaFrom && !filterFechaTo}
                  onClick={() => {
                    setFilterFechaFrom('');
                    setFilterFechaTo('');
                    setPage(1);
                  }}
                >
                  Limpiar fechas
                </Button>
                <Button size="sm" onClick={() => { setPage(1); setDateModalOpen(false); }}>
                  Aplicar
                </Button>
              </Group>
            </Stack>
          </Modal>
        </Tabs.Panel>

        {/* ── TAB HOSTS ───────────────────────────────────────────────────── */}
        <Tabs.Panel value="hosts">
          <Title order={2} mb="xl">Hosts</Title>

          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th><Text size="sm" fw={600}>Nombre</Text></Table.Th>
                <Table.Th><Text size="sm" fw={600}>Teléfono</Text></Table.Th>
                <Table.Th><Text size="sm" fw={600}>Total Tickets</Text></Table.Th>
                <Table.Th><Text size="sm" fw={600}>Registrado</Text></Table.Th>
                <Table.Th><Text size="sm" fw={600}>Acciones</Text></Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {hosts.map((host) => {
                const hostTickets = getHostTickets(host.telefono);
                return (
                  <Table.Tr key={host.id}>
                    <Table.Td fw={500}>{host.nombre}</Table.Td>
                    <Table.Td>{host.telefono}</Table.Td>
                    <Table.Td>{hostTickets.length}</Table.Td>
                    <Table.Td>
                      {host.creadoEn
                        ? new Date(host.creadoEn).toLocaleDateString('es-CO')
                        : '—'}
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs">
                        <Button
                          size="xs"
                          variant="light"
                          onClick={() => openHostTickets(host)}
                          disabled={hostTickets.length === 0}
                        >
                          Ver Tickets ({hostTickets.length})
                        </Button>
                        <Tooltip label="Editar nombre" withArrow>
                          <ActionIcon
                            size="sm"
                            variant="subtle"
                            color="blue"
                            onClick={() => openEditHost(host)}
                          >
                            <IconEdit size={14} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
              {hosts.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={5} ta="center" c="dimmed">
                    Aún no hay hosts registrados.
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Tabs.Panel>
        {/* ── TAB INFO TICKETS ────────────────────────────────────────────── */}
        <Tabs.Panel value="config">
          <Title order={2} mb="lg">Configuración del Bot</Title>

          <Tabs value={infoTab} onChange={setInfoTab} variant="outline">
            <Tabs.List mb="lg">
              <Tabs.Tab value="messages">Mensajes</Tabs.Tab>
              <Tabs.Tab value="fields">Campos del Ticket</Tabs.Tab>
            </Tabs.List>

            {/* ── Sub-tab: Mensajes ── */}
            <Tabs.Panel value="messages">
              <Text size="sm" c="dimmed" mb="md">
                Edita el texto que el bot envía en cada situación. Las variables en {'{llaves}'} se reemplazan automáticamente.
              </Text>
              <Stack gap="md" mb="lg">
                {MESSAGE_META.map(({ key, label, hint }) => (
                  <Stack key={key} gap={4}>
                    <Group gap="xs" align="center">
                      <Text size="sm" fw={600}>{label}</Text>
                      {hint && <Badge size="xs" variant="outline" color="gray">{hint}</Badge>}
                    </Group>
                    <Textarea
                      value={configMessages[key]}
                      onChange={(e) => setConfigMessages(prev => ({ ...prev, [key]: e.currentTarget.value }))}
                      autosize
                      minRows={2}
                    />
                  </Stack>
                ))}
              </Stack>
              <Button onClick={saveMessages} loading={savingMessages}>
                Guardar mensajes
              </Button>
            </Tabs.Panel>

            {/* ── Sub-tab: Campos ── */}
            <Tabs.Panel value="fields">
              {/* Campos del sistema (solo lectura) */}
              <Group justify="space-between" mb="xs">
                <Text size="sm" fw={600}>Campos del sistema</Text>
                <Text size="xs" c="dimmed">Solo lectura — gestionados internamente</Text>
              </Group>
              <Table withTableBorder withColumnBorders mb="xl" style={{ tableLayout: 'fixed' }}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th style={{ width: 180 }}>Campo</Table.Th>
                    <Table.Th>Etiqueta</Table.Th>
                    <Table.Th style={{ width: 120 }}>Tipo de dato</Table.Th>
                    <Table.Th style={{ width: 130 }}>Origen</Table.Th>
                    <Table.Th style={{ width: 90 }}>Requerido</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {STANDARD_FIELDS.map(f => (
                    <Table.Tr key={f.key} style={{ opacity: 0.75 }}>
                      <Table.Td>
                        <Badge variant="outline" color="gray" size="sm">{f.key}</Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{f.label}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge size="xs" color={TYPE_COLORS[f.type]}>{TYPE_LABELS[f.type]}</Badge>
                      </Table.Td>
                      <Table.Td>
                        <Badge size="xs" color={SOURCE_COLORS[f.source]}>{SOURCE_LABELS[f.source]}</Badge>
                      </Table.Td>
                      <Table.Td>
                        <Badge size="xs" color={f.required ? 'red' : 'gray'}>{f.required ? 'Sí' : 'No'}</Badge>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>

              {/* Campos configurables */}
              <Group justify="space-between" mb="xs">
                <Text size="sm" fw={600}>Campos configurables</Text>
                <Button size="xs" variant="light" onClick={() => setAddFieldOpen(true)}>+ Agregar campo</Button>
              </Group>
              <Table withTableBorder withColumnBorders mb="lg" style={{ tableLayout: 'fixed' }}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th style={{ width: 110 }}>Campo</Table.Th>
                    <Table.Th>Pregunta / Etiqueta</Table.Th>
                    <Table.Th style={{ width: 130 }}>Tipo de dato</Table.Th>
                    <Table.Th style={{ width: 140 }}>Origen</Table.Th>
                    <Table.Th style={{ width: 85 }}>Requerido</Table.Th>
                    <Table.Th style={{ width: 90 }}>Normalizar</Table.Th>
                    <Table.Th style={{ width: 70 }}>Orden</Table.Th>
                    <Table.Th style={{ width: 40 }}></Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {configFields.map((field, idx) => (
                    <Table.Tr key={field.key}>
                      <Table.Td>
                        <Badge variant="outline" color="blue" size="sm">{field.key}</Badge>
                      </Table.Td>
                      <Table.Td>
                        <TextInput
                          value={field.label}
                          onChange={(e) => {
                            const updated = [...configFields];
                            updated[idx] = { ...field, label: e.currentTarget.value };
                            setConfigFields(updated);
                          }}
                          size="xs"
                        />
                      </Table.Td>
                      <Table.Td>
                        <Select
                          value={field.type ?? 'string'}
                          onChange={(val) => {
                            if (!val) return;
                            const updated = [...configFields];
                            updated[idx] = { ...field, type: val as FieldType };
                            setConfigFields(updated);
                          }}
                          data={[
                            { value: 'string',  label: 'Texto' },
                            { value: 'numeric', label: 'Numérico' },
                            { value: 'date',    label: 'Fecha' },
                            { value: 'photo',   label: 'Foto(s)' },
                            { value: 'video',   label: 'Video(s)' },
                          ]}
                          size="xs"
                          allowDeselect={false}
                        />
                      </Table.Td>
                      <Table.Td>
                        <Select
                          value={field.source ?? 'bot'}
                          onChange={(val) => {
                            if (!val) return;
                            const updated = [...configFields];
                            updated[idx] = { ...field, source: val as FieldSource };
                            setConfigFields(updated);
                          }}
                          data={[
                            { value: 'bot',   label: 'Chat (Bot)' },
                            { value: 'admin', label: 'Panel Admin' },
                          ]}
                          size="xs"
                          allowDeselect={false}
                        />
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'center' }}>
                        <Switch
                          size="xs"
                          checked={field.required ?? false}
                          onChange={(e) => {
                            const updated = [...configFields];
                            updated[idx] = { ...field, required: e.currentTarget.checked };
                            setConfigFields(updated);
                          }}
                        />
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'center' }}>
                        <Switch
                          size="xs"
                          checked={field.normalize}
                          disabled={(field.type ?? 'string') !== 'string'}
                          onChange={(e) => {
                            const updated = [...configFields];
                            updated[idx] = { ...field, normalize: e.currentTarget.checked };
                            setConfigFields(updated);
                          }}
                        />
                      </Table.Td>
                      <Table.Td>
                        <Group gap={2} wrap="nowrap">
                          <Tooltip label="Subir" withArrow>
                            <ActionIcon size="xs" variant="subtle" onClick={() => moveField(idx, 'up')} disabled={idx === 0}>↑</ActionIcon>
                          </Tooltip>
                          <Tooltip label="Bajar" withArrow>
                            <ActionIcon size="xs" variant="subtle" onClick={() => moveField(idx, 'down')} disabled={idx === configFields.length - 1}>↓</ActionIcon>
                          </Tooltip>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Tooltip label="Eliminar campo" withArrow>
                          <ActionIcon size="xs" color="red" variant="subtle" onClick={() => deleteField(idx)}>✕</ActionIcon>
                        </Tooltip>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                  {configFields.length === 0 && (
                    <Table.Tr>
                      <Table.Td colSpan={8} ta="center" c="dimmed" py="md">
                        No hay campos configurables. Agrega uno con el botón de arriba.
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
              <Button onClick={saveFields} loading={savingFields}>Guardar campos</Button>
            </Tabs.Panel>
          </Tabs>
        </Tabs.Panel>
      </Tabs>

      {/* ── Modal: Agregar campo ──────────────────────────────────────────────── */}
      <Modal opened={addFieldOpen} onClose={() => setAddFieldOpen(false)} title="Agregar campo" size="sm" centered>
        <Stack>
          <TextInput
            label="Clave (identificador)"
            placeholder="ej: numero_serie"
            description="Solo letras, números y guión bajo. No se puede cambiar después."
            value={newFieldKey}
            onChange={(e) => setNewFieldKey(e.currentTarget.value)}
          />
          <TextInput
            label="Pregunta / Etiqueta"
            placeholder="ej: ¿Cuál es el número de serie del equipo?"
            value={newFieldLabel}
            onChange={(e) => setNewFieldLabel(e.currentTarget.value)}
          />
          <Select
            label="Tipo de dato"
            value={newFieldType}
            onChange={(val) => { if (val) setNewFieldType(val as FieldType); }}
            data={[
              { value: 'string',  label: 'Texto' },
              { value: 'numeric', label: 'Numérico' },
              { value: 'date',    label: 'Fecha' },
              { value: 'photo',   label: 'Foto(s)' },
              { value: 'video',   label: 'Video(s)' },
            ]}
            allowDeselect={false}
          />
          <Select
            label="Origen"
            value={newFieldSource}
            onChange={(val) => { if (val) setNewFieldSource(val as FieldSource); }}
            data={[
              { value: 'bot',   label: 'Chat (Bot) — el usuario lo envía por WhatsApp' },
              { value: 'admin', label: 'Panel Admin — lo ingresa el administrador' },
            ]}
            allowDeselect={false}
          />
          <Switch
            label="Campo requerido"
            size="sm"
            checked={newFieldRequired}
            onChange={(e) => setNewFieldRequired(e.currentTarget.checked)}
          />
          <Group justify="flex-end" mt="xs">
            <Button variant="subtle" onClick={() => setAddFieldOpen(false)}>Cancelar</Button>
            <Button onClick={addField} disabled={!newFieldKey.trim() || !newFieldLabel.trim()}>Agregar</Button>
          </Group>
        </Stack>
      </Modal>

      {/* ── Modal: Tickets del host ────────────────────────────────────────── */}
      <Modal
        opened={hostTicketsModalOpen}
        onClose={() => setHostTicketsModalOpen(false)}
        title={selectedHost ? `Tickets de ${selectedHost.nombre} (${selectedHost.telefono})` : ''}
        size="xl"
        centered
      >
        {selectedHost && (() => {
          const hostTickets = getHostTickets(selectedHost.telefono);
          return (
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Ticket #</Table.Th>
                  <Table.Th>Estado</Table.Th>
                  <Table.Th>Ciudad</Table.Th>
                  <Table.Th>Canal</Table.Th>
                  <Table.Th>Novedad</Table.Th>
                  <Table.Th>Fecha</Table.Th>
                  <Table.Th></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {hostTickets.map(t => (
                  <Table.Tr key={t.id}>
                    <Table.Td fw={500}>{t.ticketNumber}</Table.Td>
                    <Table.Td>
                      <Badge size="sm" color={STATUS_COLORS[t.status] || 'gray'}>{t.status}</Badge>
                    </Table.Td>
                    <Table.Td>{t.ciudad || '—'}</Table.Td>
                    <Table.Td>{t.canal || '—'}</Table.Td>
                    <Table.Td>{t.novelty?.description || t.novelty?.type || '—'}</Table.Td>
                    <Table.Td>
                      {t.timestamps?.createdAt
                        ? new Date(t.timestamps.createdAt).toLocaleDateString('es-CO')
                        : '—'}
                    </Table.Td>
                    <Table.Td>
                      <Button
                        component={Link}
                        href={`/admin/dashboard/tickets/${t.id}`}
                        size="xs"
                        variant="subtle"
                        onClick={() => setHostTicketsModalOpen(false)}
                      >
                        Ver
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          );
        })()}
      </Modal>

      {/* ── Modal: Editar nombre del host ─────────────────────────────────── */}
      <Modal
        opened={editHostModalOpen}
        onClose={() => setEditHostModalOpen(false)}
        title="Editar nombre del host"
        size="sm"
        centered
      >
        <Stack>
          <TextInput
            label="Nombre"
            value={editNombre}
            onChange={(e) => setEditNombre(e.currentTarget.value)}
          />
          <Group justify="flex-end" mt="xs">
            <Button variant="subtle" onClick={() => setEditHostModalOpen(false)}>
              Cancelar
            </Button>
            <Button loading={savingHost} onClick={saveHostNombre} disabled={!editNombre.trim()}>
              Guardar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Paper>
  );
}
