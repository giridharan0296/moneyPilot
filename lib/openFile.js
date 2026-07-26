// ----------------------------------------------------------------------------
// openFile — cross-platform "pick a file and read its contents" helper.
//
// This is the DEFAULT (native) implementation. It uses expo-document-picker
// to launch the OS file browser and expo-file-system to read the picked
// file. The web override lives at `openFile.web.js` and uses a hidden
// <input type="file"> + FileReader.
//
// Two-tier interface:
//
//   pickFile({ mimeTypes })      → { cancelled, name, readText(), readBase64() }
//     - Returns metadata + LAZY readers. Callers inspect `name` first (e.g.
//       to detect xlsx vs csv), then decide how to decode. This avoids
//       double-picking on platforms where reading is destructive.
//
//   pickTextFile({ mimeTypes })  → { cancelled, name, text }
//   pickBinaryFile({ mimeTypes }) → { cancelled, name, base64 }
//     - Thin convenience wrappers over pickFile for the common cases.
// ----------------------------------------------------------------------------

import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';

export async function pickFile({ mimeTypes = ['*/*'] } = {}) {
  const picked = await DocumentPicker.getDocumentAsync({
    type: mimeTypes,
    copyToCacheDirectory: true,
  });
  if (picked.canceled) return { cancelled: true };
  const asset = picked.assets[0];
  return {
    cancelled: false,
    name: asset.name,
    // Native ships the URI too — needed by libraries like
    // expo-pdf-text-extract that read directly from a file URI instead
    // of a base64 blob. Web equivalent is a `blob:` URL synthesized by
    // URL.createObjectURL in openFile.web.js.
    uri: asset.uri,
    readText:   () => FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.UTF8 }),
    readBase64: () => FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 }),
  };
}

export async function pickTextFile(opts) {
  const p = await pickFile(opts);
  if (p.cancelled) return { cancelled: true };
  return { cancelled: false, name: p.name, text: await p.readText() };
}

export async function pickBinaryFile(opts) {
  const p = await pickFile(opts);
  if (p.cancelled) return { cancelled: true };
  return { cancelled: false, name: p.name, base64: await p.readBase64() };
}
