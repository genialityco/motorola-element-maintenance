import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getStorage, connectStorageEmulator } from "firebase/storage";

const firebaseConfig = {
  projectId: "lenovo-experiences", // Usado para emuladores locales sin necesidad de service account
  apiKey: "AIzaSyB0iYSMU7tuWyMw-q5h4VKSgCq5LTZJoM4",
  appId: "1:472633703949:web:c424fcf34b2f983c779f44",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const functions = getFunctions(app);
const auth = getAuth(app);
const storage = getStorage(app);

// Conectar a emuladores locales si estamos en desarrollo
if (process.env.NEXT_PUBLIC_USE_EMULATORS === "true") {
  try {
    connectFirestoreEmulator(db, "127.0.0.1", 8010);
    connectFunctionsEmulator(functions, "127.0.0.1", 5010);
    connectAuthEmulator(auth, "http://127.0.0.1:9099");
    connectStorageEmulator(storage, "127.0.0.1", 9199);
  } catch (e) {
    console.log("Firebase emulators already connected.");
  }
}

export { app, db, functions, auth, storage };
