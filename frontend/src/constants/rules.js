export const LOGO_SRC = '/legalmetrix-logo.svg';

export const MAX_PHOTOS = 8;
export const HISTORY_STORAGE_KEY = 'legalmetrix-history';
export const MAX_HISTORY_ITEMS = 12;

export const RULE_TITLES = [
  ['LM-01', 'manufacturerIdentity', 'Manufacturer / packer / importer name'],
  ['LM-02', 'completeAddress', 'Complete manufacturer / packer / importer address'],
  ['LM-03', 'actualBusinessName', 'Actual corporate / business name identifiable'],
  ['LM-04', 'origin', 'Country of origin (where applicable)'],
  ['LM-05', 'commodity', 'Common / generic name of commodity'],
  ['LM-06', 'multiProductDetails', 'Name + number/quantity of each product where package has multiple products'],
  ['LM-07', 'quantity', 'Net quantity in standard unit / number'],
  ['LM-08', 'manufactureDate', 'Month and year of manufacture / packing / applicable date declaration'],
  ['LM-09', 'bestBefore', 'Best before / use by date where applicable'],
  ['LM-10', 'mrp', 'Maximum Retail Price (MRP) / retail sale price'],
  ['LM-11', 'mrpInclusiveTaxes', 'MRP stated inclusive of all taxes'],
  ['LM-12', 'unitSalePrice', 'Unit sale price in prescribed unit where applicable'],
  ['LM-13', 'consumerCare', 'Consumer care contact: name/address/phone/email'],
  ['LM-14', 'dimensions', 'Dimensions where dimensions are relevant'],
  ['LM-15', 'quantityUnits', 'Quantity uses an appropriate standard unit / number'],
  ['LM-16', 'quantityMisleadingWords', 'No misleading quantity wording detected'],
  ['LM-17', 'language', 'Mandatory declarations in Hindi (Devanagari) or English'],
  ['LM-18', 'visualManner', 'Legible, prominent and prescribed presentation'],
  ['LM-19', 'principalDisplayPanel', 'Required declarations appear on principal display panel'],
  ['LM-20', 'contrast', 'MRP and net quantity numerals contrast with background'],
  ['LM-21', 'quantitySpacing', 'Required clear space around quantity declaration'],
  ['LM-22', 'outerWrapper', 'Outer wrapper/container carries required declarations where applicable'],
];

export const INITIAL_CHECKS = RULE_TITLES.map(([ruleId, key, title]) => ({
  ruleId,
  key,
  title,
  status: 'REVIEW',
  evidence: null,
  message: 'Waiting for AI scan.',
}));
