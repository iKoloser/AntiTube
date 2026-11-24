const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "frontend", ".next", "standalone");

async function removeForeignSharpBinaries(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name.includes("sharp-") && !entry.name.includes("win32-x64")) {
      await fs.rm(target, { recursive: true, force: true });
      continue;
    }
    if (entry.isDirectory()) await removeForeignSharpBinaries(target);
  }
}

async function materializeSymlinks(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const link = await fs.readlink(target);
      let source;
      try {
        source = await fs.realpath(path.resolve(directory, link));
      } catch (error) {
        if (error.code === "ENOENT") {
          // Es un binario opcional de otra plataforma eliminado en el paso
          // anterior; no debe formar parte del bundle de Windows.
          await fs.rm(target, { force: true });
          continue;
        }
        throw error;
      }
      await fs.rm(target, { recursive: true, force: true });
      // Copia el paquete sin seguir los enlaces internos; esos enlaces se
      // materializan en la siguiente recursión, evitando expandir ciclos de
      // node_modules de pnpm hasta ocupar cientos de MB.
      await fs.cp(source, target, { recursive: true, dereference: false, force: true });
      const copied = await fs.lstat(target);
      if (copied.isDirectory()) await materializeSymlinks(target);
      continue;
    }
    if (entry.isDirectory()) await materializeSymlinks(target);
  }
}

async function bridgeHoistedDependencies() {
  const hoisted = path.join(root, "node_modules", ".pnpm", "node_modules");
  const frontendModules = path.join(root, "frontend", "node_modules");
  await fs.mkdir(frontendModules, { recursive: true });
  for (const entry of await fs.readdir(hoisted, { withFileTypes: true })) {
    const source = path.join(hoisted, entry.name);
    const target = path.join(frontendModules, entry.name);
    if (await fs.stat(target).then(() => true).catch(() => false)) continue;
    await fs.cp(source, target, { recursive: true, dereference: false, force: true });
  }
}

removeForeignSharpBinaries(root)
  .then(() => materializeSymlinks(root))
  .then(() => bridgeHoistedDependencies())
  .catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
