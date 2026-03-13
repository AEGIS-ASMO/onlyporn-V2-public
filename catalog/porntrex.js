const { toCatalog } = require('./utils');
const catalog = require('./porntrex.json');
const segments = [
  'Top Rated',
  'Most Recent',
  'Most Viewed',
];

const catalogs = segments.map(segment => toCatalog(segment, catalog));

module.exports = catalogs;