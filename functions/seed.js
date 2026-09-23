/**
 * One-off starter catalog seed. The temporary stock images are real photos;
 * replace them from /admin before production use.
 *
 * Emulator: firebase emulators:exec --only firestore "node seed.js"
 */
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

const stock = {
  hero: { url: 'https://images.pexels.com/photos/17746098/pexels-photo-17746098.jpeg?auto=compress&cs=tinysrgb&w=1000', alt: 'Model with long, defined curly hair' },
  curls: { url: 'https://images.pexels.com/photos/17746098/pexels-photo-17746098.jpeg?auto=compress&cs=tinysrgb&w=1000', alt: 'Model with long, defined curly hair' },
  editorial: { url: 'https://images.pexels.com/photos/20837529/pexels-photo-20837529.jpeg?auto=compress&cs=tinysrgb&w=1000', alt: 'Studio portrait with long curly hair' },
  natural: { url: 'https://images.pexels.com/photos/18746039/pexels-photo-18746039.jpeg?auto=compress&cs=tinysrgb&w=1000', alt: 'Woman with textured curly hair outdoors' },
  straight: { url: 'https://images.pexels.com/photos/17291688/pexels-photo-17291688.jpeg?auto=compress&cs=tinysrgb&w=1000', alt: 'Black woman with long sleek hair in a studio portrait' },
  wave: { url: 'https://images.pexels.com/photos/2269878/pexels-photo-2269878.jpeg?auto=compress&cs=tinysrgb&w=1000', alt: 'Black woman with long dark hair in a studio portrait' },
  studio: { url: 'https://images.pexels.com/photos/11292329/pexels-photo-11292329.jpeg?auto=compress&cs=tinysrgb&w=1000', alt: 'Black woman with long hair in a lifestyle portrait' },
};
const gallery = (...images) => images.map((image) => ({ ...image, focalPoint: { x: 50, y: 50 } }));
// [id, name, category, type, price, wholesalePrice, images, variants, details]
const source = [
  ['silk-straight', 'Silk Straight', 'wigs', 'HD lace wig', 1280, 1020, gallery(stock.straight, stock.editorial), ['18 inches', '22 inches', '26 inches'], ['Natural black', 'HD lace construction', 'Straight texture']],
  ['body-wave', 'Body Wave', 'bundles', 'Raw hair bundle', 620, 500, gallery(stock.wave, stock.editorial), ['16 inches', '20 inches', '24 inches'], ['100g per bundle', 'Low to medium lustre', 'Body-wave texture']],
  ['deep-wave', 'Deep Wave', 'bundles', 'Raw hair bundle', 680, 540, gallery(stock.curls, stock.natural), ['18 inches', '22 inches', '26 inches'], ['100g per bundle', 'Defined wave texture', 'Heat style with care']],
  ['water-wave', 'Water Wave', 'wigs', 'HD lace wig', 1480, 1180, gallery(stock.hero, stock.editorial), ['18 inches', '22 inches', '26 inches'], ['Natural black', 'HD lace construction', 'Water-wave texture']],
  ['deep-curly', 'Deep Curly', 'wigs', 'HD lace wig', 1520, 1210, gallery(stock.curls, stock.natural), ['18 inches', '22 inches', '26 inches'], ['Natural black', 'HD lace construction', 'Deep-curly texture']],
  ['loose-wave', 'Loose Wave', 'extensions', 'Clip-in extensions', 720, 580, gallery(stock.studio, stock.wave), ['16 inches', '20 inches', '24 inches'], ['7-piece set', 'Natural black', 'Loose-wave texture']],
  ['lace-melt-band', 'Lace Melt Band', 'accessories', 'Finishing accessory', 95, 75, gallery(stock.curls), ['Black'], ['Breathable stretch', 'Reusable', 'One size']],
];

const DEFAULT_STOCK = 20;
const DEFAULT_MIN_WHOLESALE_QTY = 3;

const variantId = (label) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
async function seed() {
  const batch = db.batch();
  for (const [id, name, category, type, price, wholesalePrice, images, variants, details] of source) {
    batch.set(db.collection('products').doc(id), {
      slug: id,
      name,
      category,
      type,
      price,
      wholesalePrice,
      minWholesaleQty: DEFAULT_MIN_WHOLESALE_QTY,
      currency: 'GHS',
      description: `A Nakuadiary ${name.toLowerCase()} piece, designed for easy everyday wear.`,
      details,
      image: images[0],
      images,
      variants: variants.map((label) => ({ id: variantId(label), label, available: true, stock: DEFAULT_STOCK })),
      badges: [],
      featured: ['silk-straight', 'body-wave', 'deep-curly'].includes(id),
      active: true,
      inventoryPolicy: 'deny',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  console.log(`Seeded ${source.length} starter products.`);
}
seed().catch((error) => { console.error('Seed failed:', error); process.exit(1); });
