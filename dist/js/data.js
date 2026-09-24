// Temporary, real stock photography. These are deliberately kept as URLs so
// the actual client photos can replace them from /admin without a code change.
const stock = {
  hero: { url: 'https://images.pexels.com/photos/17746098/pexels-photo-17746098.jpeg?auto=compress&cs=tinysrgb&w=1000', alt: 'Model with long, defined curly hair' },
  curls: { url: 'https://images.pexels.com/photos/17746098/pexels-photo-17746098.jpeg?auto=compress&cs=tinysrgb&w=1000', alt: 'Model with long, defined curly hair' },
  editorial: { url: 'https://images.pexels.com/photos/20837529/pexels-photo-20837529.jpeg?auto=compress&cs=tinysrgb&w=1000', alt: 'Studio portrait with long curly hair' },
  natural: { url: 'https://images.pexels.com/photos/18746039/pexels-photo-18746039.jpeg?auto=compress&cs=tinysrgb&w=1000', alt: 'Woman with textured curly hair outdoors' },
  straight: { url: 'https://images.pexels.com/photos/17291688/pexels-photo-17291688.jpeg?auto=compress&cs=tinysrgb&w=1000', alt: 'Black woman with long sleek hair in a studio portrait' },
  wave: { url: 'https://images.pexels.com/photos/2269878/pexels-photo-2269878.jpeg?auto=compress&cs=tinysrgb&w=1000', alt: 'Black woman with long dark hair in a studio portrait' },
  studio: { url: 'https://images.pexels.com/photos/11292329/pexels-photo-11292329.jpeg?auto=compress&cs=tinysrgb&w=1000', alt: 'Black woman with long hair in a lifestyle portrait' },
};

const photos = (...items) => items.map((item) => ({ ...item, focalPoint: { x: 50, y: 50 } }));

export const categories = [
  { id: 'wigs', label: 'Wigs', detail: 'Ready-to-wear confidence.' },
  { id: 'bundles', label: 'Bundles', detail: 'Choose your texture and length.' },
  { id: 'extensions', label: 'Extensions', detail: 'Add length without the commitment.' },
  { id: 'accessories', label: 'Accessories', detail: 'The finishing details.' },
];

export const products = [
  { id: 'silk-straight', name: 'Silk Straight', category: 'wigs', type: 'HD lace wig', price: 1280, images: photos(stock.straight, stock.editorial), description: 'A low-lustre straight texture for a clean everyday finish.', tags: ['Straight', 'HD lace'], details: ['Natural black', 'HD lace construction', 'Straight texture'], variants: ['18 inches', '22 inches', '26 inches'] },
  { id: 'body-wave', name: 'Body Wave', category: 'bundles', type: 'Raw hair bundle', price: 620, images: photos(stock.wave, stock.editorial), description: 'Soft, touchable volume with a loose wave that styles easily.', tags: ['Body wave'], details: ['100g per bundle', 'Low to medium lustre', 'Body-wave texture'], variants: ['16 inches', '20 inches', '24 inches'] },
  { id: 'deep-wave', name: 'Deep Wave', category: 'bundles', type: 'Raw hair bundle', price: 680, images: photos(stock.curls, stock.natural), description: 'Defined texture with a full, softly dramatic profile.', tags: ['Deep wave'], details: ['100g per bundle', 'Defined wave texture', 'Heat style with care'], variants: ['18 inches', '22 inches', '26 inches'] },
  { id: 'water-wave', name: 'Water Wave', category: 'wigs', type: 'HD lace wig', price: 1480, images: photos(stock.hero, stock.editorial), description: 'Fluid, dimensional texture with easy day-to-night movement.', tags: ['Water wave', 'HD lace'], details: ['Natural black', 'HD lace construction', 'Water-wave texture'], variants: ['18 inches', '22 inches', '26 inches'] },
  { id: 'deep-curly', name: 'Deep Curly', category: 'wigs', type: 'HD lace wig', price: 1520, images: photos(stock.curls, stock.natural), description: 'Rich curl definition for an intentionally full silhouette.', tags: ['Curly', 'HD lace'], details: ['Natural black', 'HD lace construction', 'Deep-curly texture'], variants: ['18 inches', '22 inches', '26 inches'] },
  { id: 'loose-wave', name: 'Loose Wave', category: 'extensions', type: 'Clip-in extensions', price: 720, images: photos(stock.studio, stock.wave), description: 'Relaxed volume and length when you want a different look.', tags: ['Loose wave', 'Clip-in'], details: ['7-piece set', 'Natural black', 'Loose-wave texture'], variants: ['16 inches', '20 inches', '24 inches'] },
  { id: 'lace-melt-band', name: 'Lace Melt Band', category: 'accessories', type: 'Finishing accessory', price: 95, images: photos(stock.curls), description: 'A reusable band for a neater lace finish.', details: ['Breathable stretch', 'Reusable', 'One size'], variants: ['Black'] },
].map((product) => ({ ...product, image: product.images[0].url, alt: product.images[0].alt }));

export const editorialImages = stock;
