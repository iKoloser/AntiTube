/** Puente entre la paleta de comandos y la caja de búsqueda de la página Descargar. */
export const pendingOmniboxKey = "antitube-pending-omnibox";

/** Lanza una búsqueda o abre un enlace en la página Descargar, esté donde esté el usuario. */
export function sendToOmnibox(value: string, navigate: (href: string) => void, onHome: boolean): void {
  if (onHome) {
    window.dispatchEvent(new CustomEvent("antitube-omnibox", { detail: value }));
    return;
  }
  sessionStorage.setItem(pendingOmniboxKey, value);
  navigate("/");
}
