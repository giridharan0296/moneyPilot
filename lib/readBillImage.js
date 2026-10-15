// ----------------------------------------------------------------------------
// readBillImage — get a store bill photo from the camera or the photo library.
//
//   pickBillImage('camera' | 'library')
//     → { cancelled: true }
//     → { cancelled: false, base64, mimeType }
//     → { cancelled: false, error: 'camera-denied' }
//
// Asks for base64 directly, so no second file read is needed. Quality is
// lowered to keep the upload small; a bill stays readable at this size.
// ----------------------------------------------------------------------------

import * as ImagePicker from 'expo-image-picker';

const PICK_OPTIONS = {
  mediaTypes: ['images'],
  allowsEditing: false,
  base64: true,
  quality: 0.6,
  exif: false,
};

export async function pickBillImage(source = 'library') {
  let result;
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { cancelled: false, error: 'camera-denied' };
    result = await ImagePicker.launchCameraAsync(PICK_OPTIONS);
  } else {
    result = await ImagePicker.launchImageLibraryAsync(PICK_OPTIONS);
  }

  if (result.canceled) return { cancelled: true };
  const asset = result.assets?.[0];
  if (!asset?.base64) return { cancelled: false, error: 'unreadable' };
  return {
    cancelled: false,
    base64: asset.base64,
    mimeType: asset.mimeType || 'image/jpeg',
    uri: asset.uri,
  };
}

/**
 * Pick up to `max` photos from the library in one go. Returns
 *   { cancelled: true } | { cancelled: false, images: [{ base64, mimeType, name }] }
 * Photos without base64 data are dropped. Some pickers ignore selectionLimit,
 * so the caller must check the count against `max` itself.
 */
export async function pickBillImages(max = 2) {
  const result = await ImagePicker.launchImageLibraryAsync({
    ...PICK_OPTIONS,
    allowsMultipleSelection: true,
    selectionLimit: max,
  });
  if (result.canceled) return { cancelled: true };
  // Not truncated here: the caller rejects a pick over the limit instead of
  // silently keeping some of the photos.
  const images = (result.assets || [])
    .filter((a) => a.base64)
    .map((a) => ({
      base64: a.base64,
      uri: a.uri,
      mimeType: a.mimeType || 'image/jpeg',
      name: a.fileName || 'receipt.jpg',
      size: a.fileSize ?? a.base64.length * 0.75,
    }));
  return { cancelled: false, images };
}
