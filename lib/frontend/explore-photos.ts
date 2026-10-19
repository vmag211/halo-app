import sources from '../../public/explore/photo-sources.json';

export type ExplorePhotoScene = 'river' | 'trail' | 'garden' | 'bee' | 'tree' | 'soil' | 'water' | 'compost' | 'food' | 'moisture' | 'solar' | 'cleanup';
const originalHeights: Record<string, number> = { river: 700, trail: 1333, garden: 667 };
export const explorePhotos = sources.map(source => ({ ...source, height: 'height' in source ? source.height as number : originalHeights[source.id] }));
export const photoForScene = (scene: ExplorePhotoScene) => explorePhotos.find(photo => photo.id === scene)!;
