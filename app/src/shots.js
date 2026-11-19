// Fixed scenes for screenshots: ?shot=cover shows the cover alone; ?shot=editor shows the studio page.
// query params: photo (sample base name), layout, grade, caption. Builds a good default cover otherwise.
// `load(sampleUrl, texts, shot)` applies the sample photo and text/layout overrides.
export async function runShot(query, load) {
  const params = query || new URLSearchParams();
  const shot = params.get('shot');

  const texts = {
    title1: params.get('title1') || 'VICE',
    title2: params.get('title2') || 'CITY',
    tagline: 'The sun never sets on the heist.',
    caption: (params.get('caption') || 'SUNSET HEIST').toUpperCase(),
    price: '$59.99',
    layout: params.get('layout') || 'hero3',
    grade: params.get('grade') || 'sunset',
  };

  const sample = `samples/${params.get('photo') || 'pier'}.jpg`;
  await load(sample, texts, shot);
}