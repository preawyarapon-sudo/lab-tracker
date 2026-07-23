import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCWgyRZEXzJXkftXpJSvHTOCPWWnDsE33U",
  authDomain: "planning-with-ai-a162c.firebaseapp.com",
  databaseURL: "https://planning-with-ai-a162c-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "planning-with-ai-a162c",
  storageBucket: "planning-with-ai-a162c.firebasestorage.app",
  messagingSenderId: "137382280837",
  appId: "1:137382280837:web:01d67c8821bc736983b3ec",
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
