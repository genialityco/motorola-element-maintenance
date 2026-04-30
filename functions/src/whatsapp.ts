import {onRequest} from "firebase-functions/v2/https";
import {onTaskDispatched} from "firebase-functions/v2/tasks";
import {getFunctions} from "firebase-admin/functions";
import {getFirestore} from "firebase-admin/firestore";

type WhatsAppText = {
  body?: string;
};

type WhatsAppMessage = {
  from?: string;
  type?: string;
  text?: WhatsAppText;
};

type WhatsAppChangeValue = {
  messages?: WhatsAppMessage[];
};

type WhatsAppChange = {
  value?: WhatsAppChangeValue;
};

type WhatsAppEntry = {
  changes?: WhatsAppChange[];
};

type WhatsAppWebhookPayload = {
  object?: string;
  entry?: WhatsAppEntry[];
};

type ProcessWhatsAppTaskData = {
  payload: WhatsAppWebhookPayload;
};

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

        await queue.enqueue(
          {
            payload: body,
          },
          {
            scheduleDelaySeconds: 0,
          },
        );

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
  const data = req.data as ProcessWhatsAppTaskData;
  const payload = data.payload;

  const firstEntry = payload.entry?.[0];
  const firstChange = firstEntry?.changes?.[0];
  const messages = firstChange?.value?.messages;

  if (!messages || messages.length === 0) {
    return;
  }

  const message = messages[0];
  const reporterPhone = message.from || "";

  const db = getFirestore();

  try {
    const newTicketData = {
      ticketNumber: `TKT-${Math.floor(Math.random() * 10000)}`,
      status: "REPORTADO",
      reporter: {
        phone: reporterPhone,
        name: "Usuario WhatsApp",
      },
      novelty: {
        type: "unknown",
        description: message.text?.body || "Mensaje sin texto",
      },
      point: {
        id: "p1",
        name: "Punto Default",
      },
      actors: {},
      budget: {},
      photos: {
        evidence: [],
        repair: [],
        delivery: [],
      },
      timestamps: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    };

    const newTicketRef = db.collection("tickets").doc();
    await newTicketRef.set(newTicketData);

    console.log("Ticket creado a partir de WhatsApp:", newTicketRef.id);
  } catch (error) {
    console.error("Error procesando el mensaje de WhatsApp:", error);

    throw error;
  }
});
