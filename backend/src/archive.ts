import { ZipArchive } from "archiver";
import { createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Empaqueta los archivos ya descargados en un único ZIP para que una playlist
 * se pueda guardar con un solo clic.
 */
function safeArchiveStem(value: string | null | undefined): string {
  const cleaned = (value ?? "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 120);
  return cleaned || "Playlist AntiTube";
}

export async function createPlaylistArchive(directory: string, filenames: string[], playlistTitle?: string | null): Promise<string> {
  const resolvedDirectory = path.resolve(directory);
  const archiveFilename = `${safeArchiveStem(playlistTitle)}.zip`;
  const archivePath = path.join(resolvedDirectory, archiveFilename);

  for (const filename of filenames) {
    const resolvedFile = path.resolve(resolvedDirectory, filename);
    if (!resolvedFile.startsWith(`${resolvedDirectory}${path.sep}`)) {
      throw new Error("La ruta de un archivo de playlist no es válida.");
    }
    await stat(resolvedFile);
  }

  let finalArchiveFilename = archiveFilename;
  let finalArchivePath = archivePath;
  try {
    await stat(finalArchivePath);
    const suffix = randomUUID().slice(0, 8);
    finalArchiveFilename = `${safeArchiveStem(playlistTitle)} (${suffix}).zip`;
    finalArchivePath = path.join(resolvedDirectory, finalArchiveFilename);
  } catch {
    // El nombre principal está libre.
  }

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(finalArchivePath);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    output.on("close", () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    output.on("error", fail);
    archive.on("error", fail);
    archive.pipe(output);

    for (const filename of filenames) {
      archive.file(path.join(resolvedDirectory, filename), { name: filename });
    }

    void archive.finalize().catch(fail);
  });

  return finalArchiveFilename;
}
