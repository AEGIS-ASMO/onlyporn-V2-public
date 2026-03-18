const catalog = require('./spankbang.json');

const sortBy = [
  'New',
  'Trending',
  'Popular',
  'Upcoming'
];

// 🔥 Genre dropdown
const genres = [
  'Amateur',
  'Students',
  'Japanese',
  'Asian Porn',
  'Big Tits',
  'Teens',
  'Family',
  'Creampie',
  'Small Tits',
  'Uncategorized'
];

// 🔥 Quality dropdown (NEW)
const qualities = [
  '4k',
  '1080p',
  '720p'
];

// 🔥 Build genre + sort combinations
const genreOptions = [];

for (const sort of sortBy) {
  genreOptions.push(sort); // global categories
}

for (const genre of genres) {
  for (const sort of sortBy) {
    genreOptions.push(`${genre} (${sort})`);
  }
}

// 🔥 Replace extras CLEANLY (not push)
catalog.extra = [
  { name: 'search' },
  { name: 'skip' },
  {
    name: 'genre',
    options: genreOptions
  },
  {
    name: 'quality',
    options: qualities
  }
];

module.exports = {
  sortBy,
  spankbangCatalogs: [catalog]
};