import { api } from "../runtime";
import type { Playlist } from "./types";

type Response = { playlist?: Playlist; playlists: Playlist[] };

export async function createPlaylist(name: string, trackIds: string[] = []): Promise<Response> {
  return api<Response>("/api/playlists", { body: { name, tracks: trackIds } });
}

export async function addToPlaylist(id: string, trackIds: string[], position?: number): Promise<Response> {
  return api<Response>(`/api/playlists/${id}`, { method: "PUT", body: { add: trackIds, position } });
}

export async function updatePlaylist(id: string, patch: { name?: string; trackIds?: string[] }): Promise<Response> {
  return api<Response>(`/api/playlists/${id}`, { method: "PUT", body: { name: patch.name, tracks: patch.trackIds } });
}

export async function deletePlaylist(id: string): Promise<Response> {
  return api<Response>(`/api/playlists/${id}`, { method: "DELETE" });
}
