"use client";

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { Ticket } from '../../../../shared/types';
import { Table, Badge, Select, Group, Title, Paper, Button } from '@mantine/core';
import Link from 'next/link';

export default function DashboardPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [statusFilter, setStatusFilter] = useState<string | null>('ALL');

  useEffect(() => {
    // Suscripción Realtime (Solo Lectura) a `/tickets`
    const q = query(collection(db, 'tickets'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const rawTickets = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
      })) as Ticket[];
      
      // Aplicando regla de User Memory: Deduplicar por _id antes de mostrar
      const uniqueMap = new Map(rawTickets.map(t => [t.id, t]));
      setTickets(Array.from(uniqueMap.values()));
    }, (error) => {
      console.warn("⚠️ Snapshot bloqueado por Reglas/Auth:", error.message);
      setTickets([]);
    });

    return () => unsubscribe();
  }, []);

  // Aplicando regla de User Memory: Evitar `array.sort()` directo; usar copia.
  const filtered = [...tickets]
    .filter((t) => statusFilter === 'ALL' || t.status === statusFilter)
    .sort((a, b) => (b.timestamps?.createdAt || 0) - (a.timestamps?.createdAt || 0));

  return (
    <Paper p="md" shadow="sm" radius="md" withBorder>
      <Group justify="space-between" mb="xl">
        <Title order={2}>Gestor de Tickets</Title>
        <Select
          data={['ALL', 'REPORTADO', 'REVISION', 'EN_REPARACION', 'REPARADO', 'ENTREGADO']}
          value={statusFilter}
          onChange={setStatusFilter}
          label="Filtrar por Estado"
        />
      </Group>
      
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Ticket #</Table.Th>
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
              <Table.Td>{ticket.point?.name || 'Local N/A'}</Table.Td>
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
              <Table.Td colSpan={6} align="center">No hay tickets para este filtro.</Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}