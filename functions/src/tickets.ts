import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

// import type { TicketStatus } from "../../shared/types";
type TicketStatus = 'REPORTADO' | 'REVISION' | 'EN_REPARACION' | 'REPARADO' | 'ENTREGADO';

export const transitionTicketStatus = onCall(async (request) => {
  // 1. Zero-Trust: Validate Auth & Role Custom Claim
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }

  const userRole = request.auth.token.role;
  if (!userRole || !['admin', 'workshop', 'transporter'].includes(userRole as string)) {
    throw new HttpsError("permission-denied", "No tienes permisos para esta acción.");
  }

  const { ticketId, newStatus, comments } = request.data as {
    ticketId: string;
    newStatus: TicketStatus;
    comments?: string;
  };

  if (!ticketId || !newStatus) {
    throw new HttpsError("invalid-argument", "ticketId y newStatus son obligatorios.");
  }

  const db = getFirestore();
  const ticketRef = db.collection("tickets").doc(ticketId);

  try {
    await db.runTransaction(async (transaction) => {
      const ticketDoc = await transaction.get(ticketRef);
      if (!ticketDoc.exists) {
        throw new HttpsError("not-found", "El ticket no existe.");
      }

      const currentStatus = ticketDoc.data()?.status;

      // 2. Update Ticket Document
      transaction.update(ticketRef, {
        status: newStatus,
        "timestamps.updatedAt": Date.now()
      });

      // 3. Register History in subcollection (Estado en el Backend)
      const historyRef = ticketRef.collection("statusHistory").doc();
      transaction.set(historyRef, {
        previousStatus: currentStatus,
        newStatus: newStatus,
        changedBy: {
          uid: request.auth?.uid,
          role: userRole,
        },
        comments: comments || "",
        timestamp: Date.now()
      });
    });

    return { success: true, message: "Ticket actualizado correctamente." };
  } catch (error) {
    console.error("Error transicionando el ticket:", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Error procesando el ticket.");
  }
});

// DEV MOCK LOGIN (Solo para el Emulador) - Emite un JWT con el Custom Claim necesario
export const emulateAdminLogin = onCall(async () => {
  const token = await getAuth().createCustomToken("dev-admin-uid", { role: "admin" });
  return { token };
});
