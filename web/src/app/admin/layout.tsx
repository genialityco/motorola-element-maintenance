"use client";

import { useEffect, useState } from 'react';
import { AppShell, Burger, Group, Title, NavLink, Button, Text, TextInput, PasswordInput, Paper, Container, Stack, Alert } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconDashboard, IconMessage, IconSettings } from '@tabler/icons-react';
import Link from 'next/link';

// Auth Imports
import { auth } from '../../lib/firebase';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, User } from 'firebase/auth';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [opened, { toggle }] = useDisclosure();
  const [user, setUser] = useState<User | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);

  // Estados del Login
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoadingInitial(false);
    });
    return () => unsub();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch(e: any) { 
      console.error("Login failed:", e);
      setLoginError("Credenciales inválidas o correo no registrado.");
    } finally {
      setLoginLoading(false);
    }
  };

  // Si estamos validando la sesión inicial (evita el parpadeo del login)
  if (loadingInitial) {
    return null;
  }

  // Pantalla completa de Login si NO hay usuario
  if (!user) {
    return (
      <Container size={420} my={40}>
        <Title ta="center" order={2}>Bienvenido al CRM</Title>
        <Text c="dimmed" size="sm" ta="center" mt={5}>
          Ingresa tus credenciales de Administrador para continuar
        </Text>

        <Paper withBorder shadow="md" p={30} mt={30} radius="md">
          {loginError && <Alert color="red" mb="md">{loginError}</Alert>}
          <form onSubmit={handleLogin}>
            <Stack>
              <TextInput 
                label="Correo Electrónico" 
                placeholder="admin@ejemplo.com" 
                required 
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
              />
              <PasswordInput 
                label="Contraseña" 
                placeholder="Tu contraseña secreta" 
                required 
                mt="md" 
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
              />
              <Button fullWidth mt="xl" type="submit" loading={loginLoading}>
                Iniciar Sesión
              </Button>
            </Stack>
          </form>
        </Paper>
      </Container>
    );
  }

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
          <Group>
            <Text size="sm" c="blue" fw={700}>✅ Logueado como: {user.email}</Text>
            <Button size="xs" variant="light" color="red" onClick={() => signOut(auth)}>Salir</Button>
          </Group>

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
          href="/admin/dashboard/chats"
          label="Chats WhatsApp"
          leftSection={<IconMessage size="1rem" stroke={1.5} />}
        />
        <NavLink
          component={Link}
          href="/admin/dev/simulator"
          label="Simulador Bot"
          leftSection={<IconSettings size="1rem" stroke={1.5} />}
        />
      </AppShell.Navbar>

      <AppShell.Main>
        {children}
      </AppShell.Main>
    </AppShell>
  );
}
