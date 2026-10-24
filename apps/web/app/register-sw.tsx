"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/pwa/register";

// Registers the PWA service worker in production only (helper handles that).
export default function RegisterSW() {
  useEffect(() => {
    registerServiceWorker();
  }, []);
  return null;
}
