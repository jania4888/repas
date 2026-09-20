import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import {
  gltfVisualHasRenderableMesh,
  shouldAnnounceSceneReady,
  type StreetSceneReadinessInput
} from './street-scene.runtime';

describe('street-scene.runtime — oracle de disponibilité (L0 baseline)', () => {
  const ready = (over: Partial<StreetSceneReadinessInput> = {}): StreetSceneReadinessInput => ({
    renderedFrames: 3,
    readyFacades: 2,
    expectedFacades: 2,
    alreadyAnnounced: false,
    ...over
  });

  describe('shouldAnnounceSceneReady', () => {
    it('refuse avant la première frame réellement rendue', () => {
      expect(shouldAnnounceSceneReady(ready({ renderedFrames: 0 }))).toBeFalse();
    });

    it('refuse une rue vide (aucune vitrine attendue)', () => {
      expect(
        shouldAnnounceSceneReady(ready({ expectedFacades: 0, readyFacades: 0 }))
      ).toBeFalse();
    });

    it('refuse tant qu’une façade attendue n’a pas son GLB (repli procédural seul)', () => {
      expect(shouldAnnounceSceneReady(ready({ readyFacades: 1, expectedFacades: 2 }))).toBeFalse();
    });

    it('annonce quand chaque façade attendue est attachée et qu’une frame est rendue', () => {
      expect(shouldAnnounceSceneReady(ready())).toBeTrue();
    });

    it('n’annonce jamais deux fois pour le même montage', () => {
      expect(shouldAnnounceSceneReady(ready({ alreadyAnnounced: true }))).toBeFalse();
    });
  });

  describe('gltfVisualHasRenderableMesh', () => {
    it('détecte un mesh imbriqué profondément dans la hiérarchie', () => {
      const root = new Group();
      const child = new Group();
      const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
      child.add(mesh);
      root.add(child);
      expect(gltfVisualHasRenderableMesh(root)).toBeTrue();
    });

    it('rejette une racine squelette sans aucun mesh (GLB vide)', () => {
      const root = new Group();
      root.add(new Group());
      expect(gltfVisualHasRenderableMesh(root)).toBeFalse();
    });
  });
});
