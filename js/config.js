// Book configuration.
//
// `books` are the readable books, shown face-out on the top shelf (left to right).
// Each uses scans extracted from the public-domain dLib PDFs into /scans/<id>/:
//   cover-front.webp / cover-back.webp       outside of the covers (+ cover-front-small.webp for the shelf)
//   endpaper-front.webp / endpaper-back.webp inside of the covers
//   page-001 ...                             the pages; page-001 is the first right-hand page
// Keep pageWidth / pageHeight in the same ratio as the scans.
// `chapters` are [title, printed page number] and become marks on the page slider.
export const CONFIG = {
  books: [
    {
      id: 'ciciban1915',
      title: 'Ciciban in še kaj',
      subtitle: '1915',
      spineTitle: 'CICIBAN',
      author: 'Oton Župančič',
      color: '#b3a37f',       // cloth colour of the binding (spine, board edges)
      spineInk: '#3b2a1c',    // lettering on the spine
      pageWidth: 0.16,        // meters
      pageHeight: 0.189,      // 0.16 * 780 / 660 (scan ratio)
      thickness: 0.008,       // 28 sheets of thick paper
      pages: { pattern: 'scans/ciciban/page-{###}.webp', count: 56, start: 1 },
      // from the book's own contents page ("Kje je kaj")
      chapters: [
        ['Veseli koledniki', 5], ['Žalostni koledniki', 6], ['Častitljivi koledniki', 7], ['Dedek Samonog', 8],
        ['Otroci spuščajo mehurčke', 9], ['Postovka', 10], ['Kadar se Ciciban joče', 11], ['Ples kralja Matjaža', 12],
        ['Vrabci in strašilo', 13], ['Kroparji', 15], ['Zvonovi', 16], ['Žabe', 17], ['Uspavanka', 19],
        ['Breza in hrast', 20], ['Pastirčki', 22], ['Zeleni Jurij', 23], ['Pomladna ladja', 25],
        ['Ciciban in čebela', 28], ['Povabilo', 32], ['Medved z medom', 33], ['Lenka', 35],
        ['Zlato v Blatni vasi', 36], ['Zvezdoznanstvo', 38], ['Mehurčki', 40], ['Uspavanka', 42],
        ['Ciciban — Cicifuj', 43], ['Turek', 45], ['Ciciban posluša očetovo uro', 46], ['Naše luči', 48],
        ['Ciciban zaspi', 51], ['Pomni!', 52], ['Kje je kaj', 54],
      ],
      cover: {
        front: 'scans/ciciban/cover-front.webp',
        shelf: 'scans/ciciban/cover-front-small.webp',  // small version for the shelf (loads first)
        back: 'scans/ciciban/cover-back.webp',
        endpaperFront: 'scans/ciciban/endpaper-front.webp',
        endpaperBack: 'scans/ciciban/endpaper-back.webp',
      },
    },
    {
      id: 'ciciban1932',
      title: 'Ciciban',
      subtitle: '1932, ilustriral Nikolaj Pirnat',
      spineTitle: 'CICIBAN',
      author: 'Oton Župančič',
      color: '#d4b25e',
      spineInk: '#27336e',
      pageWidth: 0.2,
      pageHeight: 0.24,       // 0.2 * 1400 / 1167
      thickness: 0.012,       // 40 sheets
      pages: { pattern: 'scans/ciciban1932/page-{###}.webp', count: 80, start: 1 },
      // poem titles as printed in the book (from the PDF text layer)
      chapters: [
        ['Veseli koledniki', 5], ['Žalostni koledniki', 7], ['Častitljivi koledniki', 9], ['Dedek Samonog', 11],
        ['Otroci spuščajo mehurčke', 13], ['Postovka', 15], ['Kadar se Ciciban joče', 17], ['Ples kralja Matjaža', 19],
        ['Vrabci in strašilo', 21], ['Lisica', 23], ['Kroparji', 25], ['Zvonovi', 27], ['Žabe', 28],
        ['Uspavanka', 31], ['Pismo', 33], ['Breza in hrast', 35], ['Pastirčki', 37], ['Zeleni Jurij', 39],
        ['Pomladna ladja', 41], ['Ciciban in čebela', 43], ['Povabilo', 45], ['Medved z medom', 46],
        ['Stari medo', 51], ['Lenka', 52], ['Zlato v Blatni vasi', 54], ['Zvezdoznanstvo', 61], ['Mehurčki', 63],
        ['Uspavanka', 65], ['Veverica', 67], ['Ciciban — Cicifuj', 69], ['Turek', 71],
        ['Ciciban posluša očetovo uro', 73], ['Naše luči', 75], ['Ciciban zaspi', 77], ['Slovo', 79],
      ],
      cover: {
        front: 'scans/ciciban1932/cover-front.webp',
        shelf: 'scans/ciciban1932/cover-front-small.webp',  // small version for the shelf (loads first)
        back: 'scans/ciciban1932/cover-back.webp',
        endpaperFront: 'scans/ciciban1932/endpaper-front.webp',
        endpaperBack: 'scans/ciciban1932/endpaper-back.webp',
      },
    },
    {
      id: 'rokopis',
      title: 'Ciciban — rokopis',
      subtitle: 'avtorjev rokopis',
      spineTitle: 'ROKOPIS',
      author: 'Oton Župančič',
      color: '#c9b48a',
      spineInk: '#4a3a2a',
      pageWidth: 0.17,
      pageHeight: 0.211,      // 0.17 * 1400 / 1128 (cropped sheet ratio)
      thickness: 0.007,       // 24 hand-written sheets
      pages: { pattern: 'scans/rokopis/page-{###}.webp', count: 48, start: 1 },
      chapters: [],
      cover: {
        front: 'scans/rokopis/cover-front.webp',
        shelf: 'scans/rokopis/cover-front-small.webp',  // small version for the shelf (loads first)
        back: 'scans/rokopis/cover-back.webp',
        endpaperFront: 'scans/rokopis/endpaper-front.webp',
        endpaperBack: 'scans/rokopis/endpaper-back.webp',
      },
    },
  ],
  onlyFeatured: true,       // other books on the shelf are decoration; tapping them points to the readable ones
  sound: true,
  // Real recordings (mp3/ogg/wav). Several files per event = random variation.
  // Missing files are skipped and a synthesized sound is used instead.
  sounds: {
    lift: ['sounds/page-lift-1.mp3', 'sounds/page-lift-2.mp3', 'sounds/page-lift-3.mp3'],
    land: ['sounds/page-land-1.mp3', 'sounds/page-land-2.mp3', 'sounds/page-land-3.mp3'],
    slide: ['sounds/book-slide.mp3'],
    thud: ['sounds/book-close.mp3'],
    tick: [],
  },
  kiosk: {
    idleSeconds: 90,        // put the book back on the shelf after this long without a touch
    rememberPage: false,    // false = every visitor starts from the cover
    hideCursor: false,      // true on a touch-only kiosk
  },
};
