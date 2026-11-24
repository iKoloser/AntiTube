"use client";

import { FormEvent, useState } from "react";
import AntiTubeLogo from "../AntiTubeLogo";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";

export default function AccessPage() {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const response = await fetch(`${apiUrl}/api/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key })
      });
      const data = await response.json() as { message?: string };
      if (!response.ok) throw new Error(data.message ?? "No se pudo validar la clave.");
      window.location.href = "/";
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo validar la clave.");
    } finally {
      setIsLoading(false);
    }
  }

  return <main className="auth-page">
    <section className="auth-card" aria-labelledby="access-title">
      <a className="brand auth-brand" href="/" aria-label="AntiTube"><AntiTubeLogo /></a>
      <p className="shazam-kicker">Acceso privado</p>
      <h1 id="access-title">AntiTube</h1>
      <p className="auth-description">Introduce la clave privada para acceder a tu terminal multimedia.</p>
      <form className="auth-form" onSubmit={handleSubmit}>
        <label htmlFor="access-key">Clave de acceso</label>
        <input id="access-key" type="password" autoComplete="current-password" value={key} onChange={(event) => setKey(event.target.value)} required autoFocus />
        <button className="download-button" type="submit" disabled={isLoading}>{isLoading ? "Comprobando…" : "Entrar"}</button>
      </form>
      {error && <p className="notice error" role="alert">ⓘ {error}</p>}
      <p className="auth-note">La clave no se guarda en el navegador. La sesión se mantiene mediante una cookie segura.</p>
    </section>
  </main>;
}
