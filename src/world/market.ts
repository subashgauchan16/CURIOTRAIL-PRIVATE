// A small procedural market stall for the Trading Market: crates, a coin
// stack, a lantern and a balance. It reacts to the player's ledger: coins
// hop and the lantern flares on a right answer; crates shudder, the
// lantern turns red and the balance tips on a wrong one. Low-poly, no textures, no lights.

import * as THREE from 'three';

export interface MarketStall {
  group: THREE.Group;
  react(kind: 'right' | 'wrong', time: number): void;
  update(time: number, delta: number, still: boolean): void;
  dispose(): void;
}

export function createMarketStall(): MarketStall {
  const group = new THREE.Group();
  group.name = 'market-stall';
  const wood = new THREE.MeshLambertMaterial({ color: '#8a5a2b', flatShading: true });
  const darkWood = new THREE.MeshLambertMaterial({ color: '#5c3a1a', flatShading: true });
  const cloth = new THREE.MeshLambertMaterial({ color: '#b8452e', flatShading: true });
  const gold = new THREE.MeshLambertMaterial({ color: '#f2b134', emissive: '#7a5200', flatShading: true });
  const glow = new THREE.MeshBasicMaterial({ color: '#ffd27a' });
  const brass = new THREE.MeshLambertMaterial({ color: '#c08a1a', flatShading: true });

  // Table and awning.
  const table = new THREE.Mesh(new THREE.BoxGeometry(14, 1.2, 6), wood);
  table.position.set(0, 4, 0);
  const legGeo = new THREE.BoxGeometry(0.8, 4, 0.8);
  const legs = [-6, 6].flatMap((x) => [-2.4, 2.4].map((z) => {
    const leg = new THREE.Mesh(legGeo, darkWood);
    leg.position.set(x, 2, z);
    return leg;
  }));
  const poleGeo = new THREE.CylinderGeometry(0.35, 0.35, 12, 6);
  const poles = [-6.5, 6.5].map((x) => {
    const p = new THREE.Mesh(poleGeo, darkWood);
    p.position.set(x, 6, -2.8);
    return p;
  });
  const awning = new THREE.Mesh(new THREE.BoxGeometry(15, 0.5, 7), cloth);
  awning.position.set(0, 12, -0.5);
  awning.rotation.x = 0.18;
  group.add(table, ...legs, ...poles, awning);

  // Crates beside the stall.
  const crateGeo = new THREE.BoxGeometry(3.2, 3.2, 3.2);
  const crates = [[-10, 1.6, 1], [-10, 4.8, 1.2], [-13.5, 1.6, -0.5]].map(([x, y, z], i) => {
    const c = new THREE.Mesh(crateGeo, i === 1 ? brass : wood);
    c.position.set(x, y, z);
    c.rotation.y = i * 0.4;
    c.userData.base = c.position.clone();
    return c;
  });
  group.add(...crates);

  // Coin stack on the table.
  const coinGeo = new THREE.CylinderGeometry(0.9, 0.9, 0.35, 10);
  const coins = Array.from({ length: 7 }, (_, i) => {
    const c = new THREE.Mesh(coinGeo, gold);
    c.position.set(3 + (i % 2) * 0.3, 4.8 + i * 0.38, 0.6);
    c.userData.baseY = c.position.y;
    return c;
  });
  group.add(...coins);

  // Balance scales on the table.
  const scale = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 4.5, 6), brass);
  post.position.y = 2.25;
  const beam = new THREE.Group();
  beam.position.y = 4.5;
  const bar = new THREE.Mesh(new THREE.BoxGeometry(6, 0.25, 0.25), brass);
  const panGeo = new THREE.CylinderGeometry(1.1, 0.7, 0.3, 10);
  const pans = [-2.8, 2.8].map((x) => {
    const pan = new THREE.Mesh(panGeo, brass);
    pan.position.set(x, -1.2, 0);
    return pan;
  });
  beam.add(bar, ...pans);
  scale.add(post, beam);
  scale.position.set(-3, 4.6, 0.4);
  group.add(scale);

  // Lantern hanging from the awning (emissive only: no real light).
  const lantern = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), glow);
  lantern.position.set(5.5, 10, 1.2);
  group.add(lantern);

  let reaction: { kind: 'right' | 'wrong'; start: number } | null = null;
  let tilt = 0.25; // the scales start slightly unbalanced: the ledger is a mess

  return {
    group,
    react(kind, time) {
      reaction = { kind, start: time };
      tilt = kind === 'right' ? 0 : 0.42;
    },
    update(time, delta, still) {
      const age = reaction ? time - reaction.start : Infinity;
      beam.rotation.z += (tilt - beam.rotation.z) * Math.min(1, delta * (still ? 60 : 3));
      lantern.position.y = 10 + (still ? 0 : Math.sin(time * 1.6) * 0.25);
      const flare = reaction && age < 1.2 && !still ? 1 + (1.2 - age) * 1.4 : 1;
      lantern.scale.setScalar(flare);
      // The lantern says it even without motion: green-gold when right, red when wrong.
      glow.color.set(reaction && age < 1.6 ? (reaction.kind === 'right' ? '#b8ffcf' : '#ff6b5b') : '#ffd27a');
      coins.forEach((c, i) => {
        const hop = reaction?.kind === 'right' && age < 1.6 && !still ? Math.max(0, Math.sin((age * 6) - i * 0.5)) * 3 : 0;
        c.position.y = (c.userData.baseY as number) + hop;
      });
      crates.forEach((c, i) => {
        const base = c.userData.base as THREE.Vector3;
        const shake = reaction?.kind === 'wrong' && age < 0.9 && !still ? Math.sin(age * 50 + i) * 0.8 * (0.9 - age) : 0;
        c.position.set(base.x + shake, base.y, base.z);
      });
      if (age > 3) reaction = null;
    },
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
      [wood, darkWood, cloth, gold, glow, brass].forEach((m) => m.dispose());
    },
  };
}
