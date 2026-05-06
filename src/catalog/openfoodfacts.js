'use strict'

/**
 * Open Food Facts – free, open database of food products worldwide.
 * Reference: https://wiki.openfoodfacts.org/API
 *
 * No credentials required. CORS-enabled.
 *
 * Key endpoints:
 *  - /cgi/search.pl?search_terms=…&json=1 – product search
 *  - /product/{barcode}.json – single product by barcode
 *  - /category/{category}.json – products by category
 *
 * Response notes:
 *  - Search and category endpoints wrap in `{products: [...]}` (not in UNWRAP_KEYS).
 *  - Single product endpoint returns `{product: {…}, status: 1}`.
 */
module.exports = {
  name: 'openfoodfacts',
  label: 'Open Food Facts (REST)',
  description: 'Free, open database of food products worldwide with ingredients, nutrition facts, labels and more.',
  driver: 'rest',
  connection: {
    database: 'https://world.openfoodfacts.org/api/v2'
  },
  entities: [
    {
      name: '/product',
      columns: ['code', 'product_name', 'brands', 'categories', 'labels', 'origins', 'countries', 'ingredients_text', 'nutriments', 'nutriscore_grade', 'nova_group', 'ecoscore_grade', 'image_url'],
      relations: []
    }
  ]
}
