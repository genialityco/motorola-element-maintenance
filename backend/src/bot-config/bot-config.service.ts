import { Injectable } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';

export interface BotMessages {
  menu: string;
  photosPrompt: string;
  ticketCreated: string;
  statusChanged: string;
  reparadoMessage: string;
  noTickets: string;
  invalidField: string;
  cancelled: string;
  goodbye: string;
  viewTicketOptions: string;
}

export interface TicketField {
  key: string;
  label: string;
  order: number;
  normalize: boolean;
}

export const DEFAULT_MESSAGES: BotMessages = {
  menu:
    'Hola, a continuación te mostraré las diferentes funcionalidades que poseo:\n' +
    '1. Para crear un ticket presiona 1\n' +
    '2. Para ver el estado de tus tickets presiona 2\n' +
    '3. Para editar un ticket presiona 3\n' +
    '4. Para eliminar un ticket presiona 4\n' +
    '5. Para finalizar un ticket presiona 5',
  photosPrompt: 'Sube unas fotos y añade una descripción para el ticket.',
  ticketCreated:
    '✅ Ticket *{ticketNumber}* creado exitosamente.\n\nTe notificaremos cuando haya actualizaciones de estados.',
  statusChanged:
    'El estado de su solicitud *{ticketNumber}* ha cambiado de "{prevStatus}" a "{newStatus}".',
  reparadoMessage:
    'Estas son las evidencias de que su ticket *{ticketNumber}* con descripción "{description}" ha sido reparado:',
  noTickets: 'No tienes tickets registrados aún. ¿Puedo ayudarte en algo más?',
  invalidField: 'Por favor ingresa una respuesta válida.',
  cancelled: 'Operación cancelada.',
  goodbye: 'Hasta luego 👋. Escribe cualquier mensaje para volver al menú.',
  viewTicketOptions: '¿Qué deseas ver?\n1. Info del ticket\n2. Ver fotos',
};

export const DEFAULT_FIELDS: TicketField[] = [
  { key: 'ciudad', label: '¿En qué ciudad se encuentra el punto de venta?', order: 0, normalize: true },
  { key: 'canal', label: '¿Cuál es el canal de venta? (ejemplo: Retail, Operador, Online):', order: 1, normalize: true },
  { key: 'punto', label: '¿Cuál es el nombre del punto de venta?', order: 2, normalize: true },
];

@Injectable()
export class BotConfigService {
  private messagesCache: BotMessages | null = null;
  private fieldsCache: TicketField[] | null = null;
  private cacheExpiry = 0;

  constructor(private readonly firebase: FirebaseService) {}

  private isCacheValid(): boolean {
    return Date.now() < this.cacheExpiry;
  }

  private invalidateCache(): void {
    this.messagesCache = null;
    this.fieldsCache = null;
    this.cacheExpiry = 0;
  }

  async getMessages(): Promise<BotMessages> {
    if (this.messagesCache && this.isCacheValid()) return this.messagesCache;

    const snap = await this.firebase.db.collection('bot_config').doc('messages').get();
    const data = snap.exists ? (snap.data() as Partial<BotMessages>) : {};
    this.messagesCache = { ...DEFAULT_MESSAGES, ...data };
    this.cacheExpiry = Date.now() + 60_000;
    return this.messagesCache;
  }

  async getFields(): Promise<TicketField[]> {
    if (this.fieldsCache && this.isCacheValid()) return this.fieldsCache;

    const snap = await this.firebase.db.collection('bot_config').doc('ticket_fields').get();
    const fields = snap.exists ? (snap.data()?.fields as TicketField[] | undefined) : undefined;
    this.fieldsCache = (fields && fields.length > 0) ? [...fields].sort((a, b) => a.order - b.order) : DEFAULT_FIELDS;
    this.cacheExpiry = Date.now() + 60_000;
    return this.fieldsCache;
  }

  async updateMessages(messages: Partial<BotMessages>): Promise<BotMessages> {
    await this.firebase.db
      .collection('bot_config')
      .doc('messages')
      .set(messages, { merge: true });
    this.invalidateCache();
    return this.getMessages();
  }

  async updateFields(fields: TicketField[]): Promise<void> {
    const normalized = fields.map((f, i) => ({ ...f, order: i }));
    await this.firebase.db
      .collection('bot_config')
      .doc('ticket_fields')
      .set({ fields: normalized });
    this.invalidateCache();
  }

  async getAll(): Promise<{ messages: BotMessages; fields: TicketField[] }> {
    const [messages, fields] = await Promise.all([this.getMessages(), this.getFields()]);
    return { messages, fields };
  }
}

export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}
