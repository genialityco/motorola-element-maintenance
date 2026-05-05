import {onRequest} from "firebase-functions/v2/https";
import {onTaskDispatched} from "firebase-functions/v2/tasks";
import {onDocumentUpdated} from "firebase-functions/v2/firestore";
import {getFunctions} from "firebase-admin/functions";
import {getFirestore} from "firebase-admin/firestore";
import {getStorage} from "firebase-admin/storage";

// Definiciones de tipos de WhatsApp
type WhatsAppText = { body?: string; };
type WhatsAppImage = { mime_type?: string; sha256?: string; id?: string; caption?: string; };
type WhatsAppMessage = { from?: string; type?: string; text?: WhatsAppText; id?: string; image?: WhatsAppImage; };
type WhatsAppChangeValue = { messages?: WhatsAppMessage[]; };
type WhatsAppChange = { value?: WhatsAppChangeValue; };
type WhatsAppEntry = { changes?: WhatsAppChange[]; };
type WhatsAppWebhookPayload = { object?: string; entry?: WhatsAppEntry[]; };
//type ProcessWhatsAppTaskData = { payload: WhatsAppWebhookPayload; };

// Helper para enviar mensajes de WhatsApp usando la API de Meta
async function sendWhatsAppMessage(to: string, text: string) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_ID;
  
  if (!token || !phoneNumberId) {
    console.warn("Faltan variables de entorno WHATSAPP_TOKEN o WHATSAPP_PHONE_ID");
    return;
  }

  const url = `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`;
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: { body: text },
      }),
    });
  } catch (error) {
    console.error("Error al enviar mensaje de WhatsApp:", error);
  }
}

// Helper para descargar y subir medios a Firebase Storage
async function uploadWhatsAppMediaToStorage(mediaId: string, mimeType: string, phone: string): Promise<string> {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) return "";

  try {
    // 1. Obtener la URL del medio desde WhatsApp Graph API
    const metadataRes = await fetch(`https://graph.facebook.com/v17.0/${mediaId}`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const mediaMetadata = await metadataRes.json();
    
    if (!mediaMetadata.url) return "";

    // 2. Descargar el archivo binario
    const mediaRes = await fetch(mediaMetadata.url, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const buffer = await mediaRes.arrayBuffer();

    // 3. Subir a Firebase Storage
    const bucket = getStorage().bucket();
    const extension = mimeType.split('/')[1] || 'jpeg';
    const filePath = `whatsapp_media/${phone}/${Date.now()}_${mediaId}.${extension}`;
    const file = bucket.file(filePath);
    
    await file.save(Buffer.from(buffer), {
      metadata: { contentType: mimeType }
    });
    
    await file.makePublic(); // Hacemos publica la URL para fácil visualización
    return file.publicUrl();
  } catch (error) {
    console.error("Error subiendo media a Storage:", error);
    return "";
  }
}

export const whatsappWebhook = onRequest({cors: true}, async (req, res) => {
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      res.status(200).send(challenge);
      return;
    }

    res.sendStatus(403);
    return;
  }

  if (req.method === "POST") {
    const body = req.body as WhatsAppWebhookPayload;

    if (body.object) {
      try {
        const queue = getFunctions().taskQueue("processWhatsAppTask");
        await queue.enqueue({ payload: body }, { scheduleDelaySeconds: 0 });
        res.status(200).send("EVENT_RECEIVED");
        return;
      } catch (error) {
        console.error("Error encolando tarea:", error);
        res.sendStatus(500);
        return;
      }
    }
    res.sendStatus(404);
    return;
  }
  res.sendStatus(405);
});

export const processWhatsAppTask = onTaskDispatched(async (req) => {
  const payload = req.data.payload as WhatsAppWebhookPayload;
  const firstEntry = payload.entry?.[0];
  const firstChange = firstEntry?.changes?.[0];
  const messages = firstChange?.value?.messages;

  if (!messages || messages.length === 0) return;

  const message = messages[0];
  const reporterPhone = message.from || "";
  const messageBody = message.text?.body?.trim().toLowerCase() || "";
  const db = getFirestore();

  try {
    const sessionRef = db.collection("whatsapp_sessions").doc(reporterPhone);
    const sessionDoc = await sessionRef.get();
    let state = "IDLE";
    
    if (sessionDoc.exists) {
      state = sessionDoc.data()?.state || "IDLE";
    }

    // Máquina de estados conversacional básica
    if (state === "IDLE") {
      const menu = "Hola, a continuación te mostraré las diferentes funcionalidades que poseo:\n" +
                   "1. Para crear un ticket presiona 1\n" +
                   "2. Para ver el estado de tus tickets presiona 2\n" +
                   "3. Para editar un ticket presiona 3\n" +
                   "4. Para eliminar un ticket presiona 4\n" +
                   "5. Para finalizar un ticket presiona 5";
      
      if (messageBody === "1") {
        await sendWhatsAppMessage(reporterPhone, "Sube unas fotos y añade una descripción para el ticket.");
        await sessionRef.set({ state: "WAITING_PHOTOS_AND_DESC" }, { merge: true });
      } else if (messageBody === "2") {
        await sendWhatsAppMessage(reporterPhone, "Ingrese su número de celular:");
        await sessionRef.set({ state: "WAITING_PHONE_FOR_STATUS" }, { merge: true });
      } else if (messageBody === "3" || messageBody === "4" || messageBody === "5") {
        // Aquí deberías consultar los tickets y listar sus IDs/Nombres.
        await sendWhatsAppMessage(reporterPhone, "Por favor responde con el ID del ticket para esta acción.");
        await sessionRef.set({ state: `WAITING_TICKET_ID_FOR_ACTION_${messageBody}` }, { merge: true });
      } else {
        await sendWhatsAppMessage(reporterPhone, menu);
      }
    } else if (state === "WAITING_PHOTOS_AND_DESC") {
      let tempPhotos: string[] = sessionDoc.data()?.tempPhotos || [];
      let finalDescription = "";
      let readyToCreate = false;

      if (message.type === "image" && message.image?.id) {
        // Subimos la imagen a Storage
        const photoUrl = await uploadWhatsAppMediaToStorage(message.image.id, message.image.mime_type || "image/jpeg", reporterPhone);
        if (photoUrl) {
          tempPhotos.push(photoUrl);
          await sessionRef.set({ tempPhotos }, { merge: true });
        }
        
        // Si la imagen viene con texto/caption, la tomamos como descripción y cerramos
        if (message.image.caption) {
          finalDescription = message.image.caption;
          readyToCreate = true;
        } else {
          await sendWhatsAppMessage(reporterPhone, "Foto recibida. Puedes enviar más fotos, o enviar un mensaje de texto con la descripción para crear el ticket.");
        }
      } else if (message.type === "text" || messageBody) {
        // Envió la descripción
        finalDescription = messageBody || message.text?.body || "Sin descripción";
        readyToCreate = true;
      }

      if (readyToCreate) {
        const newTicketData = {
          ticketNumber: `TKT-${Math.floor(Math.random() * 10000)}`,
          status: "REPORTADO",
          reporter: { phone: reporterPhone, name: "Usuario WhatsApp" },
          novelty: { type: "unknown", description: finalDescription },
          photos: { evidence: tempPhotos, repair: [], delivery: [] },
          timestamps: { createdAt: Date.now(), updatedAt: Date.now() },
        };
        await db.collection("tickets").add(newTicketData);
        await sendWhatsAppMessage(reporterPhone, "Ticket creado con éxito junto con tus fotos.");
        await sessionRef.set({ state: "IDLE", tempPhotos: [] }, { merge: true });
      }
    } else if (state === "WAITING_PHONE_FOR_STATUS") {
      const querySnapshot = await db.collection("tickets").where("reporter.phone", "==", messageBody).get();
      if (querySnapshot.empty) {
        await sendWhatsAppMessage(reporterPhone, "No se encontraron tickets. Desea 1. editar 2. eliminar o 3. terminar algun ticket, 'No' y sale.");
      } else {
        const ticketsList = querySnapshot.docs.map(doc => `Ticket: ${doc.data().ticketNumber} - Estado: ${doc.data().status}`).join('\n');
        await sendWhatsAppMessage(reporterPhone, `Tus tickets:\n${ticketsList}\n\n¿Desea 1. editar 2. eliminar o 3. terminar algun ticket?, 'No' y sale del chat`);
      }
      await sessionRef.set({ state: "IDLE" }, { merge: true }); // Volver a idle o a sub-estado si se desea la acción consecutiva
    } else {
      // Reset de seguridad
      await sessionRef.set({ state: "IDLE" }, { merge: true });
      await sendWhatsAppMessage(reporterPhone, "Operación cancelada o completada. Envía un mensaje para volver al menú.");
    }
  } catch (error) {
    console.error("Error procesando chat:", error);
    throw error;
  }
});

// Trigger: Notificar usuario cuando cambia el estado del ticket desde el administrador
export const onTicketStatusUpdated = onDocumentUpdated("tickets/{ticketId}", async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();

  if (!before || !after) return;
  if (before.status !== after.status) {
    const reporterPhone = after.reporter?.phone;
    if (reporterPhone) {
      const msg = `El estado de su solicitud ${after.ticketNumber} ha cambiado de "${before.status}" a "${after.status}".`;
      await sendWhatsAppMessage(reporterPhone, msg);
    }
  }
});
