/** Decode actual output pixels; a PNG extension or alpha channel alone doesn't prove a cutout. */
export async function validateConcept(url: string): Promise<{ valid: boolean; message: string }> {
  const image = new Image();
  image.src = url;
  await image.decode();
  if (image.naturalWidth !== 1024 || image.naturalHeight !== 1024) return { valid: false, message: `Needs 1024 × 1024 (got ${image.naturalWidth} × ${image.naturalHeight})` };
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 1024;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not inspect concept transparency');
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, 1024, 1024).data;
  let transparent = false, visible = false;
  for (let i = 3; i < pixels.length; i += 4) { transparent ||= pixels[i] === 0; visible ||= pixels[i] > 0; if (transparent && visible) break; }
  if (!transparent || !visible) return { valid: false, message: !visible ? 'The image is empty' : 'Needs real transparency; this background is opaque' };
  return { valid: true, message: '1024 × 1024 · real transparency checked. Inspect the A-pose before Tripo.' };
}
