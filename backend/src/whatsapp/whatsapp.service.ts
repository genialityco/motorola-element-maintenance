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
  description?: string;
  ciudad?: string;
  canal?: string;
  punto?: string;
}

const MENU =
  `Hola, a continuación te mostraré las diferentes funcionalidades que poseo:\n` +
  `1. Para crear un ticket presiona 1\n` +
  `2. Para ver el estado de tus tickets presiona 2\n` +
  `3. Para editar un ticket presiona 3\n` +
  `4. Para eliminar un ticket presiona 4\n` +
  `5. Para finalizar un ticket presiona 5`;

// Capitaliza la primera letra de cada palabra, preservando el resto
function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

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
                if (newStatus === 'REPARADO') {
                  // Notificación especial con fotos de reparación
                  const repairPhotos = (data.photos?.repair as string[]) || [];
                  const description = (data.novelty?.description as string) || '';
                  const msg =
                    repairPhotos.length > 0
                      ? `Estas son las evidencias de que su ticket *${data.ticketNumber}* con descripción "${description}" ha sido reparado:`
                      : `El estado de su solicitud *${data.ticketNumber}* ha cambiado de "${prevStatus}" a "${newStatus}".`;

                  await this.saveMessage(phone, 'bot', msg).catch((err) =>
                    this.logger.error('Error guardando notificación REPARADO:', err),
                  );
                  await this.sendMessage(phone, msg).catch((err) =>
                    this.logger.error('Error enviando notificación REPARADO:', err),
                  );

                  for (const photoUrl of repairPhotos) {
                    await this.saveMessage(phone, 'bot', '[imagen]', photoUrl).catch((err) =>
                      this.logger.error('Error guardando foto reparación en historial:', err),
                    );
                    await this.sendImageMessage(phone, photoUrl, 'Evidencia de reparación').catch((err) =>
                      this.logger.error('Error enviando foto de reparación:', err),
                    );
                  }
                } else {
                  const msg =
                    `El estado de su solicitud *${data.ticketNumber}* ha cambiado de "${prevStatus}" a "${newStatus}".`;
                  await this.saveMessage(phone, 'bot', msg).catch((err) =>
                    this.logger.error('Error guardando notificación en historial:', err),
                  );
                  await this.sendMessage(phone, msg).catch((err) =>
                    this.logger.error('Error en notificación de estado:', err),
                  );
                }
              }
            }
          }
        });
      },
      (err) => this.logger.error('Error en listener de tickets:', err),
    );
    this.logger.log('Listener de cambios de estado de tickets activo.');
  }

  // Envía mensaje de texto por WhatsApp API
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

  // Envía imagen por WhatsApp API usando una URL pública
  async sendImageMessage(to: string, imageUrl: string, caption?: string) {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_ID;

    if (!token || !phoneId) {
      this.logger.warn('Faltan WHATSAPP_TOKEN o WHATSAPP_PHONE_ID');
      return;
    }

    const body: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      to,
      type: 'image',
      image: { link: imageUrl, ...(caption ? { caption } : {}) },
    };

    const res = await fetch(
      `https://graph.facebook.com/v17.0/${phoneId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      this.logger.error(`Error enviando imagen WhatsApp: ${res.status} ${await res.text()}`);
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
      onResponse(photoUrl ? `[IMG]${photoUrl}` : text);
    } else if (photoUrl) {
      await this.sendImageMessage(phone, photoUrl, text !== '[imagen]' ? text : undefined);
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
        description: (data.novelty?.description as string) || '',
        ciudad: (data.ciudad as string) || '',
        canal: (data.canal as string) || '',
        punto: (data.point?.name as string) || '',
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

    // Extraer URL de imagen entrante (una sola vez para todos los estados)
    let incomingPhotoUrl: string | undefined;
    if (message.type === 'image' && (message.image?.directUrl || message.image?.id)) {
      incomingPhotoUrl = message.image.directUrl;
      if (!incomingPhotoUrl && message.image?.id) {
        incomingPhotoUrl = await this.uploadMedia(
          message.image.id,
          message.image.mime_type || 'image/jpeg',
          phone,
        );
      }
      if (incomingPhotoUrl) {
        await this.saveMessage(
          phone,
          'user',
          message.image.caption || '[imagen]',
          incomingPhotoUrl,
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
        await send('¿En qué ciudad se encuentra el punto de venta?');
        await sessionRef.set({ state: 'WAITING_CITY' }, { merge: true });
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

    // ─── CREAR TICKET: Ciudad → Canal → Punto → Teléfono ────────────────────
    } else if (state === 'WAITING_CITY') {
      if (!body) {
        await send('Por favor ingresa el nombre de la ciudad:');
        return;
      }
      await sessionRef.set(
        { state: 'WAITING_CANAL', tempCity: normalizeText(body) },
        { merge: true },
      );
      await send('¿Cuál es el canal de venta? (ejemplo: Retail, Operador, Online):');

    } else if (state === 'WAITING_CANAL') {
      if (!body) {
        await send('Por favor ingresa el canal de venta:');
        return;
      }
      await sessionRef.set(
        { state: 'WAITING_PUNTO_VENTA', tempCanal: normalizeText(body) },
        { merge: true },
      );
      await send('¿Cuál es el nombre del punto de venta?');

    } else if (state === 'WAITING_PUNTO_VENTA') {
      if (!body) {
        await send('Por favor ingresa el nombre del punto de venta:');
        return;
      }
      await sessionRef.set(
        { state: 'WAITING_PHONE_FOR_TICKET_CREATION', tempPunto: normalizeText(body), tempPhotos: [] },
        { merge: true },
      );
      await send('Por favor ingresa tu número de celular:');

    } else if (state === 'WAITING_PHONE_FOR_TICKET_CREATION') {
      await sessionRef.set(
        { state: 'WAITING_PHOTOS_AND_DESC', targetPhone: body },
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

      if (incomingPhotoUrl) {
        tempPhotos = [...tempPhotos, incomingPhotoUrl];
        this.logger.debug(
          `[${phone}] Foto guardada. Total: ${tempPhotos.length}. URLs: ${tempPhotos.join(', ')}`,
        );
        await sessionRef.set(
          { tempPhotos, state: 'WAITING_PHOTOS_AND_DESC', targetPhone },
          { merge: true },
        );
        if (message.image?.caption) {
          finalDescription = message.image.caption;
          readyToCreate = true;
        }
      } else if (message.type === 'text' && body) {
        finalDescription = body;
        readyToCreate = true;
      }

      if (readyToCreate) {
        if (!Array.isArray(tempPhotos)) tempPhotos = [];
        this.logger.log(
          `[${phone}] Creando ticket con ${tempPhotos.length} foto(s). Descripción: "${finalDescription}"`,
        );

        // Releer para tener los últimos tempPhotos al momento de crear
        const freshDoc = await sessionRef.get();
        const freshData = freshDoc.data() || {};
        const finalPhotos: string[] = Array.isArray(freshData.tempPhotos)
          ? freshData.tempPhotos
          : tempPhotos;

        const ciudad = (freshData.tempCity as string) || '';
        const canal = (freshData.tempCanal as string) || '';
        const punto = (freshData.tempPunto as string) || '';

        const ticketData = {
          ticketNumber: `TKT-${Math.floor(Math.random() * 90000) + 10000}`,
          status: 'REPORTADO',
          ciudad,
          canal,
          point: { id: punto.toLowerCase().replace(/\s+/g, '_') || 'unknown', name: punto || 'Sin punto' },
          reporter: { phone: targetPhone, name: 'Usuario WhatsApp' },
          novelty: { type: 'unknown', description: finalDescription },
          photos: { evidence: finalPhotos, repair: [], delivery: [] },
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
          { state: 'IDLE', tempPhotos: [], targetPhone: null, tempCity: null, tempCanal: null, tempPunto: null },
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
      const selectedTicket = tickets[idx];
      await sessionRef.set(
        {
          state: 'WAITING_EDIT_FIELD_SELECTION',
          pendingTicketId: selectedTicket.id,
          pendingTicketData: selectedTicket,
        },
        { merge: true },
      );
      await send(
        `¿Qué deseas editar en el ticket *${selectedTicket.ticketNumber}*?\n\n` +
        `1. Fotos\n` +
        `2. Ciudad\n` +
        `3. Punto de venta\n` +
        `4. Canal\n` +
        `5. Descripción`,
      );

    } else if (state === 'WAITING_EDIT_FIELD_SELECTION') {
      const ticketData = session.pendingTicketData as PendingTicket;

      if (body === '1') {
        const photos = ticketData?.photos || [];
        const hasPhotos = photos.length > 0;
        const photoList = hasPhotos
          ? `Fotos actuales:\n${photos.map((_, i) => `Foto ${i + 1}`).join('\n')}\n\n`
          : 'Este ticket aún no tiene fotos de evidencia.\n\n';
        await send(
          `${photoList}¿Qué deseas hacer?\n1. Editar una foto existente${!hasPhotos ? ' (no disponible)' : ''}\n2. Agregar nuevas fotos\n0. Cancelar`,
        );
        await sessionRef.set({ state: 'WAITING_EDIT_PHOTO_ACTION' }, { merge: true });

      } else if (body === '2') {
        await send(`Ciudad actual: *${ticketData?.ciudad || 'Sin ciudad'}*\n\n¿Cuál es la nueva ciudad?`);
        await sessionRef.set({ state: 'WAITING_EDIT_CITY' }, { merge: true });

      } else if (body === '3') {
        await send(`Punto de venta actual: *${ticketData?.punto || 'Sin punto'}*\n\n¿Cuál es el nuevo punto de venta?`);
        await sessionRef.set({ state: 'WAITING_EDIT_PUNTO' }, { merge: true });

      } else if (body === '4') {
        await send(`Canal actual: *${ticketData?.canal || 'Sin canal'}*\n\n¿Cuál es el nuevo canal?`);
        await sessionRef.set({ state: 'WAITING_EDIT_CANAL' }, { merge: true });

      } else if (body === '5') {
        await send(`Descripción actual: *${ticketData?.description || 'Sin descripción'}*\n\n¿Cuál es la nueva descripción?`);
        await sessionRef.set({ state: 'WAITING_NEW_DESCRIPTION' }, { merge: true });

      } else if (body === '0') {
        await send('Operación cancelada.');
        await sessionRef.set({ state: 'IDLE', pendingTicketId: null, pendingTickets: null, pendingTicketData: null }, { merge: true });

      } else {
        await send(
          `Opción no válida. ¿Qué deseas editar en el ticket *${ticketData?.ticketNumber}*?\n\n` +
          `1. Fotos\n2. Ciudad\n3. Punto de venta\n4. Canal\n5. Descripción\n0. Cancelar`,
        );
      }

    } else if (state === 'WAITING_EDIT_PHOTO_ACTION') {
      const ticketData = session.pendingTicketData as PendingTicket;
      const photos = ticketData?.photos || [];

      if (body === '0') {
        await send('Operación cancelada.');
        await sessionRef.set({ state: 'IDLE', pendingTicketId: null, pendingTickets: null, pendingTicketData: null }, { merge: true });

      } else if (body === '1') {
        if (photos.length === 0) {
          await send('No hay fotos para editar. Selecciona *2* para agregar fotos nuevas, o *0* para cancelar.');
          return;
        }
        const photoList = photos.map((_, i) => `Foto ${i + 1}`).join('\n');
        await send(`${photoList}\n\n¿Cuál deseas reemplazar? (responde el número o 0 para cancelar)`);
        await sessionRef.set({ state: 'WAITING_EDIT_PHOTO_SELECTION' }, { merge: true });

      } else if (body === '2') {
        await send('Adjunta las fotos que deseas agregar. Cuando termines, escribe *listo*.');
        await sessionRef.set({ state: 'WAITING_EDIT_ADD_PHOTOS', tempEditPhotos: [] }, { merge: true });

      } else {
        await send('Opción no válida. Responde *1* para editar, *2* para agregar, o *0* para cancelar.');
      }

    } else if (state === 'WAITING_EDIT_ADD_PHOTOS') {
      // ⚠️ Releer tempEditPhotos de Firestore (puede haber varias imágenes en paralelo)
      const latestDoc = await sessionRef.get();
      const ls = latestDoc.data() || {};
      let tempEditPhotos: string[] = Array.isArray(ls.tempEditPhotos) ? ls.tempEditPhotos : [];
      const ticketId = ls.pendingTicketId as string;

      if (body === '0') {
        await send('Operación cancelada.');
        await sessionRef.set(
          { state: 'IDLE', pendingTicketId: null, pendingTickets: null, pendingTicketData: null, tempEditPhotos: null },
          { merge: true },
        );
      } else if (incomingPhotoUrl) {
        tempEditPhotos = [...tempEditPhotos, incomingPhotoUrl];
        await sessionRef.set({ tempEditPhotos }, { merge: true });
        await send(`✅ Foto ${tempEditPhotos.length} recibida. Adjunta más fotos o escribe *listo* para guardar.`);

      } else if (body) {
        if (tempEditPhotos.length === 0) {
          await send('Aún no has adjuntado ninguna foto. Envía imágenes y luego escribe *listo*, o escribe *0* para cancelar.');
          return;
        }
        // Cualquier texto distinto de "0" confirma el guardado
        const freshDoc = await sessionRef.get();
        const freshData = freshDoc.data() || {};
        const finalPhotos: string[] = Array.isArray(freshData.tempEditPhotos)
          ? freshData.tempEditPhotos
          : tempEditPhotos;

        const ticketSnap = await db.collection('tickets').doc(ticketId).get();
        const existing: string[] = (ticketSnap.data()?.photos?.evidence as string[]) || [];

        await db.collection('tickets').doc(ticketId).update({
          'photos.evidence': [...existing, ...finalPhotos],
          'timestamps.updatedAt': Date.now(),
        });
        await send(`✅ ${finalPhotos.length} foto(s) agregada(s) al ticket correctamente.`);
        await sessionRef.set(
          { state: 'IDLE', pendingTicketId: null, pendingTickets: null, pendingTicketData: null, tempEditPhotos: null },
          { merge: true },
        );
      }

    } else if (state === 'WAITING_EDIT_PHOTO_SELECTION') {
      const ticketData = session.pendingTicketData as PendingTicket;
      const photos = ticketData?.photos || [];
      const photoIdx = parseInt(body) - 1;

      if (body === '0') {
        await send('Operación cancelada.');
        await sessionRef.set({ state: 'IDLE', pendingTicketId: null, pendingTickets: null, pendingTicketData: null }, { merge: true });
        return;
      }

      if (isNaN(photoIdx) || photoIdx < 0 || photoIdx >= photos.length) {
        await send(`Por favor selecciona un número entre 1 y ${photos.length}, o 0 para cancelar.`);
        return;
      }
      await sessionRef.set({ state: 'WAITING_EDIT_NEW_PHOTO', pendingPhotoIndex: photoIdx }, { merge: true });
      await send(`Adjunta la nueva foto para reemplazar la *Foto ${photoIdx + 1}*:`);

    } else if (state === 'WAITING_EDIT_NEW_PHOTO') {
      if (!incomingPhotoUrl) {
        await send('Por favor adjunta una imagen para continuar.');
        return;
      }

      const latestSessionDoc = await sessionRef.get();
      const ls = latestSessionDoc.data() || {};
      const pendingPhotoIndex = ls.pendingPhotoIndex as number;
      const ticketId = ls.pendingTicketId as string;

      const ticketSnap = await db.collection('tickets').doc(ticketId).get();
      const currentPhotos: string[] = [...((ticketSnap.data()?.photos?.evidence as string[]) || [])];

      if (pendingPhotoIndex >= 0 && pendingPhotoIndex < currentPhotos.length) {
        currentPhotos[pendingPhotoIndex] = incomingPhotoUrl;
      } else {
        currentPhotos.push(incomingPhotoUrl);
      }

      await db.collection('tickets').doc(ticketId).update({
        'photos.evidence': currentPhotos,
        'timestamps.updatedAt': Date.now(),
      });
      await send('✅ Foto actualizada correctamente.');
      await sessionRef.set(
        { state: 'IDLE', pendingTicketId: null, pendingTickets: null, pendingPhotoIndex: null, pendingTicketData: null },
        { merge: true },
      );

    } else if (state === 'WAITING_EDIT_CITY') {
      if (!body) {
        await send('Por favor ingresa el nombre de la ciudad:');
        return;
      }
      const ticketId = session.pendingTicketId as string;
      if (ticketId) {
        await db.collection('tickets').doc(ticketId).update({
          ciudad: normalizeText(body),
          'timestamps.updatedAt': Date.now(),
        });
        await send('✅ Ciudad actualizada correctamente.');
      }
      await sessionRef.set({ state: 'IDLE', pendingTicketId: null, pendingTickets: null, pendingTicketData: null }, { merge: true });

    } else if (state === 'WAITING_EDIT_CANAL') {
      if (!body) {
        await send('Por favor ingresa el canal:');
        return;
      }
      const ticketId = session.pendingTicketId as string;
      if (ticketId) {
        await db.collection('tickets').doc(ticketId).update({
          canal: normalizeText(body),
          'timestamps.updatedAt': Date.now(),
        });
        await send('✅ Canal actualizado correctamente.');
      }
      await sessionRef.set({ state: 'IDLE', pendingTicketId: null, pendingTickets: null, pendingTicketData: null }, { merge: true });

    } else if (state === 'WAITING_EDIT_PUNTO') {
      if (!body) {
        await send('Por favor ingresa el punto de venta:');
        return;
      }
      const ticketId = session.pendingTicketId as string;
      if (ticketId) {
        const normalized = normalizeText(body);
        await db.collection('tickets').doc(ticketId).update({
          'point.name': normalized,
          'point.id': normalized.toLowerCase().replace(/\s+/g, '_'),
          'timestamps.updatedAt': Date.now(),
        });
        await send('✅ Punto de venta actualizado correctamente.');
      }
      await sessionRef.set({ state: 'IDLE', pendingTicketId: null, pendingTickets: null, pendingTicketData: null }, { merge: true });

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
        { state: 'IDLE', pendingTicketId: null, pendingTickets: null, pendingTicketData: null },
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
