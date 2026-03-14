const { toCatalog } = require('./utils');
const catalog = require('./porntrex.json');
const segments = [
  'latest-updates',
  'top-rated',
  'most-popular'
];

const catalogs = segments.map(segment => toCatalog(segment, catalog));

module.exports = catalogs;