"use client";

import { useEffect, useState } from 'react';
import { AppShell, Burger, Group, Title, NavLink, Button, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconDashboard, IconSettings } from '@tabler/icons-react';
import Link from 'next/link';

// Auth Imports
import { auth, functions } from '../../lib/firebase';
import { onAuthStateChanged, signInWithCustomToken, signOut, User } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [opened, { toggle }] = useDisclosure();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, setUser);
    return () => unsub();
  }, []);

  const handleDevLogin = async () => {
    try {
      const getMockToken = httpsCallable(functions, 'emulateAdminLogin');
      const result = await getMockToken();
      await signInWithCustomToken(auth, (result.data as any).token);
    } catch(e) { console.error("Login failed:", e); }
  };

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 250, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header p="sm">
        <Group justify="space-between" h="100%">
          <Group>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Title order={3}>Motorola/Element CRM</Title>
          </Group>
          {user ? (
            <Group>
              <Text size="sm" c="blue" fw={700}>✅ Logueado como: Admin</Text>
              <Button size="xs" variant="light" color="red" onClick={() => signOut(auth)}>Salir</Button>
            </Group>
          ) : (
            <Button size="xs" color="indigo" onClick={handleDevLogin}>Login Admin (Dev)</Button>
          )}
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <NavLink 
          component={Link} 
          href="/admin/dashboard" 
          label="Dashboard Tickets" 
          leftSection={<IconDashboard size="1rem" stroke={1.5} />} 
        />
        <NavLink 
          component={Link} 
          href="/admin/dev/simulator" 
          label="Simulador Webhook" 
          leftSection={<IconSettings size="1rem" stroke={1.5} />} 
        />
      </AppShell.Navbar>

      <AppShell.Main>
        {children}
      </AppShell.Main>
    </AppShell>
  );
}
