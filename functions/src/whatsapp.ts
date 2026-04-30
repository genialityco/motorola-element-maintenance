import { onRequest } from "firebase-functions/v2/https";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { getFunctions } from "firebase-admin/functions";
import { getFirestore } from "firebase-admin/firestore";

// FASE 2.2: Webhook HTTPS No-Bloqueante
export const whatsappWebhook = onRequest(async (req, res) => {
  // META WEBHOOK VERIFICATION (GET)
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    // Usa env variables para el token de manera segura en prod
    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      res.status(200).send(challenge);
      return;
    } else {
      res.sendStatus(403);
      return;
    }
  }

  // META POST PAYLOAD
  if (req.method === "POST") {
    const body = req.body;

    // Verificar si es un payload válido de WhatsApp
    if (body.object) {
      try {
        // Encolar rápidamente sin bloquear usando Google Cloud Tasks via Firebase Admin
        const queue = getFunctions().taskQueue("processWhatsAppTask");
        
        await queue.enqueue({ 
          payload: body 
        }, {
          scheduleDelaySeconds: 0,
        });

        // 3. Webhook No-Bloqueante: Responder 200 INMEDIATAMENTE
        res.status(200).send("EVENT_RECEIVED");
        return;
      } catch (error) {
        console.error("Error encolando tarea:", error);
        // Retornar 500 solo si el encolado falla, Meta reintentará
        res.sendStatus(500);
        return;
      }
    } else {
      res.sendStatus(404);
      return;
    }
  }

  res.sendStatus(405);
});

// FASE 2.3: Función Worker Consumidora de Cloud Tasks
export const processWhatsAppTask = onTaskDispatched(async (req) => {
  const data = req.data as { payload: any };
  const payload = data.payload;

  if (!payload || !payload.entry || !payload.entry[0].changes) return;

  const changes = payload.entry[0].changes[0].value;
  const messages = changes.messages;

  if (!messages || messages.length === 0) return;

  const message = messages[0];
  const reporterPhone = message.from;

  const db = getFirestore();

  try {
    // Aquí implementas la lógica de procesamiento del bot,
    // extracción de texto e imágenes (descargando imagen desde Graph API 
    // y guardándola en Firebase Storage).
    
    // Por ahora, simulamos la creación del Documento "Ticket"
    const newTicketData = {
      ticketNumber: `TKT-${Math.floor(Math.random() * 10000)}`,
      status: "REPORTADO",
      reporter: {
        phone: reporterPhone,
        name: "Usuario WhatsApp" // ideal: extraer del webhook o bd de contactos
      },
      novelty: {
        type: "unknown",
        description: message.text?.body || "Mensaje sin texto",
      },
      point: { id: "p1", name: "Punto Default" },
      actors: {},
      budget: {},
      photos: { evidence: [], repair: [], delivery: [] },
      timestamps: {
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    };

    const newTicketRef = db.collection("tickets").doc();
    await newTicketRef.set(newTicketData);
    
    console.log(`✅ Ticket creado a partir de WhatsApp: ${newTicketRef.id}`);

    // NOTA: Para imágenes, validar `message.type === 'image'`, 
    // pedirla a Meta Graph API, subir a Storage, y actualizar photos.evidence.
    
  } catch (error) {
    console.error("Error en el Worker de WhatsApp procesando el mensaje:", error);
    throw error; // Al lanzar el error, Cloud Tasks reintenta según configuración
  }
});
