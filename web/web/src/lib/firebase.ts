import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { getAuth, connectAuthEmulator } from "firebase/auth";

const firebaseConfig = {
  projectId: "demo-test", // Usado para emuladores locales sin necesidad de service account
  apiKey: "fake-api-key",
  appId: "fake-app-id",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const functions = getFunctions(app);
const auth = getAuth(app);

// Conectar a emuladores locales si estamos en desarrollo
if (process.env.NODE_ENV === "development") {
  try {
    connectFirestoreEmulator(db, "127.0.0.1", 8010);
    connectFunctionsEmulator(functions, "127.0.0.1", 5010);
    connectAuthEmulator(auth, "http://127.0.0.1:9099");
  } catch (e) {
    console.log("Firebase emulators already connected.");
  }
}

export { app, db, functions, auth };