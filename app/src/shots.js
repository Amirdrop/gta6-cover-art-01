// Fixed scenes for screenshots: ?shot=cover shows the cover alone; ?shot=editor shows the studio page.
// query params: photo (sample base name), layout, grade, caption. Builds a good default cover otherwise.
// `load(sampleUrl, texts, shot)` applies the sample photo and text/layout overrides.
export async function runShot(query, load) {
  const params = query || new URLSearchParams();
  const shot = params.get('shot');

  const texts = {
    title1: params.get('title1') || params.get('title') || 'NEON',
    title2: params.get('title2') || 'COAST',
    kicker: params.get('kicker') || 'PALM BEACH, 1986',
    tagline: params.get('tagline') || 'The sun never sets on the heist.',
    caption: (params.get('caption') || 'HEIST SEASON').toUpperCase(),
    price: '$9.99',
    layout: params.get('layout') || 'hero3',
    grade: params.get('grade') || 'sunset',
    size: params.get('size') || 'portrait',
  };

  const sample = `samples/${params.get('photo') || 'pier'}.jpg`;
  await load(sample, texts, shot);
}