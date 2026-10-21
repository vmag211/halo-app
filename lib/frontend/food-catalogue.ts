import type { FoodStorage } from './food-pfas-guide';

/** Discovery names only. Catalogue membership never implies sampling, a result or a storage recommendation. */
export type CatalogueFood = { id: string; name: string; guideId: string; aliases: string[] };
const groups: [string, [string, string?][]][] = [
  ['produce', [
    ['Apples'], ['Bananas'], ['Oranges'], ['Strawberries'], ['Blueberries'], ['Raspberries'], ['Blackberries'], ['Grapes'], ['Peaches'], ['Pears'], ['Mangoes'], ['Pineapple'], ['Watermelon'], ['Cantaloupe', 'melon'], ['Lemons'], ['Limes'], ['Avocados'], ['Kiwifruit', 'kiwi'], ['Cherries'], ['Plums'], ['Grapefruit'],
    ['Tomatoes'], ['Spinach'], ['Carrots'], ['Lettuce'], ['Broccoli'], ['Cauliflower'], ['Kale'], ['Cabbage'], ['Bell peppers', 'capsicum'], ['Cucumbers'], ['Zucchini', 'courgette'], ['Potatoes'], ['Sweet potatoes'], ['Onions'], ['Garlic'], ['Mushrooms'], ['Green beans'], ['Peas'], ['Corn', 'sweetcorn'], ['Celery'], ['Asparagus'], ['Beets', 'beetroot'], ['Eggplant', 'aubergine'], ['Squash'], ['Pumpkin'], ['Basil'], ['Cilantro', 'coriander'],
  ]],
  ['seafood', [['Salmon'], ['Tuna'], ['Shrimp', 'prawns'], ['Cod'], ['Tilapia'], ['Pollock'], ['Clams'], ['Mussels'], ['Oysters'], ['Scallops'], ['Crab'], ['Lobster'], ['Catfish'], ['Trout'], ['Bass'], ['Sardines'], ['Canned tuna'], ['Frozen fish fillets']]],
  ['dairy', [['Milk'], ['Yogurt', 'yoghurt'], ['Cheese'], ['Cheddar'], ['Mozzarella'], ['Cottage cheese'], ['Cream cheese'], ['Butter'], ['Cream'], ['Sour cream'], ['Ice cream'], ['Kefir']]],
  ['meat', [['Chicken'], ['Turkey'], ['Beef'], ['Ground beef', 'beef mince hamburger'], ['Pork'], ['Lamb'], ['Bacon'], ['Sausages'], ['Ham'], ['Deli turkey'], ['Chicken nuggets']]],
  ['pantry', [
    ['Eggs'], ['Tofu'], ['Tempeh'], ['White bread'], ['Whole wheat bread', 'wholemeal bread'], ['Bagels'], ['Tortillas'], ['Pasta'], ['Macaroni and cheese', 'mac n cheese'], ['Rice'], ['Oats', 'oatmeal porridge'], ['Breakfast cereal'], ['Flour'], ['Crackers'], ['Quinoa'], ['Lentils'], ['Chickpeas', 'garbanzo beans'], ['Black beans'], ['Kidney beans'], ['Canned tomatoes'], ['Peanut butter'], ['Almond butter'], ['Peanuts'], ['Almonds'], ['Walnuts'], ['Sunflower seeds'], ['Olive oil'], ['Vegetable oil'], ['Salad dressing'], ['Mayonnaise', 'mayo'], ['Ketchup'], ['Mustard'], ['Soy sauce'], ['Sugar'], ['Honey'], ['Maple syrup'], ['Jam', 'jelly preserves'], ['Cinnamon'], ['Black pepper'], ['Turmeric'], ['Paprika'], ['Cocoa powder'], ['Chocolate'], ['Applesauce', 'apple puree'], ['Baby food', 'infant puree baby puree'], ['Infant formula', 'baby formula'], ['Orange juice'], ['Apple juice'], ['Coffee'], ['Tea'], ['Almond drink', 'almond milk'], ['Oat drink', 'oat milk'], ['Soy drink', 'soy milk soya'], ['Canned soup'], ['Frozen pizza'], ['Frozen vegetables'], ['Frozen berries'], ['Hummus'], ['Bottled water'],
  ]],
];
export const foodCatalogue: CatalogueFood[] = groups.flatMap(([guideId, items]) => items.map(([name, aliases]) => ({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, guideId, aliases: aliases ? aliases.split(' ') : [] })));
export function catalogueFood(id?: string) { return foodCatalogue.find(food => food.id === id); }
export function searchFoods(query: string) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return foodCatalogue.filter(food => terms.every(term => `${food.name} ${food.aliases.join(' ')}`.toLocaleLowerCase().includes(term)));
}
export function validFoodStorage(value: string): value is FoodStorage { return ['fridge', 'pantry', 'freezer'].includes(value); }

/** Live integration must return reviewed food-matrix evidence matched to the actual item/lot or owned sample.
 * Category studies, environmental samples and notices without a concentration cannot populate these fields.
 * Preserve compound, original value/unit/qualifier, method, basis, sample/source dates and source revision.
 * This isolated catalogue has no such service; Unknown is intentionally the only supported result.
 */
export const pantryContaminants = ['PFAS', 'Lead'] as const;
export const pantryResultLabel = 'Unknown';
