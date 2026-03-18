const catalog = require('./spankbang.json');

const genres = [
  'All',
  '4k',
  '1080p',
  '720p',
  'milf',
  'teen',
  'amateur',
  'japanese',
  'asian',
  'big tits',
  'creampie'
];

const sorts = ['trending', 'popular', 'new', 'featured'];

const qualities = ['4k', '1080p', '720p'];

catalog.extra = [
  { name: 'search' },
  { name: 'genre', options: genres },
  { name: 'sort', options: sorts },
  { name: 'quality', options: qualities },
  { name: 'skip' }
];

module.exports = {
  spankbangCatalogs: [catalog]
};