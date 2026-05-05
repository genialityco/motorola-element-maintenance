import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { FieldValue } from 'firebase-admin/firestore';

type WhatsAppMessage = {
  from?: string;
  type?: string;
  text?: { body?: string };
  image?: {
    mime_type?: string;
    id?: string;
    caption?: string;
    // Used by el simulador: la imagen ya está subida a Storage
    directUrl?: string;
  };
};

type WhatsAppWebhookPayload = {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      value?: { messages?: WhatsAppMessage[] };
    }>;
  }>;
};

interface PendingTicket {
  id: string;
  ticketNumber: string;
  status: string;
  photos?: string[];
}

const MENU =
  `Hola, a continuación te mostraré las diferentes funcionalidades que poseo:\n` +
  `1. Para crear un ticket presiona 1\n` +
  `2. Para ver el estado de tus tickets presiona 2\n` +
  `3. Para editar un ticket presiona 3\n` +
  `4. Para eliminar un ticket presiona 4\n` +
  `5. Para finalizar un ticket presiona 5`;

@Injectable()
export class WhatsappService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly ticketStatusCache = new Map<string, string>();

  constructor(private readonly firebase: FirebaseService) {}

  onModuleInit() {
    this.startTicketStatusListener();
  }

  // Reemplaza onTicketStatusUpdated (Cloud Functions trigger)
  private startTicketStatusListener() {
    this.firebase.db.collection('tickets').onSnapshot(
      (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
          const data = change.doc.data();
          const ticketId = change.doc.id;
          const newStatus = data.status as string;

          if (change.type === 'added') {
            this.ticketStatusCache.set(ticketId, newStatus);
            return;
          }

          if (change.type === 'modified') {
            const prevStatus = this.ticketStatusCache.get(ticketId);
            this.ticketStatusCache.set(ticketId, newStatus);

            if (prevStatus && prevStatus !== newStatus) {
              const phone = data.reporter?.phone as string;
              if (phone) {
                const msg =
                  `El estado de su solicitud *${data.ticketNumber}* ha cambiado de "${prevStatus}" a "${newStatus}".`;
                // Guardar en historial para que el simulador lo vea
                await this.saveMessage(phone, 'bot', msg).catch((err) =>
                  this.logger.error('Error guardando notificación en historial:', err),
                );
                // Intentar enviar por WhatsApp (puede fallar si no hay credenciales)
                await this.sendMessage(phone, msg).catch((err) =>
                  this.logger.error('Error en notificación de estado:', err),
                );
              }
            }
          }
        });
      },
      (err) => this.logger.error('Error en listener de tickets:', err),
    );
    this.logger.log('Listener de cambios de estado de tickets activo.');
  }

  // Envía mensaje real por WhatsApp API
  async sendMessage(to: string, text: string) {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_ID;

    if (!token || !phoneId) {
      this.logger.warn('Faltan WHATSAPP_TOKEN o WHATSAPP_PHONE_ID');
      return;
    }

    const res = await fetch(
      `https://graph.facebook.com/v17.0/${phoneId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: text },
        }),
      },
    );

    if (!res.ok) {
      this.logger.error(`Error enviando WhatsApp: ${res.status} ${await res.text()}`);
    }
  }

  // Guarda un mensaje en el historial de la sesión (visible para el admin)
  async saveMessage(
    phone: string,
    from: 'user' | 'bot' | 'admin',
    text: string,
    photoUrl?: string,
  ) {
    const ref = this.firebase.db.collection('whatsapp_sessions').doc(phone);
    const entry: Record<string, unknown> = {
      from,
      text,
      timestamp: Date.now(),
    };
    if (photoUrl) entry.photoUrl = photoUrl;
    await ref.set(
      { messages: FieldValue.arrayUnion(entry) },
      { merge: true },
    );
  }

  // Responde: guarda en historial y envía (o colecciona para el simulador)
  private async reply(
    phone: string,
    text: string,
    onResponse?: (msg: string) => void,
    photoUrl?: string,
  ) {
    await this.saveMessage(phone, 'bot', text, photoUrl);
    if (onResponse) {
      // Si hay foto, la marcamos con prefijo [IMG] para que el simulador la renderice
      onResponse(photoUrl ? `[IMG]${photoUrl}` : text);
    } else {
      await this.sendMessage(phone, text);
    }
  }

  // Endpoint admin: enviar mensaje manualmente a un usuario
  async sendAdminMessage(to: string, text: string) {
    await this.saveMessage(to, 'admin', text);
    await this.sendMessage(to, text);
  }

  // Habilita o deshabilita las respuestas automáticas del bot para una sesión
  async toggleBotForSession(phone: string, botEnabled: boolean) {
    const ref = this.firebase.db.collection('whatsapp_sessions').doc(phone);
    await ref.set({ botEnabled }, { merge: true });
    this.logger.log(`[${phone}] Bot ${botEnabled ? 'habilitado' : 'deshabilitado'}`);
  }

  private formatTicketsList(tickets: PendingTicket[]): string {
    return tickets
      .map((t, i) => `${i + 1}. *${t.ticketNumber}* — Estado: ${t.status}`)
      .join('\n');
  }

  private async getTicketsByPhone(phone: string): Promise<PendingTicket[]> {
    const snap = await this.firebase.db
      .collection('tickets')
      .where('reporter.phone', '==', phone)
      .get();
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ticketNumber: data.ticketNumber as string,
        status: data.status as string,
        photos: (data.photos?.evidence as string[]) || [],
      };
    });
  }

  // Sube un buffer arbitrario a Storage (usado por el simulador).
  // Devuelve la URL pública del archivo.
  async uploadBufferToStorage(
    buffer: Buffer,
    mimeType: string,
    phone: string,
  ): Promise<string> {
    try {
      const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;
      if (!storageBucket) {
        this.logger.error('FIREBASE_STORAGE_BUCKET no está configurado');
        return '';
      }
      const bucket = this.firebase.storage.bucket(storageBucket);
      const ext = (mimeType.split('/')[1] || 'jpeg').toLowerCase();
      const filePath = `whatsapp_media/${phone}/${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}.${ext}`;
      const file = bucket.file(filePath);
      await file.save(buffer, { metadata: { contentType: mimeType } });
      await file.makePublic();
      const url = file.publicUrl();
      this.logger.log(`[${phone}] Imagen guardada en Storage: ${url}`);
      return url;
    } catch (err) {
      this.logger.error('Error subiendo buffer a Storage:', err);
      return '';
    }
  }

  private async uploadMedia(
    mediaId: string,
    mimeType: string,
    phone: string,
  ): Promise<string> {
    const token = process.env.WHATSAPP_TOKEN;
    if (!token) return '';

    try {
      const meta = await fetch(
        `https://graph.facebook.com/v17.0/${mediaId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      ).then((r) => r.json());

      if (!meta.url) return '';

      const buffer = await fetch(meta.url, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.arrayBuffer());

      const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;
      if (!storageBucket) {
        this.logger.error('FIREBASE_STORAGE_BUCKET no está configurado');
        return '';
      }
      const bucket = this.firebase.storage.bucket(storageBucket);
      const ext = mimeType.split('/')[1] || 'jpeg';
      const filePath = `whatsapp_media/${phone}/${Date.now()}_${mediaId}.${ext}`;
      const file = bucket.file(filePath);

      await file.save(Buffer.from(buffer), { metadata: { contentType: mimeType } });
      await file.makePublic();
      const url = file.publicUrl();
      this.logger.log(`[${phone}] Media de WhatsApp guardada en Storage: ${url}`);
      return url;
    } catch (err) {
      this.logger.error('Error subiendo media a Storage:', err);
      return '';
    }
  }

  // Procesa un mensaje entrante. Si se pasa onResponse, las respuestas se colectan
  // en lugar de enviarse por WhatsApp (usado por el simulador).
  async processMessage(
    payload: WhatsAppWebhookPayload,
    onResponse?: (msg: string) => void,
  ) {
    const message = payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return;

    const phone = message.from || '';
    const body = message.text?.body?.trim() || '';
    const db = this.firebase.db;
    const sessionRef = db.collection('whatsapp_sessions').doc(phone);
    const sessionDoc = await sessionRef.get();
    const session = sessionDoc.data() || {};
    const state: string = session.state || 'IDLE';

    // Verificar si el bot está habilitado. Por defecto está activo (true)
    const botEnabled = session.botEnabled !== false;

    // Guardar mensaje del usuario en historial (con URL si es imagen)
    if (message.type === 'image' && (message.image?.directUrl || message.image?.id)) {
      let photoUrl = message.image.directUrl;
      // Si viene de WhatsApp API real (tiene id pero no directUrl), descargarla
      if (!photoUrl && message.image?.id) {
        photoUrl = await this.uploadMedia(
          message.image.id,
          message.image.mime_type || 'image/jpeg',
          phone,
        );
      }
      if (photoUrl) {
        await this.saveMessage(
          phone,
          'user',
          message.image.caption || '[imagen]',
          photoUrl,
        );
      }
    } else {
      await this.saveMessage(phone, 'user', body || '[imagen]');
    }

    // Si el bot está deshabilitado, solo guardar el mensaje y retornar
    if (!botEnabled) {
      this.logger.log(`[${phone}] Bot deshabilitado. Mensaje guardado sin respuesta automática.`);
      return;
    }

    const send = (text: string) => this.reply(phone, text, onResponse);
    const sendPhoto = (url: string) => this.reply(phone, '[imagen]', onResponse, url);

    // ─── IDLE ────────────────────────────────────────────────────────────────
    if (state === 'IDLE') {
      if (body === '1') {
        await send('Por favor ingresa tu número de celular:');
        await sessionRef.set(
          { state: 'WAITING_PHONE_FOR_TICKET_CREATION' },
          { merge: true },
        );
      } else if (body === '2') {
        await send('Por favor ingresa tu número de celular:');
        await sessionRef.set(
          { state: 'WAITING_PHONE_FOR_STATUS' },
          { merge: true },
        );
      } else if (body === '3' || body === '4' || body === '5') {
        const tickets = await this.getTicketsByPhone(phone);
        if (tickets.length === 0) {
          await send('No tienes tickets registrados. ¿Puedo ayudarte en algo más?');
          return;
        }
        const list = this.formatTicketsList(tickets);
        await sessionRef.set({ pendingTickets: tickets }, { merge: true });

        if (body === '3') {
          await send(
            `Tus tickets:\n${list}\n\nSelecciona el número del ticket que deseas *editar*:`,
          );
          await sessionRef.set({ state: 'WAITING_TICKET_SELECTION_EDIT' }, { merge: true });
        } else if (body === '4') {
          await send(
            `Tus tickets:\n${list}\n\nSelecciona el número del ticket que deseas *eliminar*:`,
          );
          await sessionRef.set({ state: 'WAITING_TICKET_SELECTION_DELETE' }, { merge: true });
        } else {
          await send(
            `Tus tickets:\n${list}\n\nSelecciona el número del ticket que deseas *finalizar*:`,
          );
          await sessionRef.set({ state: 'WAITING_TICKET_SELECTION_FINALIZE' }, { merge: true });
        }
      } else {
        // Cualquier otro mensaje: mostrar menú
        await send(MENU);
      }

    // ─── CREAR TICKET ────────────────────────────────────────────────────────
    } else if (state === 'WAITING_PHONE_FOR_TICKET_CREATION') {
      await sessionRef.set(
        { state: 'WAITING_PHOTOS_AND_DESC', targetPhone: body, tempPhotos: [] },
        { merge: true },
      );
      await send('Sube unas fotos y añade una descripción para el ticket.');

    } else if (state === 'WAITING_PHOTOS_AND_DESC') {
      // ⚠️ IMPORTANTE: Leer el estado más reciente de tempPhotos de Firestore cada vez
      const latestSessionDoc = await sessionRef.get();
      const latestSession = latestSessionDoc.data() || {};
      let tempPhotos: string[] = Array.isArray(latestSession.tempPhotos)
        ? latestSession.tempPhotos
        : [];
      const targetPhone: string = latestSession.targetPhone || session.targetPhone || phone;
      let finalDescription = '';
      let readyToCreate = false;

      if (message.type === 'image' && (message.image?.id || message.image?.directUrl)) {
        // Si la imagen viene del simulador ya está en Storage (directUrl).
        // Si viene del webhook real, hay que descargarla de Meta.
        const photoUrl = message.image.directUrl
          ? message.image.directUrl
          : await this.uploadMedia(
              message.image.id!,
              message.image.mime_type || 'image/jpeg',
              phone,
            );
        if (photoUrl) {
          tempPhotos = [...tempPhotos, photoUrl];
          this.logger.debug(
            `[${phone}] Foto guardada. Total: ${tempPhotos.length}. URLs: ${tempPhotos.join(', ')}`,
          );
          await sessionRef.set(
            { tempPhotos, state: 'WAITING_PHOTOS_AND_DESC', targetPhone },
            { merge: true },
          );
        }
        if (message.image.caption) {
          finalDescription = message.image.caption;
          readyToCreate = true;
        }
      } else if (message.type === 'text' && body) {
        finalDescription = body;
        readyToCreate = true;
      }

      if (readyToCreate) {
        // Validar que tenemos fotos antes de crear el ticket
        if (!Array.isArray(tempPhotos)) {
          tempPhotos = [];
        }
        this.logger.log(
          `[${phone}] Creando ticket con ${tempPhotos.length} foto(s). Descripción: "${finalDescription}"`,
        );
        const ticketData = {
          ticketNumber: `TKT-${Math.floor(Math.random() * 90000) + 10000}`,
          status: 'REPORTADO',
          reporter: { phone: targetPhone, name: 'Usuario WhatsApp' },
          novelty: { type: 'unknown', description: finalDescription },
          photos: { evidence: tempPhotos, repair: [], delivery: [] },
          timestamps: { createdAt: Date.now(), updatedAt: Date.now() },
        };
        const docRef = await db.collection('tickets').add(ticketData);
        this.logger.log(
          `[${phone}] Ticket creado: ${ticketData.ticketNumber} (ID: ${docRef.id})`,
        );
        await send(
          `✅ Ticket *${ticketData.ticketNumber}* creado exitosamente.\n\n` +
          `Te notificaremos cuando haya actualizaciones de estados.`,
        );
        await sessionRef.set(
          { state: 'IDLE', tempPhotos: [], targetPhone: null },
          { merge: true },
        );
      }

    // ─── VER ESTADO ──────────────────────────────────────────────────────────
    } else if (state === 'WAITING_PHONE_FOR_STATUS') {
      const tickets = await this.getTicketsByPhone(body);
      if (tickets.length === 0) {
        await send('No encontré tickets para ese número. ¿Deseas hacer algo más?');
        await sessionRef.set({ state: 'IDLE' }, { merge: true });
        return;
      }
      const list = this.formatTicketsList(tickets);
      await send(`Tus tickets:\n${list}`);
      // Enviar fotos de cada ticket para que el usuario pueda revisarlas
      for (const t of tickets) {
        if (t.photos && t.photos.length > 0) {
          await send(`📷 Fotos de *${t.ticketNumber}*:`);
          for (const url of t.photos) {
            await sendPhoto(url);
          }
        }
      }
      await send(
        `¿Deseas:\n1. Editar\n2. Eliminar\n3. Terminar algún ticket?\n` +
        `Responde *No* para salir del chat.`,
      );
      await sessionRef.set(
        { state: 'WAITING_ACTION_AFTER_STATUS', pendingTickets: tickets, targetPhone: body },
        { merge: true },
      );

    } else if (state === 'WAITING_ACTION_AFTER_STATUS') {
      const tickets: PendingTicket[] = session.pendingTickets || [];
      const list = this.formatTicketsList(tickets);

      if (body === '1') {
        await send(`${list}\n\nSelecciona el número del ticket que deseas *editar*:`);
        await sessionRef.set({ state: 'WAITING_TICKET_SELECTION_EDIT' }, { merge: true });
      } else if (body === '2') {
        await send(`${list}\n\nSelecciona el número del ticket que deseas *eliminar*:`);
        await sessionRef.set({ state: 'WAITING_TICKET_SELECTION_DELETE' }, { merge: true });
      } else if (body === '3') {
        await send(`${list}\n\nSelecciona el número del ticket que deseas *finalizar*:`);
        await sessionRef.set({ state: 'WAITING_TICKET_SELECTION_FINALIZE' }, { merge: true });
      } else {
        await send('Hasta luego 👋. Escribe cualquier mensaje para volver al menú.');
        await sessionRef.set({ state: 'IDLE', pendingTickets: null }, { merge: true });
      }

    // ─── EDITAR TICKET ───────────────────────────────────────────────────────
    } else if (state === 'WAITING_TICKET_SELECTION_EDIT') {
      const tickets: PendingTicket[] = session.pendingTickets || [];
      const idx = parseInt(body) - 1;
      if (isNaN(idx) || idx < 0 || idx >= tickets.length) {
        await send(`Por favor selecciona un número entre 1 y ${tickets.length}.`);
        return;
      }
      await sessionRef.set({ state: 'WAITING_NEW_DESCRIPTION', pendingTicketId: tickets[idx].id }, { merge: true });
      await send('¿Cuál es la nueva descripción del problema?');

    } else if (state === 'WAITING_NEW_DESCRIPTION') {
      const ticketId: string = session.pendingTicketId;
      if (ticketId) {
        await db.collection('tickets').doc(ticketId).update({
          'novelty.description': body,
          'timestamps.updatedAt': Date.now(),
        });
        await send('✅ Ticket actualizado correctamente.');
      }
      await sessionRef.set(
        { state: 'IDLE', pendingTicketId: null, pendingTickets: null },
        { merge: true },
      );

    // ─── ELIMINAR TICKET ─────────────────────────────────────────────────────
    } else if (state === 'WAITING_TICKET_SELECTION_DELETE') {
      const tickets: PendingTicket[] = session.pendingTickets || [];
      const idx = parseInt(body) - 1;
      if (isNaN(idx) || idx < 0 || idx >= tickets.length) {
        await send(`Por favor selecciona un número entre 1 y ${tickets.length}.`);
        return;
      }
      await db.collection('tickets').doc(tickets[idx].id).delete();
      await send(`✅ Ticket *${tickets[idx].ticketNumber}* eliminado correctamente.`);
      await sessionRef.set(
        { state: 'IDLE', pendingTickets: null },
        { merge: true },
      );

    // ─── FINALIZAR TICKET ────────────────────────────────────────────────────
    } else if (state === 'WAITING_TICKET_SELECTION_FINALIZE') {
      const tickets: PendingTicket[] = session.pendingTickets || [];
      const idx = parseInt(body) - 1;
      if (isNaN(idx) || idx < 0 || idx >= tickets.length) {
        await send(`Por favor selecciona un número entre 1 y ${tickets.length}.`);
        return;
      }
      const ticket = tickets[idx];
      await db.collection('tickets').doc(ticket.id).update({
        status: 'FINALIZADO',
        'timestamps.updatedAt': Date.now(),
      });
      await send(`✅ Ticket *${ticket.ticketNumber}* marcado como FINALIZADO.`);
      await sessionRef.set(
        { state: 'IDLE', pendingTickets: null },
        { merge: true },
      );

    // ─── RESET ───────────────────────────────────────────────────────────────
    } else {
      await sessionRef.set({ state: 'IDLE' }, { merge: true });
      await send('Operación cancelada. Escribe cualquier mensaje para volver al menú.');
    }
  }

  // Verifica el webhook de Meta (GET)
  verifyWebhook(mode: string, token: string, challenge: string): string | null {
    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return challenge;
    }
    return null;
  }

  // Obtiene el historial de conversación de un usuario
  async getChatHistory(phone: string): Promise<Array<{ from: string; text?: string; photoUrl?: string; timestamp: number }>> {
    const sessionRef = this.firebase.db.collection('whatsapp_sessions').doc(phone);
    const sessionDoc = await sessionRef.get();
    const data = sessionDoc.data();
    return data?.messages || [];
  }
}
