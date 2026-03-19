const catalog = require('./spankbang.json');

const opt = options => ({
  name: 'genre',
  options
});

// ✅ BASE SORTING (NO SEARCH)
const baseCategories = [
  'Trending',
  'New',
  'Popular',
  'Upcoming'
];

// ✅ 4K FILTER (VALID COMBOS ONLY)
const fourK = [
  '4K (Trending)',
  '4K (New)',
  '4K (Popular)',
  '4K (Upcoming)'
];

// ✅ HIGH DEMAND SEARCH KEYWORDS
const searchGenres = [
  'Milf',
  'Teen',
  'Amateur',
  'Asian',
  'Big Tits',
  'Blonde',
  'Ebony',
  'Latina',
  'Lesbian',
  'Anal',
  'Creampie'
];

// ✅ SEARCH + SORT COMBINATIONS
const searchOptions = [];

const validSorts = ['Trending', 'New', 'Popular'];

for (const genre of searchGenres) {
  // default (no sort = trending)
  searchOptions.push(genre);

  for (const sort of validSorts) {
    searchOptions.push(`${genre} (${sort})`);
  }

  // 🔥 4K variants for search
  searchOptions.push(`${genre} (4K)`);

  for (const sort of validSorts) {
    searchOptions.push(`${genre} (4K ${sort})`);
  }
}

// ✅ FINAL OPTIONS
const options = [
  ...baseCategories,
  ...fourK,
  ...searchOptions
];

catalog.extra.push(opt(options));

module.exports = {
  spankbangCatalogs: [catalog]
};