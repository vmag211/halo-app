'use client';

import { Apple, Banana, Bean, Beef, Carrot, Cherry, Citrus, Cookie, Croissant, Drumstick, Egg, Fish, Grape, IceCreamBowl, Leaf, Milk, Nut, Package, Salad, Soup, Wheat } from 'lucide-react';

function FoodIllustration({ foodId: id, guideId }: { foodId?: string; guideId?: string }) {
  if (id === 'bananas') return <Banana size={25} />;
  if (id === 'cherries' || /berries$/.test(id ?? '')) return <Cherry size={25} />;
  if (id === 'grapes') return <Grape size={25} />;
  if (['oranges', 'lemons', 'limes', 'grapefruit'].includes(id ?? '')) return <Citrus size={25} />;
  if (['carrots', 'beets', 'potatoes', 'sweet-potatoes'].includes(id ?? '')) return <Carrot size={25} />;
  if (['spinach', 'kale', 'lettuce', 'basil', 'cilantro'].includes(id ?? '')) return <Leaf size={25} />;
  if (id === 'eggs') return <Egg size={25} />;
  if (['lentils', 'chickpeas', 'black-beans', 'kidney-beans', 'tofu', 'tempeh'].includes(id ?? '')) return <Bean size={25} />;
  if (/almond|peanut|walnut/.test(id ?? '')) return <Nut size={25} />;
  if (/bread|bagel|tortilla/.test(id ?? '')) return <Croissant size={25} />;
  if (/cracker|chocolate/.test(id ?? '')) return <Cookie size={25} />;
  if (id === 'ice-cream') return <IceCreamBowl size={25} />;
  if (id === 'canned-soup') return <Soup size={25} />;
  if (/beef|pork|lamb/.test(id ?? '')) return <Beef size={25} />;
  if (id === 'apples') return <Apple size={25} />;
  return guideId === 'seafood' ? <Fish size={25} /> : guideId === 'dairy' ? <Milk size={25} /> : guideId === 'meat' ? <Drumstick size={25} /> : guideId === 'produce' ? <Salad size={25} /> : guideId === 'pantry' ? <Wheat size={25} /> : <Package size={25} />;
}

export function FoodThumb({ foodId, guideId }: { foodId?: string; guideId?: string }) {
  return <span className="hg-food-thumb" aria-hidden="true"><FoodIllustration foodId={foodId} guideId={guideId} /></span>;
}
