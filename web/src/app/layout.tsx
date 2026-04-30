import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import '@mantine/core/styles.css';
import "./globals.css";

import { MantineProvider, ColorSchemeScript } from '@mantine/core';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Motorola/Element CRM",
  description: "Gestor de tickets de mantenimiento",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <head>
        <ColorSchemeScript />
      </head>
      <body>
        <MantineProvider defaultColorScheme="auto">
          {children}
        </MantineProvider>
      </body>
    </html>
  );
}
