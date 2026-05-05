"use client";

import { useEffect, useState, useMemo } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { Ticket } from '../../../../../shared/types';
import {
  Table, Badge, Group, Title, Paper, Button,
  Popover, Checkbox, Text, Stack, Select,
  Modal, TextInput, ActionIcon, Tooltip, Pagination,
} from '@mantine/core';
import {
  IconArrowUp, IconArrowDown, IconArrowsSort, IconFilter,
} from '@tabler/icons-react';
import Link from 'next/link';
import * as XLSX from 'xlsx';

type SortCol = 'ticketNumber' | 'createdAt' | 'ciudad' | 'canal' | 'punto' | 'estado';
type SortDir = 'asc' | 'desc';

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
  const [sortCol, setSortCol] = useState<SortCol>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filterCiudades, setFilterCiudades] = useState<string[]>([]);
  const [filterCanales, setFilterCanales] = useState<string[]>([]);
  const [filterPuntos, setFilterPuntos] = useState<string[]>([]);
  const [filterEstados, setFilterEstados] = useState<string[]>([]);
  const [filterFechaFrom, setFilterFechaFrom] = useState('');
  const [filterFechaTo, setFilterFechaTo] = useState('');
  const [dateModalOpen, setDateModalOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState('10');

  useEffect(() => {
    const q = query(collection(db, 'tickets'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
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
    return () => unsubscribe();
  }, []);

  const uniqueCiudades = useMemo(() =>
    [...new Set(tickets.map(t => t.ciudad).filter(Boolean))].sort() as string[],
    [tickets]
  );
  const uniqueCanales = useMemo(() =>
    [...new Set(tickets.map(t => t.canal).filter(Boolean))].sort() as string[],
    [tickets]
  );
  const uniquePuntos = useMemo(() =>
    [...new Set(tickets.map(t => t.point?.name).filter(Boolean))].sort() as string[],
    [tickets]
  );

  const withPageReset = (fn: (v: string[]) => void) => (v: string[]) => {
    fn(v);
    setPage(1);
  };

  const filtered = useMemo(() => {
    return tickets.filter(t => {
      if (filterCiudades.length && !filterCiudades.includes(t.ciudad || '')) return false;
      if (filterCanales.length && !filterCanales.includes(t.canal || '')) return false;
      if (filterPuntos.length && !filterPuntos.includes(t.point?.name || '')) return false;
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
  }, [tickets, filterCiudades, filterCanales, filterPuntos, filterEstados, filterFechaFrom, filterFechaTo]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let aVal: any, bVal: any;
      switch (sortCol) {
        case 'ticketNumber': aVal = a.ticketNumber ?? 0; bVal = b.ticketNumber ?? 0; break;
        case 'createdAt': aVal = a.timestamps?.createdAt ?? 0; bVal = b.timestamps?.createdAt ?? 0; break;
        case 'ciudad': aVal = a.ciudad ?? ''; bVal = b.ciudad ?? ''; break;
        case 'canal': aVal = a.canal ?? ''; bVal = b.canal ?? ''; break;
        case 'punto': aVal = a.point?.name ?? ''; bVal = b.point?.name ?? ''; break;
        case 'estado': aVal = a.status ?? ''; bVal = b.status ?? ''; break;
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
    const data = tickets.map((t) => ({
      'Ticket #': t.ticketNumber,
      'Estado': t.status,
      'Ciudad': t.ciudad || '',
      'Canal': t.canal || '',
      'Punto de Venta': t.point?.name || '',
      'Reportado Por': t.reporter?.name || '',
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
      'Fecha Creación': t.timestamps?.createdAt
        ? new Date(t.timestamps.createdAt).toLocaleString('es-CO') : '',
      'Última Actualización': t.timestamps?.updatedAt
        ? new Date(t.timestamps.updatedAt).toLocaleString('es-CO') : '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tickets');
    const dateStr = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `tickets_${dateStr}.xlsx`);
  };

  const dateFilterActive = !!filterFechaFrom || !!filterFechaTo;

  const startIdx = sorted.length === 0 ? 0 : (page - 1) * pageSizeNum + 1;
  const endIdx = Math.min(page * pageSizeNum, sorted.length);

  return (
    <Paper p="md" shadow="sm" radius="md" withBorder>
      <Group justify="space-between" mb="xl">
        <Title order={2}>Gestor de Tickets</Title>
        <Button onClick={exportToExcel} variant="light" color="green">
          Exportar a Excel
        </Button>
      </Group>

      <Table striped highlightOnHover style={{ tableLayout: 'auto' }}>
        <Table.Thead>
          <Table.Tr>
            {/* Ticket # — sortable, sin filtro */}
            <Table.Th>
              <Group gap={4} wrap="nowrap" style={{ cursor: 'pointer' }} onClick={() => handleSort('ticketNumber')}>
                <Text size="sm" fw={600}>Ticket #</Text>
                <SortIcon col="ticketNumber" />
              </Group>
            </Table.Th>

            {/* Creación — sortable + filtro de fechas (modal) */}
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

            {/* Ciudad — sortable + filtro checkbox */}
            <Table.Th>
              <Group gap={4} wrap="nowrap">
                <Group gap={4} wrap="nowrap" style={{ cursor: 'pointer' }} onClick={() => handleSort('ciudad')}>
                  <Text size="sm" fw={600}>Ciudad</Text>
                  <SortIcon col="ciudad" />
                </Group>
                <Popover withArrow shadow="md" position="bottom-start" withinPortal>
                  <Popover.Target>
                    <ActionIcon size="xs" variant="subtle" color={filterCiudades.length ? 'blue' : 'gray'}>
                      <IconFilter size={13} />
                    </ActionIcon>
                  </Popover.Target>
                  <Popover.Dropdown>
                    <Text size="xs" fw={700} mb="xs">Ciudad</Text>
                    {uniqueCiudades.length === 0
                      ? <Text size="xs" c="dimmed">Sin datos</Text>
                      : <Checkbox.Group value={filterCiudades} onChange={withPageReset(setFilterCiudades)}>
                          <Stack gap={6}>
                            {uniqueCiudades.map(c => <Checkbox key={c} value={c} label={c} size="xs" />)}
                          </Stack>
                        </Checkbox.Group>
                    }
                    {filterCiudades.length > 0 && (
                      <Button size="xs" variant="subtle" color="red" mt="xs" onClick={() => withPageReset(setFilterCiudades)([])}>
                        Limpiar
                      </Button>
                    )}
                  </Popover.Dropdown>
                </Popover>
              </Group>
            </Table.Th>

            {/* Canal — sortable + filtro checkbox */}
            <Table.Th>
              <Group gap={4} wrap="nowrap">
                <Group gap={4} wrap="nowrap" style={{ cursor: 'pointer' }} onClick={() => handleSort('canal')}>
                  <Text size="sm" fw={600}>Canal</Text>
                  <SortIcon col="canal" />
                </Group>
                <Popover withArrow shadow="md" position="bottom-start" withinPortal>
                  <Popover.Target>
                    <ActionIcon size="xs" variant="subtle" color={filterCanales.length ? 'blue' : 'gray'}>
                      <IconFilter size={13} />
                    </ActionIcon>
                  </Popover.Target>
                  <Popover.Dropdown>
                    <Text size="xs" fw={700} mb="xs">Canal</Text>
                    {uniqueCanales.length === 0
                      ? <Text size="xs" c="dimmed">Sin datos</Text>
                      : <Checkbox.Group value={filterCanales} onChange={withPageReset(setFilterCanales)}>
                          <Stack gap={6}>
                            {uniqueCanales.map(c => <Checkbox key={c} value={c} label={c} size="xs" />)}
                          </Stack>
                        </Checkbox.Group>
                    }
                    {filterCanales.length > 0 && (
                      <Button size="xs" variant="subtle" color="red" mt="xs" onClick={() => withPageReset(setFilterCanales)([])}>
                        Limpiar
                      </Button>
                    )}
                  </Popover.Dropdown>
                </Popover>
              </Group>
            </Table.Th>

            {/* Punto — sortable + filtro checkbox */}
            <Table.Th>
              <Group gap={4} wrap="nowrap">
                <Group gap={4} wrap="nowrap" style={{ cursor: 'pointer' }} onClick={() => handleSort('punto')}>
                  <Text size="sm" fw={600}>Punto</Text>
                  <SortIcon col="punto" />
                </Group>
                <Popover withArrow shadow="md" position="bottom-start" withinPortal>
                  <Popover.Target>
                    <ActionIcon size="xs" variant="subtle" color={filterPuntos.length ? 'blue' : 'gray'}>
                      <IconFilter size={13} />
                    </ActionIcon>
                  </Popover.Target>
                  <Popover.Dropdown>
                    <Text size="xs" fw={700} mb="xs">Punto de Venta</Text>
                    {uniquePuntos.length === 0
                      ? <Text size="xs" c="dimmed">Sin datos</Text>
                      : <Checkbox.Group value={filterPuntos} onChange={withPageReset(setFilterPuntos)}>
                          <Stack gap={6}>
                            {uniquePuntos.map(p => <Checkbox key={p} value={p} label={p} size="xs" />)}
                          </Stack>
                        </Checkbox.Group>
                    }
                    {filterPuntos.length > 0 && (
                      <Button size="xs" variant="subtle" color="red" mt="xs" onClick={() => withPageReset(setFilterPuntos)([])}>
                        Limpiar
                      </Button>
                    )}
                  </Popover.Dropdown>
                </Popover>
              </Group>
            </Table.Th>

            {/* Reportado Por — sin orden, sin filtro */}
            <Table.Th>
              <Text size="sm" fw={600}>Reportado Por</Text>
            </Table.Th>

            {/* Novedad — sin orden, sin filtro */}
            <Table.Th>
              <Text size="sm" fw={600}>Novedad</Text>
            </Table.Th>

            {/* Estado — sortable + filtro checkbox */}
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
              <Table.Td>{ticket.ciudad || '—'}</Table.Td>
              <Table.Td>{ticket.canal || '—'}</Table.Td>
              <Table.Td>{ticket.point?.name || '—'}</Table.Td>
              <Table.Td>{ticket.reporter?.name || ticket.reporter?.phone}</Table.Td>
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
              <Table.Td colSpan={9} ta="center" c="dimmed">
                No hay tickets para estos filtros.
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>

      {/* Paginado y contador */}
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

      {/* Modal filtro de fechas */}
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
    </Paper>
  );
}
