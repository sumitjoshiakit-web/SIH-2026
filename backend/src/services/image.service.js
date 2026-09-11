import sharp from 'sharp';

const MAX_PREPARED_IMAGE_BYTES = 3.2 * 1024 * 1024;

export async function prepareImage(file) {
  let buffer = await sharp(file.buffer, { failOn: 'none' })
    .rotate()
    .resize({
      width: 2400,
      height: 2400,
      fit: 'inside',
      withoutEnlargement: false,
    })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();

  if (buffer.length > MAX_PREPARED_IMAGE_BYTES) {
    buffer = await sharp(file.buffer, { failOn: 'none' })
      .rotate()
      .resize({
        width: 2000,
        height: 2000,
        fit: 'inside',
        withoutEnlargement: false,
      })
      .jpeg({ quality: 78, mozjpeg: true })
      .toBuffer();
  }

  return {
    mimeType: 'image/jpeg',
    buffer,
  };
}
