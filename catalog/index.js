const shuffle = require('fisher-yates');
const porntrexCatalogs = require('./porntrex');
const { spankbangCatalogs } = require('./spankbang');
const xhamsterCatalogs = require('./xhamster');
const { catalogs: epornerCatalogs } = require('./eporner');
const xvideosCatalog = require('./xvideos.json');
const { catalogs: sxyprnCatalogs } = require('./sxyprn');

function randomize(catalogs) {
  const arr = catalogs.map((_e, i) => i);
  return shuffle(arr).map(i => catalogs[i]);
}

const catalogNames = [
  'spankbang',
  'xhamster',
  'eporner',
  'porntrex',
  'xvideos',
  'sxyprn'
];

const catalogs = [
  ...epornerCatalogs,
  ...xhamsterCatalogs,
  ...porntrexCatalogs,
  ...spankbangCatalogs,
  ...sxyprnCatalogs,
  xvideosCatalog
];

const addonEnabled = (id) => {
  return getActiveProvider(id) !== null;
}

const getActiveProvider = (id) => {
  for (const name of catalogNames) {
    if (id.includes(name)) {
      return name;
    }
  }
  return null;
}

module.exports = {
  catalogs,
  catalogNames,
  addonEnabled,
  getActiveProvider
};