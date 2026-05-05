"use client";

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { Ticket } from '../../../../../shared/types';
import { Table, Badge, Select, Group, Title, Paper, Button } from '@mantine/core';
import Link from 'next/link';
import * as XLSX from 'xlsx';

export default function DashboardPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [statusFilter, setStatusFilter] = useState<string | null>('ALL');

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

  const filtered = [...tickets]
    .filter((t) => statusFilter === 'ALL' || t.status === statusFilter)
    .sort((a, b) => (b.timestamps?.createdAt || 0) - (a.timestamps?.createdAt || 0));

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
        ? new Date(t.timestamps.createdAt).toLocaleString('es-CO')
        : '',
      'Última Actualización': t.timestamps?.updatedAt
        ? new Date(t.timestamps.updatedAt).toLocaleString('es-CO')
        : '',
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tickets');

    const dateStr = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `tickets_${dateStr}.xlsx`);
  };

  return (
    <Paper p="md" shadow="sm" radius="md" withBorder>
      <Group justify="space-between" mb="xl">
        <Title order={2}>Gestor de Tickets</Title>
        <Group>
          <Select
            data={['ALL', 'REPORTADO', 'REVISION', 'EN_REPARACION', 'REPARADO', 'ENTREGADO']}
            value={statusFilter}
            onChange={setStatusFilter}
            label="Filtrar por Estado"
          />
          <Button onClick={exportToExcel} variant="light" color="green" mt="xl">
            Exportar a Excel
          </Button>
        </Group>
      </Group>

      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Ticket #</Table.Th>
            <Table.Th>Creación</Table.Th>
            <Table.Th>Ciudad</Table.Th>
            <Table.Th>Canal</Table.Th>
            <Table.Th>Punto</Table.Th>
            <Table.Th>Reportado Por</Table.Th>
            <Table.Th>Novedad</Table.Th>
            <Table.Th>Estado</Table.Th>
            <Table.Th>Acciones</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {filtered.map((ticket) => (
            <Table.Tr key={ticket.id}>
              <Table.Td fw={500}>{ticket.ticketNumber}</Table.Td>
              <Table.Td>{ticket.timestamps?.createdAt ? new Date(ticket.timestamps.createdAt).toLocaleDateString('es-CO') : 'Fecha N/A'}</Table.Td>
              <Table.Td>{ticket.ciudad || '—'}</Table.Td>
              <Table.Td>{ticket.canal || '—'}</Table.Td>
              <Table.Td>{ticket.point?.name || '—'}</Table.Td>
              <Table.Td>{ticket.reporter?.name || ticket.reporter?.phone}</Table.Td>
              <Table.Td>{ticket.novelty?.description || ticket.novelty?.type}</Table.Td>
              <Table.Td><Badge color={ticket.status === 'REPORTADO' ? 'red' : 'blue'}>{ticket.status}</Badge></Table.Td>
              <Table.Td>
                <Button component={Link} href={`/admin/dashboard/tickets/${ticket.id}`} size="xs" variant="light">
                  Ver Detalle / Gestionar
                </Button>
              </Table.Td>
            </Table.Tr>
          ))}
          {filtered.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={9} align="center">No hay tickets para este filtro.</Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}
