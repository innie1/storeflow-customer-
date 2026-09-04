/** Guesses a product's packaging shape from its name/category/unit, so a
 *  catalog with no photographs still gets a meaningful icon per item. */

export function getProductCategoryType(name: string = '', category: string = '', unit: string = ''): 'bottle' | 'box' | 'sachet' | 'can' | 'fresh' | 'service' | 'general' {
  const text = (name + ' ' + category + ' ' + unit).toLowerCase();

  if (
    text.includes('bottle') || text.includes('drink') || text.includes('water') ||
    text.includes('juice') || text.includes('soda') || text.includes('syrup') ||
    text.includes('wine') || text.includes('beer') || text.includes('beverage') ||
    text.includes('oil') || text.includes('liquid') || text.includes('liter') ||
    text.includes('cl') || text.includes('ml') || text.includes('spirit') ||
    text.includes('coke') || text.includes('fanta') || text.includes('sprite') ||
    text.includes('pepsi') || text.includes('zobo') || text.includes('kunu')
  ) {
    return 'bottle';
  }

  if (
    text.includes('sachet') || text.includes('pouch') || text.includes('maggi') ||
    text.includes('knorr') || text.includes('seasoning') || text.includes('tea') ||
    text.includes('coffee') || text.includes('powder') || text.includes('spice') ||
    text.includes('detergent') || text.includes('soap') || text.includes('salt') ||
    text.includes('sugar') || text.includes('biscuit') || text.includes('snack') ||
    text.includes('chips') || text.includes('noodle') || text.includes('indomie') ||
    text.includes('sweet') || text.includes('candy') || text.includes('gummy')
  ) {
    return 'sachet';
  }

  if (
    text.includes('can') || text.includes('tin') || text.includes('tomato') ||
    text.includes('paste') || text.includes('sardine') || text.includes('tuna') ||
    text.includes('corned beef') || text.includes('milo') || text.includes('bournvita') ||
    text.includes('red bull') || text.includes('monster')
  ) {
    return 'can';
  }

  if (
    text.includes('box') || text.includes('carton') || text.includes('cereal') ||
    text.includes('cornflakes') || text.includes('oats') || text.includes('custard') ||
    text.includes('rice') || text.includes('flour') || text.includes('semovita') ||
    text.includes('garri') || text.includes('spaghetti') || text.includes('pasta') ||
    text.includes('tissue') || text.includes('diaper') || text.includes('pad') ||
    text.includes('pack')
  ) {
    return 'box';
  }

  if (
    text.includes('fresh') || text.includes('bread') || text.includes('cake') ||
    text.includes('apple') || text.includes('fruit') || text.includes('veg') ||
    text.includes('meat') || text.includes('chicken') || text.includes('fish') ||
    text.includes('egg') || text.includes('yam') || text.includes('plantain') ||
    text.includes('banana') || text.includes('orange')
  ) {
    return 'fresh';
  }

  if (text.includes('service') || text.includes('wash') || text.includes('laundry') || text.includes('clean')) {
    return 'service';
  }

  return 'general';
}
