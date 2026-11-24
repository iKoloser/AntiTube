"use client";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";

export default function LogoutButton() {
  async function handleLogout() {
    await fetch(`${apiUrl}/api/auth/logout`, { method: "POST", credentials: "include" });
    window.location.href = "/acceso";
  }

  return <button className="logout-button" type="button" onClick={() => void handleLogout()}>Salir</button>;
}
